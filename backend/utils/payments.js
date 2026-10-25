/**
 * Payments ledger — who we are paying, and reconciling it.
 *
 *   Company Payments          (kind "company")
 *   Outside Rental Payments   (kind "outside")
 *
 * Both have the same lines:  Sl No · Name · Item · Description · Payable · Paid · Balance   with   Balance = Payable − Paid.
 * Sl No is just the position in the list; Balance is always worked out (never typed or stored), so it can never go out of step.
 * A negative balance means we have paid MORE than was payable (an advance) — it is allowed, and shown as such.
 * Every line also has a DATE (chosen on a calendar) and "Paid By" (typed by hand).
 */
const KINDS = ['company', 'outside'];
const KIND_LABEL = { company: 'Company Payments', outside: 'Outside Rental Payments' };
const MAX_LINES = 60;
const MAX_AMOUNT = 9999999999.99;

const round2 = n => Math.round((Number(n) || 0) * 100 + (Number(n) < 0 ? -1e-9 : 1e-9)) / 100;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = name => clean(name, 120).toLowerCase();
const money = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** blank → 0; otherwise a number of 0 or more, at most 2 decimals worth keeping. */
function parseAmount(raw, label, who) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: 0 };
  const n = Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return { error: `${label} for ${who} must be an amount of 0 or more.` };
  return { value: round2(n) };
}

const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const dmy = d => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '');
/** blank → today; otherwise a real date from 2000 up to a year ahead. */
function parseDate(raw, at) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { value: todayIST() };
  const d = String(raw).trim();
  const ahead = new Date(Date.now() + (5.5 * 3600 + 366 * 86400) * 1000).toISOString().slice(0, 10);
  if (!validDay(d) || d < '2000-01-01' || d > ahead) return { error: `${at} needs a valid date.` };
  return { value: d };
}

/** One line → { line } or { error }. */
function parseLine(r, n = null) {
  const at = n ? `Line ${n}` : 'This line';
  const party_name = clean(r && r.party_name, 120);
  if (!party_name) return { error: `${at} needs a name.` };
  const item = clean(r && r.item, 120), description = clean(r && r.description, 300);
  if (!item) return { error: `${at} (${party_name}) needs an item.` };
  if (String(r.party_name || '').trim().length > 120) return { error: `The name on ${at.toLowerCase()} is too long (120 characters at most).` };
  const dt = parseDate(r.pay_date, `${at} (${party_name})`); if (dt.error) return { error: dt.error };
  const paid_by = clean(r.paid_by, 120), site = clean(r.site, 120);
  const p = parseAmount(r.payable, 'Payable', party_name); if (p.error) return { error: p.error };
  const d = parseAmount(r.paid, 'Paid', party_name); if (d.error) return { error: d.error };
  if (p.value === 0 && d.value === 0) return { error: `${at} (${party_name}) needs a Payable or a Paid amount.` };
  return { line: { party_name, party_key: keyOf(party_name), pay_date: dt.value, item, description, payable: p.value, paid: d.value, paid_by, site } };
}

/** The lines of a save → { items } or { error }. A completely empty row is ignored. */
function parseItems(raw) {
  if (!Array.isArray(raw)) return { error: 'There are no payment lines to save.' };
  const rows = raw.filter(r => r && ['party_name', 'item', 'description', 'payable', 'paid', 'paid_by'].some(k => String(r[k] == null ? '' : r[k]).trim() !== ''));
  if (!rows.length) return { error: 'Add at least one line.' };
  if (rows.length > MAX_LINES) return { error: `At most ${MAX_LINES} lines can be saved at once.` };
  const items = [];
  for (let i = 0; i < rows.length; i++) { const x = parseLine(rows[i], i + 1); if (x.error) return { error: x.error }; items.push(x.line); }
  return { items };
}

const balanceOf = (payable, paid) => round2((Number(payable) || 0) - (Number(paid) || 0));
/** 'due' (we still owe), 'settled' (nothing owed) or 'over' (we paid more than was payable). */
const statusOf = balance => (balance > 0.004 ? 'due' : balance < -0.004 ? 'over' : 'settled');

const totalsOf = rows => {
  const payable = round2(rows.reduce((a, r) => a + (Number(r.payable) || 0), 0)), paid = round2(rows.reduce((a, r) => a + (Number(r.paid) || 0), 0));
  return { count: rows.length, payable, paid, balance: round2(payable - paid) };
};

/** Party-wise cumulative: every line of the same name (any capitals / spaces) added together. */
function partyWise(rows) {
  const by = new Map();
  for (const r of rows) {
    const k = r.party_key || keyOf(r.party_name);
    if (!by.has(k)) by.set(k, { party_name: r.party_name, rows: [] });
    by.get(k).rows.push(r);
  }
  return [...by.values()].map(g => ({ party_name: g.party_name, ...totalsOf(g.rows) })).sort((a, b) => a.party_name.localeCompare(b.party_name, 'en', { sensitivity: 'base' }));
}

