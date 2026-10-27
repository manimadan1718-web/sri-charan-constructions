/**
 * The DAILY loads breakup: for one date and one site there is ONE set of lines (unloading point, material, location, loads, rate).
 * Together they must equal ALL the loads the day's vehicle entries recorded at that site \u2014 for example 10 vehicles, 100 loads,
 * and the lines add up to 100. The vehicle entries themselves carry no lines any more (older per-vehicle lines are kept as they were).
 *
 * The lines are saved as a whole: saving replaces the day's lines. If the day's loads change afterwards (another vehicle is
 * entered, a figure is corrected) the saved lines are kept and shown as "short" / "too many" until they are corrected.
 */
const supabase = require('../config/supabase');
const lp = require('./loadPoints');

const TABLE = 'day_load_points';
const SETUP_MESSAGE = 'The daily loads breakup needs a one-time database update. Run run-in-supabase-13-daily-breakup.sql in Supabase > SQL Editor, then try again.';
const isMissingTable = err => !!err && /day_load_points/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

const siteKey = s => String(s == null ? '' : s).trim().toLowerCase();
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || ''); };

/** What the day's vehicle entries recorded at this site: total loads, and each vehicle's share. */
async function loadsOf(date, site) {
  const { data, error } = await supabase.from('entries').select('vehicle_no, loads, site').eq('date', date);
  if (error) throw error;
  const rows = (data || []).filter(e => siteKey(e.site) === siteKey(site));
  const per = new Map(); let total = 0;
  for (const e of rows) {
    const l = parseInt(e.loads, 10) || 0; total += l;
    const key = e.vehicle_no || 'Unknown', v = per.get(key) || { vehicle_no: key, loads: 0, entries: 0 };
    v.loads += l; v.entries += 1; per.set(key, v);
  }
  const vehicles = [...per.values()].filter(v => v.loads > 0).sort((a, b) => b.loads - a.loads || a.vehicle_no.localeCompare(b.vehicle_no));
  return { entries: rows.length, total, vehicles };
}

/** The saved lines (rows) for this date and site, in the order they were typed. */
async function rowsOf(date, site) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('work_date', date).order('position', { ascending: true }).order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).filter(r => siteKey(r.site) === siteKey(site));
}

const statusOf = (total, sum, hasLines) => (!hasLines ? (total > 0 ? 'none' : 'empty') : sum === total ? 'match' : sum < total ? 'short' : 'over');

/** Everything the Data Entry screen needs for one day. */
async function getDay(date, site) {
  const day = await loadsOf(date, site);
  let rows = [], setupRequired = false;
  try { rows = await rowsOf(date, site); } catch (err) { if (isMissingTable(err)) setupRequired = true; else throw err; }
  const points = lp.withAmounts(rows.map(r => ({ point_name: r.point_name, material: r.material, location: r.location, loads: r.loads, rate: r.rate, position: r.position })));
  const sum = points.reduce((a, p) => a + p.loads, 0);
  const last = rows.reduce((a, r) => (!a || String(r.updated_at || r.created_at) > String(a.updated_at || a.created_at) ? r : a), null);
  return {
    date, site, entries: day.entries, vehicles: day.vehicles.length, total_loads: day.total, vehicle_loads: day.vehicles,
    points, points_total: sum, amount_total: Math.round(points.reduce((a, p) => a + p.amount, 0) * 100) / 100,
    difference: sum - day.total, status: statusOf(day.total, sum, points.length > 0),
    saved_by: last ? last.saved_by_name || null : null, saved_at: last ? last.updated_at || last.created_at || null : null,
    setup_required: setupRequired || undefined,
  };
}

/** Replaces the day's lines. The old lines are put back if the new ones cannot be saved. */
async function replaceDay({ date, site, points, user }) {
  const old = await rowsOf(date, site);
  if (old.length) {
    const { error } = await supabase.from(TABLE).delete().in('id', old.map(r => r.id));
    if (error) throw error;
  }
  if (points.length) {
    const now = new Date().toISOString();
    const rows = points.map((p, i) => ({
      work_date: date, site, position: i + 1, point_name: p.point_name, material: p.material || '', location: p.location || '',
      loads: p.loads, rate: Number(p.rate) || 0, saved_by_id: user && user.id ? String(user.id) : null, saved_by_name: user && user.name ? user.name : null, updated_at: now,
    }));
    const { error } = await supabase.from(TABLE).insert(rows);
    if (error) {
      if (old.length) await supabase.from(TABLE).insert(old.map(({ id, ...rest }) => rest));          // (put back exactly as they were)
      throw error;
    }
  }
  return old;
}

/** For reports: the saved day lines for the dates in these entries. Returns Map "date|site" -> [lines]. [] before the SQL has been run. */
async function dayLinesFor(entries) {
  const dates = [...new Set((entries || []).map(e => e.date).filter(Boolean))];
  const out = new Map();
  if (!dates.length) return out;
  const { data, error } = await supabase.from(TABLE).select('*').in('work_date', dates).order('position', { ascending: true });
  if (error) { if (isMissingTable(error)) return out; throw error; }
  for (const r of data || []) {
    const key = `${r.work_date}|${siteKey(r.site)}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

module.exports = { TABLE, SETUP_MESSAGE, isMissingTable, siteKey, isDate, dmy, loadsOf, rowsOf, statusOf, getDay, replaceDay, dayLinesFor };
