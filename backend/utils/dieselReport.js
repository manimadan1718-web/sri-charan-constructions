/**
 * The Diesel Expenses report (Excel and PDF): every fill with its proof photo, a bold TOTAL line, and a site-wise summary
 * with its own bold TOTAL. Data comes from dieselRegister.js; photos are the thumbnails loaded by reports.loadThumbnails.
 */
const path = require('path');
const reports = require('./reports');
const { COLORS } = reports;
const { dmy } = require('./dieselRegister');

const argb = hex => ({ argb: 'FF' + hex });
const thin = { style: 'thin', color: argb(COLORS.line) };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const TOTAL_FILL = 'FFE2C2', SUBHEAD_FILL = 'E9EDF3';
const pdfText = s => String(s == null ? '' : s)
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2192/g, '->')
  .replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2022\u2026\u20ac]/g, '?');
const catLabel = c => (c === 'rental' ? 'Rental' : 'Own');
const money2 = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shownPhotos = (rows, thumbs) => rows.filter(r => r.photo && thumbs.has(r.photo)).length;
const photoNote = (rows, thumbs) => { const att = rows.filter(r => r.photo).length, shown = shownPhotos(rows, thumbs); return `${shown} proof photo${shown === 1 ? '' : 's'}${att - shown ? ` (${att - shown} unavailable)` : ''}`; };
const wrappedLines = (text, widthChars) => (!text ? 1 : String(text).split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars * 1.08))), 0));

/* ── Excel ─────────────────────────────────────────────────────────────────────────────────────────────────── */
const XL = [
  { key: 'n', header: '#', width: 5 }, { key: 'date', header: 'Date', width: 12 }, { key: 'site', header: 'Site', width: 26 },
  { key: 'category', header: 'Category', width: 10 }, { key: 'vehicle_no', header: 'Vehicle No.', width: 18 }, { key: 'operator', header: 'Operator', width: 16 },
  { key: 'litres', header: 'Diesel (L)', width: 12 }, { key: 'proof', header: 'Proof photo', width: 23, photo: true }, { key: 'remarks', header: 'Remarks', width: 30 },
];
const HEADER_ROW = 5, IMG_W = 150, IMG_H = 112, PHOTO_ROW_PT = (IMG_H + 14) * 0.75, EMU = 9525;

