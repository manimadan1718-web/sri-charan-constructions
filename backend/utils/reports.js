/**
 * Report builders for the Records screen: CSV, Excel (.xlsx) and PDF.
 *
 *   • CSV    plain text — a photo can't live in a CSV, so the photo columns say Yes / No.
 *   • Excel  every photo is placed inside its own cell, next to the reading it proves.
 *   • PDF    same table, print-ready, with the photos in the cells.
 *
 * Photos are read from the private storage bucket and shrunk to small thumbnails first,
 * so a report with hundreds of photos stays a sensible size instead of hundreds of MB.
 *
 * The heavy libraries (exceljs, pdfkit, sharp) are loaded only when a report is made, so the
 * rest of the app keeps working even if they have not been installed yet.
 */
const path = require('path');
const supabase = require('../config/supabase');
const { parseWorkingMinutes, hoursFromMinutes } = require('./workHours');
const { mileageOf, fmtMileage, fmtEntryMileage, readingOf } = require('./mileage');
const { withVehicleTypes } = require('./vehicleTypes');
const photos = require('./photos');
const { fmtDateDMY } = require('./activity');
const lp = require('./loadPoints');
const progressUtil = require('./progress');

const REPORT_TZ  = process.env.REPORT_TZ || 'Asia/Kolkata';
const MAX_ROWS   = parseInt(process.env.REPORT_MAX_ROWS, 10)   || 2000;
const MAX_PHOTOS = parseInt(process.env.REPORT_MAX_PHOTOS, 10) || 500;
const THUMB_EDGE = 400;      // longest side of a report thumbnail, in pixels
const THUMB_QUALITY = 72;

const COLORS = { ink: '1B2433', steel: '5B6779', orange: 'E2740A', line: 'E4E8EF', paper: 'F8FAFC' };

/* ── helpers ─────────────────────────────────────────────────────────────────── */
function lib(name) {
  try { return require(name); } catch {
    const err = new Error(`missing library ${name}`);
    err.userMessage = `Reports need the "${name}" package, which is not installed on the server yet. Run "npm install" and restart.`;
    err.status = 503;
    throw err;
  }
}

function userError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.userMessage = message;
  return err;
}

const zoneName = () => (REPORT_TZ === 'Asia/Kolkata' ? 'IST' : REPORT_TZ);
const todayStamp = () => new Date().toLocaleDateString('en-CA', { timeZone: REPORT_TZ });   // YYYY-MM-DD
const nowStamp = () =>
  new Date().toLocaleString('en-IN', { timeZone: REPORT_TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) + ' ' + zoneName();

const cleanText = (v, max = 300) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Fetches the entries for the given ids, keeping the caller's order. */
async function fetchEntriesByIds(ids) {
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const chunk = ids.slice(i, i + 100);
    let r = await supabase.from('entries').select('*, load_points(*)').in('id', chunk);
    if (r.error && lp.isMissingLoadPoints(r.error)) r = await supabase.from('entries').select('*').in('id', chunk);
    if (r.error) throw r.error;
    (r.data || []).forEach(row => byId.set(String(row.id), row));
  }
  const found = ids.map(id => byId.get(String(id))).filter(Boolean);
  await withVehicleTypes(found);                                           // (Inventory's vehicle type tells kilometres from hours)
  return found;
}

/** One flat, display-ready row per entry. */
function toRow(e, i) {
  return {
    n: i + 1,
    date: fmtDateDMY(e.date),
    site: e.site || '',
    category: e.category === 'rental' ? 'Rental' : 'Own',
    vehicle: e.vehicle_no || '',
    start: e.start_reading || '',
    startPhoto: photos.isReadingPath(e.start_photo) ? e.start_photo : null,
    close: e.close_reading || '',
    closePhoto: photos.isReadingPath(e.close_photo) ? e.close_photo : null,
    hours: e.working_hours || '',
    hoursMin: (r => (r && r.kind === 'hours' ? r.min : null))(readingOf(e)),      // only real hours are added up (not km)
    vehicleType: e.vehicle_type || '',
    diesel: Number(e.diesel) || 0,
    dieselPhoto: photos.isReadingPath(e.diesel_photo) ? e.diesel_photo : null,
    mileage: fmtEntryMileage(e),                       // this entry's own diesel per hour (or km per litre); '' when it cannot be worked out
    loads: parseInt(e.loads, 10) || 0,
    operator: e.operator || '',
    remarks: e.remarks || '',
    hadStartPhoto: !!e.start_photo,
    hadClosePhoto: !!e.close_photo,
    hadDieselPhoto: !!e.diesel_photo,
  };
}

/* ── What a report holds: any mix of the Records table, the Loads Breakup summary and the Site Working Progress pictures ── */
const ALL_SECTIONS = { records: true, breakup: true, progress: true };
const SECTION_KEYS = ['records', 'breakup', 'progress'];
/** ['records', 'breakup'] -> { records: true, breakup: true, progress: false }; nothing given = everything (as before). Returns null when the list is not valid. */
function normalizeSections(list) {
  if (list === undefined || list === null) return { ...ALL_SECTIONS };
  if (!Array.isArray(list) || !list.length || !list.every(x => SECTION_KEYS.includes(x))) return null;
  return { records: list.includes('records'), breakup: list.includes('breakup'), progress: list.includes('progress') };
}
const gateExtras = (extras, sections) => ({ ...extras, breakup: sections.breakup ? (extras.breakup || []) : [], progress: sections.progress ? (extras.progress || []) : [] });
const reportTitle = sections => (sections.records ? 'Site Activity Log' : sections.breakup && sections.progress ? 'Loads Breakup and Site Working Progress' : sections.breakup ? 'Loads Breakup' : 'Site Working Progress Images');
/** One line saying what the file holds: "62 records · 40 photos · Loads breakup (17 lines) · Site working progress (14 images)". */
function contentsLine(rows, thumbs, extras, sections) {
  const parts = [];
  if (sections.records) parts.push(`${rows.length} record${rows.length === 1 ? '' : 's'}`, photoSummary(rows, thumbs));
  const bl = extras.breakup || [], pg = extras.progress || [];
  if (sections.breakup) parts.push(`Loads breakup (${bl.length} line${bl.length === 1 ? '' : 's'})`);
  if (sections.progress) parts.push(`Site working progress (${pg.length} image${pg.length === 1 ? '' : 's'})`);
  return parts.join('  ·  ');
}

