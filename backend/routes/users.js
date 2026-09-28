const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validatePin, hashPin, matchesPin } = require('../utils/pin');
const { logActivity } = require('../utils/activity');

const roleName = r => (r ? r.charAt(0).toUpperCase() + r.slice(1) : null);

const VALID_ROLES = ['supervisor', 'owner', 'admin'];
const PUBLIC_COLS = 'id, name, role, active, created_at'; // never send PINs / hashes to the browser
const PIN_RULE = 'PIN must be 4–10 characters with no spaces.';

// All routes here are Admin-only.
router.use(requireAuth, requireRole('admin'));

// PINs are hashed, so uniqueness can no longer be enforced by the database
// (every hash is different). Check it here by comparing against every user.
async function pinInUse(pin, exceptId) {
  const { data, error } = await supabase.from('users').select('id, pin');
  if (error) throw error;
  for (const u of data || []) {
    if (exceptId && u.id === exceptId) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await matchesPin(pin, u.pin)) return true;
  }
  return false;
}

// ── GET /api/users ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(PUBLIC_COLS)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /users:', err.message);
    res.status(500).json({ error: err.message });
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
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be supervisor, owner or admin.' });
    }
    if (!validatePin(pin)) return res.status(400).json({ error: PIN_RULE });
    if (await pinInUse(pin)) return res.status(409).json({ error: 'That PIN is already in use.' });

    const { data, error } = await supabase
      .from('users')
      .insert({ name, pin: await hashPin(pin), role })
      .select(PUBLIC_COLS)
      .single();

    if (error) throw error;
    await logActivity(req, {
      category: 'user', action: 'user_created', entityType: 'user', entityId: data.id,
      entityLabel: data.name, changes: [{ field: 'Role', from: null, to: roleName(data.role) }],
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('POST /users:', err.message);
    res.status(500).json({ error: err.message });
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
      updates.name = name.trim();
    }
    if (pin !== undefined) {
      if (!validatePin(pin)) return res.status(400).json({ error: PIN_RULE });
      if (await pinInUse(pin, id)) return res.status(409).json({ error: 'That PIN is already in use.' });
      updates.pin = await hashPin(pin);
    }
    if (role !== undefined)   updates.role   = role;
    if (active !== undefined) updates.active = !!active;

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nothing to update.' });
    }

    const { data: before, error: getErr } = await supabase
      .from('users').select(PUBLIC_COLS).eq('id', id).maybeSingle();
    if (getErr) throw getErr;
    if (!before) return res.status(404).json({ error: 'User not found.' });

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select(PUBLIC_COLS)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found.' });

    // What changed — the PIN itself is never logged, only that it was reset.
    const changes = [];
    if (updates.name !== undefined && updates.name !== before.name)     changes.push({ field: 'Name', from: before.name, to: updates.name });
    if (updates.role !== undefined && updates.role !== before.role)     changes.push({ field: 'Role', from: roleName(before.role), to: roleName(updates.role) });
    if (updates.active !== undefined && updates.active !== before.active) changes.push({ field: 'Status', from: before.active ? 'Active' : 'Inactive', to: updates.active ? 'Active' : 'Inactive' });
    if (updates.pin !== undefined) changes.push({ field: 'PIN', from: null, to: 'Reset' });
    if (changes.length) {
      await logActivity(req, {
        category: 'user', action: 'user_updated', entityType: 'user', entityId: id,
        entityLabel: data.name, changes,
      });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error('PUT /users/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/users/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account.' });
    }

    const { data: before } = await supabase.from('users').select(PUBLIC_COLS).eq('id', id).maybeSingle();
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    if (before) {
      await logActivity(req, {
        category: 'user', action: 'user_deleted', entityType: 'user', entityId: id,
        entityLabel: before.name, changes: [{ field: 'Role', from: roleName(before.role), to: null }],
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
