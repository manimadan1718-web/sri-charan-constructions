const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth, requireRole('owner', 'admin'));

// ── GET /api/summaries ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('summaries')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/summaries ──────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { period, total_diesel, total_hours, total_loads, notes } = req.body;
    if (!period) return res.status(400).json({ error: 'period is required.' });

    const { data, error } = await supabase
      .from('summaries')
      .insert({ period, total_diesel, total_hours, total_loads, notes })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/summaries/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('summaries').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