/** The overall mileage of the rows in a report (used for the closing Total line). */
const totalMileageText = rows => fmtMileage(mileageOf(rows.map(r => ({ vehicle_no: r.vehicle, vehicle_type: r.vehicleType, diesel: r.diesel, working_hours: r.hours }))));

/* ── Under the table: Loads breakup summary, then Site Working Progress ──────────────────────────────── */
const round2 = n => Math.round(n * 100) / 100;
const fmtMoney = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One line per breakup line of every entry in the report (in the report's order). */
function breakupLines(entries) {
  return (entries || []).flatMap(e => lp.withAmounts(e.load_points || []).map(p => ({
    date: fmtDateDMY(e.date), vehicle: e.vehicle_no || '', name: p.point_name, material: p.material, location: p.location, loads: p.loads, rate: p.rate, amount: p.amount,
  })));
}
const { siteKey, dayLinesFor } = require('./dayBreakup');
/** The loads breakup lines for a report: for a date and site that has a DAILY breakup, its lines (once); otherwise the entries' own older lines. Keeps the report's order. */
async function breakupLinesFor(entries) {
  const byDay = await dayLinesFor(entries), done = new Set(), out = [];
  for (const e of entries || []) {
    const key = `${e.date}|${siteKey(e.site)}`;
    if (byDay.has(key)) {
      if (done.has(key)) continue;
      done.add(key);
      lp.withAmounts(byDay.get(key).map(r => ({ point_name: r.point_name, material: r.material, location: r.location, loads: r.loads, rate: r.rate, position: r.position })))
        .forEach(p => out.push({ date: fmtDateDMY(e.date), vehicle: '', name: p.point_name, material: p.material, location: p.location, loads: p.loads, rate: p.rate, amount: p.amount }));
    } else {
      out.push(...breakupLines([e]));
    }
  }
  return out;
}
const breakupTotals = lines => ({ loads: lines.reduce((a, l) => a + l.loads, 0), amount: round2(lines.reduce((a, l) => a + l.amount, 0)) });

/** The site working progress images of the entries in the report. [] when there are none (or before the one-time database update). */
async function fetchProgress(entries) {
  const byId = new Map((entries || []).map((e, i) => [String(e.id), { e, i }]));
  const ids = [...byId.keys()];
  let rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const r = await supabase.from('progress_photos').select('*').in('entry_id', ids.slice(i, i + 100));
    if (r.error) { if (progressUtil.isMissingProgress(r.error)) return []; throw r.error; }
    rows = rows.concat(r.data || []);
  }
  return rows
    .filter(p => photos.isProgressPath(p.storage_path))
    .sort((a, b) => (byId.get(String(a.entry_id)).i - byId.get(String(b.entry_id)).i) || String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    .map(p => { const { e } = byId.get(String(p.entry_id)); return { key: p.storage_path, date: fmtDateDMY(e.date), site: e.site || '', vehicle: e.vehicle_no || '', caption: p.caption || '', by: p.uploaded_by_name || '' }; });
}

const PHOTO_KEYS = ['startPhoto', 'closePhoto', 'dieselPhoto'];
const countPhotos = rows => rows.reduce((n, r) => n + PHOTO_KEYS.filter(k => r[k]).length, 0);

/** "4 photos" or "4 photos (1 unavailable)" — counts what is really shown in the report. */
function photoSummary(rows, thumbs) {
  const attached = countPhotos(rows);
  const shown = rows.reduce((n, r) => n + PHOTO_KEYS.filter(k => r[k] && thumbs.has(r[k])).length, 0);
  const missing = attached - shown;
  return `${shown} photo${shown === 1 ? '' : 's'}${missing ? ` (${missing} unavailable)` : ''}`;
}

/* ── photos → small thumbnails ───────────────────────────────────────────────── */
async function makeThumb(sharp, photoPath) {
  const { data, error } = await supabase.storage.from(photos.BUCKET).download(photoPath);
  if (error || !data) throw error || new Error('photo not found');
  const input = Buffer.from(await data.arrayBuffer());
  const { data: buffer, info } = await sharp(input, { failOn: 'none' })
    .rotate()                                                   // honour the phone's rotation
    .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: THUMB_QUALITY })
    .toBuffer({ resolveWithObject: true });
  return { buffer, width: info.width, height: info.height };
}

/** Map of photo path → { buffer, width, height }. A photo that can't be read is simply left out. */
async function loadThumbnails(rows, extraPaths = []) {
  const wanted = [...new Set([...rows.flatMap(r => PHOTO_KEYS.map(k => r[k])), ...extraPaths].filter(Boolean))];
  const out = new Map();
  if (!wanted.length) return out;
  const sharp = lib('sharp');
  sharp.cache(false);          // keep memory low on a small server
  sharp.concurrency(2);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= wanted.length) return;
      try { out.set(wanted[i], await makeThumb(sharp, wanted[i])); }
      catch (err) { console.warn('report: photo skipped —', err.message); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, wanted.length) }, worker));
  return out;
}

