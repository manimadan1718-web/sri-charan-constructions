/**
 * What goes into the Inventory, Users and Activity-Log reports.
 * (How they are drawn — Excel / PDF — lives in tableReports.js.)
 */
const supabase = require('../config/supabase');
const { istDate, istTime } = require('./tableReports');
const lq = require('./logQuery');
const { summaryFor } = require('./summary');
const { fmtMileage } = require('./mileage');
const { fetchAll } = require('./db');
const pay = require('./payments');
const { fmtDateDMY } = require('./activity');

const MAX_LOG_ROWS_XLSX = parseInt(process.env.REPORT_MAX_LOG_ROWS_XLSX, 10) || 20000;
const MAX_LOG_ROWS_PDF  = parseInt(process.env.REPORT_MAX_LOG_ROWS_PDF, 10)  || 2000;

const stamp = iso => (iso ? `${istDate(iso)} ${istTime(iso)}` : '');
const yesNo = a => (a === false ? 'Inactive' : 'Active');

/* ── Inventory: Vehicles / Sites / Operators ────────────────────────────────── */
const INVENTORY = {
  vehicles: {
    table: 'vehicles', order: 'vehicle_no', title: 'Vehicles / Machines', sheet: 'Vehicles',
    columns: [
      { key: 'n', header: '#', width: 6, weight: 4, align: 'right' },
      { key: 'a', header: 'Vehicle / Machine No.', width: 24, weight: 24, bold: true },
      { key: 'b', header: 'Type', width: 22, weight: 20 },
      { key: 'status', header: 'Status', width: 12, weight: 10 },
      { key: 'added', header: 'Added on', width: 22, weight: 18 },
    ],
    cols: r => ({ a: r.vehicle_no, b: r.type }),
  },
  sites: {
    table: 'sites', order: 'name', title: 'Sites', sheet: 'Sites',
    columns: [
      { key: 'n', header: '#', width: 6, weight: 4, align: 'right' },
      { key: 'a', header: 'Site Name', width: 28, weight: 24, bold: true },
      { key: 'b', header: 'Location', width: 28, weight: 24 },
      { key: 'status', header: 'Status', width: 12, weight: 10 },
      { key: 'added', header: 'Added on', width: 22, weight: 18 },
    ],
    cols: r => ({ a: r.name, b: r.location }),
  },
  operators: {
    table: 'operators', order: 'name', title: 'Operators / Drivers', sheet: 'Operators',
    columns: [
      { key: 'n', header: '#', width: 6, weight: 4, align: 'right' },
      { key: 'a', header: 'Name', width: 28, weight: 24, bold: true },
      { key: 'b', header: 'Phone', width: 22, weight: 20 },
      { key: 'status', header: 'Status', width: 12, weight: 10 },
      { key: 'added', header: 'Added on', width: 22, weight: 18 },
    ],
    cols: r => ({ a: r.name, b: r.phone }),
  },
};

async function inventoryReport(type) {
  const def = INVENTORY[type];
  if (!def) return null;
  const { data, error } = await supabase.from(def.table).select('*').order(def.order, { ascending: true });
  if (error) throw error;
  const rows = (data || []).map((r, i) => ({
    n: i + 1, ...def.cols(r), status: yesNo(r.active), added: stamp(r.created_at),
    _tone: r.active === false ? 'muted' : undefined,
  }));
  return { title: def.title, sheet: def.sheet, columns: def.columns, rows };
}

/* ── Users ───────────────────────────────────────────────────────────────────── */
const USER_COLUMNS = [
  { key: 'n', header: '#', width: 5, weight: 3, align: 'right' },
  { key: 'name', header: 'Name', width: 24, weight: 14, bold: true },
  { key: 'role', header: 'Role', width: 12, weight: 7 },
  { key: 'status', header: 'Status', width: 11, weight: 7 },
  { key: 'cDate', header: 'Created date', width: 13, weight: 8 },
  { key: 'cTime', header: 'Created time', width: 12, weight: 7 },
  { key: 'cBy', header: 'Created by', width: 17, weight: 10 },
  { key: 'uDate', header: 'Last edited date', width: 14, weight: 8 },
  { key: 'uTime', header: 'Last edited time', width: 13, weight: 7 },
  { key: 'uBy', header: 'Last edited by', width: 17, weight: 10 },
  { key: 'dDate', header: 'Deleted date', width: 13, weight: 8 },
  { key: 'dTime', header: 'Deleted time', width: 12, weight: 7 },
  { key: 'dBy', header: 'Deleted by', width: 17, weight: 10 },
];