async function buildDieselXlsx(d, meta, thumbs) {
  const ExcelJS = reports.lib('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Sri Charan Constructions'; wb.created = new Date();
  const ws = wb.addWorksheet('Diesel Expenses', { views: [{ state: 'frozen', ySplit: HEADER_ROW }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  XL.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
  const last = XL.length;
  ws.mergeCells(1, 1, 1, last); ws.getCell(1, 1).value = 'SRI CHARAN CONSTRUCTIONS \u2014 Diesel Expenses';
  ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: argb(COLORS.orange) }; ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, last); ws.getCell(2, 1).value = `Generated ${reports.nowStamp()} by ${meta.user}  \u00b7  ${d.fills} fill${d.fills === 1 ? '' : 's'}  \u00b7  ${money2(d.total_litres)} L  \u00b7  ${photoNote(d.rows, thumbs)}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  ws.mergeCells(3, 1, 3, last); ws.getCell(3, 1).value = `Filters: ${meta.filtersText}`;
  ws.getCell(3, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) }; ws.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(3).height = Math.max(15, 14 * Math.ceil(String(ws.getCell(3, 1).value).length / 150));

  const head = ws.getRow(HEADER_ROW);
  XL.forEach((c, i) => {
    const cell = head.getCell(i + 1); cell.value = c.header;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: argb('FFFFFF') }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) };
    cell.alignment = { vertical: 'middle', horizontal: c.photo ? 'center' : c.key === 'litres' ? 'right' : 'left', indent: c.photo ? 0 : 1, wrapText: true }; cell.border = BORDER;
  });
  head.height = 24;
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: last } };

  const first = HEADER_ROW + 1;
  d.rows.forEach((r, idx) => {
    const row = ws.getRow(first + idx), hasThumb = !!(r.photo && thumbs.has(r.photo));
    const vals = { n: r.n, date: dmy(r.date), site: r.site || '\u2014', category: catLabel(r.category), vehicle_no: r.vehicle_no, operator: r.operator, litres: r.litres, remarks: r.remarks };
    XL.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.photo) cell.value = !r.photo ? 'No proof' : hasThumb ? null : '(photo unavailable)'; else cell.value = vals[c.key];
      cell.font = { name: 'Calibri', size: 10.5, color: argb(COLORS.ink), bold: c.key === 'vehicle_no' };
      cell.alignment = { vertical: 'middle', horizontal: c.photo ? 'center' : (c.key === 'litres' || c.key === 'n') ? 'right' : 'left', wrapText: c.key === 'site' || c.key === 'remarks', indent: c.photo || c.key === 'litres' || c.key === 'n' ? 0 : 1 };
      cell.border = BORDER;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) };
      if (c.photo && cell.value) cell.font = { name: 'Calibri', size: 9, italic: true, color: argb(r.photo ? 'B4372A' : 'A8B1C0') };
    });
    row.getCell(7).numFmt = '#,##0.00';
    row.height = Math.max(22, Math.min(150, Math.max(wrappedLines(r.site, 26), wrappedLines(r.remarks, 30)) * 14 + 8), hasThumb ? PHOTO_ROW_PT : 0);
    if (hasThumb) {                                                  // the photo sits inside its own cell (and hides with the row when filtered)
      const t = thumbs.get(r.photo), rowPx = row.height / 0.75, scale = Math.min(IMG_W / t.width, IMG_H / t.height, 1);
      const w = Math.max(1, Math.round(t.width * scale)), h = Math.max(1, Math.round(t.height * scale)), cellPx = XL[7].width * 7 + 5;
      const offX = Math.max(0, (cellPx - w) / 2), offY = Math.max(0, (rowPx - h) / 2), id = wb.addImage({ buffer: t.buffer, extension: 'jpeg' });
      ws.addImage(id, { tl: { nativeCol: 7, nativeColOff: Math.round(offX * EMU), nativeRow: first + idx - 1, nativeRowOff: Math.round(offY * EMU) }, br: { nativeCol: 7, nativeColOff: Math.round((offX + w) * EMU), nativeRow: first + idx - 1, nativeRowOff: Math.round((offY + h) * EMU) }, editAs: 'twoCell' });
    }
  });

  const totalRow = (rowNo, label, labelCol, fillsText, litresValue, litresFormula) => {      // a bold, shaded, ruled TOTAL line
    const row = ws.getRow(rowNo);
    for (let i = 1; i <= last; i++) {
      const cell = row.getCell(i);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: argb(COLORS.ink) }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(TOTAL_FILL) };
      cell.border = { ...BORDER, top: { style: 'medium', color: argb(COLORS.orange) } }; cell.alignment = { vertical: 'middle', indent: 1 };
    }
    row.getCell(labelCol).value = label;
    if (fillsText !== null) { row.getCell(labelCol + 1).value = fillsText; row.getCell(labelCol + 1).alignment = { vertical: 'middle', horizontal: 'right', indent: 1 }; }
    const lc = row.getCell(7); lc.value = litresFormula ? { formula: litresFormula, result: litresValue } : litresValue; lc.numFmt = '#,##0.00'; lc.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
    row.height = 24; return row;
  };
  let r0 = first + d.rows.length;
  if (d.rows.length) {
    const lastData = first + d.rows.length - 1;
    totalRow(r0, 'TOTAL', 5, `${d.fills} fill${d.fills === 1 ? '' : 's'}`, d.total_litres, `SUBTOTAL(109,G${first}:G${lastData})`);      // SUBTOTAL: follows any filter applied in Excel
    ws.getRow(r0).getCell(6).value = null;
    ws.getRow(r0).getCell(5).value = `TOTAL \u00b7 ${d.fills} fill${d.fills === 1 ? '' : 's'}`;
    r0 += 2;
  }
  if (d.sites.length) {
    ws.mergeCells(r0, 1, r0, last);
    const sh = ws.getCell(r0, 1); sh.value = 'SITE-WISE SUMMARY'; sh.font = { name: 'Calibri', size: 11.5, bold: true, color: argb(COLORS.ink) };
    sh.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(SUBHEAD_FILL) }; sh.alignment = { vertical: 'middle', indent: 1 }; sh.border = { top: thin, bottom: { style: 'medium', color: argb(COLORS.orange) } }; ws.getRow(r0).height = 24; r0 += 1;
    const sHead = ws.getRow(r0);
    for (let i = 1; i <= last; i++) { const c = sHead.getCell(i); c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) }; c.border = BORDER; c.font = { name: 'Calibri', size: 10.5, bold: true, color: argb('FFFFFF') }; }
    sHead.getCell(3).value = 'Site'; sHead.getCell(4).value = 'Fills'; sHead.getCell(7).value = 'Diesel (L)';
    sHead.getCell(4).alignment = { horizontal: 'right' }; sHead.getCell(7).alignment = { horizontal: 'right', indent: 1 }; sHead.height = 22; r0 += 1;
    const s0 = r0;
    d.sites.forEach((s, i) => {
      const row = ws.getRow(r0);
      for (let c = 1; c <= last; c++) { const cell = row.getCell(c); cell.border = BORDER; cell.font = { name: 'Calibri', size: 10.5, color: argb(COLORS.ink) }; if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) }; }
      row.getCell(3).value = s.site; row.getCell(3).font = { name: 'Calibri', size: 10.5, bold: true, color: argb(COLORS.ink) };
      row.getCell(4).value = s.fills; row.getCell(4).alignment = { horizontal: 'right' };
      row.getCell(7).value = s.litres; row.getCell(7).numFmt = '#,##0.00'; row.getCell(7).alignment = { horizontal: 'right', indent: 1 }; row.height = 20; r0 += 1;
    });
    const tr = totalRow(r0, 'TOTAL (all sites)', 3, d.sites.reduce((a, s) => a + s.fills, 0), d.total_litres, `SUM(G${s0}:G${r0 - 1})`);
    tr.getCell(4).value = { formula: `SUM(D${s0}:D${r0 - 1})`, result: d.sites.reduce((a, s) => a + s.fills, 0) }; tr.getCell(4).alignment = { horizontal: 'right', vertical: 'middle' };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ── PDF ───────────────────────────────────────────────────────────────────────────────────────────────────── */
async function buildDieselPdf(d, meta, thumbs) {
  const PDFDocument = reports.lib('pdfkit');
  const M = 28, doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true, info: { Title: 'Diesel Expenses \u2014 Sri Charan Constructions', Author: 'Sri Charan Constructions' } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const finished = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const PW = doc.page.width, PH = doc.page.height, usableW = PW - M * 2, bottom = PH - M - 14, hex = h => '#' + h;
  const PAD = 3, FONT = 7.6, BOX_W = 104, BOX_H = 46, MAXT = 54;
  const fixed = [22, 56, 120, 40, 92, 96, 54, 112];
  const COLS = [
    { key: 'n', header: '#', w: fixed[0], right: true }, { key: 'date', header: 'Date', w: fixed[1] }, { key: 'site', header: 'Site', w: fixed[2] }, { key: 'category', header: 'Cat.', w: fixed[3] },
    { key: 'vehicle_no', header: 'Vehicle No.', w: fixed[4], bold: true }, { key: 'operator', header: 'Operator', w: fixed[5] }, { key: 'litres', header: 'Diesel (L)', w: fixed[6], right: true },
    { key: 'proof', header: 'Proof photo', w: fixed[7], photo: true }, { key: 'remarks', header: 'Remarks', w: usableW - fixed.reduce((a, b) => a + b, 0) },
  ];
  const xs = COLS.reduce((acc, c, i) => { acc.push(i ? acc[i - 1] + COLS[i - 1].w : M); return acc; }, []);

  let y = M;
  try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), M, y - 2, { width: 34 }); } catch { /* the logo is optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(hex(COLORS.orange)).text('SRI CHARAN CONSTRUCTIONS', M + 42, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text('Diesel Expenses', M + 42, y + 19, { lineBreak: false });
  doc.fontSize(8).text(pdfText(`Generated ${reports.nowStamp()} by ${meta.user}`), M, y, { width: usableW, align: 'right', lineBreak: false });
  doc.text(pdfText(`${d.fills} fill${d.fills === 1 ? '' : 's'}  \u00b7  ${money2(d.total_litres)} L  \u00b7  ${photoNote(d.rows, thumbs)}`), M, y + 12, { width: usableW, align: 'right', lineBreak: false });
  y += 46;
  doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.5).strokeColor(hex(COLORS.orange)).stroke(); y += 8;
  doc.font('Helvetica').fontSize(8).fillColor(hex(COLORS.steel));
  const ftext = pdfText(`Filters: ${meta.filtersText}`), fh = doc.heightOfString(ftext, { width: usableW });
  doc.text(ftext, M, y, { width: usableW }); y += fh + 6;

  const drawHeader = () => {
    doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink)); doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF');
    COLS.forEach((c, i) => doc.text(c.header, xs[i] + PAD, y + 6, { width: c.w - PAD * 2, align: c.photo ? 'center' : c.right ? 'right' : 'left', lineBreak: false }));
    y += 18;
  };
  const ensure = (h, header) => { if (y + h > bottom) { doc.addPage(); y = M; if (header) header(); } };
  drawHeader();

  d.rows.forEach((r, idx) => {
    const text = { n: String(r.n), date: dmy(r.date), site: r.site || '\u2014', category: catLabel(r.category), vehicle_no: r.vehicle_no, operator: r.operator, litres: money2(r.litres), remarks: r.remarks };
    let textH = 12;
    COLS.forEach(c => { if (c.photo) return; doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT); textH = Math.max(textH, Math.min(MAXT, doc.heightOfString(pdfText(text[c.key]) || ' ', { width: c.w - PAD * 2 }))); });
    const hasThumb = !!(r.photo && thumbs.has(r.photo)), rowH = Math.max(textH, hasThumb ? BOX_H : 0) + PAD * 2 + 2;
    ensure(rowH, drawHeader);
    if (idx % 2 === 1) doc.rect(M, y, usableW, rowH).fill(hex(COLORS.paper));
    COLS.forEach((c, i) => {
      if (c.photo) {
        if (hasThumb) { const t = thumbs.get(r.photo), s = Math.min(BOX_W / t.width, BOX_H / t.height, 1), w = t.width * s, h = t.height * s; doc.image(t.buffer, xs[i] + (c.w - w) / 2, y + (rowH - h) / 2, { width: w, height: h }); }
        else doc.font('Helvetica').fontSize(FONT).fillColor(r.photo ? '#B4372A' : '#A8B1C0').text(r.photo ? '(unavailable)' : 'No proof', xs[i] + PAD, y + (rowH - FONT) / 2, { width: c.w - PAD * 2, align: 'center', lineBreak: false });
      } else doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT).fillColor(hex(COLORS.ink)).text(pdfText(text[c.key]), xs[i] + PAD, y + PAD + 1, { width: c.w - PAD * 2, height: MAXT, ellipsis: true, align: c.right ? 'right' : 'left' });
    });
    doc.moveTo(M, y + rowH).lineTo(M + usableW, y + rowH).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke();
    y += rowH;
  });

  const totalLine = (label, labelX, labelW, fills, litres, litresX, litresW, fillsX, fillsW) => {         // a bold, shaded, ruled TOTAL line
    ensure(22, null);
    doc.rect(M, y, usableW, 18).fill('#' + TOTAL_FILL); doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.2).strokeColor(hex(COLORS.orange)).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(hex(COLORS.ink));
    doc.text(label, labelX + PAD, y + 5, { width: labelW - PAD * 2, lineBreak: false });
    if (fills !== null) doc.text(String(fills), fillsX + PAD, y + 5, { width: fillsW - PAD * 2, align: 'right', lineBreak: false });
    doc.text(money2(litres), litresX + PAD, y + 5, { width: litresW - PAD * 2, align: 'right', lineBreak: false });
    y += 18;
  };
  if (d.rows.length) totalLine(`TOTAL \u00b7 ${d.fills} fill${d.fills === 1 ? '' : 's'}`, xs[4], fixed[4] + fixed[5], null, d.total_litres, xs[6], fixed[6]);

  if (d.sites.length) {
    y += 14; ensure(70, null);
    doc.rect(M, y, usableW, 17).fill('#' + SUBHEAD_FILL); doc.moveTo(M, y + 17).lineTo(M + usableW, y + 17).lineWidth(1).strokeColor(hex(COLORS.orange)).stroke();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(hex(COLORS.ink)).text('SITE-WISE SUMMARY', M + PAD + 2, y + 4.5, { lineBreak: false }); y += 19;
    const sHead = () => { doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink)); doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF'); doc.text('Site', xs[2] + PAD, y + 6, { lineBreak: false }); doc.text('Fills', xs[3] + PAD, y + 6, { width: fixed[3] - PAD * 2, align: 'right', lineBreak: false }); doc.text('Diesel (L)', xs[6] + PAD, y + 6, { width: fixed[6] - PAD * 2, align: 'right', lineBreak: false }); y += 18; };
    sHead();
    d.sites.forEach((s, i) => {
      ensure(20, sHead);
      if (i % 2 === 1) doc.rect(M, y, usableW, 17).fill(hex(COLORS.paper));
      doc.font('Helvetica-Bold').fontSize(FONT + 0.4).fillColor(hex(COLORS.ink)).text(pdfText(s.site), xs[2] + PAD, y + 5, { width: fixed[2] + fixed[3] + fixed[4] - PAD * 2 - 30, lineBreak: false, ellipsis: true });
      doc.font('Helvetica').text(String(s.fills), xs[3] + PAD, y + 5, { width: fixed[3] - PAD * 2, align: 'right', lineBreak: false });
      doc.text(money2(s.litres), xs[6] + PAD, y + 5, { width: fixed[6] - PAD * 2, align: 'right', lineBreak: false });
      doc.moveTo(M, y + 17).lineTo(M + usableW, y + 17).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke(); y += 17;
    });
    totalLine('TOTAL (all sites)', xs[2], fixed[2], d.sites.reduce((a, s) => a + s.fills, 0), d.total_litres, xs[6], fixed[6], xs[3], fixed[3]);
  }
  if (!d.rows.length) doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text('No diesel records match these filters.', M, y + 10);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i); doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(hex(COLORS.steel));
    doc.text('Sri Charan Constructions \u00b7 Diesel Expenses', M, PH - M + 4, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M, PH - M + 4, { width: usableW, align: 'right', lineBreak: false });
  }
  doc.end();
  return finished;
}

module.exports = { buildDieselXlsx, buildDieselPdf };
