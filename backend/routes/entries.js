const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  logActivity, cleanReason, reasonError, entryDiff, entrySnapshot, entryLabel,
} = require('../utils/activity');

router.use(requireAuth);

// "YYYY-MM" -> "YYYY-MM-01" of the FOLLOWING month (exclusive upper bound).
// Using this with .lt() avoids building an invalid literal like "2026-02-31"
// for months that don't have 31 days, which Postgres rejects outright.
function getNextMonthStart(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  let year = parseInt(match[1], 10);
  let m = parseInt(match[2], 10);
  if (m < 1 || m > 12) return null;
  m += 1;
  if (m > 12) { m = 1; year += 1; }
  return `${year}-${String(m).padStart(2, '0')}-01`;
}

function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const str = v => (v === undefined || v === null ? null : String(v).trim());

/**
 * Validates + normalises the body shared by POST and PUT.
 * Returns { error } or { fields, rows }.
 */
function parseEntryBody(body) {
  const b = body || {};
  const vehicle_no = str(b.vehicle_no);
  if (!b.date || !vehicle_no) return { error: 'date and vehicle_no are required.' };
  if (!isValidDate(b.date)) return { error: 'date must be a valid date in YYYY-MM-DD format.' };

  const diesel = b.diesel === undefined || b.diesel === null || b.diesel === '' ? 0 : Number(b.diesel);
  const loads  = b.loads  === undefined || b.loads  === null || b.loads  === '' ? 0 : Number(b.loads);
  if (!Number.isFinite(diesel) || diesel < 0 || diesel > 999999) return { error: 'diesel must be a number between 0 and 999999.' };
  if (!Number.isInteger(loads) || loads < 0 || loads > 100000000) return { error: 'loads must be a whole number of 0 or more.' };

  const fields = {
    date: b.date,
    vehicle_no,
    start_reading: str(b.start_reading),
    close_reading: str(b.close_reading),
    working_hours: str(b.working_hours),
    diesel,
    loads,
    operator: str(b.operator),
    remarks: str(b.remarks),
    site: str(b.site),
    category: b.category === 'rental' ? 'rental' : 'own',
  };

  const rows = (Array.isArray(b.breakup_rows) ? b.breakup_rows : [])
    .map(r => ({ description: str(r && r.description) || '', quantity: str(r && r.quantity) || '' }))
    .filter(r => r.description || r.quantity);

  return { fields, rows };
}

