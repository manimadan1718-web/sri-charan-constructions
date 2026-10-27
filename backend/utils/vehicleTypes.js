/**
 * The vehicle TYPE (Tipper, Excavator, …) lives in Inventory, not on the entry. Mileage needs it to tell kilometres from hours,
 * so entries are given a vehicle_type before they are shown, summed or exported. If Inventory cannot be read, entries simply
 * have no type and the plain-number rule in mileage.js still applies.
 */
const supabase = require('../config/supabase');

async function typeMap() {
  const { data, error } = await supabase.from('vehicles').select('vehicle_no, type');
  if (error) return new Map();
  return new Map((data || []).map(v => [String(v.vehicle_no || '').trim().toLowerCase(), v.type || '']));
}

/** Adds .vehicle_type to each entry (in place) and returns the same array. */
async function withVehicleTypes(entries) {
  if (!entries || !entries.length) return entries;
  const types = await typeMap();
  for (const e of entries) e.vehicle_type = types.get(String(e.vehicle_no || '').trim().toLowerCase()) || '';
  return entries;
}

module.exports = { withVehicleTypes, typeMap };
