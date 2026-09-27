const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_ROLES = ['supervisor', 'owner', 'admin'];

// All routes here are Admin-only.
router.use(requireAuth, requireRole('admin'));

// ── GET /api/users ────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, name, pin, role, active, created_at')
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
    const { name, pin, role } = req.body;
    if (!name || !pin || !role) {
      return res.status(400).json({ error: 'Name, PIN and role are required.' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be supervisor, owner or admin.' });
    }

    const { data, error } = await supabase
      .from('users')
      .insert({ name, pin, role })
      .select('id, name, pin, role, active, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That PIN is already in use.' });
      throw error;
    }

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

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: 'Role must be supervisor, owner or admin.' });
    }
    if (id === req.user.id && active === false) {
      return res.status(400).json({ error: 'You cannot deactivate your own account.' });
    }
    if (id === req.user.id && role && role !== 'admin') {
      return res.status(400).json({ error: 'You cannot remove your own admin role.' });
    }

    const updates = {};
    if (name !== undefined)   updates.name   = name;
    if (pin !== undefined)    updates.pin    = pin;
    if (role !== undefined)   updates.role   = role;
    if (active !== undefined) updates.active = active;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('id, name, pin, role, active, created_at')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That PIN is already in use.' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'User not found.' });

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

    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /users/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
