/**
 * Purchases: material that arrives at a site (sand, aggregate, bricks …).
 *   Net weight = Load weight − Empty weight   (always worked out HERE; a number sent by the browser is ignored)
 * Weights are in kilograms, with up to three decimals.
 */
const { clean } = require('./documents');

const MAX_WEIGHT_KG = 500000;     // 500 tonnes in one load is far beyond any truck — anything above is a typing slip

const isMissingPurchases = err =>
  !!err && /purchases/i.test(String(err.message || '')) &&
  (/(schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST205', '42P01'].includes(err.code));
const PURCHASES_SETUP_MESSAGE =
  'Purchases need a one-time database update. Run run-in-supabase-4-purchases.sql in Supabase → SQL Editor, then try again.';

/** "1234.5" → 1234500 (thousandths of a kilogram), or null when it is not a plain weight. */
function toMilli(v) {
  const s = String(v == null ? '' : v).trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return null;
  const n = Math.round(parseFloat(s) * 1000);
  return Number.isFinite(n) ? n : null;
}
const fromMilli = m => Number((m / 1000).toFixed(3));

const kg = n => `${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} kg`;
const tonnes = n => `${(Number(n) / 1000).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 })} t`;

const VEHICLE_RE = /^[A-Za-z0-9][A-Za-z0-9 .,&()\/_-]{1,39}$/;

function todayPlusOne() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10);
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Checks the form and works out the net weight. { error } or { value }. */
function parsePurchase(b) {
  b = b || {};
  const date = String(b.purchase_date || '').trim();
  if (!validDate(date)) return { error: 'Choose the date of the purchase.' };
  if (date < '2000-01-01' || date > todayPlusOne()) return { error: 'The purchase date cannot be in the future.' };
  // Too-long text is refused (not silently cut short), so what is saved is always what was typed.
  const text = (v, max, label) => {
    const full = clean(v, 100000);
    if (!full) return { error: `${label} is needed.` };
    if (full.length > max) return { error: `${label} is too long (${max} characters at most).` };
    return { value: full };
  };
  const siteR = text(b.site, 100, 'The site');             if (siteR.error) return { error: 'Choose the site.' };
  const supplierR = text(b.supplier, 120, 'The supplier'); if (supplierR.error) return { error: supplierR.error.replace('The supplier is needed.', 'Enter the supplier.') };
  const vehicleR = text(b.vehicle_no, 40, 'The vehicle number'); if (vehicleR.error) return { error: vehicleR.error.replace('The vehicle number is needed.', 'Enter the vehicle number.') };
  const itemR = text(b.item_name, 120, 'The item name');  if (itemR.error) return { error: itemR.error.replace('The item name is needed.', 'Enter the item name.') };
  const site = siteR.value, supplier = supplierR.value, vehicle_no = vehicleR.value, item_name = itemR.value;
  if (!VEHICLE_RE.test(vehicle_no)) return { error: 'The vehicle number can only contain letters, numbers, spaces and - . / & ( ) , _' };

  const L = toMilli(b.load_weight), E = toMilli(b.empty_weight);
  if (L === null || b.load_weight === '' || b.load_weight == null) return { error: 'Enter the load weight in kg (numbers only, up to 3 decimals).' };
  if (E === null || b.empty_weight === '' || b.empty_weight == null) return { error: 'Enter the empty weight in kg (numbers only, up to 3 decimals).' };
  if (L > MAX_WEIGHT_KG * 1000 || E > MAX_WEIGHT_KG * 1000) return { error: `A weight cannot be more than ${MAX_WEIGHT_KG.toLocaleString('en-IN')} kg.` };
  if (L <= E) return { error: 'The load weight must be more than the empty weight.' };
  return { value: { purchase_date: date, site, supplier, vehicle_no, item_name, load_weight: fromMilli(L), empty_weight: fromMilli(E), net_weight: fromMilli(L - E) } };
}

module.exports = {
  MAX_WEIGHT_KG, isMissingPurchases, PURCHASES_SETUP_MESSAGE, parsePurchase, toMilli, fromMilli, kg, tonnes, validDate,
};
