/**
 * Plain-table reports (Inventory lists, Users, Activity Logs) as Excel and PDF.
 *
 * columns: [{ key, header, width (Excel, in characters), weight (PDF, relative width), align?, wrap? }]
 * rows:    [{ [key]: value, _tone?: 'danger' | 'muted' }]     (_tone colours the whole row)
 * meta:    { user, subtitle? }
 *
 * Text is always written as text — a cell like  =HYPERLINK(...)  is never turned into a formula.
 */
const path = require('path');
const { lib, COLORS, REPORT_TZ, nowStamp, cleanText } = require('./reports');

const argb = hex => ({ argb: 'FF' + hex });
const thin = { style: 'thin', color: argb(COLORS.line) };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const TONES = { danger: 'B4372A', muted: '8A94A6' };

/** "09/10/2026" and "08:43 pm" in the report time zone, from a stored timestamp. */
function istDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { timeZone: REPORT_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
}
function istTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-IN', { timeZone: REPORT_TZ, hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
}

const wrappedLines = (text, widthChars) =>
  !text ? 1 : String(text).split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / (widthChars * 1.08))), 0);

/* ── Excel ───────────────────────────────────────────────────────────────────── */
async function buildTableXlsx({ sheetName, title, columns, rows, meta }) {
  const ExcelJS = lib('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sri Charan Constructions';
  wb.created = new Date();
  const HEADER_ROW = 5;
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
  });
  ws.columns = columns.map(c => ({ key: c.key, width: c.width }));
  const lastCol = columns.length;

  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = `SRI CHARAN CONSTRUCTIONS — ${title}`;
  ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: argb(COLORS.orange) };
  ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = `Generated ${nowStamp()} by ${meta.user}  ·  ${rows.length} row${rows.length === 1 ? '' : 's'}`;
  ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = meta.subtitle || '';
  ws.getCell(3, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };

  const head = ws.getRow(HEADER_ROW);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: 'Calibri', size: 10.5, bold: true, color: argb('FFFFFF') };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) };
    cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', wrapText: true, indent: c.align === 'center' ? 0 : 1 };
    cell.border = BORDER;
  });
  head.height = 24;
  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW, column: lastCol } };

  rows.forEach((r, idx) => {
    const row = ws.getRow(HEADER_ROW + 1 + idx);
    let lines = 1;
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = r[c.key];
      cell.value = v === undefined || v === null ? '' : v;
      cell.font = { name: 'Calibri', size: 10.5, color: argb(TONES[r._tone] || COLORS.ink), bold: !!c.bold };
      cell.alignment = { vertical: 'top', horizontal: c.align || 'left', wrapText: !!c.wrap, indent: c.align === 'center' ? 0 : 1 };
      cell.border = BORDER;
      if (idx % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) };
      if (c.wrap) lines = Math.max(lines, wrappedLines(v, c.width));
    });
    row.height = Math.max(20, Math.min(160, lines * 14 + 8));
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ── PDF ─────────────────────────────────────────────────────────────────────── */
// The built-in PDF fonts only cover Western (Latin) characters, so anything else is shown as "?".
const pdfText = s => String(s == null ? '' : s)
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2192/g, '->')
  .replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2022\u2026\u20ac]/g, '?');

async function buildTablePdf({ title, columns, rows, meta }) {
  const PDFDocument = lib('pdfkit');
  const M = 28;
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: M, bufferPages: true, info: { Title: `${title} — Sri Charan Constructions`, Author: 'Sri Charan Constructions' } });
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const finished = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });

  const PW = doc.page.width, PH = doc.page.height;
  const usableW = PW - M * 2;
  const bottom = PH - M - 14;
  const PAD = 3, MAX_TEXT_H = 60, FONT = 7.4;
  const hex = h => '#' + h;
  const totalWeight = columns.reduce((a, c) => a + c.weight, 0);
  const widths = columns.map(c => (c.weight / totalWeight) * usableW);
  const xs = widths.reduce((acc, w, i) => { acc.push(i ? acc[i - 1] + widths[i - 1] : M); return acc; }, []);

  let y = M;
  try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), M, y - 2, { width: 34 }); } catch { /* logo is optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(hex(COLORS.orange)).text('SRI CHARAN CONSTRUCTIONS', M + 42, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text(pdfText(title), M + 42, y + 19, { lineBreak: false });
  doc.fontSize(8).text(pdfText(`Generated ${nowStamp()} by ${meta.user}`), M, y, { width: usableW, align: 'right', lineBreak: false });
  doc.text(`${rows.length} row${rows.length === 1 ? '' : 's'}`, M, y + 12, { width: usableW, align: 'right', lineBreak: false });
  if (meta.subtitle) doc.text(pdfText(meta.subtitle), M, y + 24, { width: usableW, align: 'right', lineBreak: false, ellipsis: true, height: 10 });
  y += 46;
  doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.5).strokeColor(hex(COLORS.orange)).stroke();
  y += 8;

  const drawHeader = () => {
    doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink));
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF');
    columns.forEach((c, i) => doc.text(c.header, xs[i] + PAD, y + 6, { width: widths[i] - PAD * 2, align: c.align || 'left', lineBreak: false, ellipsis: true }));
    y += 18;
  };
  drawHeader();

  rows.forEach((r, idx) => {
    doc.font('Helvetica').fontSize(FONT);
    let textH = 11;
    const texts = columns.map((c, i) => {
      const t = pdfText(r[c.key] === undefined || r[c.key] === null ? '' : r[c.key]);
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT);
      textH = Math.max(textH, Math.min(MAX_TEXT_H, doc.heightOfString(t || ' ', { width: widths[i] - PAD * 2 })));
      return t;
    });
    const rowH = textH + PAD * 2 + 2;
    if (y + rowH > bottom) { doc.addPage(); y = M; drawHeader(); }
    if (idx % 2 === 1) doc.rect(M, y, usableW, rowH).fill(hex(COLORS.paper));
    const tone = hex(TONES[r._tone] || COLORS.ink);
    columns.forEach((c, i) => {
      doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT).fillColor(tone)
        .text(texts[i], xs[i] + PAD, y + PAD + 1, { width: widths[i] - PAD * 2, height: MAX_TEXT_H, ellipsis: true, align: c.align || 'left' });
    });
    doc.moveTo(M, y + rowH).lineTo(M + usableW, y + rowH).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke();
    y += rowH;
  });

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;           // otherwise writing in the margin would start a new page
    doc.font('Helvetica').fontSize(7).fillColor(hex(COLORS.steel))
      .text(`Sri Charan Constructions · ${pdfText(title)}`, M, PH - M - 4, { lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, M, PH - M - 4, { width: usableW, align: 'right', lineBreak: false });
  }
  doc.end();
  return finished;
}

module.exports = { buildTableXlsx, buildTablePdf, istDate, istTime, cleanText };
