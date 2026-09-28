const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, simpleSnapshot } = require('../utils/activity');

const SUMMARY_FIELDS = [
  ['period', 'Period'], ['total_diesel', 'Diesel (L)'], ['total_hours', 'Hours'], ['total_loads', 'Loads'], ['notes', 'Notes'],
];

// Read access: owner + admin can view summaries.
// Write/delete access is intentionally restricted to admin only (see below).
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
    console.error('GET /summaries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/summaries ──────────────────────────────────────────────────────
router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const period = typeof b.period === 'string' ? b.period.trim() : '';
    if (!period) return res.status(400).json({ error: 'period is required.' });

    const total_diesel = b.total_diesel === undefined || b.total_diesel === null || b.total_diesel === '' ? 0 : Number(b.total_diesel);
    const total_loads  = b.total_loads  === undefined || b.total_loads  === null || b.total_loads  === '' ? 0 : Number(b.total_loads);
    if (!Number.isFinite(total_diesel) || total_diesel < 0) return res.status(400).json({ error: 'total_diesel must be 0 or more.' });
    if (!Number.isInteger(total_loads) || total_loads < 0) return res.status(400).json({ error: 'total_loads must be a whole number of 0 or more.' });

    const { data, error } = await supabase
      .from('summaries')
      .insert({
        period,
        total_diesel,
        total_hours: typeof b.total_hours === 'string' ? b.total_hours.trim() : null,
        total_loads,
        notes: typeof b.notes === 'string' ? b.notes.trim() : null,
      })
      .select()
      .single();

    if (error) throw error;
    await logActivity(req, {
      category: 'summary', action: 'summary_created', entityType: 'summary', entityId: data.id,
      entityLabel: data.period, changes: simpleSnapshot(data, SUMMARY_FIELDS, 'to'),
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('POST /summaries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/summaries/:id ────────────────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { data: before } = await supabase.from('summaries').select('*').eq('id', req.params.id).maybeSingle();
    const { error } = await supabase.from('summaries').delete().eq('id', req.params.id);
    if (error) throw error;
    if (before) {
      await logActivity(req, {
        category: 'summary', action: 'summary_deleted', entityType: 'summary', entityId: before.id,
        entityLabel: before.period, changes: simpleSnapshot(before, SUMMARY_FIELDS, 'from'),
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /summaries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