/* ── CSV ─────────────────────────────────────────────────────────────────────── */
function csvEscape(val) {
  let s = (val === null || val === undefined) ? '' : String(val);
  // Text starting with = + - @ would be run as a formula by Excel / Sheets (CSV injection),
  // so it is prefixed with a quote and stays plain text. Real numbers are left alone.
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCsv(rows, extras = {}, sections = ALL_SECTIONS) {
  extras = gateExtras(extras, sections);
  const headers = ['Date', 'Site', 'Category', 'Vehicle No.', 'Start', 'Start Photo', 'Close', 'Close Photo', 'Working Hrs', 'Diesel (L)', 'Diesel Photo', 'Mileage', 'Loads', 'Operator', 'Remarks'];
  const lines = rows.map(r => [
    r.date, r.site, r.category, r.vehicle, r.start, r.hadStartPhoto ? 'Yes' : 'No', r.close, r.hadClosePhoto ? 'Yes' : 'No',
    r.hours, r.diesel, r.hadDieselPhoto ? 'Yes' : 'No', r.mileage, r.loads, r.operator, r.remarks,
  ]);
  // The same closing line the Excel and PDF reports have: the totals under Vehicle No., Diesel and Loads.
  const hrsTotal = hoursFromMinutes(rows.reduce((a, r) => a + (r.hoursMin || 0), 0));
  const total = rows.length ? [['', '', '', 'Total', '', '', '', '', rows.some(r => r.hoursMin !== null) ? hrsTotal : '', Number(rows.reduce((a, r) => a + r.diesel, 0).toFixed(2)), '', totalMileageText(rows), rows.reduce((a, r) => a + r.loads, 0), '', '']] : [];
  const more = [];
  const bl = extras.breakup || [];
  if (bl.length) {
    const t = breakupTotals(bl);
    more.push([], ['Loads breakup summary'], ['Sl No', 'Date', 'Name', 'Material', 'Location', 'Loads', 'Rate', 'Amount']);
    bl.forEach((l, i) => more.push([i + 1, l.date, l.name, l.material, l.location, l.loads, l.rate, l.amount]));
    more.push(['', '', '', '', 'Total', t.loads, '', t.amount]);
  }
  const pg = extras.progress || [];
  if (pg.length) {                                   // (a CSV cannot hold pictures — they are in the Excel and PDF reports)
    more.push([], ['Site working progress images (the pictures are in the Excel and PDF reports)'], ['Sl No', 'Date', 'Site', 'Vehicle No.', 'Caption', 'Added by']);
    pg.forEach((x, i) => more.push([i + 1, x.date, x.site, x.vehicle, x.caption, x.by]));
  }
  if (!sections.records && more.length && !more[0].length) more.shift();                       // no empty first line when the Records table is not in the file
  const csv = [...(sections.records ? [headers, ...lines, ...total] : []), ...more].map(l => l.map(csvEscape).join(',')).join('\n');
  return Buffer.from('\uFEFF' + csv, 'utf8');   // BOM so Excel reads accents/₹ correctly
}

/* ── Excel ───────────────────────────────────────────────────────────────────── */
const XL_COLS = [
  { key: 'n',          header: '#',            width: 5 },
  { key: 'date',       header: 'Date',         width: 12 },
  { key: 'site',       header: 'Site',         width: 20 },
  { key: 'category',   header: 'Category',     width: 10 },
  { key: 'vehicle',    header: 'Vehicle No.',  width: 17 },
  { key: 'start',      header: 'Start',        width: 12 },
  { key: 'startPhoto', header: 'Start Photo',  width: 23, photo: true },
  { key: 'close',      header: 'Close',        width: 12 },
  { key: 'closePhoto', header: 'Close Photo',  width: 23, photo: true },
  { key: 'hours',      header: 'Working Hrs',  width: 14 },
  { key: 'diesel',     header: 'Diesel (L)',   width: 11 },
  { key: 'dieselPhoto', header: 'Diesel Photo', width: 23, photo: true },
  { key: 'mileage',    header: 'Mileage',      width: 13 },
  { key: 'loads',      header: 'Loads',        width: 8 },
  { key: 'operator',   header: 'Operator',     width: 16 },
  { key: 'remarks',    header: 'Remarks',      width: 30 },
];
const HEADER_ROW = 5;
const IMG_BOX_W = 150, IMG_BOX_H = 112;      // pixels — how big a photo appears in its cell
const PHOTO_ROW_PT = (IMG_BOX_H + 14) * 0.75; // a row that holds a photo is a little taller than the photo
const EMU = 9525;                             // English Metric Units per pixel

// Excel does not resize a row by itself when its height is set, so estimate how many lines the wrapped columns need.
const WRAP_WIDTHS = { site: 20, remarks: 30 };
const wrappedLines = (text, widthChars) =>
  !text ? 1 : String(text).split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars * 1.08))), 0);

const argb = hex => ({ argb: 'FF' + hex });
const thin = { style: 'thin', color: argb(COLORS.line) };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

