const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

// "YYYY-MM" -> "YYYY-MM-01" of the FOLLOWING month (exclusive upper bound).
// Using this with .lt() avoids building an invalid literal like "2026-02-31"
// for months that don't have 31 days, which Postgres rejects outright.
function getNextMonthStart(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  let year = parseInt(match[1], 10);
  let m = parseInt(match[2], 10);
  m += 1;
  if (m > 12) { m = 1; year += 1; }
  return `${year}-${String(m).padStart(2, '0')}-01`;
}

// ── GET /api/entries  (Owner + Admin — "Records" & "Summary" reports) ───────
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { date, date_from, date_to, vehicle, month } = req.query;

    let query = supabase
      .from('entries')
      .select('*, breakup_rows(*)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (date)      query = query.eq('date', date);
    if (date_from) query = query.gte('date', date_from);
    if (date_to)   query = query.lte('date', date_to);
    if (vehicle)   query = query.ilike('vehicle_no', `%${vehicle}%`);
    if (month) {
      const nextMonth = getNextMonthStart(month);
      if (nextMonth) query = query.gte('date', `${month}-01`).lt('date', nextMonth);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /entries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/entries  (Supervisor + Admin — "Data Entry") ──────────────────
router.post('/', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const {
      date, vehicle_no, start_reading, close_reading,
      working_hours, diesel, loads, operator, remarks,
      breakup_rows: breakupRows = []
    } = req.body;

    if (!date || !vehicle_no) {
      return res.status(400).json({ error: 'date and vehicle_no are required.' });
    }

    // Insert entry
    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .insert({ date, vehicle_no, start_reading, close_reading, working_hours, diesel, loads, operator, remarks })
      .select()
      .single();

    if (entryErr) throw entryErr;

    // Insert breakup rows if any
    if (breakupRows.length > 0) {
      const rows = breakupRows
        .filter(r => r.description || r.quantity)
        .map(r => ({ entry_id: entry.id, description: r.description, quantity: r.quantity }));

      if (rows.length > 0) {
        const { error: buErr } = await supabase.from('breakup_rows').insert(rows);
        if (buErr) throw buErr;
      }
    }

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error('POST /entries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/entries/:id  (Admin only — edit an existing entry) ─────────────
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date, vehicle_no, start_reading, close_reading,
      working_hours, diesel, loads, operator, remarks,
      breakup_rows: breakupRows = []
    } = req.body;

    if (!date || !vehicle_no) {
      return res.status(400).json({ error: 'date and vehicle_no are required.' });
    }

    // Update the entry itself
    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .update({ date, vehicle_no, start_reading, close_reading, working_hours, diesel, loads, operator, remarks })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (entryErr) throw entryErr;
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });

    // Replace breakup rows: delete old, insert new
    const { error: delErr } = await supabase.from('breakup_rows').delete().eq('entry_id', id);
    if (delErr) throw delErr;

    const rows = (breakupRows || [])
      .filter(r => r.description || r.quantity)
      .map(r => ({ entry_id: id, description: r.description, quantity: r.quantity }));

    if (rows.length > 0) {
      const { error: buErr } = await supabase.from('breakup_rows').insert(rows);
      if (buErr) throw buErr;
    }

    res.json({ success: true, data: entry });
  } catch (err) {
    console.error('PUT /entries/:id:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/entries/:id  (Admin only) ────────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    // breakup_rows delete cascades automatically
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /entries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/entries/summary-stats  (Owner + Admin — aggregated totals) ─────
router.get('/summary-stats', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { month } = req.query;

    let query = supabase.from('entries').select('diesel, loads, vehicle_no, date');
    if (month) {
      const nextMonth = getNextMonthStart(month);
      if (nextMonth) query = query.gte('date', `${month}-01`).lt('date', nextMonth);
    }

    const { data, error } = await query;
    if (error) throw error;

    const stats = {
      total_entries: data.length,
      total_diesel: data.reduce((a, e) => a + (parseFloat(e.diesel) || 0), 0).toFixed(2),
      total_loads: data.reduce((a, e) => a + (parseInt(e.loads) || 0), 0),
      unique_vehicles: [...new Set(data.map(e => e.vehicle_no))].length,
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('GET /entries/summary-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
