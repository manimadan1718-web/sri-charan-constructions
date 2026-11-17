/**
 * Party Ledger — the Payments lines shown the Tally way: Opening Balance, then Dr / Cr entries, then Closing Balance.
 *
 *   Cr  = a bill / amount PAYABLE to the party (we owe them more)        ← the "Payable" of a payment line
 *   Dr  = a PAYMENT made to the party (we owe them less)                 ← the "Paid" of a payment line
 *   Opening Balance of a period = everything dated BEFORE the "from" date, carried forward (plus any manual opening balance).
 *   Balance is a signed number: positive = Cr (we still owe), negative = Dr (we paid in advance). It is worked out, never stored.
 *
 * Nothing here touches the existing Payments lines; one payment line simply becomes up to two ledger entries (its Cr and its Dr).
 */
const pay = require('./payments');

const SIDES = ['cr', 'dr'];
const SIDE_LABEL = { cr: 'Cr', dr: 'Dr' };
const MAX_NOTE = 200;
const r2 = pay.round2;

/** { amount, side } from a signed balance (positive = Cr). */
const sided = signed => { const v = r2(signed); return { amount: Math.abs(v), side: v < -0.004 ? 'dr' : 'cr', signed: v }; };
const crOf = r => (r.side === 'cr' ? r.amount : 0);
const drOf = r => (r.side === 'dr' ? r.amount : 0);

/** Payment lines → ledger entries (a line with a Payable gives a Cr; a line with a Paid gives a Dr). */
function entriesFromLines(lines) {
  const out = [];
  for (const l of pay.sortRows(lines)) {
    const date = l.pay_date ? String(l.pay_date).slice(0, 10) : String(l.created_at || '').slice(0, 10);
    const base = { date, party_key: l.party_key || pay.keyOf(l.party_name), party_name: l.party_name, kind: l.kind, site: l.site || '', paid_by: l.paid_by || '', line_id: l.id, type: 'line' };
    const what = [l.item, l.description].filter(Boolean).join(' — ');
    if (Number(l.payable) > 0) out.push({ ...base, side: 'cr', amount: r2(l.payable), particulars: what || 'Payable' });
    if (Number(l.paid) > 0) out.push({ ...base, side: 'dr', amount: r2(l.paid), particulars: what || 'Payment' });
  }
  return out;
}

/** Manual opening balances → ledger entries. */
function entriesFromOpenings(openings) {
  return (openings || []).map(o => ({
    date: String(o.as_on).slice(0, 10), party_key: o.party_key || pay.keyOf(o.party_name), party_name: o.party_name, kind: o.kind, site: '', paid_by: '',
    opening_id: o.id, type: 'opening', side: o.side, amount: r2(o.amount), particulars: o.note ? `Opening Balance — ${o.note}` : 'Opening Balance',
  }));
}

const sortEntries = es => es.map((e, i) => ({ e, i })).sort((a, b) => a.e.date.localeCompare(b.e.date) || (a.e.type === b.e.type ? a.i - b.i : a.e.type === 'opening' ? -1 : 1)).map(x => x.e);

/** Which entries are in scope: kind (company / outside / all) and, optionally, one site (manual openings have no site, so they are left out then). */
function inScope(entries, { kind, site } = {}) {
  const sk = site ? (site === pay.NO_PAID_BY ? pay.NO_PAID_BY : pay.keyOf(site)) : '';
  return entries.filter(e => {
    if (kind && kind !== 'all' && e.kind !== kind) return false;
    if (sk) { if (e.type === 'opening') return false; const mine = pay.keyOf(e.site || ''); if (sk === pay.NO_PAID_BY ? mine !== '' : mine !== sk) return false; }
    return true;
  });
}

/** Opening / period / closing for one set of (already party-filtered) entries. */
function statement(entries, from, to) {
  const sorted = sortEntries(entries);
  let open = 0;
  const period = [];
  for (const e of sorted) {
    // an opening balance dated on (or before) the first day of the period IS the opening balance, so it is carried forward rather than listed
    if (from && (e.date < from || (e.type === 'opening' && e.date <= from))) { open = r2(open + crOf(e) - drOf(e)); continue; }
    if (to && e.date > to) continue;
    period.push(e);
  }
  let run = open;
  const rows = period.map(e => { run = r2(run + crOf(e) - drOf(e)); const b = sided(run); return { ...e, dr: drOf(e), cr: crOf(e), balance: b.amount, balance_side: b.side }; });
  const dr = r2(rows.reduce((a, r) => a + r.dr, 0)), cr = r2(rows.reduce((a, r) => a + r.cr, 0));
  const opening = sided(open), closing = sided(run);
  // Tally style: the opening balance sits on its own side, the closing balance on the opposite side, so both columns add up to the same figure.
  const totalDr = r2(dr + (opening.side === 'dr' ? opening.amount : 0) + (closing.side === 'cr' ? closing.amount : 0));
  const totalCr = r2(cr + (opening.side === 'cr' ? opening.amount : 0) + (closing.side === 'dr' ? closing.amount : 0));
  return { opening, closing, rows, period: { dr, cr, count: rows.length }, totals: { dr: totalDr, cr: totalCr } };
}

