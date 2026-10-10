const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isMissingTable, logActivity } = require('../utils/activity');
const { serverError } = require('../utils/http');
const lq = require('../utils/logQuery');

// Owner + Admin can READ the log. There is no way to edit a log row. Only an Admin can delete rows
// (to clear test data), and every deletion leaves a record of its own that cannot be deleted.
router.use(requireAuth, requireRole('owner', 'admin'));

const ID_RE = /^[0-9A-Za-z_-]{8,64}$/;

function fail(res, err, where) {
  console.error(`${where}:`, err.message);
  if (isMissingTable(err)) {
    return res.status(503).json({
      error: 'The activity log table has not been created yet. Run run-in-supabase-logs.sql in Supabase → SQL Editor.',
      setup_required: true,
    });
  }
  return serverError(res, err, where);
}

// ── GET /api/logs ─ filters: category, q, from, to, limit, offset ───────────
router.get('/', async (req, res) => {
  try {
    const { category, q, from, to } = req.query;
    const limit  = Math.min(Math.max(parseInt(req.query.limit, 10)  || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

    let filters;
    try { filters = lq.normalizeFilters({ category, q, from, to }); }
    catch (e) { return res.status(e.status || 400).json({ error: e.userMessage || 'Invalid filters.' }); }

    const { data, error, count } = await lq.applyLogFilters(
      supabase.from('activity_logs').select('*', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }),
      filters,
    ).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ success: true, data, total: count ?? data.length, limit, offset });
  } catch (err) {
    fail(res, err, 'GET /logs');
  }
});

// ── GET /api/logs/entry/:id ─ full history of one entry (newest first) ──────
router.get('/entry/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('entity_type', 'entry')
      .eq('entity_id', req.params.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    fail(res, err, 'GET /logs/entry/:id');
  }
});

// ── POST /api/logs/entry-counts ─ { ids: [...] } → how many times each was edited ──
router.post('/entry-counts', async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? [...new Set(req.body.ids.filter(x => typeof x === 'string' && x.length <= 64))].slice(0, 5000)
      : [];
    const counts = {};
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase
        .from('activity_logs')
        .select('entity_id')
        .eq('action', 'entry_updated')
        .in('entity_id', chunk);
      if (error) throw error;
      (data || []).forEach(r => { counts[r.entity_id] = (counts[r.entity_id] || 0) + 1; });
    }
    res.json({ success: true, counts });
  } catch (err) {
    fail(res, err, 'POST /logs/entry-counts');
  }
});

// ── DELETE /api/logs  (Admin only) ──────────────────────────────────────────
// Body: { ids: [...] }                         → delete exactly those rows
//       { filters: { category, q, from, to } } → delete everything matching the filters ({} = everything)
// Deleting more than one row needs  confirm: "DELETE"  (the screen asks the person to type it).
// The "logs deleted" record is never removed, and a new one is written for every clean-up.
router.delete('/', requireRole('admin'), async (req, res) => {
  try {
    const body = req.body || {};
    let ids = null, filters = null;
    if (Array.isArray(body.ids)) {
      ids = [...new Set(body.ids)];
      if (!ids.length) return res.status(400).json({ error: 'Choose which entries to delete.' });
      if (ids.length > 5000) return res.status(400).json({ error: 'Too many entries at once. Delete in smaller batches.' });
      if (!ids.every(id => typeof id === 'string' && ID_RE.test(id))) return res.status(400).json({ error: 'Some of the selected entries are not valid.' });
    } else if (body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters)) {
      try { filters = lq.normalizeFilters(body.filters); }
      catch (e) { return res.status(e.status || 400).json({ error: e.userMessage || 'Invalid filters.' }); }
    } else {
      return res.status(400).json({ error: 'Choose which entries to delete.' });
    }
    if ((filters || ids.length > 1) && body.confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Type DELETE to confirm deleting several entries.' });
    }

    // Which rows really exist and may be removed (the protected record is skipped).
    let targets = [];
    if (filters) {
      targets = await lq.collectDeletable(filters);
    } else {
      for (let i = 0; i < ids.length; i += 100) {
        // eslint-disable-next-line no-await-in-loop
        const { data, error } = await supabase.from('activity_logs').select('id, action, category, created_at')
          .in('id', ids.slice(i, i + 100)).neq('action', lq.PROTECTED_ACTION);
        if (error) throw error;
        targets.push(...(data || []));
      }
    }
    const skipped = ids ? ids.length - targets.length : 0;
    if (!targets.length) return res.json({ success: true, deleted: 0, skipped });

    for (let i = 0; i < targets.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from('activity_logs').delete().in('id', targets.slice(i, i + 100).map(t => t.id));
      if (error) throw error;
    }

    // Leave a permanent trace: who cleaned the log, how much, and of what kind.
    const byAction = {};
    targets.forEach(t => { byAction[t.action] = (byAction[t.action] || 0) + 1; });
    const times = targets.map(t => t.created_at).sort();
    const first = lq.fmtIstDate(times[0]), last = lq.fmtIstDate(times[times.length - 1]);
    const n = targets.length;
    await logActivity(req, {
      category: 'system', action: lq.PROTECTED_ACTION, entityType: 'log',
      entityLabel: `Deleted ${n} log entr${n === 1 ? 'y' : 'ies'} · ${first === last ? first : `${first} – ${last}`}`,
      changes: Object.entries(byAction).sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([action, c]) => ({ field: action.replace(/_/g, ' '), from: String(c), to: null })),
    });

    res.json({ success: true, deleted: n, skipped });
  } catch (err) {
    fail(res, err, 'DELETE /logs');
  }
});

module.exports = router;
