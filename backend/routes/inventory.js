const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

/* ══════════════════════════════ VEHICLES ══════════════════════════════════ */

// GET /api/inventory/vehicles — any logged-in user (populates the dropdown)
router.get('/vehicles', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .order('vehicle_no', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /inventory/vehicles:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/vehicles — Admin only
router.post('/vehicles', requireRole('admin'), async (req, res) => {
  try {
    const { vehicle_no, type } = req.body;
    if (!vehicle_no) return res.status(400).json({ error: 'Vehicle / Machine No. is required.' });

    const { data, error } = await supabase
      .from('vehicles')
      .insert({ vehicle_no, type })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'That vehicle already exists.' });
      throw error;
    }
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('POST /inventory/vehicles:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/vehicles/:id — Admin only (e.g. toggle active)
router.put('/vehicles/:id', requireRole('admin'), async (req, res) => {
  try {
    const { vehicle_no, type, active } = req.body;
    const updates = {};
    if (vehicle_no !== undefined) updates.vehicle_no = vehicle_no;
    if (type !== undefined)       updates.type       = type;
    if (active !== undefined)     updates.active     = active;

    const { data, error } = await supabase
      .from('vehicles')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Vehicle not found.' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('PUT /inventory/vehicles/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inventory/vehicles/:id — Admin only
router.delete('/vehicles/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabase.from('vehicles').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /inventory/vehicles/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════ OPERATORS ═════════════════════════════════ */

// GET /api/inventory/operators — any logged-in user (populates the dropdown)
router.get('/operators', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('operators')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /inventory/operators:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/operators — Admin only
router.post('/operators', requireRole('admin'), async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Operator name is required.' });

    const { data, error } = await supabase
      .from('operators')
      .insert({ name, phone })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('POST /inventory/operators:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/operators/:id — Admin only (e.g. toggle active)
router.put('/operators/:id', requireRole('admin'), async (req, res) => {
  try {
    const { name, phone, active } = req.body;
    const updates = {};
    if (name !== undefined)   updates.name   = name;
    if (phone !== undefined)  updates.phone  = phone;
    if (active !== undefined) updates.active = active;

    const { data, error } = await supabase
      .from('operators')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Operator not found.' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('PUT /inventory/operators/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inventory/operators/:id — Admin only
router.delete('/operators/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabase.from('operators').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /inventory/operators/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