/* ── search filters (the same ones narrow the screen AND the exported report) ─────────────────────────── */
const STATUSES = ['due', 'settled', 'over'];
const NO_PAID_BY = '__none__';
const STATUS_LABEL = { due: 'Balance due', settled: 'Settled', over: 'Advance paid' };
/** From a query string or a request body → { filters } or { error }. Everything is optional. */
function parseFilters(src) {
  const q = src || {}, f = {}, str = (v, max) => (typeof v === 'string' ? clean(v, max) : '');
  for (const k of ['from', 'to']) { const v = str(q[k], 10); if (v) { if (!validDay(v)) return { error: `${k === 'from' ? 'The "from" date' : 'The "to" date'} must be a valid date.` }; f[k] = v; } }
  if (f.from && f.to && f.from > f.to) return { error: 'The "from" date cannot be after the "to" date.' };
  const name = str(q.name, 120), site = str(q.site, 120), paid_by = str(q.paid_by, 120), status = str(q.status, 12), text = str(q.q, 120);
  if (name) f.name = name;
  if (site) f.site = site;
  if (paid_by) f.paid_by = paid_by;
  if (status) { if (!STATUSES.includes(status)) return { error: 'The status filter is not valid.' }; f.status = status; }
  if (text) f.q = text;
  return { filters: f };
}
/** rows need: party_name, item, description, paid_by, pay_date, status. */
function applyFilters(rows, f = {}) {
  const q = (f.q || '').toLowerCase(), name = f.name ? keyOf(f.name) : '', pb = f.paid_by ? (f.paid_by === NO_PAID_BY ? NO_PAID_BY : keyOf(f.paid_by)) : '';
  const sk = f.site ? (f.site === NO_PAID_BY ? NO_PAID_BY : keyOf(f.site)) : '';
  return rows.filter(r => {
    if (f.from && String(r.pay_date) < f.from) return false;
    if (f.to && String(r.pay_date) > f.to) return false;
    if (name && keyOf(r.party_name) !== name) return false;
    if (sk) { const mine = keyOf(r.site || ''); if (sk === NO_PAID_BY ? mine !== '' : mine !== sk) return false; }
    if (pb) { const mine = keyOf(r.paid_by || ''); if (pb === NO_PAID_BY ? mine !== '' : mine !== pb) return false; }
    if (f.status && r.status !== f.status) return false;
    if (q && !`${r.party_name} ${r.item} ${r.description} ${r.paid_by} ${r.site || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
/** "From 01/10/2026 · To 31/10/2026 · Name: Sri Cements · Paid by: Cash · Balance due · Search: sand" (or '' when none). */
function filtersText(f = {}) {
  return [f.from && `From ${dmy(f.from)}`, f.to && `To ${dmy(f.to)}`, f.site && `Site: ${f.site === NO_PAID_BY ? '(not entered)' : f.site}`, f.name && `Name: ${f.name}`, f.paid_by && `Paid by: ${f.paid_by === NO_PAID_BY ? '(not entered)' : f.paid_by}`, f.status && STATUS_LABEL[f.status], f.q && `Search: ${f.q}`].filter(Boolean).join('  ·  ');
}
/** Oldest date first (it reads as a ledger), then the order lines were saved. */
const sortRows = rows => [...rows].sort((a, b) => String(a.pay_date).localeCompare(String(b.pay_date)) || String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id)));
/** What the filter drop-downs offer: every name and every "paid by" used so far (the whole ledger, not just what is shown). */
function optionsOf(rows) {
  const uniq = pick => { const seen = new Set(), out = []; for (const r of rows) { const v = pick(r); if (!v) continue; const k = keyOf(v); if (!seen.has(k)) { seen.add(k); out.push(v); } } return out.sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })); };
  return { names: uniq(r => r.party_name), paid_by: uniq(r => r.paid_by), has_blank_paid_by: rows.some(r => !String(r.paid_by || '').trim()), sites: uniq(r => r.site), has_blank_site: rows.some(r => !String(r.site || '').trim()) };
}

/** The whole picture: both kinds, their totals, party-wise lists, and the overall total. */
function cumulative(rows) {
  const out = { kinds: {} };
  for (const k of KINDS) { const mine = rows.filter(r => r.kind === k); out.kinds[k] = { label: KIND_LABEL[k], totals: totalsOf(mine), parties: partyWise(mine) }; }
  out.overall = totalsOf(rows.filter(r => KINDS.includes(r.kind)));
  return out;
}

/** True when a database error only means the payment_lines table has not been created yet. */
const isMissingPayments = err =>
  !!err && /payment_lines/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));
const PAYMENTS_SETUP_MESSAGE = 'Payments need a one-time database update. Run run-in-supabase-7-payment-ledger.sql in Supabase > SQL Editor, then try again.';
/** True when only the Date / Paid By columns are missing (the table exists, but run-in-supabase-8 has not been run). */
const isMissingPaymentColumns = err => !!err && /(pay_date|paid_by)/i.test(String(err.message || '')) && /(column|schema cache)/i.test(String(err.message || ''));
const PAYMENTS_COLUMNS_MESSAGE = 'Payments now have a Date and a "Paid By" — they need a one-time database update. Run run-in-supabase-8-payment-date-paidby.sql in Supabase > SQL Editor, then try again.';

/** True when only the Site column is missing (the table exists, but run-in-supabase-12 has not been run). */
const isMissingSiteColumn = err => !!err && /(payment_lines\.site|'site' column|column "?site"?)/i.test(String(err.message || '')) && /(column|schema cache)/i.test(String(err.message || ''));
const PAYMENTS_SITE_MESSAGE = 'Payments now have a Site \u2014 choosing one needs a one-time database update. Run run-in-supabase-12-payment-site.sql in Supabase > SQL Editor, then try again.';

module.exports = {
  KINDS, KIND_LABEL, MAX_LINES, MAX_AMOUNT, round2, clean, keyOf, money, parseAmount, parseLine, parseItems, balanceOf, statusOf, totalsOf, partyWise, cumulative,
  todayIST, validDay, dmy, parseDate, STATUSES, NO_PAID_BY, STATUS_LABEL, parseFilters, applyFilters, filtersText, sortRows, optionsOf,
  isMissingPayments, PAYMENTS_SETUP_MESSAGE, isMissingPaymentColumns, PAYMENTS_COLUMNS_MESSAGE, isMissingSiteColumn, PAYMENTS_SITE_MESSAGE,
};
