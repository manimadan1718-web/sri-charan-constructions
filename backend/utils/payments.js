/**
 * Payments: Weekly (food, etc.) and Monthly (salary, etc.) — one line per person per period.
 * The same person cannot be entered twice for the same type and period (checked here AND by a unique
 * index in the database, so two supervisors saving at the same moment cannot create a duplicate).
 */
const MAX_ITEMS = 100;
const TYPES = ['weekly', 'monthly'];
const MAX_DAYS = { weekly: 7, monthly: 31 };
const MAX_AMOUNT = 99999999.99;

const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const keyOf = name => cleanName(name).toLowerCase();

const isDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const ymd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const dmy = s => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Weekly: any date → the Monday–Sunday week that contains it.
 * Monthly: "YYYY-MM" (or any date in that month) → first–last day of the month.
 * Returns { start, end, label } or { error }.
 */
function resolvePeriod(type, period) {
  let start, end;
  if (type === 'weekly') {
    if (!isDate(period)) return { error: 'Choose a date inside the week.' };
    const dow = new Date(`${period}T00:00:00Z`).getUTCDay();          // 0 = Sunday
    start = addDays(period, -((dow + 6) % 7));
    end = addDays(start, 6);
  } else {
    const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(typeof period === 'string' ? period : '');
    if (!m || +m[2] < 1 || +m[2] > 12) return { error: 'Choose the month.' };
    start = `${m[1]}-${m[2]}-01`;
    const next = new Date(Date.UTC(+m[1], +m[2], 1));
    next.setUTCDate(0);
    end = ymd(next);
  }
  // Catch typing mistakes such as the year 2062.
  const limit = addDays(ymd(new Date()), 60);
  if (start < '2015-01-01' || start > limit) return { error: 'That period looks wrong. Please check the date.' };
  return { start, end, label: type === 'weekly' ? `week ${dmy(start)} – ${dmy(end)}` : `${['January','February','March','April','May','June','July','August','September','October','November','December'][+start.slice(5, 7) - 1]} ${start.slice(0, 4)}` };
}

/** Validates the lines. Returns { items } (cleaned, with employee_key) or { error }. */
function parseItems(raw, type) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'Add at least one person.' };
  if (raw.length > MAX_ITEMS) return { error: `At most ${MAX_ITEMS} people can be saved at once.` };
  const items = [];
  const seen = new Set();
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const one = parseOne(r, type, `Line ${i + 1}`);
    if (one.error) return { error: one.error };
    if (seen.has(one.item.employee_key)) return { error: `"${one.item.employee_name}" is on the list twice. Each person can be paid only once for the same period.` };
    seen.add(one.item.employee_key);
    items.push(one.item);
  }
  return { items };
}

function parseOne(r, type, who) {
  const name = cleanName(r.employee_name);
  if (!name) return { error: `${who}: enter the employee's name.` };
  if (name.length > 80) return { error: `${who}: the name is too long (80 characters at most).` };
  const days = Number(r.days_worked);
  if (r.days_worked === '' || r.days_worked === null || r.days_worked === undefined || !Number.isFinite(days) || days < 0 || days > MAX_DAYS[type] || Math.round(days * 2) / 2 !== days) {
    return { error: `${who} (${name}): days worked must be between 0 and ${MAX_DAYS[type]} (half days are allowed).` };
  }
  const amount = Number(r.amount);
  if (r.amount === '' || r.amount === null || r.amount === undefined || !Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) {
    return { error: `${who} (${name}): enter an amount greater than 0.` };
  }
  return { item: { employee_name: name, employee_key: keyOf(name), days_worked: days, amount: Math.round(amount * 100) / 100 } };
}

const money = n => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const typeLabel = t => (t === 'weekly' ? 'Weekly' : 'Monthly');
const daysText = d => `${d} day${Number(d) === 1 ? '' : 's'}`;

const isMissingPayments = err =>
  !!err && /payments/i.test(String(err.message || '')) &&
  (/(schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST205', '42P01'].includes(err.code));
const PAYMENTS_SETUP_MESSAGE =
  'Payments need a one-time database update. Run run-in-supabase-3-new-features.sql in Supabase → SQL Editor, then try again.';

module.exports = {
  MAX_ITEMS, TYPES, cleanName, keyOf, resolvePeriod, parseItems, parseOne, money, typeLabel, daysText, dmy,
  isMissingPayments, PAYMENTS_SETUP_MESSAGE,
};
