/**
 * Payroll rules and the salary calculation. Pure functions (no database) so every figure can be tested.
 *
 *  • An employee has a MONTHLY CTC (cost to company). A salary structure splits it:
 *        Basic = basic_pct % of CTC,   HRA = hra_pct % of Basic,   Employer PF = 12 % of Basic (up to the wage limit),
 *        Special allowance = what is left of the CTC.
 *  • PAID DAYS = salary days − loss-of-pay days.  Loss of pay = absent days + the unpaid part of half days + days that were not marked
 *    (weekly offs count as paid even when not marked) + days before the person joined / after they left.
 *  • Each component is paid in proportion:  component x paid days / salary days  (salary days = days of the month, or a fixed number).
 *  • Deductions: employee PF (12 % of the Basic earned, up to the wage limit), ESI (when the full-month gross is within the limit),
 *    Professional Tax (slab on the full-month gross) and any deduction lines added for the month (advance, fine …).
 *  • Overtime and bonus lines are added on top (not part of PF).
 * All amounts are rounded to the nearest rupee, component by component, so the pay slip adds up exactly.
 * The rates are settings (the Admin can change them); the defaults below are only a starting point.
 */
const DAY_MS = 86400000;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const r0 = n => Math.round((Number(n) || 0) + 1e-9);
const r2 = n => Math.round((Number(n) || 0) * 100 + 1e-9) / 100;

const DEFAULT_CONFIG = {
  company_name: 'Sri Charan Constructions',
  salary_days: 'calendar', fixed_days: 26,
  pay_day: 5,
  weekly_off: [0],                                           // 0 = Sunday … 6 = Saturday
  templates: [
    { key: 'standard', name: 'Standard staff', basic_pct: 50, hra_pct: 40 },
    { key: 'site', name: 'Site and machine staff', basic_pct: 40, hra_pct: 30 },
  ],
  pf:  { on: true, employee_pct: 12, employer_pct: 12, wage_limit: 15000 },
  esi: { on: true, employee_pct: 0.75, employer_pct: 3.25, gross_limit: 21000 },
  pt:  { on: true, slabs: [{ upto: 21000, amount: 0 }, { upto: null, amount: 200 }] },
  attendance: { half_value: 0.5, ot_on: true, ot_multiplier: 1.5, hours_per_day: 8, lock_day: 3 },
  holidays: [],                                              // [{ date: 'YYYY-MM-DD', name }]  paid for everyone
  slip: { logo: true, address_on: true, words_on: true, address: '', gstin: '', footer: 'This is a computer-generated pay slip and does not need a signature.' },
};
const STATUSES = ['P', 'A', 'H', 'L', 'W'];
const STATUS_TEXT = { P: 'Present', A: 'Absent', H: 'Half day', L: 'Paid leave', W: 'Weekly off' };

/* ── dates ── */
const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m)) && m >= '2000-01' && m <= '2100-12';
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const daysInMonth = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const dayOf = (m, d) => `${m}-${String(d).padStart(2, '0')}`;
const weekday = date => new Date(date + 'T00:00:00Z').getUTCDay();
const todayIST = (now = Date.now()) => new Date(now + 5.5 * 3600000).toISOString().slice(0, 10);
const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dmy = d => (d ? `${String(d).slice(8, 10)}-${String(d).slice(5, 7)}-${String(d).slice(0, 4)}` : '');
const prevMonth = m => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const nextMonth = m => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 7); };