/** What the drop-downs offer: every name that has lines or an opening balance, and every site used. */
function optionsOf(entries, lines) {
  const seen = new Map();
  for (const e of entries) { const k = e.party_key; if (!seen.has(k)) seen.set(k, { name: e.party_name, kinds: new Set() }); seen.get(k).kinds.add(e.kind); }
  const parties = [...seen.values()].map(p => ({ name: p.name, kinds: [...p.kinds].sort() })).sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const o = pay.optionsOf(lines);
  return { parties, sites: o.sites, has_blank_site: o.has_blank_site };
}

/** The ledger of ONE party. */
function partyLedger({ lines, openings, party, kind, from, to, site }) {
  const all = [...entriesFromLines(lines), ...entriesFromOpenings(openings)];
  const key = pay.keyOf(party);
  const mine = inScope(all, { kind, site }).filter(e => e.party_key === key);
  const display = (all.find(e => e.party_key === key) || {}).party_name || pay.clean(party, 120);
  return { party: display, ...statement(mine, from, to), options: optionsOf(all, lines) };
}

/** Every party: opening, Dr, Cr, closing — and the grand totals. A party with nothing before and nothing in the period is left out. */
function allParties({ lines, openings, kind, from, to, site }) {
  const all = [...entriesFromLines(lines), ...entriesFromOpenings(openings)];
  const scoped = inScope(all, { kind, site });
  const by = new Map();
  for (const e of scoped) { if (!by.has(e.party_key)) by.set(e.party_key, { name: e.party_name, es: [] }); by.get(e.party_key).es.push(e); }
  const parties = [];
  for (const g of by.values()) {
    const s = statement(g.es, from, to);
    if (!s.period.count && s.opening.amount === 0) continue;
    parties.push({ party_name: g.name, kinds: [...new Set(g.es.map(e => e.kind))].sort(), opening: s.opening, dr: s.period.dr, cr: s.period.cr, closing: s.closing, lines: s.period.count });
  }
  parties.sort((a, b) => a.party_name.localeCompare(b.party_name, 'en', { sensitivity: 'base' }));
  const sum = f => r2(parties.reduce((a, p) => a + f(p), 0));
  const totals = { parties: parties.length, opening: sided(sum(p => p.opening.signed)), dr: sum(p => p.dr), cr: sum(p => p.cr), closing: sided(sum(p => p.closing.signed)) };
  return { parties, totals, options: optionsOf(all, lines) };
}

/* ── manual opening balances: validation ─────────────────────────────────────────────── */
function parseOpening(b) {
  const x = b || {};
  if (!pay.KINDS.includes(x.kind)) return { error: 'Choose Company Payments or Outside Rental Payments.' };
  const party_name = pay.clean(x.party_name, 120);
  if (!party_name) return { error: 'The opening balance needs a party name.' };
  if (String(x.party_name || '').trim().length > 120) return { error: 'The party name is too long (120 characters at most).' };
  const as_on = String(x.as_on == null ? '' : x.as_on).trim();
  const ahead = new Date(Date.now() + (5.5 * 3600 + 366 * 86400) * 1000).toISOString().slice(0, 10);
  if (!pay.validDay(as_on) || as_on < '2000-01-01' || as_on > ahead) return { error: 'The opening balance needs a valid "as on" date.' };
  if (!SIDES.includes(x.side)) return { error: 'Choose Cr (we owe the party) or Dr (we paid in advance).' };
  const n = Number(String(x.amount == null ? '' : x.amount).replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0 || n > pay.MAX_AMOUNT) return { error: 'The opening balance must be an amount above 0.' };
  const note = pay.clean(x.note, MAX_NOTE);
  return { opening: { kind: x.kind, party_name, party_key: pay.keyOf(party_name), as_on, side: x.side, amount: r2(n), note } };
}

const isMissingOpenings = err => !!err && /payment_openings/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));
const OPENINGS_SETUP_MESSAGE = 'Opening balances need a one-time database update. Run run-in-supabase-15-payment-openings.sql in Supabase > SQL Editor, then try again.';

/** "Cr" / "Dr" text for a signed or sided amount, e.g. "41,500.00 Cr". Zero has no side. */
const sidedText = b => (!b || !b.amount ? pay.money(0) : `${pay.money(b.amount)} ${SIDE_LABEL[b.side]}`);

module.exports = { SIDES, SIDE_LABEL, sided, entriesFromLines, entriesFromOpenings, partyLedger, allParties, parseOpening, isMissingOpenings, OPENINGS_SETUP_MESSAGE, sidedText };