const roleLabel = r => (r ? r.charAt(0).toUpperCase() + r.slice(1) : '');

async function userLogEvents() {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('activity_logs')
      .select('entity_id, action, user_name, created_at, entity_label, changes')
      .eq('entity_type', 'user').in('action', ['user_created', 'user_updated', 'user_deleted'])
      .order('created_at', { ascending: true }).range(offset, offset + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function usersReport() {
  const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  const users = data || [];

  // The Activity Log fills in anything the user record does not carry (people created or edited before
  // tracking existed) and is the only place left that knows about users removed in the old way.
  let events = [];
  try { events = await userLogEvents(); } catch (e) { console.warn('users report: activity log unavailable —', e.message); }
  const created = {}, updated = {}, deleted = {};
  events.forEach(ev => {
    const id = String(ev.entity_id);
    if (ev.action === 'user_created' && !created[id]) created[id] = ev;
    if (ev.action === 'user_updated') updated[id] = ev;       // events are oldest → newest, so this ends as the latest
    if (ev.action === 'user_deleted') deleted[id] = ev;
  });

  const build = (src) => {
    const cAt = src.createdAt, uAt = src.updatedAt, dAt = src.deletedAt;
    return {
      name: src.name, role: roleLabel(src.role), status: src.status,
      cDate: istDate(cAt), cTime: istTime(cAt), cBy: src.createdBy || (cAt ? 'Not recorded' : ''),
      uDate: istDate(uAt), uTime: istTime(uAt), uBy: src.updatedBy || '',
      dDate: istDate(dAt), dTime: istTime(dAt), dBy: src.deletedBy || '',
      _tone: src.status === 'Deleted' ? 'danger' : src.status === 'Inactive' ? 'muted' : undefined,
    };
  };

  const known = new Set(users.map(u => String(u.id)));
  const current = [], gone = [];
  users.forEach(u => {
    const id = String(u.id);
    const isDel = !!u.deleted_at;
    const row = build({
      name: u.name, role: u.role, status: isDel ? 'Deleted' : yesNo(u.active),
      createdAt: u.created_at, createdBy: u.created_by_name || (created[id] && created[id].user_name),
      updatedAt: u.updated_at || (updated[id] && updated[id].created_at), updatedBy: u.updated_by_name || (updated[id] && updated[id].user_name),
      deletedAt: isDel ? u.deleted_at : null, deletedBy: isDel ? (u.deleted_by_name || (deleted[id] && deleted[id].user_name)) : '',
    });
    (isDel ? gone : current).push({ row, at: isDel ? u.deleted_at : u.created_at });
  });
  // Users removed before tracking existed: their record is gone, but the Activity Log remembers them.
  Object.entries(deleted).forEach(([id, ev]) => {
    if (known.has(id)) return;
    const c = created[id];
    const roleFrom = Array.isArray(ev.changes) && ev.changes[0] ? ev.changes[0].from : '';
    gone.push({
      row: build({ name: ev.entity_label, role: (roleFrom || '').toLowerCase(), status: 'Deleted', createdAt: c && c.created_at, createdBy: c && c.user_name, deletedAt: ev.created_at, deletedBy: ev.user_name }),
      at: ev.created_at,
    });
  });
  gone.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const rows = [...current, ...gone].map((x, i) => ({ n: i + 1, ...x.row }));
  return { title: 'Users', sheet: 'Users', columns: USER_COLUMNS, rows, counts: { current: current.length, deleted: gone.length } };
}

/* ── Activity Logs ───────────────────────────────────────────────────────────── */
const LOG_COLUMNS_XLSX = [
  { key: 'n', header: '#', width: 6, weight: 3, align: 'right' },
  { key: 'date', header: 'Date', width: 12, weight: 7 },
  { key: 'time', header: 'Time', width: 11, weight: 6 },
  { key: 'who', header: 'Who', width: 18, weight: 10, bold: true },
  { key: 'role', header: 'Role', width: 11, weight: 6 },
  { key: 'activity', header: 'Activity', width: 18, weight: 10 },
  { key: 'details', header: 'Details', width: 30, weight: 16, wrap: true },
  { key: 'reason', header: 'Reason', width: 26, weight: 13, wrap: true },
  { key: 'changes', header: 'What changed', width: 46, weight: 24, wrap: true },
  { key: 'ip', header: 'IP address', width: 16, weight: 8 },
  { key: 'device', header: 'Device', width: 18, weight: 9 },
];

const SPECIAL = {
  login: 'Login', login_failed: 'Failed login', login_blocked: 'Login blocked', logout: 'Logout', access_denied: 'Access denied',
  entry_updated: 'Entry edited', report_exported: 'Report exported', logs_deleted: 'Logs deleted',
};
function activityLabel(action) {
  if (SPECIAL[action]) return SPECIAL[action];
  const m = /^([a-z]+)_(added|created|updated|deleted)$/.exec(action || '');
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
  if (m) return `${cap(m[1])} ${m[2]}`;
  return cap(String(action || 'activity').replace(/_/g, ' '));
}
function deviceLabel(ua) {
  if (!ua) return '';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}
/** "Diesel (L): 25 → 30; Loads: 12 → 14" — values only, never anything secret (the log never holds any). */
function changesText(changes) {
  if (!Array.isArray(changes)) return '';
  const v = x => (x === null || x === undefined || x === '' ? '—' : String(x));
  return changes.map(c => {
    const hasFrom = c.from !== null && c.from !== undefined, hasTo = c.to !== null && c.to !== undefined;
    if (hasFrom && hasTo) return `${c.field}: ${v(c.from)} → ${v(c.to)}`;
    return `${c.field}: ${v(hasTo ? c.to : c.from)}`;
  }).join('; ');
}

function describeFilters(filters, idsCount) {
  if (idsCount) return `Selected ${idsCount} entr${idsCount === 1 ? 'y' : 'ies'}`;
  const parts = [];
  if (filters.category) parts.push(`Type: ${filters.category}`);
  if (filters.from) parts.push(`From ${lq.fmtIstDate(filters.from)}`);
  if (filters.to) parts.push(`To ${lq.fmtIstDate(filters.to)}`);
  if (filters.q) parts.push(`Search: "${filters.q}"`);
  return parts.length ? `Filters: ${parts.join(' · ')}` : 'Filters: none (all activity)';
}

/** ids = specific rows, or filters = everything matching. `format` decides the size limit. */
async function logsReport({ ids, filters, format }) {
  const max = format === 'pdf' ? MAX_LOG_ROWS_PDF : MAX_LOG_ROWS_XLSX;
  let list = [];
  if (ids) {
    if (ids.length > max) throw lq.userError(413, `That is too many entries for one ${format === 'pdf' ? 'PDF' : 'Excel'} file (${ids.length}). Select fewer, or narrow the filters.`);
    for (let i = 0; i < ids.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await supabase.from('activity_logs').select('*').in('id', ids.slice(i, i + 100));
      if (error) throw error;
      list.push(...(data || []));
    }
    list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  } else {
    const total = await lq.countLogs(filters);
    if (total > max) throw lq.userError(413, `That is too many entries for one ${format === 'pdf' ? 'PDF' : 'Excel'} file (${total}). Narrow the filters (for example to one month)${format === 'pdf' ? ' or choose Excel' : ''}.`);
    list = await lq.collectLogs(filters, max);
  }
  const rows = list.map((l, i) => ({
    n: i + 1, date: istDate(l.created_at), time: istTime(l.created_at),
    who: l.user_name || 'Not signed in', role: roleLabel(l.user_role), activity: activityLabel(l.action),
    details: l.entity_label || '', reason: l.reason || '', changes: changesText(l.changes),
    ip: l.ip || '', device: deviceLabel(l.user_agent),
    _tone: l.action === 'login_failed' || l.action === 'login_blocked' || l.action === 'access_denied' ? 'danger' : undefined,
  }));
  return { title: 'Activity Logs', sheet: 'Activity Logs', columns: LOG_COLUMNS_XLSX, rows, subtitle: describeFilters(filters || {}, ids ? ids.length : 0) };
}

/* ── Summary ─────────────────────────────────────────────────────────────────── */
const rangeText = ({ from, to }) => {
  if (from && to) return from === to ? fmtDateDMY(from) : `${fmtDateDMY(from)} – ${fmtDateDMY(to)}`;
  if (from) return `From ${fmtDateDMY(from)}`;
  if (to) return `Up to ${fmtDateDMY(to)}`;
  return 'All time';
};
const SUMMARY_COLUMNS = [
  { key: 'n', header: '#', width: 6, weight: 4, align: 'right' },
  { key: 'vehicle', header: 'Vehicle No.', width: 26, weight: 22, bold: true },
  { key: 'entries', header: 'Entries', width: 12, weight: 9, align: 'right' },
  { key: 'diesel', header: 'Total diesel (L)', width: 18, weight: 13, align: 'right' },
  { key: 'loads', header: 'Total loads', width: 14, weight: 11, align: 'right' },
  { key: 'hours', header: 'Total working hours', width: 20, weight: 15, align: 'right' },
  { key: 'mileage', header: 'Mileage', width: 16, weight: 12, align: 'right' },
];
const fmtHrs = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

async function summaryReport(range) {
  const s = await summaryFor(range);
  const sum = (list, k) => list.reduce((a, v) => a + (parseFloat(v[k]) || 0), 0);
  const rows = s.vehicles.map((v, i) => ({ n: i + 1, vehicle: v.vehicle_no, entries: v.entries, diesel: v.diesel, loads: v.loads, hours: fmtHrs(v.hours), mileage: fmtMileage(v.mileage) }));
  if (rows.length) {
    rows.push({
      n: '', vehicle: 'TOTAL (vehicles listed)', entries: sum(s.vehicles, 'entries'),
      diesel: sum(s.vehicles, 'diesel').toFixed(2), loads: sum(s.vehicles, 'loads'), hours: fmtHrs(Math.round(sum(s.vehicles, 'hours') * 100) / 100), mileage: fmtMileage(s.mileage),
    });
  }
  // With no site chosen, the report also carries the site-wise summary underneath.
  if (s.site === null && s.sites.length) {
    rows.push({ n: '', vehicle: '', entries: '', diesel: '', loads: '', hours: '', mileage: '' });
    rows.push({ n: '', vehicle: 'SITE-WISE SUMMARY', entries: 'Entries', diesel: 'Diesel (L)', loads: 'Loads', hours: 'Working hours', mileage: 'Mileage' });
    s.sites.forEach((x, i) => rows.push({ n: i + 1, vehicle: x.site, entries: x.entries, diesel: x.diesel, loads: x.loads, hours: fmtHrs(x.hours), mileage: fmtMileage(x.mileage) }));
    rows.push({ n: '', vehicle: 'TOTAL (all sites)', entries: s.total_entries, diesel: s.total_diesel, loads: s.total_loads, hours: fmtHrs(s.total_hours), mileage: fmtMileage(s.mileage) });
  }
  return {
    title: 'Summary', sheet: 'Summary', columns: SUMMARY_COLUMNS, rows,
    subtitle: `Period: ${rangeText(s.range)}  ·  Site: ${s.site === null ? 'All sites' : s.site}  ·  Vehicles with loads or working hours are listed  ·  All entries: ${s.total_entries} entries, ${s.total_diesel} L diesel, ${s.total_loads} loads, ${fmtHrs(s.total_hours)} working hours${fmtMileage(s.mileage) ? `, mileage ${fmtMileage(s.mileage)}` : ''}`,
    realRows: s.vehicles.length,
  };
}

/* ── Payments: one kind (Company / Outside Rental), or the complete cumulative report of both ───────────── */
const PAY_COLUMNS = [
  { key: 'n', header: 'Sl No', width: 7, weight: 5, align: 'right' },
  { key: 'date', header: 'Date', width: 12, weight: 9 },
  { key: 'site', header: 'Site', width: 18, weight: 12, wrap: true },
  { key: 'name', header: 'Name', width: 26, weight: 18, bold: true, wrap: true },
  { key: 'item', header: 'Item', width: 22, weight: 14, wrap: true },
  { key: 'description', header: 'Description', width: 32, weight: 20, wrap: true },
  { key: 'payable', header: 'Payable', width: 15, weight: 11, align: 'right', numFmt: '#,##0.00', fmt: pay.money },
  { key: 'paid', header: 'Paid', width: 15, weight: 11, align: 'right', numFmt: '#,##0.00', fmt: pay.money },
  { key: 'balance', header: 'Balance', width: 15, weight: 11, align: 'right', numFmt: '#,##0.00', fmt: pay.money },
  { key: 'paid_by', header: 'Paid By', width: 18, weight: 12, wrap: true },
];
const numbers = t => ({ payable: t.payable, paid: t.paid, balance: t.balance });

async function paymentsReport(kind, filters = {}) {
  const { data, error } = await fetchAll(() => supabase.from('payment_lines').select('*').order('created_at', { ascending: true }).order('id', { ascending: true }), 20000)
    .then(r => (r.error ? r : r)).catch(e => ({ data: null, error: e }));
  if (error) {
    if (pay.isMissingPayments(error)) throw Object.assign(new Error('payment_lines missing'), { status: 503, userMessage: pay.PAYMENTS_SETUP_MESSAGE });
    throw error;
  }
  const everything = pay.sortRows(data.map(p => {
    const balance = pay.balanceOf(p.payable, p.paid);
    return { ...p, pay_date: p.pay_date ? String(p.pay_date).slice(0, 10) : String(p.created_at || '').slice(0, 10), payable: Number(p.payable) || 0, paid: Number(p.paid) || 0, balance, status: pay.statusOf(balance), paid_by: p.paid_by || '', party_key: pay.keyOf(p.party_name) };
  }));
  const lines = pay.applyFilters(everything, filters), ftxt = pay.filtersText(filters);
  const lineRow = (p, i) => ({ n: i + 1, date: pay.dmy(p.pay_date), site: p.site || '', name: p.party_name, item: p.item || '', description: p.description || '', ...numbers(p), paid_by: p.paid_by || '' });
  const note = `Balance = Payable − Paid  ·  amounts in rupees  ·  a negative balance means more was paid than was payable${ftxt ? `  ·  Filters: ${ftxt}` : ''}`;

  if (kind === 'company' || kind === 'outside') {
    const mine = lines.filter(l => l.kind === kind), t = pay.totalsOf(mine);
    const rows = mine.map(lineRow);
    if (rows.length) rows.push({ n: '', name: 'TOTAL', item: `${t.count} line${t.count === 1 ? '' : 's'}`, description: '', ...numbers(t), _kind: 'total' });
    return { title: pay.KIND_LABEL[kind], sheet: pay.KIND_LABEL[kind], columns: PAY_COLUMNS, rows, subtitle: `${pay.KIND_LABEL[kind]}  ·  ${t.count} line${t.count === 1 ? '' : 's'}  ·  ${note}`, realRows: mine.length };
  }

  // The complete cumulative report: both kinds together.
  const c = pay.cumulative(lines), rows = [];
  rows.push({ _kind: 'section', _label: 'CUMULATIVE SUMMARY — COMPANY AND OUTSIDE RENTAL PAYMENTS' });
  pay.KINDS.forEach((k, i) => rows.push({ n: i + 1, name: pay.KIND_LABEL[k], item: `${c.kinds[k].totals.count} line${c.kinds[k].totals.count === 1 ? '' : 's'}`, description: `${c.kinds[k].parties.length} ${c.kinds[k].parties.length === 1 ? 'party' : 'parties'}`, ...numbers(c.kinds[k].totals) }));
  rows.push({ n: '', name: 'GRAND TOTAL', item: `${c.overall.count} line${c.overall.count === 1 ? '' : 's'}`, description: '', ...numbers(c.overall), _kind: 'total' });
  for (const k of pay.KINDS) {
    rows.push({ _kind: 'section', _label: `${pay.KIND_LABEL[k].toUpperCase()} — PARTY-WISE` });
    c.kinds[k].parties.forEach((p, i) => rows.push({ n: i + 1, name: p.party_name, item: `${p.count} line${p.count === 1 ? '' : 's'}`, description: '', ...numbers(p) }));
    rows.push({ n: '', name: `Total — ${pay.KIND_LABEL[k]}`, item: '', description: '', ...numbers(c.kinds[k].totals), _kind: 'subtotal' });
  }
  for (const k of pay.KINDS) {
    const mine = lines.filter(l => l.kind === k);
    rows.push({ _kind: 'section', _label: `COMPLETE STATEMENT — ${pay.KIND_LABEL[k].toUpperCase()}` });
    mine.forEach((p, i) => rows.push(lineRow(p, i)));
    rows.push({ n: '', name: `Total — ${pay.KIND_LABEL[k]}`, item: `${mine.length} line${mine.length === 1 ? '' : 's'}`, description: '', ...numbers(c.kinds[k].totals), _kind: 'subtotal' });
  }
  rows.push({ n: '', name: 'GRAND TOTAL — COMPANY + OUTSIDE RENTAL', item: '', description: '', ...numbers(c.overall), _kind: 'total' });
  return { title: 'Cumulative Payments Report', sheet: 'Cumulative', columns: PAY_COLUMNS, rows, subtitle: `Company + Outside Rental  ·  ${c.overall.count} line${c.overall.count === 1 ? '' : 's'}  ·  ${note}`, realRows: lines.length };
}

module.exports = { paymentsReport, inventoryReport, usersReport, logsReport, summaryReport, rangeText, INVENTORY, MAX_LOG_ROWS_XLSX, MAX_LOG_ROWS_PDF, activityLabel, changesText, deviceLabel };
