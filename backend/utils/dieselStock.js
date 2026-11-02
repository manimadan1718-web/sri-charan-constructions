/**
 * Diesel STOCK: what was received at each site, and what is left.
 *
 *   Balance Stock = Diesel Stock Received  -  Usage          (running, per site)
 *
 * Stock received is typed in (date, site, litres) and kept in `diesel_stock`. Usage is never typed: it is the diesel on the entries
 * (site by site, vehicle by vehicle), so the balance follows what the supervisors enter, and corrections to an entry are reflected.
 * A period can be chosen: the stock and usage BEFORE it become an opening balance, so the balance stays right.
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');
const { NO_SITE, NO_SITE_PARAM } = require('./summary');

const TABLE = 'diesel_stock';
const SETUP_MESSAGE = 'Diesel stock needs a one-time database update. Run run-in-supabase-14-diesel-stock.sql in Supabase > SQL Editor, then try again.';
const isMissingTable = err => !!err && /diesel_stock/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const siteKey = s => String(s == null ? '' : s).trim().toLowerCase();
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const dmy = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || ''); };
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const clean = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const MAX_LITRES = 1000000;

/** Checks what someone typed. Returns { value } or { error }. The site is matched to Inventory (any capitals) and written the way Inventory spells it. */
async function parseStock(b) {
  b = b || {};
  const stock_date = String(b.date || b.stock_date || '');
  if (!isDate(stock_date)) return { error: 'Choose a valid date.' };
  if (stock_date > todayIST()) return { error: 'The date cannot be in the future.' };
  const typed = clean(b.site, 120);
  if (!typed) return { error: 'Choose the site.' };
  const { data, error } = await supabase.from('sites').select('name');
  if (error) throw error;
  const real = (data || []).find(s => siteKey(s.name) === siteKey(typed));
  if (!real) return { error: `The site "${typed}" is not in Inventory. Pick one from the list, or add it under Inventory first.` };
  const raw = typeof b.litres === 'string' ? b.litres.trim() : b.litres;
  const litres = Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(litres)) return { error: 'Enter the litres of diesel received.' };
  if (litres <= 0) return { error: 'The litres received must be more than 0.' };
  if (litres > MAX_LITRES) return { error: 'That is too many litres. Please check the number.' };
  return { value: { stock_date, site: real.name, litres: round2(litres), note: clean(b.note, 200) } };
}

const publicRow = r => ({ id: r.id, date: r.stock_date, site: r.site, litres: round2(r.litres), note: r.note || '', created_by_name: r.created_by_name || null, created_at: r.created_at || null, updated_by_name: r.updated_by_name || null, updated_at: r.updated_at || null });

/** All stock rows up to a date (older ones are needed for the opening balance). Returns { rows, setupRequired }. */
async function readStock({ to } = {}) {
  const r = await fetchAll(() => { let q = supabase.from(TABLE).select('*').order('stock_date', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }); if (to) q = q.lte('stock_date', to); return q; });
  if (r.error) { if (isMissingTable(r.error)) return { rows: [], setupRequired: true }; throw r.error; }
  return { rows: r.data || [], setupRequired: false };
}

/** The diesel on the entries up to a date: one row per entry that used diesel. */
async function readUsage({ to } = {}) {
  const r = await fetchAll(() => { let q = supabase.from('entries').select('id, date, site, vehicle_no, diesel').gt('diesel', 0).order('date', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }); if (to) q = q.lte('date', to); return q; });
  if (r.error) throw r.error;
  return r.data || [];
}