/* ── settings ── */
function num(v, lo, hi, what) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`${what} must be a number from ${lo} to ${hi}.`);
  return n;
}
/** Body → { config } or { error }. Anything not sent keeps its current value. */
function parseConfig(b, base = DEFAULT_CONFIG) {
  b = b || {};
  try {
    const c = JSON.parse(JSON.stringify(base));
    if (b.company_name !== undefined) { c.company_name = clean(b.company_name, 80); if (!c.company_name) throw new Error('Enter the company name.'); }
    if (b.salary_days !== undefined) { if (!['calendar', 'fixed'].includes(b.salary_days)) throw new Error('Choose how salary days are counted.'); c.salary_days = b.salary_days; }
    if (b.fixed_days !== undefined) c.fixed_days = Math.round(num(b.fixed_days, 20, 31, 'Fixed salary days'));
    if (b.pay_day !== undefined) c.pay_day = Math.round(num(b.pay_day, 1, 28, 'The pay day'));
    if (b.weekly_off !== undefined) {
      if (!Array.isArray(b.weekly_off) || b.weekly_off.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('Weekly off must be days of the week.');
      c.weekly_off = [...new Set(b.weekly_off)].sort();
    }
    if (b.templates !== undefined) {
      if (!Array.isArray(b.templates) || !b.templates.length || b.templates.length > 12) throw new Error('Keep between 1 and 12 salary structures.');
      const seen = new Set();
      c.templates = b.templates.map(t => {
        const key = clean(t && t.key, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || `t${seen.size + 1}`;
        if (seen.has(key)) throw new Error('Two salary structures have the same key.'); seen.add(key);
        const name = clean(t && t.name, 40); if (!name) throw new Error('Every salary structure needs a name.');
        return { key, name, basic_pct: num(t.basic_pct, 1, 100, 'Basic %'), hra_pct: num(t.hra_pct, 0, 100, 'HRA %') };
      });
    }
    const flag = (v, what) => { if (typeof v !== 'boolean') throw new Error(`${what} must be on or off.`); return v; };
    if (b.pf !== undefined) c.pf = { on: flag((b.pf || {}).on, 'PF'), employee_pct: num((b.pf || {}).employee_pct, 0, 30, 'Employee PF %'), employer_pct: num((b.pf || {}).employer_pct, 0, 30, 'Employer PF %'), wage_limit: num((b.pf || {}).wage_limit, 1000, 1000000, 'The PF wage limit') };
    if (b.esi !== undefined) c.esi = { on: flag((b.esi || {}).on, 'ESI'), employee_pct: num((b.esi || {}).employee_pct, 0, 10, 'Employee ESI %'), employer_pct: num((b.esi || {}).employer_pct, 0, 10, 'Employer ESI %'), gross_limit: num((b.esi || {}).gross_limit, 1000, 1000000, 'The ESI gross limit') };
    if (b.pt !== undefined) {
      const sl = (b.pt || {}).slabs;
      if (!Array.isArray(sl) || !sl.length || sl.length > 10) throw new Error('Professional Tax needs between 1 and 10 slabs.');
      let last = -1;
      const slabs = sl.map((s, i) => {
        const last_one = i === sl.length - 1;
        const upto = last_one ? null : num(s.upto, 1, 100000000, 'A slab limit');
        if (!last_one && upto <= last) throw new Error('Slab limits must go up.');
        if (!last_one) last = upto;
        return { upto, amount: num(s.amount, 0, 100000, 'A Professional Tax amount') };
      });
      c.pt = { on: flag((b.pt || {}).on, 'Professional Tax'), slabs };
    }
    if (b.attendance !== undefined) {
      const a = b.attendance || {};
      c.attendance = { half_value: num(a.half_value, 0, 1, 'A half day'), ot_on: flag(a.ot_on, 'Overtime'), ot_multiplier: num(a.ot_multiplier, 1, 5, 'The overtime multiplier'), hours_per_day: num(a.hours_per_day, 4, 24, 'Hours per day'), lock_day: Math.round(num(a.lock_day, 1, 28, 'The lock day')) };
    }
    if (b.slip !== undefined) { const s = b.slip || {}; c.slip = { logo: flag(s.logo, 'Logo'), address_on: flag(s.address_on, 'Address'), words_on: flag(s.words_on, 'Salary in words'), address: clean(s.address, 400), gstin: s.gstin === undefined ? (base.slip && base.slip.gstin) || '' : clean(s.gstin, 20).toUpperCase(), footer: clean(s.footer, 160) }; }
    if (b.holidays !== undefined) {
      if (!Array.isArray(b.holidays) || b.holidays.length > 120) throw new Error('Keep up to 120 holidays.');
      const seen = new Set();
      c.holidays = b.holidays.map(h => {
        const date = String((h && h.date) || '').trim(); if (!validDay(date)) throw new Error('A holiday has no valid date.');
        if (seen.has(date)) throw new Error(`${dmy(date)} is listed twice.`); seen.add(date);
        const name = clean(h.name, 60); if (!name) throw new Error(`Give the holiday on ${dmy(date)} a name.`);
        return { date, name };
      }).sort((a, b2) => (a.date < b2.date ? -1 : 1));
    }
    return { config: c };
  } catch (e) { return { error: e.message }; }
}
/** Stored settings (may lack newer keys) → a full config. */
const fullConfig = stored => { const p = parseConfig(stored && typeof stored === 'object' ? stored : {}, DEFAULT_CONFIG); return p.config || DEFAULT_CONFIG; };

/* ── one employee's salary structure ── */
const templateOf = (cfg, key) => cfg.templates.find(t => t.key === key) || cfg.templates[0];
function breakup(ctc, emp, cfg) {
  const t = templateOf(cfg, emp.structure);
  const basic = r0(ctc * t.basic_pct / 100), hra = r0(basic * t.hra_pct / 100);
  const pf_employer = cfg.pf.on && emp.pf_applicable ? r0(cfg.pf.employer_pct / 100 * Math.min(basic, cfg.pf.wage_limit)) : 0;
  const special = Math.max(0, r0(ctc) - basic - hra - pf_employer);
  return { basic, hra, special, pf_employer, gross: basic + hra + special, template: t.name };
}
const ptFor = (gross, cfg) => { for (const s of cfg.pt.slabs) if (s.upto === null || gross <= s.upto) return s.amount; return 0; };

/** What the month's attendance means for one person. recs = { 'YYYY-MM-DD': { s, ot } } */
function paidSummary(emp, month, recs, cfg) {
  const dim = daysInMonth(month), out = { present: 0, absent: 0, half: 0, leave: 0, weekly_off: 0, holiday: 0, unmarked: 0, outside: 0, ot_hours: 0 };
  const hol = new Set((cfg.holidays || []).map(h => h.date));
  let lop = 0;
  for (let d = 1; d <= dim; d++) {
    const date = dayOf(month, d);
    if ((emp.joined_on && date < String(emp.joined_on).slice(0, 10)) || (emp.left_on && date > String(emp.left_on).slice(0, 10))) { out.outside++; lop++; continue; }
    const r = recs && recs[date];
    if (r) {
      out.ot_hours += Number(r.ot) || 0;
      if (r.s === 'P') out.present++; else if (r.s === 'A') { out.absent++; lop += 1; } else if (r.s === 'H') { out.half++; lop += 1 - cfg.attendance.half_value; } else if (r.s === 'L') out.leave++; else if (r.s === 'W') out.weekly_off++;
    } else if (hol.has(date)) out.holiday++;
    else if (cfg.weekly_off.includes(weekday(date))) out.weekly_off++;
    else { out.unmarked++; lop += 1; }
  }
  const salary_days = cfg.salary_days === 'fixed' ? cfg.fixed_days : dim;
  return { ...out, days_in_month: dim, salary_days, lop_days: r2(lop), paid_days: Math.max(0, r2(salary_days - lop)) };
}

/** The whole line for one person and month. adj = [{ kind: 'earning' | 'deduction', label, amount }] */
function computeLine(emp, month, recs, adj, cfg) {
  const ctc = Number(emp.monthly_ctc) || 0, b = breakup(ctc, emp, cfg), s = paidSummary(emp, month, recs, cfg);
  const f = s.salary_days ? s.paid_days / s.salary_days : 0;
  const basic = r0(b.basic * f), hra = r0(b.hra * f), special = r0(b.special * f), gross = basic + hra + special;
  const hourly = s.salary_days ? ctc / s.salary_days / cfg.attendance.hours_per_day : 0;
  const ot_pay = cfg.attendance.ot_on ? r0(s.ot_hours * hourly * cfg.attendance.ot_multiplier) : 0;
  const lines = (Array.isArray(adj) ? adj : []).filter(a => a && Number(a.amount) > 0);
  const other_earnings = lines.filter(a => a.kind === 'earning').reduce((t, a) => t + r0(a.amount), 0);
  const other_deductions = lines.filter(a => a.kind === 'deduction').reduce((t, a) => t + r0(a.amount), 0);
  const pf = cfg.pf.on && emp.pf_applicable ? r0(cfg.pf.employee_pct / 100 * Math.min(basic, cfg.pf.wage_limit)) : 0;
  const esi = cfg.esi.on && emp.esi_applicable && b.gross <= cfg.esi.gross_limit ? r0(cfg.esi.employee_pct / 100 * (gross + ot_pay + other_earnings)) : 0;
  const pt = cfg.pt.on && emp.pt_applicable ? ptFor(b.gross, cfg) : 0;
  const total_deductions = pf + esi + pt + other_deductions, total_earnings = gross + ot_pay + other_earnings;
  const flags = [];
  if (s.unmarked) flags.push(`${s.unmarked} day${s.unmarked === 1 ? '' : 's'} not marked`);
  if (!emp.bank_account) flags.push('Bank details missing');
  if (total_earnings - total_deductions < 0) flags.push('Deductions are more than the pay');
  return {
    employee_id: emp.id, emp_code: emp.emp_code, name: emp.name, designation: emp.designation, site: emp.site || '', joined_on: emp.joined_on ? String(emp.joined_on).slice(0, 10) : null,
    phone: emp.phone || '', bank_name: emp.bank_name || '', bank_account: emp.bank_account || '', ifsc: emp.ifsc || '', pan: emp.pan || '', uan: emp.uan || '', esi_no: emp.esi_no || '',
    monthly_ctc: ctc, structure: b.template,
    full: { basic: b.basic, hra: b.hra, special: b.special, pf_employer: b.pf_employer, gross: b.gross },
    ...s, basic, hra, special, gross, ot_pay, other_earnings, pf, esi, pt, other_deductions, total_earnings, total_deductions, net: total_earnings - total_deductions,
    adjustments: lines.map(a => ({ kind: a.kind, label: clean(a.label, 60), amount: r0(a.amount), ...(a.auto ? { auto: true } : {}) })), flags,
  };
}
const totals = lines => ({
  count: lines.length, gross: lines.reduce((t, l) => t + l.total_earnings, 0), deductions: lines.reduce((t, l) => t + l.total_deductions, 0), net: lines.reduce((t, l) => t + l.net, 0),
  ctc: lines.reduce((t, l) => t + l.monthly_ctc, 0), pf: lines.reduce((t, l) => t + l.pf, 0), esi: lines.reduce((t, l) => t + l.esi, 0), pt: lines.reduce((t, l) => t + l.pt, 0), other: lines.reduce((t, l) => t + l.other_deductions, 0),
});

/* ── employee fields ── */
const digits = (v, min, max, what) => { const s = String(v == null ? '' : v).replace(/[\s-]/g, ''); if (!s) return ''; if (!/^\d+$/.test(s) || s.length < min || s.length > max) throw new Error(`${what} must be ${min === max ? min : `${min} to ${max}`} digits.`); return s; };
/** Body → { fields } or { error }. cfg is needed to check the salary structure. */
function parseEmployee(b, cfg) {
  b = b || {};
  try {
    const name = clean(b.name, 80); if (name.length < 2) throw new Error('Enter the employee\'s name.');
    const designation = clean(b.designation, 60); if (!designation) throw new Error('Enter the designation (for example Site Supervisor).');
    const joined_on = String(b.joined_on || '').trim(); if (!validDay(joined_on) || joined_on < '2000-01-01' || joined_on > '2100-12-31') throw new Error('Choose the date of joining.');
    const left_on = String(b.left_on || '').trim() || null;
    if (left_on && (!validDay(left_on) || left_on < joined_on)) throw new Error('The last working day must be on or after the date of joining.');
    const ctcRaw = typeof b.monthly_ctc === 'string' ? b.monthly_ctc.replace(/,/g, '') : b.monthly_ctc;
    const monthly_ctc = r2(num(ctcRaw, 1000, 10000000, 'The monthly CTC'));
    const structure = clean(b.structure, 30) || cfg.templates[0].key; if (!cfg.templates.some(t => t.key === structure)) throw new Error('Choose a salary structure from the list.');
    const ifsc = clean(b.ifsc, 11).toUpperCase().replace(/\s/g, ''); if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) throw new Error('The IFSC code looks wrong (4 letters, a zero, then 6 letters or digits).');
    const pan = clean(b.pan, 10).toUpperCase().replace(/\s/g, ''); if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) throw new Error('The PAN looks wrong (5 letters, 4 digits, 1 letter).');
    const flag = (v, d) => (v === undefined ? d : !!v);
    return { fields: {
      name, designation, site: clean(b.site, 80), phone: digits(b.phone, 10, 15, 'The phone number'), address: clean(b.address, 250), emergency_name: clean(b.emergency_name, 80), emergency_phone: digits(b.emergency_phone, 10, 15, 'The emergency phone number'),
      notes: clean(b.notes, 300), joined_on, left_on, status: left_on || b.status === 'left' ? 'left' : 'active', monthly_ctc, structure,
      pf_applicable: flag(b.pf_applicable, true), esi_applicable: flag(b.esi_applicable, true), pt_applicable: flag(b.pt_applicable, true),
      bank_name: clean(b.bank_name, 80), bank_account: digits(b.bank_account, 6, 20, 'The bank account number'), ifsc, pan, uan: digits(b.uan, 12, 12, 'The UAN'), esi_no: digits(b.esi_no, 10, 17, 'The ESI number'),
    } };
  } catch (e) { return { error: e.message }; }
}
const nextCode = list => 'E' + String(list.reduce((m, e) => Math.max(m, parseInt(String(e.emp_code || '').replace(/\D/g, ''), 10) || 0), 0) + 1).padStart(3, '0');

