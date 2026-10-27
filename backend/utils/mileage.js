/**
 * Mileage — how much diesel the work used.
 *
 *   Machines measured in HOURS (excavators, breakers …)  →  litres per hour      (L/hr)   = diesel ÷ working hours
 *   Vehicles measured in KILOMETRES (tippers, trucks …) →  kilometres per litre (km/L)   = km ÷ diesel
 *
 * The entry form writes the working hours / reading as text ("6.8", "8 hrs 30 mins", "130 km", or just "51" from an odometer).
 * readingOf() decides what ONE entry measured, and every screen, total and report uses it, so they always agree:
 *
 *   • "130 km"                         → km (the text says so)
 *   • a plain number such as "51":
 *        - vehicle TYPE (from Inventory) is a road vehicle (Tipper, Truck, Lorry …)   → km, however small
 *        - vehicle TYPE is a machine (Excavator, JCB, Breaker …)                      → hours (a number over 24 is not a day's hours: ignored)
 *        - vehicle TYPE unknown                                                        → over 24 can only be km; 24 or less is hours
 *   • "8 hrs", "8:30", "45 mins"          → hours
 *
 * A single day's figure can mislead: diesel is often put in on some days only. So totals (per vehicle, per site, overall) use
 * the diesel and the hours/km of the WHOLE period together, and only for vehicles that were measured (a vehicle with diesel
 * but no hours/km is left out of the average rather than skewing it).
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

const BARE_NUMBER_RE = /^\d+(?:\.\d+)?$/;
const ROAD_TYPE_RE = /\b(tipper|truck|lorry|trailer|tanker|car|jeep|pickup|van|bus|mixer)\b/i;
const MACHINE_TYPE_RE = /(excavator|jcb|breaker|roller|loader|crane|dozer|grader|compactor|poclain|backhoe|bucket|drill|compressor|generator|pump|bobcat|crusher|paver|batching)/i;
/** 'road' (measured in km), 'machine' (measured in hours) or null (not known) \u2014 from the vehicle TYPE kept in Inventory. */
const vehicleKind = type => { const t = String(type == null ? '' : type); return MACHINE_TYPE_RE.test(t) ? 'machine' : ROAD_TYPE_RE.test(t) ? 'road' : null; };

/** What one entry measured: { kind: 'km', km } | { kind: 'hours', min } | null. Uses e.working_hours, and e.vehicle_type when known. */
function readingOf(e) {
  const text = String(e && e.working_hours != null ? e.working_hours : '').trim();
  if (!text) return null;
  const km = parseKm(text);
  if (km !== null) return { kind: 'km', km };
  if (BARE_NUMBER_RE.test(text)) {
    const n = parseFloat(text), kind = vehicleKind(e.vehicle_type);
    if (kind === 'road' && n > 0 && n <= MAX_KM_PER_DAY) return { kind: 'km', km: n };
    if (kind === null && n > 24 && n <= MAX_KM_PER_DAY) return { kind: 'km', km: n };          // more than a day has hours: it can only be an odometer difference
  }
  const min = parseWorkingMinutes(text);
  return min !== null ? { kind: 'hours', min } : null;
}

/** One entry's own figure: { value, unit } or null (no diesel, or nothing measured). */
function entryMileage(e) {
  const d = Number(e && e.diesel) || 0;
  if (d <= 0) return null;
  const r = readingOf(e);
  if (r && r.kind === 'km' && r.km > 0) return { value: round1(r.km / d), unit: 'km/L' };
  if (r && r.kind === 'hours' && r.min > 0) return { value: round1(d / (r.min / 60)), unit: 'L/hr' };
  return null;
}

/** Overall figure for a group of entries: { lph, kpl } (each a number or null). */
function mileageOf(entries) {
  const byVehicle = new Map();
  for (const e of entries || []) {
    const key = (e.vehicle_no || 'Unknown');
    const v = byVehicle.get(key) || { litres: 0, minutes: 0, km: 0 };
    v.litres += parseFloat(e.diesel) || 0;
    const r = readingOf(e);
    if (r && r.kind === 'hours') v.minutes += r.min;
    if (r && r.kind === 'km') v.km += r.km;
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

module.exports = { parseKm, readingOf, vehicleKind, entryMileage, mileageOf, fmtMileage, fmtEntryMileage };