/** { from?, to?, sites? } -> the ledger: rows (date, site, received, usage, balance, vehicles), per-site summary, totals, vehicle-wise usage, the stock entries. */
async function ledger({ from, to, sites = [] } = {}) {
  const [{ rows: stockRows, setupRequired }, usageRows] = await Promise.all([readStock({ to }), readUsage({ to })]);
  const want = sites.length ? new Set(sites.map(s => (s === NO_SITE_PARAM ? '' : String(s).toLowerCase()))) : null;
  const book = new Map();
  const slot = (raw, display) => {
    const key = siteKey(raw);
    if (!book.has(key)) book.set(key, { site: '', before: { received: 0, used: 0 }, days: new Map(), vehicles: new Map() });
    const s = book.get(key); if (display && !s.site) s.site = display; return s;
  };
  const day = (s, date) => { if (!s.days.has(date)) s.days.set(date, { received: 0, used: 0, vehicles: new Map(), stock_ids: [] }); return s.days.get(date); };
  const inRange = date => !from || date >= from;
  const stockList = [];
  for (const r of stockRows) {
    if (want && !want.has(siteKey(r.site))) continue;
    const s = slot(r.site, r.site), litres = Number(r.litres) || 0;
    if (inRange(r.stock_date)) { const d = day(s, r.stock_date); d.received += litres; d.stock_ids.push(r.id); stockList.push(publicRow(r)); }
    else s.before.received += litres;
  }
  for (const e of usageRows) {
    if (want && !want.has(siteKey(e.site))) continue;
    const s = slot(e.site, String(e.site || '').trim()), litres = Number(e.diesel) || 0;
    if (inRange(e.date)) {
      const d = day(s, e.date); d.used += litres;
      const v = d.vehicles.get(e.vehicle_no || 'Unknown') || { vehicle_no: e.vehicle_no || 'Unknown', litres: 0, entries: 0 }; v.litres += litres; v.entries += 1; d.vehicles.set(v.vehicle_no, v);
      const w = s.vehicles.get(e.vehicle_no || 'Unknown') || { vehicle_no: e.vehicle_no || 'Unknown', litres: 0, entries: 0 }; w.litres += litres; w.entries += 1; s.vehicles.set(w.vehicle_no, w);
    } else s.before.used += litres;
  }
  const rows = [], summary = [], vehicleUsage = [];
  for (const [key, s] of book) {
    const name = s.site || NO_SITE, value = key === '' ? NO_SITE_PARAM : s.site;
    const opening = round2(s.before.received - s.before.used);
    let running = opening, rec = 0, used = 0;
    for (const date of [...s.days.keys()].sort()) {
      const d = s.days.get(date); running += d.received - d.used; rec += d.received; used += d.used;
      rows.push({ date, site: name, value, received: round2(d.received), usage: round2(d.used), balance: round2(running), stock_ids: d.stock_ids,
        vehicles: [...d.vehicles.values()].sort((a, b) => b.litres - a.litres || a.vehicle_no.localeCompare(b.vehicle_no)).map(v => ({ ...v, litres: round2(v.litres) })) });
    }
    summary.push({ site: name, value, opening, received: round2(rec), used: round2(used), balance: round2(running) });
    [...s.vehicles.values()].sort((a, b) => b.litres - a.litres || a.vehicle_no.localeCompare(b.vehicle_no)).forEach(v => vehicleUsage.push({ site: name, value, vehicle_no: v.vehicle_no, litres: round2(v.litres), entries: v.entries }));
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site));
  const bySiteName = (a, b) => (a.value === NO_SITE_PARAM ? 1 : b.value === NO_SITE_PARAM ? -1 : a.site.localeCompare(b.site));
  summary.sort(bySiteName); vehicleUsage.sort((a, b) => bySiteName(a, b) || b.litres - a.litres);
  const sum = k => round2(summary.reduce((t, s) => t + s[k], 0));
  return {
    range: { from: from || null, to: to || null }, sites_filter: [...sites],
    totals: { opening: sum('opening'), received: sum('received'), used: sum('used'), balance: sum('balance') },
    below_zero: summary.filter(s => s.balance < 0).map(s => ({ site: s.site, balance: s.balance })),
    rows, sites: summary, vehicle_usage: vehicleUsage,
    stock: stockList.sort((a, b) => b.date.localeCompare(a.date) || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    setup_required: setupRequired || undefined,
  };
}

/** What is left at one site (as of a date, or all time): used by Data Entry to show the balance and to ask for stock when there is none. */
async function balanceFor(site, upTo) {
  const key = siteKey(site);
  const [{ rows: stockRows, setupRequired }, usageRows] = await Promise.all([readStock({ to: upTo }), readUsage({ to: upTo })]);
  const mine = stockRows.filter(r => siteKey(r.site) === key);
  const received = round2(mine.reduce((a, r) => a + (Number(r.litres) || 0), 0));
  const used = round2(usageRows.filter(e => siteKey(e.site) === key).reduce((a, e) => a + (Number(e.diesel) || 0), 0));
  let any = mine.length > 0;
  if (!any && upTo) { const all = await readStock({}); any = all.rows.some(r => siteKey(r.site) === key); }     // stock added at any date counts as "stock added"
  return { site, as_of: upTo || null, has_stock: any, received, used, balance: round2(received - used), setup_required: setupRequired || undefined };
}

module.exports = { TABLE, SETUP_MESSAGE, isMissingTable, parseStock, publicRow, ledger, balanceFor, round2, siteKey, isDate, dmy, todayIST };
