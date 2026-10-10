const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validatePin, isWeakPin, WEAK_PIN_MESSAGE, hashPin, matchesPin } = require('../utils/pin');
const { logActivity } = require('../utils/activity');
const { serverError } = require('../utils/http');

const roleName = r => (r ? r.charAt(0).toUpperCase() + r.slice(1) : null);

const VALID_ROLES = ['supervisor', 'owner', 'admin'];
const PIN_RULE = 'PIN must be 4–10 characters with no spaces.';

// Columns that record who created / edited / deleted a user. They come from a one-time database
// update (run-in-supabase-user-tracking.sql). Until that is run the app keeps working without them.
const TRACK_COLS = ['created_by_name', 'updated_at', 'updated_by_name', 'deleted_at', 'deleted_by_name'];
const isMissingTrackingColumn = err =>
  !!err && TRACK_COLS.some(c => String(err.message || '').includes(c)) && /(column|schema cache)/i.test(String(err.message || ''));

// All routes here are Admin-only.
router.use(requireAuth, requireRole('admin'));

/** What the browser is allowed to see of a user — never the PIN or its hash. */
const publicUser = u => ({ id: u.id, name: u.name, role: u.role, active: u.active, created_at: u.created_at });
const isDeleted = u => !!(u && u.deleted_at);

async function loadUsers() {
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// PINs are hashed, so uniqueness can no longer be enforced by the database
// (every hash is different). Check it here by comparing against every user.
async function pinInUse(pin, exceptId) {
  for (const u of await loadUsers()) {
    if (isDeleted(u) || (exceptId && u.id === exceptId)) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await matchesPin(pin, u.pin)) return true;
  }
  return false;
}

// ── GET /api/users  (deleted users are not shown here — only in the downloaded report) ──
router.get('/', async (req, res) => {
  try {
    res.json({ success: true, data: (await loadUsers()).filter(u => !isDeleted(u)).map(publicUser) });
  } catch (err) {
    serverError(res, err, 'GET /users');
  }
});

// ── POST /api/users ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const { pin, role } = req.body;
    if (!name || !pin || !role) {
      return res.status(400).json({ error: 'Name, PIN and role are required.' });
    }
    if (name.length > 80) return res.status(400).json({ error: 'Name is too long (80 characters at most).' });
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be supervisor, owner or admin.' });
    }
    if (!validatePin(pin)) return res.status(400).json({ error: PIN_RULE });
    if (isWeakPin(pin)) return res.status(400).json({ error: WEAK_PIN_MESSAGE });
    if (await pinInUse(pin)) return res.status(409).json({ error: 'That PIN is already in use.' });

    const row = { name, pin: await hashPin(pin), role };
    let { data, error } = await supabase.from('users').insert({ ...row, created_by_name: req.user.name }).select('*').single();
    if (error && isMissingTrackingColumn(error)) ({ data, error } = await supabase.from('users').insert(row).select('*').single());
    if (error) throw error;

    await logActivity(req, {
      category: 'user', action: 'user_created', entityType: 'user', entityId: data.id,
      entityLabel: data.name, changes: [{ field: 'Role', from: null, to: roleName(data.role) }],
    });
    res.status(201).json({ success: true, data: publicUser(data) });
  } catch (err) {
    serverError(res, err, 'POST /users');
  }
});

// ── PUT /api/users/:id  (edit name / pin / role / active) ────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, pin, role, active } = req.body;

    if (role !== undefined && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be supervisor, owner or admin.' });
    }
    if (id === req.user.id && active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }
    if (id === req.user.id && role !== undefined && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role.' });
    }

    const updates = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Name cannot be empty.' });
      if (name.trim().length > 80) return res.status(400).json({ error: 'Name is too long (80 characters at most).' });
      updates.name = name.trim();
    }
    if (pin !== undefined) {
      if (!validatePin(pin)) return res.status(400).json({ error: PIN_RULE });
      if (isWeakPin(pin)) return res.status(400).json({ error: WEAK_PIN_MESSAGE });
      if (await pinInUse(pin, id)) return res.status(409).json({ error: 'That PIN is already in use.' });
      updates.pin = await hashPin(pin);
    }
    if (role !== undefined)   updates.role   = role;
    if (active !== undefined) updates.active = !!active;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const { data: before, error: getErr } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (getErr) throw getErr;
    if (!before || isDeleted(before)) return res.status(404).json({ error: 'User not found.' });

    // What changed — the PIN itself is never logged, only that it was reset.
    const changes = [];
    if (updates.name !== undefined && updates.name !== before.name)     changes.push({ field: 'Name', from: before.name, to: updates.name });
    if (updates.role !== undefined && updates.role !== before.role)     changes.push({ field: 'Role', from: roleName(before.role), to: roleName(updates.role) });
    if (updates.active !== undefined && updates.active !== before.active) changes.push({ field: 'Status', from: before.active ? 'Active' : 'Inactive', to: updates.active ? 'Active' : 'Inactive' });
    if (updates.pin !== undefined) changes.push({ field: 'PIN', from: null, to: 'Reset' });

    // Nothing really changed (for example the dialog was saved untouched) → leave the record alone.
    const anyChange = changes.length > 0;
    const track = anyChange ? { updated_at: new Date().toISOString(), updated_by_name: req.user.name } : {};

    let { data, error } = await supabase.from('users').update({ ...updates, ...track }).eq('id', id).select('*').maybeSingle();
    if (error && isMissingTrackingColumn(error)) ({ data, error } = await supabase.from('users').update(updates).eq('id', id).select('*').maybeSingle());
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found.' });

    if (anyChange) {
      await logActivity(req, {
        category: 'user', action: 'user_updated', entityType: 'user', entityId: id,
        entityLabel: data.name, changes,
      });
    }

    res.json({ success: true, data: publicUser(data), unchanged: !anyChange });
  } catch (err) {
    serverError(res, err, 'PUT /users/:id');
  }
});

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
// The person can no longer log in and disappears from the Users screen, but the record is kept
// (marked deleted, with who and when) so the downloaded Users report can still list them.
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const { data: before, error: getErr } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
    if (getErr) throw getErr;
    if (before && !isDeleted(before)) {
      // The old PIN is destroyed: it is replaced by a hash of random bytes nobody knows.
      const unusable = await hashPin(crypto.randomBytes(32).toString('hex'));
      const { error } = await supabase.from('users')
        .update({ active: false, pin: unusable, deleted_at: new Date().toISOString(), deleted_by_name: req.user.name }).eq('id', id);
      if (error && isMissingTrackingColumn(error)) {
        // The database update for tracking has not been run yet: fall back to removing the row.
        const { error: delErr } = await supabase.from('users').delete().eq('id', id);
        if (delErr) throw delErr;
      } else if (error) {
        throw error;
      }
      await logActivity(req, {
        category: 'user', action: 'user_deleted', entityType: 'user', entityId: id,
        entityLabel: before.name, changes: [{ field: 'Role', from: roleName(before.role), to: null }],
      });
    }
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'DELETE /users/:id');
  }
});

module.exports = router;
