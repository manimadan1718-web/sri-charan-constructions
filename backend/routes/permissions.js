const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm, markPermissionsColumnReady } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const P = require('../utils/permissions');

router.use(requireAuth, requirePerm('permissions.manage'));

const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const SETUP_MESSAGE = 'Permissions need a one-time database update. Run run-in-supabase-5-permissions.sql in Supabase → SQL Editor, then try again.';
const isMissingColumn = err => !!err && /permissions/i.test(String(err.message || '')) && /(column|schema cache|does not exist)/i.test(String(err.message || ''));

const personRow = u => {
  const o = P.readOverrides(u.permissions);
  return {
    id: u.id, name: u.name, role: u.role, active: u.active !== false,
    effective: P.effectivePermissions(u.role, u.permissions),
    extra: o.grant.filter(k => !(P.ROLE_DEFAULTS[u.role] || []).includes(k) && P.effectivePermissions(u.role, u.permissions).includes(k)),
    removed: o.deny.filter(k => (P.ROLE_DEFAULTS[u.role] || []).includes(k)),
  };
};

// ── GET /api/permissions — the catalogue, each role's defaults and every person's current permissions ──
router.get('/', async (req, res) => {
  try {
    let r = await supabase.from('users').select('id, name, role, active, permissions').order('name', { ascending: true });
    let columnMissing = false;
    if (r.error && isMissingColumn(r.error)) { columnMissing = true; r = await supabase.from('users').select('id, name, role, active').order('name', { ascending: true }); }
    if (r.error) throw r.error;
    res.json({
      success: true, column_ready: !columnMissing,
      catalog: P.CATALOG.map(c => ({ key: c.key, group: c.group, label: c.label, desc: c.desc, requires: c.requires || null, admin_only: !!c.adminOnly })),
      groups: P.GROUPS, role_defaults: P.ROLE_DEFAULTS,
      users: (r.data || []).map(personRow),
    });
  } catch (err) {
    serverError(res, err, 'GET /permissions');
  }
});

// ── PUT /api/permissions/:id  { permissions: [every permission the person should have], reason } ──
//      or  { reset: true, reason }  to go back to the role's defaults
router.put('/:id', async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Person not found.' });
    const { data: u, error: getErr } = await supabase.from('users').select('id, name, role, active, permissions').eq('id', req.params.id).maybeSingle();
    if (getErr) {
      if (isMissingColumn(getErr)) return res.status(503).json({ error: SETUP_MESSAGE, setup_required: true });
      throw getErr;
    }
    if (!u) return res.status(404).json({ error: 'Person not found.' });
    if (u.role === 'admin') return res.status(400).json({ error: 'An Admin always has every permission. It cannot be changed.' });

    const body = req.body || {};
    const wanted = body.reset === true ? [...P.ROLE_DEFAULTS[u.role]] : body.permissions;
    const problem = P.problemWith(wanted, u.role);
    if (problem) return res.status(400).json({ error: problem });

    const before = new Set(P.effectivePermissions(u.role, u.permissions));
    const after = P.normalise(wanted, u.role);
    const changes = P.KEYS.filter(k => before.has(k) !== after.has(k)).map(k => ({ field: P.labelOf(k), from: before.has(k) ? 'On' : 'Off', to: after.has(k) ? 'On' : 'Off' }));
    if (!changes.length) return res.json({ success: true, unchanged: true, person: personRow(u) });

    const rErr = reasonError(body.reason, "change someone's permissions");
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(body.reason);

    const overrides = P.overridesFor(u.role, [...after]);
    const { data, error } = await supabase.from('users').update({ permissions: overrides }).eq('id', u.id).select('id, name, role, active, permissions').maybeSingle();
    if (error) {
      if (isMissingColumn(error)) return res.status(503).json({ error: SETUP_MESSAGE, setup_required: true });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Person not found.' });
    markPermissionsColumnReady();

    await logActivity(req, {
      category: 'user', action: 'permissions_changed', entityType: 'user', entityId: data.id,
      entityLabel: `${data.name} · ${data.role}${body.reset === true ? ' · reset to role defaults' : ''}`, reason, changes,
    });
    res.json({ success: true, person: personRow(data) });
  } catch (err) {
    serverError(res, err, 'PUT /permissions/:id');
  }
});

module.exports = router;