// ── GET /api/entries  (Owner + Admin — "Records" & "Summary" reports) ───────
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { date, date_from, date_to, vehicle, site, month, vehicle_no, site_name, category, type } = req.query;

    let query = supabase
      .from('entries')
      .select('*, breakup_rows(*)')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (date)      query = query.eq('date', date);
    if (date_from) query = query.gte('date', date_from);
    if (date_to)   query = query.lte('date', date_to);
    if (vehicle)   query = query.ilike('vehicle_no', `%${vehicle}%`);
    if (site)      query = query.ilike('site', `%${site}%`);
    // Exact matches — used by the Records dropdowns (values come from the inventory lists)
    if (vehicle_no) query = query.eq('vehicle_no', vehicle_no);
    if (site_name)  query = query.eq('site', site_name);
    if (category) {
      if (!['own', 'rental'].includes(category)) return res.status(400).json({ error: 'category must be "own" or "rental".' });
      query = query.eq('category', category);
    }
    if (month) {
      const nextMonth = getNextMonthStart(month);
      if (!nextMonth) return res.status(400).json({ error: 'month must be in YYYY-MM format.' });
      query = query.gte('date', `${month}-01`).lt('date', nextMonth);
    }

    // Vehicle TYPE (Tipper, JCB, …) is stored in Inventory, not on the entry, so look up
    // which vehicle numbers have that type and filter the entries by those numbers.
    // Case-insensitive; % and _ are escaped so they can't act as wildcards.
    if (typeof type === 'string' && type.trim()) {
      const exact = type.trim().replace(/[\\%_]/g, '\\$&');
      const { data: vs, error: vErr } = await supabase.from('vehicles').select('vehicle_no').ilike('type', exact);
      if (vErr) throw vErr;
      const numbers = (vs || []).map(v => v.vehicle_no);
      if (!numbers.length) return res.json({ success: true, data: [] });
      query = query.in('vehicle_no', numbers);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /entries:', err.message);
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
      if (!nextMonth) return res.status(400).json({ error: 'month must be in YYYY-MM format.' });
      query = query.gte('date', `${month}-01`).lt('date', nextMonth);
    }

    const { data, error } = await query;
    if (error) throw error;

    const stats = {
      total_entries: data.length,
      total_diesel: data.reduce((a, e) => a + (parseFloat(e.diesel) || 0), 0).toFixed(2),
      total_loads: data.reduce((a, e) => a + (parseInt(e.loads, 10) || 0), 0),
      unique_vehicles: new Set(data.map(e => e.vehicle_no)).size,
    };

    res.json({ success: true, data: stats });
  } catch (err) {
    console.error('GET /entries/summary-stats:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/entries  (Supervisor + Admin — "Data Entry") ──────────────────
router.post('/', requireRole('supervisor', 'admin'), async (req, res) => {
  let createdId = null;
  try {
    const parsed = parseEntryBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .insert(parsed.fields)
      .select()
      .single();

    if (entryErr) throw entryErr;
    createdId = entry.id;

    if (parsed.rows.length > 0) {
      const { error: buErr } = await supabase
        .from('breakup_rows')
        .insert(parsed.rows.map(r => ({ entry_id: entry.id, ...r })));
      if (buErr) throw buErr;
    }

    await logActivity(req, {
      category: 'entry', action: 'entry_created', entityType: 'entry', entityId: entry.id,
      entityLabel: entryLabel(parsed.fields),
      changes: entrySnapshot(parsed.fields, parsed.rows, 'to'),
    });

    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    console.error('POST /entries:', err.message);
    // Don't leave a half-saved entry (entry without its breakup rows) behind.
    if (createdId) await supabase.from('entries').delete().eq('id', createdId);
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/entries/:id  (Admin only — edit an existing entry) ─────────────
// Every real change needs a written reason (10+ characters) and is recorded in
// the activity log together with exactly what changed.
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  let snapshot = null; // original entry + breakup rows, used to roll back on failure
  let entryChanged = false;
  let rowsReplaced = false;

  try {
    const parsed = parseEntryBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { data: original, error: getErr } = await supabase
      .from('entries')
      .select('*, breakup_rows(*)')
      .eq('id', id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!original) return res.status(404).json({ error: 'Entry not found.' });
    snapshot = original;

    const changes = entryDiff(original, parsed.fields, parsed.rows);
    if (!changes.length) {
      // Nothing actually differs — don't touch the record or ask for a reason.
      const { breakup_rows, ...plain } = original;
      return res.json({ success: true, unchanged: true, data: plain });
    }

    const rErr = reasonError(req.body.reason, 'change an entry');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .update(parsed.fields)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (entryErr) throw entryErr;
    entryChanged = true;
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });

    // Replace breakup rows: delete old, insert new
    const { error: delErr } = await supabase.from('breakup_rows').delete().eq('entry_id', id);
    if (delErr) throw delErr;
    rowsReplaced = true;

    if (parsed.rows.length > 0) {
      const { error: buErr } = await supabase
        .from('breakup_rows')
        .insert(parsed.rows.map(r => ({ entry_id: id, ...r })));
      if (buErr) throw buErr;
    }

    await logActivity(req, {
      category: 'entry', action: 'entry_updated', entityType: 'entry', entityId: id,
      entityLabel: entryLabel(parsed.fields), reason, changes,
    });

    res.json({ success: true, data: entry });
  } catch (err) {
    console.error('PUT /entries/:id:', err.message);
    // Best-effort rollback so a failed edit can't silently wipe the old breakup rows.
    if (snapshot) {
      try {
        const { breakup_rows: oldRows = [], ...oldEntry } = snapshot;
        if (entryChanged) {
          const { id: _omit, created_at: _c, ...restore } = oldEntry;
          await supabase.from('entries').update(restore).eq('id', id);
        }
        if (rowsReplaced) {
          await supabase.from('breakup_rows').delete().eq('entry_id', id);
          if (oldRows.length) await supabase.from('breakup_rows').insert(oldRows);
        }
      } catch (rbErr) {
        console.error('PUT /entries/:id rollback failed:', rbErr.message);
      }
    }
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/entries/:id  (Admin only — needs a written reason) ───────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const rErr = reasonError(req.body && req.body.reason, 'delete an entry');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: original, error: getErr } = await supabase
      .from('entries')
      .select('*, breakup_rows(*)')
      .eq('id', id)
      .maybeSingle();
    if (getErr) throw getErr;
    if (!original) return res.status(404).json({ error: 'Entry not found.' });

    // breakup_rows delete cascades automatically
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (error) throw error;

    // The log keeps a full copy of what was deleted.
    await logActivity(req, {
      category: 'entry', action: 'entry_deleted', entityType: 'entry', entityId: id,
      entityLabel: entryLabel(original), reason,
      changes: entrySnapshot(original, original.breakup_rows, 'from'),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /entries:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
