/** Pay slips as one PDF (one A4 page per employee). */
const path = require('path');
const P = require('./payroll');
const { lib } = require('./reports');
const pdfText = s => String(s == null ? '' : s).replace(/[^ -~ -ÿ]/g, '?');
const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN');

async function build(lines, month, cfg) {
  const PDFDocument = lib('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Pay slip ${P.monthName(month)}`, Author: cfg.company_name } });
  const chunks = []; doc.on('data', c => chunks.push(c));
  const done = new Promise((ok, no) => { doc.on('end', () => ok(Buffer.concat(chunks))); doc.on('error', no); });
  const W = doc.page.width - 80, INK = '#1B2433', STEEL = '#5B6678', LINE = '#E3E7EE', HAZ = '#C2570A';
  lines.forEach((l, idx) => {
    if (idx) doc.addPage();
    let y = 40;
    if (cfg.slip.logo) { try { doc.image(path.join(__dirname, '../../frontend/img/logo.png'), 40, y - 2, { width: 38 }); } catch { /* optional */ } }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(HAZ).text(pdfText(cfg.company_name.toUpperCase()), cfg.slip.logo ? 88 : 40, y, { lineBreak: false });
    let hdrH = 52; const tx = cfg.slip.logo ? 88 : 40;
    if (cfg.slip.address_on && cfg.slip.address) {
      doc.font('Helvetica').fontSize(8.5); const ah = doc.heightOfString(pdfText(cfg.slip.address), { width: 330 });
      doc.fillColor(STEEL).text(pdfText(cfg.slip.address), tx, y + 20, { width: 330 }); hdrH = Math.max(hdrH, 24 + ah + 4);
    }
    if (cfg.slip.gstin) { doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('GSTIN: ' + pdfText(cfg.slip.gstin), tx, y + hdrH - 2, { width: 330, lineBreak: false }); hdrH += 12; }
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('PAY SLIP', 40, y, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor(STEEL).text(P.monthName(month), 40, y + 17, { width: W, align: 'right' });
    y += hdrH; doc.moveTo(40, y).lineTo(40 + W, y).lineWidth(1.5).strokeColor(HAZ).stroke(); y += 12;
    const kv = (x, yy, k, v, w) => { doc.font('Helvetica').fontSize(8).fillColor(STEEL).text(k, x, yy, { width: w, lineBreak: false }); doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(pdfText(v || '-'), x, yy + 10, { width: w, lineBreak: false, ellipsis: true }); };
    const cw = W / 3;
    kv(40, y, 'Employee', l.name, cw - 8); kv(40 + cw, y, 'Employee ID', l.emp_code, cw - 8); kv(40 + 2 * cw, y, 'Designation', l.designation, cw - 8); y += 30;
    kv(40, y, 'Date of joining', P.dmy(l.joined_on), cw - 8); kv(40 + cw, y, 'Site', l.site, cw - 8); kv(40 + 2 * cw, y, 'Bank account', l.bank_account ? `${l.bank_name ? l.bank_name + ' ' : ''}${l.bank_account}` : '', cw - 8); y += 30;
    kv(40, y, 'PAN', l.pan, cw - 8); kv(40 + cw, y, 'UAN', l.uan, cw - 8); kv(40 + 2 * cw, y, 'ESI number', l.esi_no, cw - 8); y += 34;
    doc.rect(40, y, W, 24).fill('#F3F5F9');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text(`Days in month ${l.days_in_month}   |   Paid days ${l.paid_days}   |   Loss of pay ${l.lop_days}   |   Overtime ${l.ot_hours} h`, 48, y + 8, { width: W - 16, lineBreak: false });
    y += 36;
    const half = W / 2 - 8, hdr = (x, t) => { doc.rect(x, y, half, 20).fill(INK); doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF').text(t, x + 8, y + 6, { lineBreak: false }); doc.text('AMOUNT', x, y + 6, { width: half - 8, align: 'right', lineBreak: false }); };
    hdr(40, 'EARNINGS'); hdr(40 + half + 16, 'DEDUCTIONS'); y += 20;
    const earn = [['Basic', l.basic], ['House rent allowance', l.hra], ['Special allowance', l.special]];
    if (l.ot_pay) earn.push([`Overtime (${l.ot_hours} h)`, l.ot_pay]);
    (l.adjustments || []).filter(a => a.kind === 'earning').forEach(a => earn.push([a.label, a.amount]));
    const ded = []; if (l.pf) ded.push(['Provident fund (PF)', l.pf]); if (l.esi) ded.push(['ESI', l.esi]); if (l.pt) ded.push(['Professional tax', l.pt]); if (l.tds) ded.push(['Income tax (TDS)', l.tds]);
    (l.adjustments || []).filter(a => a.kind === 'deduction').forEach(a => ded.push([a.label, a.amount]));
    if (!ded.length) ded.push(['No deductions', 0]);
    const n = Math.max(earn.length, ded.length), rowH = 20;
    for (let i = 0; i < n; i++) {
      const yy = y + i * rowH;
      [[40, earn[i]], [40 + half + 16, ded[i]]].forEach(([x, r]) => {
        if (!r) return;
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(pdfText(r[0]), x + 8, yy + 6, { width: half - 90, lineBreak: false, ellipsis: true });
        doc.text(r[1] ? money(r[1]).replace('Rs. ', '') : '-', x, yy + 6, { width: half - 8, align: 'right', lineBreak: false });
        doc.moveTo(x, yy + rowH).lineTo(x + half, yy + rowH).lineWidth(0.5).strokeColor(LINE).stroke();
      });
    }
    y += n * rowH;
    doc.rect(40, y, half, 22).fill('#FFF3E6'); doc.rect(40 + half + 16, y, half, 22).fill('#FFF3E6');
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK);
    doc.text('Total earnings', 48, y + 7, { lineBreak: false }); doc.text(Number(l.total_earnings).toLocaleString('en-IN'), 40, y + 7, { width: half - 8, align: 'right', lineBreak: false });
    doc.text('Total deductions', 48 + half + 16, y + 7, { lineBreak: false }); doc.text(Number(l.total_deductions).toLocaleString('en-IN'), 40 + half + 16, y + 7, { width: half - 8, align: 'right', lineBreak: false });
    y += 40;
    doc.rect(40, y, W, 44).fill(INK);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF').text('NET PAY', 54, y + 8, { lineBreak: false });
    doc.fontSize(18).text(money(l.net), 40, y + 8, { width: W - 14, align: 'right', lineBreak: false });
    if (cfg.slip.words_on) doc.font('Helvetica').fontSize(9).fillColor('#E3E7EE').text(P.rupeesInWords(l.net), 54, y + 28, { width: W - 20, lineBreak: false });
    y += 64;
    if (cfg.slip.footer) doc.font('Helvetica-Oblique').fontSize(8).fillColor(STEEL).text(pdfText(cfg.slip.footer), 40, y, { width: W, align: 'center' });
  });
  doc.end();
  return done;
}
module.exports = { build };