/* ── advances and loans: the EMI of a month ── */
const emiOf = (amount, n) => r0(Number(amount) / n);
/** The instalment a loan takes in a month (0 if none). First instalment month = loan.first_month. */
function loanInstalment(loan, month) {
  if (loan.status === 'closed' || !loan.first_month || month < loan.first_month) return 0;
  let m = loan.first_month, i = 0;
  while (m < month && i < loan.instalments) { m = nextMonth(m); i++; }
  if (m !== month || i >= loan.instalments) return 0;
  const emi = emiOf(loan.amount, loan.instalments);
  return i === loan.instalments - 1 ? Math.max(0, r0(loan.amount) - emi * (loan.instalments - 1)) : emi;
}
const loanMonths = loan => { const out = []; let m = loan.first_month; for (let i = 0; i < loan.instalments; i++) { out.push(m); m = nextMonth(m); } return out; };
function parseLoan(b) {
  b = b || {};
  try {
    if (!['advance', 'loan'].includes(b.kind)) throw new Error('Choose Advance or Loan.');
    const amount = r0(num(typeof b.amount === 'string' ? b.amount.replace(/,/g, '') : b.amount, 100, 10000000, 'The amount'));
    const instalments = Math.round(num(b.instalments, 1, 60, 'The number of instalments'));
    const given_on = String(b.given_on || '').trim(); if (!validDay(given_on)) throw new Error('Choose the date given.');
    const first_month = String(b.first_month || '').trim(); if (!validMonth(first_month)) throw new Error('Choose the first deduction month.');
    return { fields: { kind: b.kind, amount, instalments, given_on, first_month, emi: emiOf(amount, instalments), note: clean(b.note, 120) } };
  } catch (e) { return { error: e.message }; }
}
/** Amounts in words, Indian style: "Rupees Twenty Two Thousand Four Hundred Ninety Six only". */
function rupeesInWords(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  const ones = 'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' ');
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = x => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  if (n === 0) return 'Rupees Zero only';
  const out = [];
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) if (n >= div) { out.push(`${two(Math.floor(n / div))} ${name}`); n %= div; }
  if (n) out.push(three(n));
  return `Rupees ${out.join(' ')} only`;
}
module.exports = { DEFAULT_CONFIG, STATUSES, STATUS_TEXT, clean, r0, r2, validMonth, validDay, daysInMonth, dayOf, weekday, todayIST, monthName, dmy, prevMonth, nextMonth,
  loanInstalment, loanMonths, parseLoan, emiOf, parseConfig, fullConfig, templateOf, breakup, ptFor, paidSummary, computeLine, totals, parseEmployee, nextCode, rupeesInWords };
