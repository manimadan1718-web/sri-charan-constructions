/**
 * Payments ledger — who we are paying, and reconciling it.
 *
 *   Company Payments          (kind "company")
 *   Outside Rental Payments   (kind "outside")
 *
 * Both have the same lines:  Sl No · Name · Item · Description · Payable · Paid · Balance   with   Balance = Payable − Paid.
 * Sl No is just the position in the list; Balance is always worked out (never typed or stored), so it can never go out of step.
 * A negative balance means we have paid MORE than was payable (an advance) — it is allowed, and shown as such.
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

/** One line → { line } or { error }. */
function parseLine(r, n = null) {
  const at = n ? `Line ${n}` : 'This line';
  const party_name = clean(r && r.party_name, 120);
  if (!party_name) return { error: `${at} needs a name.` };
  const item = clean(r && r.item, 120), description = clean(r && r.description, 300);
  if (!item) return { error: `${at} (${party_name}) needs an item.` };
  if (String(r.party_name || '').trim().length > 120) return { error: `The name on ${at.toLowerCase()} is too long (120 characters at most).` };
  const p = parseAmount(r.payable, 'Payable', party_name); if (p.error) return { error: p.error };
  const d = parseAmount(r.paid, 'Paid', party_name); if (d.error) return { error: d.error };
  if (p.value === 0 && d.value === 0) return { error: `${at} (${party_name}) needs a Payable or a Paid amount.` };
  return { line: { party_name, party_key: keyOf(party_name), item, description, payable: p.value, paid: d.value } };
}

/** The lines of a save → { items } or { error }. A completely empty row is ignored. */
function parseItems(raw) {
  if (!Array.isArray(raw)) return { error: 'There are no payment lines to save.' };
  const rows = raw.filter(r => r && ['party_name', 'item', 'description', 'payable', 'paid'].some(k => String(r[k] == null ? '' : r[k]).trim() !== ''));
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

module.exports = {
  KINDS, KIND_LABEL, MAX_LINES, MAX_AMOUNT, round2, clean, keyOf, money, parseAmount, parseLine, parseItems, balanceOf, statusOf, totalsOf, partyWise, cumulative,
  isMissingPayments, PAYMENTS_SETUP_MESSAGE,
};
