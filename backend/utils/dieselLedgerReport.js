/**
 * The Diesel Stock & Balance report (Excel and PDF):
 *   1. the ledger   Date | Site | Diesel Stock Received | Usage | Balance Stock   (with an opening-balance line when a period is chosen)
 *   2. SITE-WISE SUMMARY      Site | Opening | Received | Used | Balance
 *   3. VEHICLE-WISE USAGE     Site | Vehicle No. | Diesel used | Fills
 * Every TOTAL line is bold and shaded. A balance below zero (more used than stock recorded) is printed in red.
 */
const path = require('path');
const reports = require('./reports');
const { COLORS } = reports;
const { dmy, round2 } = require('./dieselStock');

const argb = hex => ({ argb: 'FF' + hex });
const thin = { style: 'thin', color: argb(COLORS.line) };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const TOTAL_FILL = 'FFE2C2', SUBHEAD_FILL = 'E9EDF3', RED = 'B4372A';
const pdfText = s => String(s == null ? '' : s).replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\u2192/g, '->').replace(/[^\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2022\u2026\u20ac]/g, '?');
const money = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ledger lines in print order: the opening balances first (when a period is chosen), then each day. */
function ledgerLines(d) {
  const out = [];
  if (d.range.from) d.sites.filter(s => s.opening !== 0).forEach(s => out.push({ date: 'Opening', site: s.site, received: null, usage: null, balance: s.opening }));
  d.rows.forEach(r => out.push({ date: dmy(r.date), site: r.site, received: r.received, usage: r.usage, balance: r.balance }));
  return out;
}
const periodText = d => (d.range.from || d.range.to ? `${d.range.from ? `From ${dmy(d.range.from)}` : ''}${d.range.from && d.range.to ? ' to ' : ''}${d.range.to ? `${d.range.from ? '' : 'Up to '}${dmy(d.range.to)}` : ''}` : 'All time');
const filtersText = d => `Period: ${periodText(d)}  \u00b7  Site: ${d.sites_filter && d.sites_filter.length ? d.sites_filter.map(s => (s === '__none__' ? '(no site)' : s)).join(', ') : 'All sites'}`;
const summaryLine = d => `${d.rows.length} day${d.rows.length === 1 ? '' : 's'}  \u00b7  received ${money(d.totals.received)} L  \u00b7  used ${money(d.totals.used)} L  \u00b7  balance ${money(d.totals.balance)} L`;

