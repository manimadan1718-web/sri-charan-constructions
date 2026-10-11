/**
 * The Summary screen's numbers (and its Excel / PDF export).
 *
 *  • Totals count EVERY entry in the period.
 *  • The per-vehicle list shows only vehicles that actually have loads.
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');

async function summaryFor({ from, to }) {
  const { data, error } = await fetchAll(() => {
    let q = supabase.from('entries').select('diesel, loads, vehicle_no, date')
      .order('date', { ascending: true }).order('id', { ascending: true });
    if (from) q = q.gte('date', from);
    if (to)   q = q.lte('date', to);
    return q;
  });
  if (error) throw error;

  const byVehicle = new Map();
  let diesel = 0, loads = 0;
  for (const e of data) {
    const d = parseFloat(e.diesel) || 0, l = parseInt(e.loads, 10) || 0;
    diesel += d; loads += l;
    const key = e.vehicle_no || 'Unknown';
    const v = byVehicle.get(key) || { vehicle_no: key, entries: 0, diesel: 0, loads: 0 };
    v.entries += 1; v.diesel += d; v.loads += l;
    byVehicle.set(key, v);
  }
  const vehicles = [...byVehicle.values()]
    .filter(v => v.loads > 0)
    .sort((a, b) => a.vehicle_no.localeCompare(b.vehicle_no))
    .map(v => ({ ...v, diesel: v.diesel.toFixed(2) }));

  return {
    total_entries: data.length,
    total_diesel: diesel.toFixed(2),
    total_loads: loads,
    unique_vehicles: byVehicle.size,
    vehicles_with_loads: vehicles.length,
    vehicles,
    range: { from: from || null, to: to || null },
  };
}

module.exports = { summaryFor };
