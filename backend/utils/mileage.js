/**
 * Mileage — how much diesel the work used.
 *
 *   Machines measured in HOURS (excavators, breakers …)  →  litres per hour      (L/hr)   = diesel ÷ working hours
 *   Vehicles measured in KILOMETRES ("130 km")           →  kilometres per litre (km/L)   = km ÷ diesel
 *
 * The entry form writes the working hours / reading as text ("6.8", "8 hrs 30 mins", "130 km"); the same readers that add up
 * working hours (workHours.js) decide which kind an entry is. The browser has a copy of these rules (app.js) and a test
 * keeps the two identical.
 *
 * A single day's figure can mislead: diesel is often put in on some days only. So totals (per vehicle, per site, overall) use
 * the diesel and the hours/km of the WHOLE period together, and only for vehicles that were measured (a vehicle with diesel
 * but no hours is left out of the average rather than skewing it).
 */
const { parseWorkingMinutes } = require('./workHours');

const KM_RE = /^(\d+(?:\.\d+)?)\s*(?:km|kms|kilometer|kilometers|kilometre|kilometres)$/i;
const MAX_KM_PER_DAY = 3000;

/** Distance in km, only when the text says km ("130 km"). Otherwise null. */
function parseKm(text) {
  const m = KM_RE.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v <= MAX_KM_PER_DAY ? v : null;
}

const round1 = n => Math.round(n * 10) / 10;

/** One entry's own figure: { value, unit } or null (no diesel, or nothing measured). */
function entryMileage(e) {
  const d = Number(e && e.diesel) || 0;
  if (d <= 0) return null;
  const km = parseKm(e.working_hours);
  if (km !== null && km > 0) return { value: round1(km / d), unit: 'km/L' };
  const min = parseWorkingMinutes(e.working_hours);
  if (min !== null && min > 0) return { value: round1(d / (min / 60)), unit: 'L/hr' };
  return null;
}

/** Overall figure for a group of entries: { lph, kpl } (each a number or null). */
function mileageOf(entries) {
  const byVehicle = new Map();
  for (const e of entries || []) {
    const key = (e.vehicle_no || 'Unknown');
    const v = byVehicle.get(key) || { litres: 0, minutes: 0, km: 0 };
    v.litres += parseFloat(e.diesel) || 0;
    const m = parseWorkingMinutes(e.working_hours); if (m !== null) v.minutes += m;
    const k = parseKm(e.working_hours);            if (k !== null) v.km += k;
    byVehicle.set(key, v);
  }
  let hLitres = 0, hMin = 0, kLitres = 0, kKm = 0;
  for (const v of byVehicle.values()) {
    if (v.minutes > 0) { hLitres += v.litres; hMin += v.minutes; }
    if (v.km > 0)      { kLitres += v.litres; kKm += v.km; }
  }
  return {
    lph: hMin > 0 && hLitres > 0 ? round1(hLitres / (hMin / 60)) : null,
    kpl: kKm > 0 && kLitres > 0 ? round1(kKm / kLitres) : null,
  };
}

/** "9.9 L/hr"  ·  "4.2 km/L"  ·  both joined by " · "  ·  "" when there is nothing to show. */
function fmtMileage(m) {
  if (!m) return '';
  return [m.lph != null ? `${m.lph.toFixed(1)} L/hr` : '', m.kpl != null ? `${m.kpl.toFixed(1)} km/L` : ''].filter(Boolean).join(' · ');
}
const fmtEntryMileage = e => { const m = entryMileage(e); return m ? `${m.value.toFixed(1)} ${m.unit}` : ''; };

module.exports = { parseKm, entryMileage, mileageOf, fmtMileage, fmtEntryMileage };