/* \u2500\u2500 Excel \u2500\u2500 */
async function buildLedgerXlsx(d, meta) {
  const ExcelJS = reports.lib('exceljs');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Sri Charan Constructions'; wb.created = new Date();
  const ws = wb.addWorksheet('Diesel Stock', { views: [{ state: 'frozen', ySplit: 5 }], pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  [14, 34, 22, 20, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const L = 5, font = (o = {}) => ({ name: 'Calibri', size: 10.5, color: argb(COLORS.ink), ...o });
  ws.mergeCells(1, 1, 1, L); ws.getCell(1, 1).value = 'SRI CHARAN CONSTRUCTIONS \u2014 Diesel Stock & Balance'; ws.getCell(1, 1).font = { name: 'Calibri', size: 16, bold: true, color: argb(COLORS.orange) }; ws.getRow(1).height = 26;
  ws.mergeCells(2, 1, 2, L); ws.getCell(2, 1).value = `Generated ${reports.nowStamp()} by ${meta.user}  \u00b7  ${summaryLine(d)}`; ws.getCell(2, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) };
  ws.mergeCells(3, 1, 3, L); ws.getCell(3, 1).value = `Filters: ${filtersText(d)}`; ws.getCell(3, 1).font = { name: 'Calibri', size: 10, color: argb(COLORS.steel) }; ws.getCell(3, 1).alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(3).height = Math.max(15, 14 * Math.ceil(String(ws.getCell(3, 1).value).length / 100));

  let r = 5;
  const headRow = (labels, numFrom = 2) => {
    const row = ws.getRow(r);
    labels.forEach((t, i) => { const c = row.getCell(i + 1); c.value = t; c.font = font({ bold: true, color: argb('FFFFFF') }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.ink) }; c.border = BORDER; c.alignment = { vertical: 'middle', horizontal: i >= numFrom ? 'right' : 'left', indent: 1, wrapText: true }; });
    row.height = 24; r += 1;
  };
  const dataRow = (vals, i, { numFrom = 2, redAt = [], boldFirst = false } = {}) => {
    const row = ws.getRow(r);
    vals.forEach((v, k) => {
      const c = row.getCell(k + 1); c.value = v; c.border = BORDER;
      c.font = font({ bold: boldFirst && k === 1, color: argb(redAt.includes(k) && typeof v === 'number' && v < 0 ? RED : COLORS.ink) });
      c.alignment = { vertical: 'middle', horizontal: k >= numFrom ? 'right' : 'left', indent: 1 };
      if (typeof v === 'number') c.numFmt = '#,##0.00;[Red]-#,##0.00';
      if (i % 2 === 1) c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(COLORS.paper) };
    });
    row.height = 20; r += 1;
  };
  const totalRow = (vals, numFrom = 2) => {                       // a bold, shaded, ruled TOTAL line
    const row = ws.getRow(r);
    vals.forEach((v, k) => {
      const c = row.getCell(k + 1); c.value = v; c.font = font({ size: 11, bold: true }); c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(TOTAL_FILL) };
      c.border = { ...BORDER, top: { style: 'medium', color: argb(COLORS.orange) } }; c.alignment = { vertical: 'middle', horizontal: k >= numFrom ? 'right' : 'left', indent: 1 };
      if (typeof v === 'number') c.numFmt = '#,##0.00;[Red]-#,##0.00';
    });
    row.height = 24; r += 1;
  };
  const subhead = text => {
    ws.mergeCells(r, 1, r, L); const c = ws.getCell(r, 1); c.value = text; c.font = font({ size: 11.5, bold: true });
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(SUBHEAD_FILL) }; c.alignment = { vertical: 'middle', indent: 1 }; c.border = { top: thin, bottom: { style: 'medium', color: argb(COLORS.orange) } }; ws.getRow(r).height = 24; r += 1;
  };

  headRow(['Date', 'Site', 'Diesel Stock Received (L)', 'Usage (L)', 'Balance Stock (L)'], 2);
  const lines = ledgerLines(d);
  lines.forEach((x, i) => dataRow([x.date, x.site, x.received, x.usage, x.balance], i, { redAt: [4], boldFirst: true }));
  if (lines.length) totalRow(['TOTAL', d.range.from ? 'Including the opening balance' : '', d.totals.received, d.totals.used, d.totals.balance]);
  if (d.sites.length) {
    r += 1; subhead('SITE-WISE SUMMARY');
    headRow(['Site', 'Opening Balance (L)', 'Received (L)', 'Used (L)', 'Balance Stock (L)'], 1);
    d.sites.forEach((s, i) => dataRow([s.site, s.opening, s.received, s.used, s.balance], i, { numFrom: 1, redAt: [4] }));
    totalRow(['TOTAL (all sites)', d.totals.opening, d.totals.received, d.totals.used, d.totals.balance], 1);
  }
  if (d.vehicle_usage.length) {
    r += 1; subhead('VEHICLE-WISE USAGE');
    headRow(['Site', 'Vehicle No.', 'Diesel Used (L)', 'Fills', ''], 2);
    d.vehicle_usage.forEach((v, i) => dataRow([v.site, v.vehicle_no, v.litres, v.entries, ''], i, { numFrom: 2 }));
    totalRow(['TOTAL', '', round2(d.vehicle_usage.reduce((a, v) => a + v.litres, 0)), d.vehicle_usage.reduce((a, v) => a + v.entries, 0), '']);
    ws.getRow(r - 1).getCell(4).numFmt = '0';
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* \u2500\u2500 PDF \u2500\u2500 */
async function buildLedgerPdf(d, meta) {
  const PDFDocument = reports.lib('pdfkit');
  const M = 28, doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: M, bufferPages: true, info: { Title: 'Diesel Stock & Balance \u2014 Sri Charan Constructions', Author: 'Sri Charan Constructions' } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const finished = new Promise(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const PW = doc.page.width, PH = doc.page.height, usableW = PW - M * 2, bottom = PH - M - 14, hex = h => '#' + h, PAD = 4, FONT = 8.2;
  let y = M;
  try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), M, y - 2, { width: 34 }); } catch { /* the logo is optional */ }
  doc.font('Helvetica-Bold').fontSize(14).fillColor(hex(COLORS.orange)).text('SRI CHARAN CONSTRUCTIONS', M + 42, y, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text('Diesel Stock & Balance', M + 42, y + 18, { lineBreak: false });
  doc.fontSize(7.5).text(pdfText(`Generated ${reports.nowStamp()} by ${meta.user}`), M, y, { width: usableW, align: 'right', lineBreak: false });
  y += 46; doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.5).strokeColor(hex(COLORS.orange)).stroke(); y += 8;
  doc.font('Helvetica').fontSize(8).fillColor(hex(COLORS.steel));
  const lead = pdfText(`${summaryLine(d)}\n${`Filters: ${filtersText(d)}`}`), lh = doc.heightOfString(lead, { width: usableW });
  doc.text(lead, M, y, { width: usableW }); y += lh + 8;

  const ensure = (h, head) => { if (y + h > bottom) { doc.addPage(); y = M; if (head) head(); } };
  const table = (cols, rowsData, total, opts = {}) => {
    const xs = cols.reduce((acc, c, i) => { acc.push(i ? acc[i - 1] + cols[i - 1].w : M); return acc; }, []);
    const head = () => { doc.rect(M, y, usableW, 18).fill(hex(COLORS.ink)); doc.font('Helvetica-Bold').fontSize(6.8).fillColor('#FFFFFF'); cols.forEach((c, i) => doc.text(c.h, xs[i] + PAD, y + 6, { width: c.w - PAD * 2, align: c.right ? 'right' : 'left', lineBreak: false })); y += 18; };
    head();
    rowsData.forEach((row, idx) => {
      ensure(19, head);
      if (idx % 2 === 1) doc.rect(M, y, usableW, 17).fill(hex(COLORS.paper));
      cols.forEach((c, i) => {
        const v = row[i], neg = c.red && typeof v === 'number' && v < 0;
        doc.font(c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT).fillColor(neg ? '#' + RED : hex(COLORS.ink)).text(pdfText(typeof v === 'number' ? (c.int ? String(v) : money(v)) : (v == null ? '' : v)), xs[i] + PAD, y + 4.5, { width: c.w - PAD * 2, align: c.right ? 'right' : 'left', lineBreak: false, ellipsis: true });
      });
      doc.moveTo(M, y + 17).lineTo(M + usableW, y + 17).lineWidth(0.4).strokeColor(hex(COLORS.line)).stroke(); y += 17;
    });
    if (total) {                                                   // a bold, shaded, ruled TOTAL line
      ensure(22, null);
      doc.rect(M, y, usableW, 18).fill('#' + TOTAL_FILL); doc.moveTo(M, y).lineTo(M + usableW, y).lineWidth(1.2).strokeColor(hex(COLORS.orange)).stroke();
      cols.forEach((c, i) => { const v = total[i]; if (v === '' || v == null) return; doc.font('Helvetica-Bold').fontSize(8.6).fillColor(hex(COLORS.ink)).text(pdfText(typeof v === 'number' ? (c.int ? String(v) : money(v)) : v), xs[i] + PAD, y + 5, { width: c.w - PAD * 2, align: c.right ? 'right' : 'left', lineBreak: false, ellipsis: true }); });
      y += 18;
    }
  };
  const section = text => { y += 14; ensure(60, null); doc.rect(M, y, usableW, 17).fill('#' + SUBHEAD_FILL); doc.moveTo(M, y + 17).lineTo(M + usableW, y + 17).lineWidth(1).strokeColor(hex(COLORS.orange)).stroke(); doc.font('Helvetica-Bold').fontSize(8.5).fillColor(hex(COLORS.ink)).text(text, M + PAD + 2, y + 4.5, { lineBreak: false }); y += 19; };

  const lines = ledgerLines(d);
  table([{ h: 'Date', w: 66, bold: true }, { h: 'Site', w: 180 }, { h: 'Diesel Stock Received (L)', w: 92, right: true }, { h: 'Usage (L)', w: 90, right: true }, { h: 'Balance Stock (L)', w: usableW - 428, right: true, red: true }],
    lines.map(x => [x.date, x.site, x.received, x.usage, x.balance]), lines.length ? ['TOTAL', d.range.from ? 'incl. opening balance' : '', d.totals.received, d.totals.used, d.totals.balance] : null);
  if (!lines.length) doc.font('Helvetica').fontSize(9).fillColor(hex(COLORS.steel)).text('No stock was received and no diesel was used in this period.', M, y + 10);
  if (d.sites.length) {
    section('SITE-WISE SUMMARY');
    table([{ h: 'Site', w: 190, bold: true }, { h: 'Opening Balance (L)', w: 87, right: true }, { h: 'Received (L)', w: 87, right: true }, { h: 'Used (L)', w: 87, right: true }, { h: 'Balance Stock (L)', w: usableW - 451, right: true, red: true }],
      d.sites.map(s => [s.site, s.opening, s.received, s.used, s.balance]), ['TOTAL (all sites)', d.totals.opening, d.totals.received, d.totals.used, d.totals.balance]);
  }
  if (d.vehicle_usage.length) {
    section('VEHICLE-WISE USAGE');
    table([{ h: 'Site', w: 200 }, { h: 'Vehicle No.', w: 150, bold: true }, { h: 'Diesel Used (L)', w: 100, right: true }, { h: 'Fills', w: usableW - 450, right: true, int: true }],
      d.vehicle_usage.map(v => [v.site, v.vehicle_no, v.litres, v.entries]), ['TOTAL', '', round2(d.vehicle_usage.reduce((a, v) => a + v.litres, 0)), d.vehicle_usage.reduce((a, v) => a + v.entries, 0)]);
  }
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i); doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7).fillColor(hex(COLORS.steel));
    doc.text('Sri Charan Constructions \u00b7 Diesel Stock & Balance', M, PH - M + 4, { lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, M, PH - M + 4, { width: usableW, align: 'right', lineBreak: false });
  }
  doc.end();
  return finished;
}

module.exports = { buildLedgerXlsx, buildLedgerPdf, filtersText, ledgerLines };
