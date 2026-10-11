const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const {
  logActivity, cleanReason, reasonError, entryDiff, entrySnapshot, entryLabel,
} = require('../utils/activity');
const photos = require('../utils/photos');
const { serverError } = require('../utils/http');
const lp = require('../utils/loadPoints');
const { fetchAll } = require('../utils/db');
const { summaryFor } = require('../utils/summary');

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

/** ?from / ?to (YYYY-MM-DD) or ?month (YYYY-MM) → { from, to } or { error }. Either end may be missing. */
function summaryRange(q) {
  let { from, to } = q;
  if (q.month) {
    const next = getNextMonthStart(q.month);
    if (!next) return { error: 'month must be in YYYY-MM format.' };
    from = `${q.month}-01`;
    const d = new Date(`${next}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1);
    to = d.toISOString().slice(0, 10);
  }
  if (from && !isValidDate(from)) return { error: 'from must be a date in YYYY-MM-DD format.' };
  if (to && !isValidDate(to))     return { error: 'to must be a date in YYYY-MM-DD format.' };
  if (from && to && from > to)    return { error: 'The "from" date cannot be after the "to" date.' };
  return { from: from || null, to: to || null };
}

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

  // (Work Breakup was removed. A page that still sends `breakup_rows` is simply ignored.)

  // Photo proof (start / close reading and diesel). A photo is only ever a path our own upload route handed out.
  //   key missing        → "leave as it is"
  //   null / ''          → "remove the photo"
  //   valid path string  → "attach this photo"
  const photoInput = {};
  for (const col of photos.PHOTO_COLUMNS) {
    if (!(col in b)) continue;
    const v = b[col];
    if (v === null || v === '') { photoInput[col] = null; continue; }
    // Either a freshly uploaded photo (pending/…) or, when editing, the entry's own saved photo (readings/…).
    if (!photos.isPendingPath(v) && !photos.isReadingPath(v)) return { error: 'One of the attached photos is not valid. Please attach it again.' };
    photoInput[col] = v;
  }

  // Loads breakup: the unloading points must add up to Loads (checked by parsePoints).
  const pp = lp.parsePoints(b.load_points, loads);
  if (pp.error) return { error: pp.error };

  return { fields, photoInput, points: pp.points };
}

/** Checks that each photo path being attached really exists in storage. Returns an error message or null. */
async function checkPhotosExist(paths) {
  for (const p of paths) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await photos.photoExists(p))) return 'An attached photo could not be found. Please attach it again.';
  }
  return null;
}

/** Sends the "database needs its one-time update" message instead of a raw database error. */
function sendSaveError(res, err) {
  if (photos.isMissingPhotoColumn(err)) {
    return res.status(503).json({ error: photos.PHOTO_SETUP_MESSAGE, setup_required: true });
  }
  if (lp.isMissingLoadPoints(err)) {
    return res.status(503).json({ error: lp.LOAD_POINTS_SETUP_MESSAGE, setup_required: true });
  }
  return serverError(res, err, 'entry save');
}

/** Reads entries together with their unloading points. Works even before the one-time SQL has been run. */
async function withPoints(build) {
  let r = await build('*, load_points(*)');
  if (r.error && lp.isMissingLoadPoints(r.error)) r = await build('*');
  return r;
}

// ── GET /api/entries  (Owner + Admin — "Records" & "Summary" reports) ───────
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { date, date_from, date_to, vehicle, site, month, vehicle_no, site_name, category, type } = req.query;

    if (category && !['own', 'rental'].includes(category)) return res.status(400).json({ error: 'category must be "own" or "rental".' });
    let monthRange = null;
    if (month) {
      const nextMonth = getNextMonthStart(month);
      if (!nextMonth) return res.status(400).json({ error: 'month must be in YYYY-MM format.' });
      monthRange = [`${month}-01`, nextMonth];
    }

    // Vehicle TYPE (Tipper, JCB, …) is stored in Inventory, not on the entry, so look up
    // which vehicle numbers have that type and filter the entries by those numbers.
    // Case-insensitive; % and _ are escaped so they can't act as wildcards.
    let typeNumbers = null;
    if (typeof type === 'string' && type.trim()) {
      const exact = type.trim().replace(/[\\%_]/g, '\\$&');
      const { data: vs, error: vErr } = await supabase.from('vehicles').select('vehicle_no').ilike('type', exact);
      if (vErr) throw vErr;
      typeNumbers = (vs || []).map(v => v.vehicle_no);
      if (!typeNumbers.length) return res.json({ success: true, data: [] });
    }

    const build = cols => {
      let query = supabase.from('entries').select(cols)
        .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
      if (date)      query = query.eq('date', date);
      if (date_from) query = query.gte('date', date_from);
      if (date_to)   query = query.lte('date', date_to);
      if (vehicle)   query = query.ilike('vehicle_no', `%${vehicle}%`);
      if (site)      query = query.ilike('site', `%${site}%`);
      // Exact matches — used by the Records dropdowns (values come from the inventory lists)
      if (vehicle_no) query = query.eq('vehicle_no', vehicle_no);
      if (site_name)  query = query.eq('site', site_name);
      if (category)   query = query.eq('category', category);
      if (monthRange) query = query.gte('date', monthRange[0]).lt('date', monthRange[1]);
      if (typeNumbers) query = query.in('vehicle_no', typeNumbers);
      return query;
    };

    // Every page is read, so the list never silently stops at 1,000 records.
    const { data, error } = await withPoints(cols => fetchAll(() => build(cols)));
    if (error) throw error;

    res.json({ success: true, data });
  } catch (err) {
    return serverError(res, err, 'GET /entries');
  }
});

// ── GET /api/entries/summary-stats  (Owner + Admin) ─────────────────────────
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (either may be left out), or the older ?month=YYYY-MM.
// Totals count every entry; the per-vehicle list shows only vehicles that have loads.
router.get('/summary-stats', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const range = summaryRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    res.json({ success: true, data: await summaryFor(range) });
  } catch (err) {
    return serverError(res, err, 'GET /entries/summary-stats');
  }
});

// ── GET /api/entries/unload-points  (Supervisor + Admin) — names used before, for the type-ahead list ──
router.get('/unload-points', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('load_points').select('point_name, created_at')
      .order('created_at', { ascending: false }).range(0, 1999);
    if (error) {
      if (lp.isMissingLoadPoints(error)) return res.json({ success: true, data: [] });   // SQL not run yet — nothing to suggest
      throw error;
    }
    const seen = new Set(), names = [];
    for (const r of data || []) {
      const key = String(r.point_name).toLowerCase();
      if (!seen.has(key)) { seen.add(key); names.push(r.point_name); }
      if (names.length >= 100) break;
    }
    res.json({ success: true, data: names.sort((a, b) => a.localeCompare(b)) });
  } catch (err) {
    return serverError(res, err, 'GET /entries/unload-points');
  }
});

// ── POST /api/entries  (Supervisor + Admin — "Data Entry") ──────────────────
router.post('/', requireRole('supervisor', 'admin'), async (req, res) => {
  let createdId = null;
  try {
    const parsed = parseEntryBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    // Only photos that are actually attached are sent to the database (so entries without
    // photos keep working even before the one-time database update has been run).
    // Each new photo waits in pending/ and is moved to readings/ once the entry is saved.
    const toPromote = [];
    for (const [col, v] of Object.entries(parsed.photoInput)) {
      if (v === null) continue;
      if (!photos.isPendingPath(v)) return res.status(400).json({ error: 'One of the attached photos is not valid. Please attach it again.' });
      const to = photos.toFinalPath(v);
      parsed.fields[col] = to;
      toPromote.push({ from: v, to });
    }
    if (new Set(toPromote.map(x => x.from)).size !== toPromote.length) {
      return res.status(400).json({ error: 'The same photo cannot be used twice. Please attach a separate photo for each reading.' });
    }
    if (toPromote.length) {
      const missing = await checkPhotosExist(toPromote.map(x => x.from));
      if (missing) return res.status(400).json({ error: missing });
    }

    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .insert(parsed.fields)
      .select()
      .single();

    if (entryErr) throw entryErr;
    createdId = entry.id;

    // Loads breakup. (If this fails, the entry is removed again below, so nothing is half-saved.)
    if (parsed.points && parsed.points.length) {
      const { error: ptErr } = await supabase.from('load_points').insert(parsed.points.map(p => ({ entry_id: entry.id, ...p })));
      if (ptErr) throw ptErr;
    }

    // Last step: file the photos under readings/. If this fails the entry is removed again (below)
    // and the photos are put back, so the person can just press Save again.
    if (toPromote.length) await photos.promoteAll(toPromote);

    await logActivity(req, {
      category: 'entry', action: 'entry_created', entityType: 'entry', entityId: entry.id,
      entityLabel: entryLabel(parsed.fields),
      changes: entrySnapshot(parsed.fields, 'to', parsed.points),
    });

    res.status(201).json({ success: true, data: { ...entry, load_points: parsed.points || [] } });
  } catch (err) {
    console.error('POST /entries:', err.message);
    // Don't leave a half-saved entry (saved, but its photos could not be filed) behind.
    if (createdId) await supabase.from('entries').delete().eq('id', createdId);
    sendSaveError(res, err);
  }
});

// ── PUT /api/entries/:id  (Admin only — edit an existing entry) ─────────────
// Every real change needs a written reason (10+ characters) and is recorded in
// the activity log together with exactly what changed.
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  let snapshot = null; // the entry as it was, used to roll back on failure
  let entryChanged = false;
  let pointsReplaced = false;
  let oldPoints = [];

  try {
    const parsed = parseEntryBody(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { data: original, error: getErr } = await withPoints(cols => supabase.from('entries').select(cols).eq('id', id).maybeSingle());
    if (getErr) throw getErr;
    if (!original) return res.status(404).json({ error: 'Entry not found.' });
    const { load_points: _lp, ...entryOnly } = original;
    snapshot = entryOnly;
    oldPoints = Array.isArray(original.load_points) ? original.load_points : [];

    // Unloading points: lines that were sent replace the old ones; if none were sent the old ones stay,
    // and then they must still add up to the (possibly changed) Loads.
    const finalPoints = parsed.points !== undefined ? parsed.points : oldPoints;
    const finalSum = finalPoints.reduce((a, p) => a + p.loads, 0);
    if (finalPoints.length && finalSum !== parsed.fields.loads) {
      return res.status(400).json({ error: `The unloading points add up to ${finalSum} load${finalSum === 1 ? '' : 's'}, but Loads is ${parsed.fields.loads}. Update the unloading points so they match.` });
    }

    // Photos: a freshly uploaded one (pending/…) replaces or attaches; null removes (only if there is one);
    // a key that is missing — or the entry's own saved photo sent again — leaves the photo exactly as it is.
    // Any other saved photo (e.g. one that belongs to a different entry) is refused.
    const toPromote = [];
    for (const [col, v] of Object.entries(parsed.photoInput)) {
      if (v === null) {
        if (original[col]) parsed.fields[col] = null;
      } else if (photos.isPendingPath(v)) {
        const to = photos.toFinalPath(v);
        parsed.fields[col] = to;
        toPromote.push({ from: v, to });
      } else if (v === original[col]) {
        parsed.fields[col] = v;
      } else {
        return res.status(400).json({ error: 'One of the attached photos is not valid. Please attach it again.' });
      }
    }
    if (new Set(toPromote.map(x => x.from)).size !== toPromote.length) {
      return res.status(400).json({ error: 'The same photo cannot be used twice. Please attach a separate photo for each reading.' });
    }

    const changes = entryDiff(original, parsed.fields, parsed.points);
    if (!changes.length) {
      // Nothing actually differs — don't touch the record or ask for a reason.
      return res.json({ success: true, unchanged: true, data: original });
    }

    const rErr = reasonError(req.body.reason, 'change an entry');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    if (toPromote.length) {
      const missing = await checkPhotosExist(toPromote.map(x => x.from));
      if (missing) return res.status(400).json({ error: missing });
    }

    const { data: entry, error: entryErr } = await supabase
      .from('entries')
      .update(parsed.fields)
      .eq('id', id)
      .select()
      .maybeSingle();
    if (entryErr) throw entryErr;
    entryChanged = true;
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });

    // Loads breakup: replace the old lines with the new ones (only when they really differ).
    if (parsed.points !== undefined && lp.pointsText(parsed.points) !== lp.pointsText(oldPoints)) {
      const { error: delErr } = await supabase.from('load_points').delete().eq('entry_id', id);
      if (delErr) throw delErr;
      pointsReplaced = true;
      if (parsed.points.length) {
        const { error: insErr } = await supabase.from('load_points').insert(parsed.points.map(p => ({ entry_id: id, ...p })));
        if (insErr) throw insErr;
      }
    }

    // Last step: file new photos under readings/. If it fails, the catch block below restores the old entry.
    if (toPromote.length) await photos.promoteAll(toPromote);

    await logActivity(req, {
      category: 'entry', action: 'entry_updated', entityType: 'entry', entityId: id,
      entityLabel: entryLabel(parsed.fields), reason, changes,
    });

    res.json({ success: true, data: { ...entry, load_points: finalPoints } });
  } catch (err) {
    console.error('PUT /entries/:id:', err.message);
    // Best-effort rollback so a failed edit (for example photos that could not be filed) leaves the entry as it was.
    if (snapshot) {
      try {
        if (entryChanged) {
          const { id: _omit, created_at: _c, ...restore } = snapshot;
          await supabase.from('entries').update(restore).eq('id', id);
        }
        if (pointsReplaced) {
          await supabase.from('load_points').delete().eq('entry_id', id);
          if (oldPoints.length) await supabase.from('load_points').insert(oldPoints.map(p => ({ entry_id: id, point_name: p.point_name, loads: p.loads })));
        }
      } catch (rbErr) {
        console.error('PUT /entries/:id rollback failed:', rbErr.message);
      }
    }
    sendSaveError(res, err);
  }
});

// ── DELETE /api/entries/:id  (Admin only — needs a written reason) ───────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    const rErr = reasonError(req.body && req.body.reason, 'delete an entry');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: original, error: getErr } = await withPoints(cols => supabase.from('entries').select(cols).eq('id', id).maybeSingle());
    if (getErr) throw getErr;
    if (!original) return res.status(404).json({ error: 'Entry not found.' });

    // (Its unloading points — and any old Work Breakup rows — are removed with it by the database.)
    // (Any old Work Breakup rows that belong to this entry are removed with it by the database.)
    const { error } = await supabase.from('entries').delete().eq('id', id);
    if (error) throw error;

    // The log keeps a full copy of what was deleted.
    await logActivity(req, {
      category: 'entry', action: 'entry_deleted', entityType: 'entry', entityId: id,
      entityLabel: entryLabel(original), reason,
      changes: entrySnapshot(original, 'from', original.load_points),
    });

    res.json({ success: true });
  } catch (err) {
    return serverError(res, err, 'DELETE /entries');
  }
});

module.exports = router;
module.exports.summaryRange = summaryRange;
