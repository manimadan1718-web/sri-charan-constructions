/**
 * What goes into the Inventory, Users and Activity-Log reports.
 * (How they are drawn — Excel / PDF — lives in tableReports.js.)
 */
const supabase = require('../config/supabase');
const { istDate, istTime } = require('./tableReports');
const lq = require('./logQuery');
const { summaryFor } = require('./summary');
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
  { key: 'vehicle', header: 'Vehicle No.', width: 26, weight: 24, bold: true },
  { key: 'entries', header: 'Entries', width: 12, weight: 10, align: 'right' },
  { key: 'diesel', header: 'Total diesel (L)', width: 18, weight: 14, align: 'right' },
  { key: 'loads', header: 'Total loads', width: 14, weight: 12, align: 'right' },
];

async function summaryReport(range) {
  const s = await summaryFor(range);
  const rows = s.vehicles.map((v, i) => ({ n: i + 1, vehicle: v.vehicle_no, entries: v.entries, diesel: v.diesel, loads: v.loads }));
  if (rows.length) {
    rows.push({
      n: '', vehicle: 'TOTAL (vehicles listed)', entries: s.vehicles.reduce((a, v) => a + v.entries, 0),
      diesel: s.vehicles.reduce((a, v) => a + parseFloat(v.diesel), 0).toFixed(2), loads: s.vehicles.reduce((a, v) => a + v.loads, 0),
    });
  }
  return {
    title: 'Summary', sheet: 'Summary', columns: SUMMARY_COLUMNS, rows,
    subtitle: `Period: ${rangeText(s.range)}  ·  Only vehicles with loads are listed  ·  All entries in the period: ${s.total_entries} entries, ${s.total_diesel} L diesel, ${s.total_loads} loads`,
    realRows: s.vehicles.length,
  };
}

module.exports = { inventoryReport, usersReport, logsReport, summaryReport, rangeText, INVENTORY, MAX_LOG_ROWS_XLSX, MAX_LOG_ROWS_PDF, activityLabel, changesText, deviceLabel };