async function buildXlsx(rows, meta, thumbs, extras = {}, sections = ALL_SECTIONS) {
  extras = gateExtras(extras, sections);
  const ExcelJS = lib('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sri Charan Constructions';
  wb.created = new Date();

  const ws = wb.addWorksheet('Site Log', {
    views: [sections.records ? { state: 'frozen', ySplit: HEADER_ROW, showGridLines: false } : { showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = XL_COLS.map(c => ({ key: c.key, width: c.width }));
  const lastCol = XL_COLS.length;

  // Title block
  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: `SRI CHARAN CONSTRUCTIONS \u2014 ${reportTitle(sections)}` });
  ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: argb(COLORS.orange) };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `Generated ${nowStamp()} by ${meta.user}  \u00b7  ${contentsLine(rows, thumbs, extras, sections)}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = meta.filtersText ? `Filters: ${meta.filtersText}` : 'Filters: none (all records shown on screen)';
  ws.getCell(3, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  // several vehicles / sites ticked make a long line: let it wrap and give the row the height it needs, so nothing is cut off
  ws.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
  { const widthChars = Math.max(60, Math.round(XL_COLS.reduce((a, c) => a + (c.width || 10), 0) * 1.05)); ws.getRow(3).height = Math.max(15, 14 * Math.ceil(String(ws.getCell(3, 1).value || '').length / widthChars)); }

  const firstData = HEADER_ROW + 1;
  if (sections.records) {                                         // ── the Records table: header, rows and the closing Total line ──
  // Table header
  const head = ws.getRow(HEADER_ROW);
  XL_COLS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: argb('FFFFFF') };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) };
    cell.alignment = { vertical: 'middle', horizontal: c.photo ? 'center' : 'left', wrapText: true, indent: c.photo ? 0 : 1 };
    cell.border = BORDER;
  });
  head.height = 24;
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } };

  // Data rows
  rows.forEach((r, idx) => {
    const row = ws.getRow(firstData + idx);
    const hasPhoto = PHOTO_KEYS.some(k => r[k] && thumbs.has(r[k]));
    XL_COLS.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.photo) {
        const p = r[c.key];
        if (!p)                    cell.value = '—';
        else if (!thumbs.has(p))   cell.value = '(photo unavailable)';
      } else {
        cell.value = r[c.key];                                  // plain strings are never treated as formulas
      }
      cell.font = { name: 'Calibri', size: 10.5, color: argb(COLORS.ink), bold: c.key === 'vehicle' };
      cell.alignment = { vertical: 'middle', horizontal: c.photo ? 'center' : (c.key === 'diesel' || c.key === 'loads' || c.key === 'n') ? 'right' : 'left', wrapText: c.key === 'remarks' || c.key === 'site' || c.key === 'unload', indent: c.photo ? 0 : 1 };
      cell.border = BORDER;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) };
      if (c.photo && cell.value && cell.value !== '—') cell.font = { name: 'Calibri', size: 9, italic: true, color: argb('B4372A') };
      if (c.photo && cell.value === '—') cell.font = { name: 'Calibri', size: 10.5, color: argb('A8B1C0') };
    });
    row.getCell(XL_COLS.findIndex(c => c.key === 'diesel') + 1).numFmt = '0.00';
    const textLines = Math.max(...Object.entries(WRAP_WIDTHS).map(([k, w]) => wrappedLines(r[k], w)));
    row.height = Math.max(22, Math.min(150, textLines * 14 + 8), hasPhoto ? PHOTO_ROW_PT : 0);

    // Photos go inside their own cells. Anchoring to both corners (twoCell) means that when someone
    // filters the sheet and a row is hidden, its photo hides with it.
    const rowPx = row.height / 0.75;
    XL_COLS.forEach((c, i) => {
      if (!c.photo || !r[c.key] || !thumbs.has(r[c.key])) return;
      const t = thumbs.get(r[c.key]);
      const scale = Math.min(IMG_BOX_W / t.width, IMG_BOX_H / t.height, 1);
      const w = Math.max(1, Math.round(t.width * scale)), h = Math.max(1, Math.round(t.height * scale));
      const cellPx = c.width * 7 + 5;
      const offX = Math.max(0, (cellPx - w) / 2), offY = Math.max(0, (rowPx - h) / 2);
      const id = wb.addImage({ buffer: t.buffer, extension: 'jpeg' });
      ws.addImage(id, {
        tl: { nativeCol: i, nativeColOff: Math.round(offX * EMU), nativeRow: firstData + idx - 1, nativeRowOff: Math.round(offY * EMU) },
        br: { nativeCol: i, nativeColOff: Math.round((offX + w) * EMU), nativeRow: firstData + idx - 1, nativeRowOff: Math.round((offY + h) * EMU) },
        editAs: 'twoCell',
      });
    });
  });

  // Totals
  if (rows.length) {
    const lastData = firstData + rows.length - 1;
    const totalRow = ws.getRow(lastData + 1);
    const colLetter = key => ws.getColumn(XL_COLS.findIndex(c => c.key === key) + 1).letter;
    const dI = XL_COLS.findIndex(c => c.key === 'diesel') + 1, lI = XL_COLS.findIndex(c => c.key === 'loads') + 1;
    totalRow.getCell(XL_COLS.findIndex(c => c.key === 'vehicle') + 1).value = 'Total';
    totalRow.getCell(dI).value = { formula: `SUM(${colLetter('diesel')}${firstData}:${colLetter('diesel')}${lastData})`, result: rows.reduce((a, r) => a + r.diesel, 0) };
    totalRow.getCell(lI).value = { formula: `SUM(${colLetter('loads')}${firstData}:${colLetter('loads')}${lastData})`, result: rows.reduce((a, r) => a + r.loads, 0) };
    totalRow.getCell(dI).numFmt = '0.00';
    const mI = XL_COLS.findIndex(c => c.key === 'mileage') + 1;
    totalRow.getCell(mI).value = totalMileageText(rows) || null;          // e.g. "11.5 L/hr" — over the whole list, vehicles that were measured
    const hI = XL_COLS.findIndex(c => c.key === 'hours') + 1;
    if (rows.some(r => r.hoursMin !== null)) {              // the hours column holds text, so the total is worked out here (not a SUM formula)
      totalRow.getCell(hI).value = hoursFromMinutes(rows.reduce((a, r) => a + (r.hoursMin || 0), 0));
      totalRow.getCell(hI).numFmt = '0.0#';
    }
    for (let i = 1; i <= lastCol; i++) {
      const cell = totalRow.getCell(i);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: argb(COLORS.ink) };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FFF3E6') };
      cell.border = { top: { style: 'medium', color: argb(COLORS.orange) }, bottom: thin };
      if (i === dI || i === lI || i === hI || i === mI) cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      else cell.alignment = { vertical: 'middle', indent: 1 };
    }
    const mtx = totalMileageText(rows) || '';
    if (mtx.includes(' \u00b7 ')) {                                       // both L/hr and km/L: one under the other, so neither is cut off
      totalRow.getCell(mI).value = mtx.replace(' \u00b7 ', '\n');
      totalRow.getCell(mI).alignment = { horizontal: 'right', vertical: 'middle', indent: 1, wrapText: true };
      totalRow.height = 34;
    } else totalRow.height = 24;
  }

  // ── Under the table: Loads breakup summary, then Site Working Progress ──
  }                                                               // (end of the Records table)
  let r0 = sections.records ? firstData + rows.length + 2 : HEADER_ROW;
  const merged = (row, c1, c2, value, o = {}) => {
    if (c2 > c1) ws.mergeCells(row, c1, row, c2);
    for (let c = c1; c <= c2; c++) { const cell = ws.getCell(row, c); cell.border = BORDER; if (o.fill) cell.fill = o.fill; }
    const cell = ws.getCell(row, c1);
    cell.value = value;
    cell.font = { name: 'Calibri', size: o.size || 10.5, bold: !!o.bold, color: argb(o.color || COLORS.ink) };
    cell.alignment = { vertical: o.top ? 'top' : 'middle', horizontal: o.right ? 'right' : 'left', wrapText: !!o.wrap, indent: o.right ? 1 : 1 };
    if (o.numFmt) cell.numFmt = o.numFmt;
  };
  const title = (row, text) => {
    ws.mergeCells(row, 1, row, lastCol);
    const c = ws.getCell(row, 1);
    c.value = text; c.font = { name: 'Calibri', size: 12, bold: true, color: argb(COLORS.orange) };
    c.border = { bottom: { style: 'medium', color: argb(COLORS.orange) } };
    ws.getRow(row).height = 22;
  };
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) };
  const bl = extras.breakup || [];
  if (bl.length) {
    title(r0, 'LOADS BREAKUP SUMMARY'); r0 += 1;
    const spans = [[1, 1, 'Sl No'], [2, 2, 'Date'], [3, 5, 'Name'], [6, 7, 'Material'], [8, 9, 'Location'], [10, 10, 'Loads'], [11, 11, 'Rate (₹)'], [12, 12, 'Amount (₹)']];
    spans.forEach(([a, b, t]) => merged(r0, a, b, t, { bold: true, color: 'FFFFFF', fill: headFill, right: ['Loads', 'Rate (₹)', 'Amount (₹)', 'Sl No'].includes(t) }));
    ws.getRow(r0).height = 22; r0 += 1;
    bl.forEach((l, i) => {
      const f = i % 2 === 1 ? { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) } : undefined;
      merged(r0, 1, 1, i + 1, { right: true, fill: f }); merged(r0, 2, 2, l.date, { fill: f });
      merged(r0, 3, 5, l.name, { fill: f, wrap: true, bold: true }); merged(r0, 6, 7, l.material, { fill: f, wrap: true }); merged(r0, 8, 9, l.location, { fill: f, wrap: true });
      merged(r0, 10, 10, l.loads, { right: true, fill: f }); merged(r0, 11, 11, l.rate, { right: true, fill: f, numFmt: '#,##0.00' }); merged(r0, 12, 12, l.amount, { right: true, fill: f, numFmt: '#,##0.00' });
      ws.getRow(r0).height = Math.max(20, wrappedLines(l.name, 45) * 14 + 6, wrappedLines(l.material, 35) * 14 + 6, wrappedLines(l.location, 35) * 14 + 6);
      r0 += 1;
    });
    const t = breakupTotals(bl), tf = { type: 'pattern', pattern: 'solid', fgColor: argb('FFF3E6') };
    [[1, 9, 'Total'], [10, 10, t.loads], [11, 11, ''], [12, 12, t.amount]].forEach(([a, b, v]) => merged(r0, a, b, v, { bold: true, fill: tf, right: a >= 10, numFmt: a === 12 ? '#,##0.00' : undefined }));
    ws.getRow(r0).height = 24; r0 += 2;
  }
  const pgList = extras.progress || [];
  if (pgList.length) {
    title(r0, `SITE WORKING PROGRESS (${pgList.length} image${pgList.length === 1 ? '' : 's'})`); r0 += 1;
    [[1, 1, 'Sl No'], [2, 2, 'Date'], [3, 3, 'Site'], [4, 6, 'Vehicle / added by'], [7, 7, 'Picture'], [8, lastCol, 'Caption']].forEach(([a, b, t]) => merged(r0, a, b, t, { bold: true, color: 'FFFFFF', fill: headFill, right: t === 'Sl No' }));
    ws.getRow(r0).height = 22; r0 += 1;
    pgList.forEach((x, i) => {
      const f = i % 2 === 1 ? { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) } : undefined;
      merged(r0, 1, 1, i + 1, { right: true, fill: f, top: true }); merged(r0, 2, 2, x.date, { fill: f, top: true }); merged(r0, 3, 3, x.site || '(no site)', { fill: f, wrap: true, top: true });
      merged(r0, 4, 6, `${x.vehicle}${x.by ? `\nAdded by ${x.by}` : ''}`, { fill: f, wrap: true, top: true }); merged(r0, 8, lastCol, x.caption, { fill: f, wrap: true, top: true });
      const cell7 = ws.getCell(r0, 7); cell7.border = BORDER; if (f) cell7.fill = f;
      ws.getRow(r0).height = PHOTO_ROW_PT;
      const t = thumbs.get(x.key);
      if (t) {
        const scale = Math.min(IMG_BOX_W / t.width, IMG_BOX_H / t.height, 1);
        const w = Math.max(1, Math.round(t.width * scale)), h = Math.max(1, Math.round(t.height * scale));
        const cellPx = XL_COLS[6].width * 7 + 5, rowPx = PHOTO_ROW_PT / 0.75;
        const offX = Math.max(0, (cellPx - w) / 2), offY = Math.max(0, (rowPx - h) / 2);
        const id = wb.addImage({ buffer: t.buffer, extension: 'jpeg' });
        ws.addImage(id, {
          tl: { nativeCol: 6, nativeColOff: Math.round(offX * EMU), nativeRow: r0 - 1, nativeRowOff: Math.round(offY * EMU) },
          br: { nativeCol: 6, nativeColOff: Math.round((offX + w) * EMU), nativeRow: r0 - 1, nativeRowOff: Math.round((offY + h) * EMU) },
          editAs: 'twoCell',
        });
      } else {
        cell7.value = '(photo unavailable)'; cell7.font = { name: 'Calibri', size: 9, italic: true, color: argb('B4372A') }; cell7.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }
      r0 += 1;
    });
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ── PDF ─────────────────────────────────────────────────────────────────────── */
// The built-in PDF fonts only cover Western (Latin) characters, so anything else is shown as "?".
// (Excel and CSV keep every language.)
const pdfText = s => String(s == null ? '' : s)
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2192/g, '->')
  .replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2022\u2026\u20ac]/g, '?');

const PDF_COLS = [
  { key: 'n',          header: '#',           w: 18 },
  { key: 'date',       header: 'Date',        w: 46 },
  { key: 'site',       header: 'Site',        w: 56 },
  { key: 'category',   header: 'Cat.',        w: 34 },
  { key: 'vehicle',    header: 'Vehicle No.', w: 62, bold: true },
  { key: 'start',      header: 'Start',       w: 40 },
  { key: 'startPhoto', header: 'Start photo', w: 70, photo: true },
  { key: 'close',      header: 'Close',       w: 40 },
  { key: 'closePhoto', header: 'Close photo', w: 70, photo: true },
  { key: 'hours',      header: 'Working hrs', w: 40 },
  { key: 'diesel',     header: 'Diesel (L)',  w: 40, right: true },
  { key: 'dieselPhoto', header: 'Diesel photo', w: 70, photo: true },
  { key: 'mileage',    header: 'Mileage',     w: 42 },
  { key: 'loads',      header: 'Loads',       w: 28, right: true },
  { key: 'operator',   header: 'Operator',    w: 52 },
  { key: 'remarks',    header: 'Remarks',     w: 77 },
];

async function buildPdf(rows, meta, thumbs, extras = {}, sections = ALL_SECTIONS) {
  extras = gateExtras(extras, sections);
  const PDFDocument = lib('pdfkit');
  const M = 28;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true, info: { Title: 'Site Activity Log — Sri Charan Constructions', Author: 'Sri Charan Constructions' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const PW = doc.page.width, PH = doc.page.height;
  const usableW = PW - M * 2;
  const bottom = PH - M - 14;            // keep room for the footer
  const PAD = 3, BOX_W = 64, BOX_H = 48, MAX_TEXT_H = 54, FONT = 7.4;
  const hex = h => '#' + h;

  const x0 = PDF_COLS.reduce((acc, c, i) => { acc.push(i ? acc[i - 1] + PDF_COLS[i - 1].w : M); return acc; }, []);

  // ── page 1 title block ──
  let y = M;
  try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), M, y - 2, { width: 34 }); } catch { /* logo is optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(hex(COLORS.orange)).text('SRI CHARAN CONSTRUCTIONS', M + 42, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text(`${reportTitle(sections)} report`, M + 42, y + 19, { lineBreak: false });
  doc.fontSize(8).text(pdfText(`Generated ${nowStamp()} by ${meta.user}`), M, y, { width: usableW, align: 'right', lineBreak: false });
  doc.text(pdfText(contentsLine(rows, thumbs, extras, sections)), M, y + 12, { width: usableW, align: 'right', lineBreak: false });
  const filterLine = pdfText(meta.filtersText ? `Filters: ${meta.filtersText}` : 'Filters: none (all records shown on screen)');
  const longFilters = doc.widthOfString(filterLine) > usableW - 240;            // a short line stays in the corner; a long one (several choices) gets its own wrapped lines
  if (!longFilters) doc.text(filterLine, M, y + 24, { width: usableW, align: 'right', lineBreak: false, ellipsis: true, height: 10 });
  y += 46;
  doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.5).strokeColor(hex(COLORS.orange)).stroke();
  y += 8;
  if (longFilters) {
    doc.font('Helvetica').fontSize(8).fillColor(hex(COLORS.steel));
    const fh = doc.heightOfString(filterLine, { width: usableW });
    doc.text(filterLine, M, y, { width: usableW });
    y += fh + 6;
  }

  const drawHeader = () => {
    doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink));
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF');
    PDF_COLS.forEach((c, i) => doc.text(c.header, x0[i] + PAD, y + 6, { width: c.w - PAD * 2, align: c.photo ? 'center' : c.right ? 'right' : 'left', lineBreak: false }));
    y += 18;
  };
  if (sections.records) drawHeader();

  const drawRow = (r, idx) => {
    doc.font('Helvetica').fontSize(FONT);
    const cellText = {};
    let textH = 12;
    PDF_COLS.forEach(c => {
      if (c.photo) return;
      const t = pdfText(c.key === 'n' ? r.n : c.key === 'diesel' ? r.diesel.toFixed(2) : r[c.key]);
      cellText[c.key] = t;
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT);
      textH = Math.max(textH, Math.min(MAX_TEXT_H, doc.heightOfString(t || ' ', { width: c.w - PAD * 2 })));
    });
    const hasPhoto = PHOTO_KEYS.some(k => r[k] && thumbs.has(r[k]));
    const rowH = Math.max(textH, hasPhoto ? BOX_H : 0) + PAD * 2 + 2;

    if (y + rowH > bottom) { doc.addPage(); y = M; drawHeader(); }

    if (idx % 2 === 1) doc.rect(M, y, usableW, rowH).fill(hex(COLORS.paper));
    PDF_COLS.forEach((c, i) => {
      const cx = x0[i];
      if (c.photo) {
        const p = r[c.key];
        if (p && thumbs.has(p)) {
          const t = thumbs.get(p);
          const s = Math.min(BOX_W / t.width, BOX_H / t.height, 1);
          const w = t.width * s, h = t.height * s;
          doc.image(t.buffer, cx + (c.w - w) / 2, y + (rowH - h) / 2, { width: w, height: h });
        } else {
          doc.font('Helvetica').fontSize(FONT).fillColor(p ? '#B4372A' : '#A8B1C0')
            .text(p ? '(unavailable)' : '—', cx + PAD, y + (rowH - FONT) / 2, { width: c.w - PAD * 2, align: 'center', lineBreak: false });
        }
      } else {
        doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT).fillColor(hex(COLORS.ink))
          .text(cellText[c.key], cx + PAD, y + PAD + 1, { width: c.w - PAD * 2, height: MAX_TEXT_H, ellipsis: true, align: c.right ? 'right' : 'left' });
      }
    });
    doc.moveTo(M, y + rowH).lineTo(M + usableW, y + rowH).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke();
    y += rowH;
  };
  if (sections.records) rows.forEach(drawRow);

  // Totals
  if (sections.records && rows.length) {
    const mtp = totalMileageText(rows), th = mtp && mtp.includes('\u00b7') ? 27 : 18, ty = th > 18 ? 9.5 : 5.5;      // two mileage figures (L/hr and km/L) get a taller row
    if (y + th + 2 > bottom) { doc.addPage(); y = M; drawHeader(); }
    doc.rect(M, y, usableW, th).fill('#FFF3E6');
    doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.2).strokeColor(hex(COLORS.orange)).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(hex(COLORS.ink));
    const ci = k => PDF_COLS.findIndex(c => c.key === k);
    doc.text('Total', x0[ci('vehicle')] + PAD, y + ty, { width: PDF_COLS[ci('vehicle')].w, lineBreak: false });
    if (mtp) mtp.split(' \u00b7 ').forEach((part, k) => doc.text(part, x0[ci('mileage')] + PAD, y + (th > 18 ? 4 : ty) + k * 10, { width: PDF_COLS[ci('mileage')].w - PAD * 2, align: 'left', lineBreak: false }));
    if (rows.some(r => r.hoursMin !== null)) doc.text(String(hoursFromMinutes(rows.reduce((a, r) => a + (r.hoursMin || 0), 0))), x0[ci('hours')] + PAD, y + ty, { width: PDF_COLS[ci('hours')].w - PAD * 2, align: 'left', lineBreak: false });
    doc.text(rows.reduce((a, r) => a + r.diesel, 0).toFixed(2), x0[ci('diesel')] + PAD, y + ty, { width: PDF_COLS[ci('diesel')].w - PAD * 2, align: 'right', lineBreak: false });
    doc.text(String(rows.reduce((a, r) => a + r.loads, 0)), x0[ci('loads')] + PAD, y + ty, { width: PDF_COLS[ci('loads')].w - PAD * 2, align: 'right', lineBreak: false });
    y += th;
  }

  // ── Under the table: Loads breakup summary, then Site Working Progress ──
  const sectionTitle = text => {
    if (y + 46 > bottom) { doc.addPage(); y = M; }
    y += 16;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(hex(COLORS.orange)).text(pdfText(text), M, y, { lineBreak: false });
    y += 14;
    doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1).strokeColor(hex(COLORS.orange)).stroke();
    y += 6;
  };
  const bl = extras.breakup || [];
  if (bl.length) {
    const fixed = [['Sl No', 28, 'left'], ['Date', 56, 'left'], ['Name', 190, 'left'], ['Material', 140, 'left'], ['Location', 0, 'left'], ['Loads', 46, 'right'], ['Rate (Rs)', 62, 'right'], ['Amount (Rs)', 78, 'right']];
    fixed[4][1] = usableW - fixed.reduce((a, c) => a + c[1], 0);
    const bx = fixed.reduce((acc, c, i) => { acc.push(i ? acc[i - 1] + fixed[i - 1][1] : M); return acc; }, []);
    const bHead = () => {
      doc.rect(M, y, usableW, 16).fill(hex(COLORS.ink));
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF');
      fixed.forEach((c, i) => doc.text(c[0], bx[i] + PAD, y + 5.5, { width: c[1] - PAD * 2, align: c[2], lineBreak: false }));
      y += 16;
    };
    sectionTitle(`LOADS BREAKUP SUMMARY (${bl.length} line${bl.length === 1 ? '' : 's'})`); bHead();
    bl.forEach((l, i) => {
      if (y + 15 > bottom) { doc.addPage(); y = M; sectionTitle('LOADS BREAKUP SUMMARY (continued)'); bHead(); }
      if (i % 2 === 1) doc.rect(M, y, usableW, 15).fill(hex(COLORS.paper));
      const vals = [String(i + 1), l.date, l.name, l.material, l.location, String(l.loads), fmtMoney(l.rate), fmtMoney(l.amount)];
      doc.font('Helvetica').fontSize(FONT).fillColor(hex(COLORS.ink));
      vals.forEach((v, k) => doc.font(k === 2 ? 'Helvetica-Bold' : 'Helvetica').text(pdfText(v), bx[k] + PAD, y + 4, { width: fixed[k][1] - PAD * 2, align: fixed[k][2], lineBreak: false, ellipsis: true }));
      doc.moveTo(M, y + 15).lineTo(M + usableW, y + 15).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke();
      y += 15;
    });
    if (y + 18 > bottom) { doc.addPage(); y = M; sectionTitle('LOADS BREAKUP SUMMARY (continued)'); bHead(); }
    const bt = breakupTotals(bl);
    doc.rect(M, y, usableW, 18).fill('#FFF3E6');
    doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.2).strokeColor(hex(COLORS.orange)).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(hex(COLORS.ink));
    doc.text('Total', bx[4] + PAD, y + 5.5, { width: fixed[4][1] - PAD * 2, align: 'right', lineBreak: false });
    doc.text(String(bt.loads), bx[5] + PAD, y + 5.5, { width: fixed[5][1] - PAD * 2, align: 'right', lineBreak: false });
    doc.text(fmtMoney(bt.amount), bx[7] + PAD, y + 5.5, { width: fixed[7][1] - PAD * 2, align: 'right', lineBreak: false });
    y += 18;
  }
  const pgList = extras.progress || [];
  if (pgList.length) {
    sectionTitle(`SITE WORKING PROGRESS (${pgList.length} image${pgList.length === 1 ? '' : 's'})`);
    const cols = 4, gap = 10, cellW = (usableW - gap * (cols - 1)) / cols, imgH = 118, capH = 36, cellH = imgH + capH + 8;
    let c = 0;
    pgList.forEach(x => {
      if (c === 0 && y + cellH > bottom) { doc.addPage(); y = M; sectionTitle('SITE WORKING PROGRESS (continued)'); }
      const cx = M + c * (cellW + gap);
      doc.rect(cx, y, cellW, imgH).lineWidth(0.5).strokeColor(hex(COLORS.line)).stroke();
      const t = thumbs.get(x.key);
      if (t) {
        const sc = Math.min((cellW - 2) / t.width, (imgH - 2) / t.height, 1), w = t.width * sc, h = t.height * sc;
        doc.image(t.buffer, cx + (cellW - w) / 2, y + (imgH - h) / 2, { width: w, height: h });
      } else {
        doc.font('Helvetica').fontSize(FONT).fillColor('#B4372A').text('(photo unavailable)', cx, y + imgH / 2 - 4, { width: cellW, align: 'center', lineBreak: false });
      }
      doc.font('Helvetica-Bold').fontSize(7).fillColor(hex(COLORS.ink)).text(pdfText(`${x.date}  ·  ${x.site || '(no site)'}`), cx, y + imgH + 3, { width: cellW, height: 9, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').fontSize(6.8).fillColor(hex(COLORS.steel)).text(pdfText(`${x.vehicle}${x.by ? `  ·  ${x.by}` : ''}`), cx, y + imgH + 12, { width: cellW, height: 9, lineBreak: false, ellipsis: true });
      if (x.caption) doc.font('Helvetica').fontSize(6.8).fillColor(hex(COLORS.ink)).text(pdfText(x.caption), cx, y + imgH + 21, { width: cellW, height: 16, ellipsis: true });
      c += 1; if (c === cols) { c = 0; y += cellH; }
    });
    if (c !== 0) y += cellH;
  }

  // Footer with page numbers (written last, when the page count is known)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;           // otherwise writing in the margin would start a new page
    doc.font('Helvetica').fontSize(7).fillColor(hex(COLORS.steel))
      .text(`Sri Charan Constructions \u00b7 ${reportTitle(sections)}`, M, PH - M - 4, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, M, PH - M - 4, { width: usableW, align: 'right', lineBreak: false });
  }

  doc.end();
  return finished;
}

module.exports = {
  lib, COLORS, REPORT_TZ, nowStamp, zoneName,
  MAX_ROWS, MAX_PHOTOS, todayStamp, cleanText, userError,
  fetchEntriesByIds, toRow, countPhotos, loadThumbnails, breakupLines, breakupLinesFor, breakupTotals, fetchProgress,
  buildCsv, buildXlsx, buildPdf, csvEscape, photoSummary,
  normalizeSections, reportTitle, SECTION_KEYS,
};
