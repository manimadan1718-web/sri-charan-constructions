/**
 * The full backup — everything in the database, as ONE Excel file (Admin only).
 *   • one sheet per module (Records, Purchases, Payments, Renewals, Documents, People …), every column exactly as stored;
 *   • NOT included: PINs (never leave the database), and the uploaded photo / PDF files themselves (they stay in storage —
 *     the sheets keep their names and storage paths, so nothing is orphaned);
 *   • the Activity Log is the newest 20,000 entries.
 * It is WRITTEN AS IT IS READ (a streaming workbook), so a big database does not need big memory.
 */
const ExcelJS = require('exceljs');
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');

const MAX_ROWS = 100000, MAX_LOG_ROWS = 20000, CELL_MAX = 32000;
const SHEETS = [
  { name: 'Records',             table: 'entries' },
  { name: 'Unloading lines',     table: 'load_points' },
  { name: 'Daily breakup lines', table: 'day_load_points' },
  { name: 'Progress pictures',   table: 'progress_photos' },
  { name: 'Purchases',           table: 'purchases' },
  { name: 'Payments',            table: 'payment_lines' },
  { name: 'Old weekly-monthly',  table: 'payments' },                 // the earlier employee payments: still in the database, no longer shown in the app
  { name: 'Renewals',            table: 'renewals' },
  { name: 'Renewal documents',   table: 'renewal_files' },
  { name: 'Documents',           table: 'documents' },
  { name: 'Vehicles',            table: 'vehicles' },
  { name: 'Operators',           table: 'operators' },
  { name: 'Sites',               table: 'sites' },
  { name: 'People',              table: 'users', drop: ['pin'] },     // never the PIN
  { name: 'Archive',             table: 'archive_items', drop: ['snapshot'] },
  { name: 'Reminder settings',   table: 'app_settings' },
  { name: 'Activity log',        table: 'activity_logs', newestFirst: true, max: MAX_LOG_ROWS },
];

const isMissingTable = (err, table) => !!err && new RegExp(table, 'i').test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

/** One database value → one Excel cell. */
function cell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > CELL_MAX ? s.slice(0, CELL_MAX) + ' … (cut: too long for one cell)' : s;
}

async function readAll() {
  const out = [];
  for (const sh of SHEETS) {
    // eslint-disable-next-line no-await-in-loop
    const r = await fetchAll(() => {
      const q = supabase.from(sh.table).select('*');
      return sh.newestFirst ? q.order('created_at', { ascending: false }).order('id', { ascending: false }) : q.order('id', { ascending: true });
    }, sh.max || MAX_ROWS).catch(error => ({ data: null, error }));
    if (r.error) {
      if (isMissingTable(r.error, sh.table)) { out.push({ ...sh, rows: [], missing: true }); continue; }
      throw r.error;
    }
    const rows = (r.data || []).map(row => { const c = { ...row }; (sh.drop || []).forEach(k => delete c[k]); return c; });
    out.push({ ...sh, rows });
  }
  return out;
}

/** Streams the workbook into `stream` (a response). Returns { sheets, rows }. */
async function writeBackup(stream, { user, appUrl, now = new Date() }) {
  const data = await readAll();                                  // everything is read BEFORE the first byte is sent, so a failure is a clean error
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
  wb.creator = 'Sri Charan Constructions — Site Log';

  const when = new Date(now.getTime() + 5.5 * 3600000).toISOString().replace('T', ' ').slice(0, 16) + ' (India time)';
  const total = data.reduce((a, d) => a + d.rows.length, 0);
  const readme = wb.addWorksheet('README', { properties: { tabColor: { argb: 'FFE2740A' } } });
  readme.columns = [{ width: 30 }, { width: 100 }];
  const put = (a, b, bold) => { const r = readme.addRow([a, b]); if (bold) r.font = { bold: true, size: 13 }; r.alignment = { wrapText: true, vertical: 'top' }; r.commit(); };
  put('SRI CHARAN CONSTRUCTIONS — FULL BACKUP', '', true);
  put('Made on', when); put('Made by', user && user.name ? `${user.name} (Admin)` : 'Admin'); put('From', appUrl || '');
  put('', ''); put('What is inside', 'One sheet per module. Every column is exactly as it is stored in the database.', true);
  data.forEach(d => put(d.name, d.missing ? 'not set up yet (nothing to save)' : `${d.rows.length} row${d.rows.length === 1 ? '' : 's'}${d.name === 'Activity log' && d.rows.length >= MAX_LOG_ROWS ? ' — the newest 20,000 only' : ''}`));
  put('', ''); put('What is NOT inside', '', true);
  put('PINs', 'Never saved. They cannot be read from the database, and a backup must not carry them.');
  put('Photos and PDFs', 'The uploaded files stay in storage. These sheets keep their names and storage paths, so they can be matched again. Keep the originals of important papers elsewhere too.');
  put('Archive copies', 'The Archive sheet lists each item (what, who, when, why); the full copies stay in the database.');
  put('', ''); put('Keep it safe', 'This file holds your business records. Store it in a private folder, not in WhatsApp or a shared drive. Use a dated name, for example SCC-backup-2026-11-06.');
  readme.commit();

  for (const d of data) {
    const ws = wb.addWorksheet(d.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols = [];
    d.rows.forEach(r => Object.keys(r).forEach(k => { if (!cols.includes(k)) cols.push(k); }));
    if (!cols.length) { ws.addRow([d.missing ? '(not set up yet)' : '(no rows)']).commit(); ws.commit(); continue; }
    ws.columns = cols.map(c => ({ width: Math.min(46, Math.max(12, c.length + 4)) }));
    const head = ws.addRow(cols); head.font = { bold: true, color: { argb: 'FFFFFFFF' } }; head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B2127' } }; head.commit();
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    for (const r of d.rows) ws.addRow(cols.map(c => cell(r[c]))).commit();
    ws.commit();
  }
  await wb.commit();
  return { sheets: data.length, rows: total, detail: data.map(d => `${d.name}: ${d.rows.length}`) };
}

module.exports = { SHEETS, writeBackup, readAll, cell, isMissingTable };
