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
const photos = require('./photos');
const { fmtDateDMY } = require('./activity');

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

/** Fetches the entries (with breakup rows) for the given ids, keeping the caller's order. */
async function fetchEntriesByIds(ids) {
  const byId = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await supabase.from('entries').select('*, breakup_rows(*)').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    (data || []).forEach(r => byId.set(String(r.id), r));
  }
  return ids.map(id => byId.get(String(id))).filter(Boolean);
}

/** One flat, display-ready row per entry. */
function toRow(e, i) {
  const breakup = (e.breakup_rows || [])
    .filter(b => b && (b.description || b.quantity))
    .map(b => `${b.description || ''}: ${b.quantity || ''}`).join(' | ');
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
    diesel: Number(e.diesel) || 0,
    loads: parseInt(e.loads, 10) || 0,
    operator: e.operator || '',
    remarks: e.remarks || '',
    breakup,
    hadStartPhoto: !!e.start_photo,
    hadClosePhoto: !!e.close_photo,
  };
}

const countPhotos = rows => rows.reduce((n, r) => n + (r.startPhoto ? 1 : 0) + (r.closePhoto ? 1 : 0), 0);

/** "4 photos" or "4 photos (1 unavailable)" — counts what is really shown in the report. */
function photoSummary(rows, thumbs) {
  const attached = countPhotos(rows);
  const shown = rows.reduce((n, r) => n + (r.startPhoto && thumbs.has(r.startPhoto) ? 1 : 0) + (r.closePhoto && thumbs.has(r.closePhoto) ? 1 : 0), 0);
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
async function loadThumbnails(rows) {
  const wanted = [...new Set(rows.flatMap(r => [r.startPhoto, r.closePhoto]).filter(Boolean))];
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

function buildCsv(rows) {
  const headers = ['Date', 'Site', 'Category', 'Vehicle No.', 'Start', 'Start Photo', 'Close', 'Close Photo', 'Working Hrs', 'Diesel (L)', 'Loads', 'Operator', 'Remarks', 'Breakup'];
  const lines = rows.map(r => [
    r.date, r.site, r.category, r.vehicle, r.start, r.hadStartPhoto ? 'Yes' : 'No', r.close, r.hadClosePhoto ? 'Yes' : 'No',
    r.hours, r.diesel, r.loads, r.operator, r.remarks, r.breakup,
  ]);
  const csv = [headers, ...lines].map(l => l.map(csvEscape).join(',')).join('\n');
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
  { key: 'loads',      header: 'Loads',        width: 8 },
  { key: 'operator',   header: 'Operator',     width: 16 },
  { key: 'remarks',    header: 'Remarks',      width: 28 },
  { key: 'breakup',    header: 'Breakup',      width: 30 },
];
const HEADER_ROW = 5;
const IMG_BOX_W = 150, IMG_BOX_H = 112;      // pixels — how big a photo appears in its cell
const PHOTO_ROW_PT = (IMG_BOX_H + 14) * 0.75; // a row that holds a photo is a little taller than the photo
const EMU = 9525;                             // English Metric Units per pixel

// Excel does not resize a row by itself when its height is set, so estimate how many lines the wrapped columns need.
const WRAP_WIDTHS = { site: 20, remarks: 28, breakup: 30 };
const wrappedLines = (text, widthChars) =>
  !text ? 1 : String(text).split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars * 1.08))), 0);

const argb = hex => ({ argb: 'FF' + hex });
const thin = { style: 'thin', color: argb(COLORS.line) };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

