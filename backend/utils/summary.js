/**
 * The Summary screen's numbers (and its Excel / PDF export).
 *
 *  • Totals count EVERY entry in the period (and, if a site is chosen, at that site).
 *  • The per-vehicle list shows the vehicles that actually did work: they have loads OR working hours.
 *  • The per-site list always covers the whole period, so the site choices never shrink once a site is picked.
 *  • Working hours are added up from the text people entered (see workHours.js); entries whose hours are not a
 *    length of time (for example "130 km") are left out of the hours and counted in hours_entries' shortfall.
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');
const { parseWorkingMinutes, hoursFromMinutes } = require('./workHours');

const NO_SITE = '(no site)';
const NO_SITE_PARAM = '__none__';
const siteOf = e => String(e.site == null ? '' : e.site).trim();

const blank = () => ({ entries: 0, diesel: 0, loads: 0, minutes: 0, hoursEntries: 0 });
function add(t, e) {
  const d = parseFloat(e.diesel) || 0, l = parseInt(e.loads, 10) || 0, m = parseWorkingMinutes(e.working_hours);
  t.entries += 1; t.diesel += d; t.loads += l;
  if (m !== null) { t.minutes += m; t.hoursEntries += 1; }
}

async function summaryFor({ from, to, site }) {
  const { data, error } = await fetchAll(() => {
    let q = supabase.from('entries').select('diesel, loads, vehicle_no, date, site, working_hours')
      .order('date', { ascending: true }).order('id', { ascending: true });
    if (from) q = q.gte('date', from);
    if (to)   q = q.lte('date', to);
    return q;
  });
  if (error) throw error;

  // Per site, over the whole period
  const bySite = new Map();
  for (const e of data) {
    const key = siteOf(e);
    if (!bySite.has(key)) bySite.set(key, blank());
    add(bySite.get(key), e);
  }
  const sites = [...bySite.entries()]
    .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : a[0].localeCompare(b[0])))
    .map(([key, t]) => ({ site: key || NO_SITE, value: key || NO_SITE_PARAM, entries: t.entries, diesel: t.diesel.toFixed(2), loads: t.loads, hours: hoursFromMinutes(t.minutes) }));

  // The chosen site (if any) narrows everything else
  const chosen = typeof site === 'string' && site.trim() ? (site.trim() === NO_SITE_PARAM ? '' : site.trim()) : null;
  const rows = chosen === null ? data : data.filter(e => siteOf(e).toLowerCase() === chosen.toLowerCase());

  const byVehicle = new Map(), total = blank();
  for (const e of rows) {
    add(total, e);
    const key = e.vehicle_no || 'Unknown';
    if (!byVehicle.has(key)) byVehicle.set(key, blank());
    add(byVehicle.get(key), e);
  }
  const vehicles = [...byVehicle.entries()]
    .filter(([, v]) => v.loads > 0 || v.minutes > 0)                       // vehicles that did work: loads or hours
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([vehicle_no, v]) => ({ vehicle_no, entries: v.entries, diesel: v.diesel.toFixed(2), loads: v.loads, hours: hoursFromMinutes(v.minutes) }));

  return {
    total_entries: rows.length,
    total_diesel: total.diesel.toFixed(2),
    total_loads: total.loads,
    total_hours: hoursFromMinutes(total.minutes),
    hours_entries: total.hoursEntries,                                       // how many entries had hours that could be added up
    unique_vehicles: byVehicle.size,
    vehicles_with_loads: vehicles.length,                                    // (older name, kept) = vehicles listed
    vehicles_listed: vehicles.length,
    vehicles,
    sites,
    site: chosen === null ? null : (chosen || NO_SITE),
    range: { from: from || null, to: to || null },
  };
}

module.exports = { summaryFor, NO_SITE, NO_SITE_PARAM };