async function buildXlsx(rows, meta, thumbs) {
  const ExcelJS = lib('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sri Charan Constructions';
  wb.created = new Date();

  const ws = wb.addWorksheet('Site Log', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = XL_COLS.map(c => ({ key: c.key, width: c.width }));
  const lastCol = XL_COLS.length;

  // Title block
  ws.mergeCells(1, 1, 1, lastCol);
  Object.assign(ws.getCell(1, 1), { value: 'SRI CHARAN CONSTRUCTIONS — Site Activity Log' });
  ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: argb(COLORS.orange) };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `Generated ${nowStamp()} by ${meta.user}  ·  ${rows.length} record${rows.length === 1 ? '' : 's'}  ·  ${photoSummary(rows, thumbs)}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = meta.filtersText ? `Filters: ${meta.filtersText}` : 'Filters: none (all records shown on screen)';
  ws.getCell(3, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };

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
  const firstData = HEADER_ROW + 1;
  rows.forEach((r, idx) => {
    const row = ws.getRow(firstData + idx);
    const hasPhoto = (r.startPhoto && thumbs.has(r.startPhoto)) || (r.closePhoto && thumbs.has(r.closePhoto));
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
      cell.alignment = { vertical: 'middle', horizontal: c.photo ? 'center' : (c.key === 'diesel' || c.key === 'loads' || c.key === 'n') ? 'right' : 'left', wrapText: c.key === 'remarks' || c.key === 'breakup' || c.key === 'site', indent: c.photo ? 0 : 1 };
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
    for (let i = 1; i <= lastCol; i++) {
      const cell = totalRow.getCell(i);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: argb(COLORS.ink) };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb('FFF3E6') };
      cell.border = { top: { style: 'medium', color: argb(COLORS.orange) }, bottom: thin };
      if (i === dI || i === lI) cell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      else cell.alignment = { vertical: 'middle', indent: 1 };
    }
    totalRow.height = 24;
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
  { key: 'n',          header: '#',           w: 20 },
  { key: 'date',       header: 'Date',        w: 50 },
  { key: 'site',       header: 'Site',        w: 58 },
  { key: 'category',   header: 'Cat.',        w: 36 },
  { key: 'vehicle',    header: 'Vehicle No.', w: 76, bold: true },
  { key: 'start',      header: 'Start',       w: 44 },
  { key: 'startPhoto', header: 'Start photo', w: 76, photo: true },
  { key: 'close',      header: 'Close',       w: 44 },
  { key: 'closePhoto', header: 'Close photo', w: 76, photo: true },
  { key: 'hours',      header: 'Working hrs', w: 48 },
  { key: 'diesel',     header: 'Diesel (L)',  w: 42, right: true },
  { key: 'loads',      header: 'Loads',       w: 28, right: true },
  { key: 'operator',   header: 'Operator',    w: 56 },
  { key: 'remarks',    header: 'Remarks',     w: 63 },
  { key: 'breakup',    header: 'Breakup',     w: 68 },
];

async function buildPdf(rows, meta, thumbs) {
  const PDFDocument = lib('pdfkit');
  const M = 28;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true, info: { Title: 'Site Activity Log — Sri Charan Constructions', Author: 'Sri Charan Constructions' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const PW = doc.page.width, PH = doc.page.height;
  const usableW = PW - M * 2;
  const bottom = PH - M - 14;            // keep room for the footer
  const PAD = 3, BOX_W = 68, BOX_H = 51, MAX_TEXT_H = 54, FONT = 7.4;
  const hex = h => '#' + h;

  const x0 = PDF_COLS.reduce((acc, c, i) => { acc.push(i ? acc[i - 1] + PDF_COLS[i - 1].w : M); return acc; }, []);

  // ── page 1 title block ──
  let y = M;
  try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), M, y - 2, { width: 34 }); } catch { /* logo is optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(hex(COLORS.orange)).text('SRI CHARAN CONSTRUCTIONS', M + 42, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text('Site Activity Log report', M + 42, y + 19, { lineBreak: false });
  doc.fontSize(8).text(pdfText(`Generated ${nowStamp()} by ${meta.user}`), M, y, { width: usableW, align: 'right', lineBreak: false });
  doc.text(`${rows.length} record${rows.length === 1 ? '' : 's'}  ·  ${photoSummary(rows, thumbs)}`, M, y + 12, { width: usableW, align: 'right', lineBreak: false });
  doc.text(pdfText(meta.filtersText ? `Filters: ${meta.filtersText}` : 'Filters: none (all records shown on screen)'), M, y + 24, { width: usableW, align: 'right', lineBreak: false, ellipsis: true, height: 10 });
  y += 46;
  doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.5).strokeColor(hex(COLORS.orange)).stroke();
  y += 8;

  const drawHeader = () => {
    doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink));
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF');
    PDF_COLS.forEach((c, i) => doc.text(c.header, x0[i] + PAD, y + 6, { width: c.w - PAD * 2, align: c.photo ? 'center' : c.right ? 'right' : 'left', lineBreak: false }));
    y += 18;
  };
  drawHeader();

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
    const hasPhoto = (r.startPhoto && thumbs.has(r.startPhoto)) || (r.closePhoto && thumbs.has(r.closePhoto));
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
  rows.forEach(drawRow);

  // Totals
  if (rows.length) {
    if (y + 20 > bottom) { doc.addPage(); y = M; drawHeader(); }
    doc.rect(M, y, usableW, 18).fill('#FFF3E6');
    doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.2).strokeColor(hex(COLORS.orange)).stroke();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(hex(COLORS.ink));
    const ci = k => PDF_COLS.findIndex(c => c.key === k);
    doc.text('Total', x0[ci('vehicle')] + PAD, y + 5.5, { width: PDF_COLS[ci('vehicle')].w, lineBreak: false });
    doc.text(rows.reduce((a, r) => a + r.diesel, 0).toFixed(2), x0[ci('diesel')] + PAD, y + 5.5, { width: PDF_COLS[ci('diesel')].w - PAD * 2, align: 'right', lineBreak: false });
    doc.text(String(rows.reduce((a, r) => a + r.loads, 0)), x0[ci('loads')] + PAD, y + 5.5, { width: PDF_COLS[ci('loads')].w - PAD * 2, align: 'right', lineBreak: false });
  }

  // Footer with page numbers (written last, when the page count is known)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;           // otherwise writing in the margin would start a new page
    doc.font('Helvetica').fontSize(7).fillColor(hex(COLORS.steel))
      .text('Sri Charan Constructions · Site Activity Log', M, PH - M - 4, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, M, PH - M - 4, { width: usableW, align: 'right', lineBreak: false });
  }

  doc.end();
  return finished;
}

module.exports = {
  MAX_ROWS, MAX_PHOTOS, todayStamp, cleanText, userError,
  fetchEntriesByIds, toRow, countPhotos, loadThumbnails,
  buildCsv, buildXlsx, buildPdf, csvEscape, photoSummary,
};
