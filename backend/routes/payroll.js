/**
 * Payroll.  Everything is under /api/payroll and needs a permission from the "Payroll" group.
 *   GET  /meta                         settings + sites + what the person may do
 *   PUT  /config                       settings (payroll.config)
 *   GET  /overview?month=              checklist and numbers for a month
 *   GET/POST /employees, PUT/DELETE-like /employees/:id (+ /left)
 *   GET  /attendance?month=            the monthly grid;  PUT /attendance  { items:[{employee_id,date,status,ot_hours,note}] }
 *   POST /attendance/mark-day          { date, site?, status }  mark everyone (not yet marked) for a day
 *   POST /months/:month/lock | unlock  (unlock needs a reason)
 *   GET  /months/:month                the payroll (computed live while open, the saved figures once finalised)
 *   PUT  /months/:month/adjustments    { employee_id, adjustments:[{kind,label,amount}] }
 *   POST /months/:month/status         { to: 'reviewed' | 'finalised' | 'paid' | 'draft', reason? }
 *   GET  /months/:month/export         Excel of the payroll
 *   GET  /payslips/:month/:employeeId  pay slip PDF       GET /payslips/:month/all  all pay slips in one PDF
 */
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm, hasPerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const P = require('../utils/payroll');
const { buildTableXlsx } = require('../utils/tableReports');

router.use(requireAuth);
const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const SETUP = 'Payroll needs a one-time database update. Run run-in-supabase-19-payroll.sql in Supabase > SQL Editor, then try again.';
const isSetup = e => !!e && /payroll_/i.test(String(e.message || '')) && (/(schema cache|does not exist|relation)/i.test(String(e.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(e.code));
const fail = (res, e, where) => (isSetup(e) || (e && /app_settings/i.test(String(e.message || '')) && /schema cache|does not exist/i.test(String(e.message))) ? res.status(503).json({ error: SETUP, setup_required: true }) : serverError(res, e, where));
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const monthOf = (req, res) => { const m = String(req.params.month || req.query.month || '').trim(); if (!P.validMonth(m)) { bad(res, 'Choose a valid month.'); return null; } return m; };
const who = req => (req.user && req.user.name) || null;

/* ── settings ── */
async function getConfig() {
  const { data, error } = await supabase.from('app_settings').select('*').eq('key', 'payroll_config').maybeSingle();
  if (error) throw error;
  return P.fullConfig(data && data.value);
}
async function saveConfig(cfg, user) {
  const row = { key: 'payroll_config', value: cfg, updated_at: new Date().toISOString(), updated_by_name: user && user.name };
  const { data: have, error: g } = await supabase.from('app_settings').select('key').eq('key', 'payroll_config').maybeSingle();
  if (g) throw g;
  const { error } = have ? await supabase.from('app_settings').update(row).eq('key', 'payroll_config') : await supabase.from('app_settings').insert(row);
  if (error) throw error;
}

/* ── data loaders ── */
async function allEmployees() {
  const { data, error } = await supabase.from('payroll_employees').select('*').order('emp_code', { ascending: true }).limit(5000);
  if (error) throw error;
  return data || [];
}
/** Pages through attendance of a month (Supabase returns at most 1000 rows per request). */
async function attendanceOf(month) {
  const from = P.dayOf(month, 1), to = P.dayOf(month, P.daysInMonth(month)), out = [];
  for (let off = 0; off < 50000; off += 1000) {
    const { data, error } = await supabase.from('payroll_attendance').select('employee_id, att_date, status, ot_hours, note').gte('att_date', from).lte('att_date', to).order('att_date', { ascending: true }).range(off, off + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const recsByEmp = rows => { const m = {}; rows.forEach(r => { (m[r.employee_id] = m[r.employee_id] || {})[String(r.att_date).slice(0, 10)] = { s: r.status, ot: Number(r.ot_hours) || 0, note: r.note || '' }; }); return m; };
async function monthRow(month) {
  const { data, error } = await supabase.from('payroll_months').select('*').eq('month', month).maybeSingle();
  if (error) throw error;
  return data || { month, status: 'draft', attendance_locked: false };
}
async function ensureMonth(month) {
  const { data, error } = await supabase.from('payroll_months').select('month').eq('month', month).maybeSingle();
  if (error) throw error;
  if (!data) { const { error: e2 } = await supabase.from('payroll_months').insert({ month, status: 'draft', attendance_locked: false }); if (e2 && e2.code !== '23505') throw e2; }
}
async function linesOf(month) {
  const { data, error } = await supabase.from('payroll_lines').select('*').eq('month', month).limit(5000);
  if (error) throw error;
  return data || [];
}
/** Employees who belong in a month's payroll: joined by its last day and not gone before its first day. */
const inMonth = (e, month) => String(e.joined_on).slice(0, 10) <= P.dayOf(month, P.daysInMonth(month)) && (!e.left_on || String(e.left_on).slice(0, 10) >= P.dayOf(month, 1));

/** The payroll of a month: while open it is worked out now; once finalised the saved figures are shown. */
async function loansOf() {
  const { data, error } = await supabase.from('payroll_loans').select('*').limit(5000);
  if (error) { if (isSetup(error)) return []; throw error; }       // before SQL 20 is run there are simply no loans
  return (data || []).map(l => ({ ...l, amount: Number(l.amount), emi: Number(l.emi) }));
}
async function payrollOf(month) {
  const [cfg, mrow, emps, att, lines, loans] = await Promise.all([getConfig(), monthRow(month), allEmployees(), attendanceOf(month), linesOf(month), loansOf()]);
  const recs = recsByEmp(att), byEmp = {}; lines.forEach(l => { byEmp[l.employee_id] = l; });
  const frozen = mrow.status === 'finalised' || mrow.status === 'paid';
  const out = [];
  for (const e of emps) {
    const l = byEmp[e.id];
    if (frozen) { if (l && l.data) out.push({ ...l.data, payslip_at: l.payslip_at || null, shared_at: l.shared_at || null }); continue; }
    if (!inMonth(e, month)) continue;
    const auto = loans.filter(x => x.employee_id === e.id).map(x => ({ kind: 'deduction', label: `${x.kind === 'loan' ? 'Loan' : 'Advance'} instalment`, amount: P.loanInstalment(x, month), auto: true })).filter(a => a.amount > 0);
    out.push({ ...P.computeLine(e, month, recs[e.id] || {}, ((l && l.adjustments) || []).concat(auto), cfg), payslip_at: l && l.payslip_at || null, shared_at: l && l.shared_at || null });
  }
  return { cfg, month: mrow, lines: out, totals: P.totals(out) };
}

/* ── meta / config ── */
router.get('/meta', requirePerm('payroll.view'), async (req, res) => {
  try {
    const [cfg, sites] = await Promise.all([getConfig(), supabase.from('sites').select('name').order('name', { ascending: true }).limit(500)]);
    res.json({ success: true, config: cfg, sites: ((sites.data) || []).map(s => s.name).filter(Boolean), can: { attendance: hasPerm(req, 'payroll.attendance'), employees: hasPerm(req, 'payroll.employees'), run: hasPerm(req, 'payroll.run'), config: hasPerm(req, 'payroll.config') }, today: P.todayIST() });
  } catch (e) { fail(res, e, 'GET /payroll/meta'); }
});
router.put('/config', requirePerm('payroll.config'), async (req, res) => {
  try {
    const cur = await getConfig(), p = P.parseConfig(req.body, cur);
    if (p.error) return bad(res, p.error);
    await saveConfig(p.config, req.user);
    await logActivity(req, { category: 'payroll', action: 'payroll_config', entityType: 'payroll', entityLabel: 'Payroll configuration' });
    res.json({ success: true, config: p.config });
  } catch (e) { fail(res, e, 'PUT /payroll/config'); }
});

/* ── employees ── */
router.get('/employees', requirePerm('payroll.view'), async (req, res) => {
  try {
    const [cfg, list] = await Promise.all([getConfig(), allEmployees()]);
    const showPay = hasPerm(req, 'payroll.employees') || hasPerm(req, 'payroll.run');
    res.json({ success: true, employees: list.map(e => ({ ...e, ...(showPay ? { breakup: P.breakup(Number(e.monthly_ctc), e, cfg) } : { monthly_ctc: null }) })), next_code: P.nextCode(list) });
  } catch (e) { fail(res, e, 'GET /payroll/employees'); }
});
router.post('/employees', requirePerm('payroll.employees'), async (req, res) => {
  try {
    const cfg = await getConfig(), p = P.parseEmployee(req.body, cfg);
    if (p.error) return bad(res, p.error);
    const list = await allEmployees();
    let row, last;
    for (let i = 0; i < 4; i++) {
      const code = i === 0 && req.body.emp_code ? P.clean(req.body.emp_code, 12).toUpperCase() : P.nextCode(list.concat(i ? [{ emp_code: last }] : []));
      if (!/^[A-Z0-9-]{1,12}$/.test(code)) return bad(res, 'The employee ID can have letters, digits and dashes only.');
      if (list.some(e => e.emp_code === code)) { if (i === 0 && req.body.emp_code) return bad(res, `The employee ID ${code} is already used.`); last = code; continue; }
      const { data, error } = await supabase.from('payroll_employees').insert({ ...p.fields, emp_code: code, created_by_name: who(req) }).select().single();
      if (error && error.code === '23505') { last = code; continue; }
      if (error) throw error;
      row = data; break;
    }
    if (!row) return bad(res, 'Could not choose an employee ID. Try again.', 409);
    await logActivity(req, { category: 'payroll', action: 'employee_added', entityType: 'payroll_employee', entityId: row.id, entityLabel: `${row.emp_code} ${row.name}` });
    res.status(201).json({ success: true, employee: row });
  } catch (e) { fail(res, e, 'POST /payroll/employees'); }
});
router.put('/employees/:id', requirePerm('payroll.employees'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return bad(res, 'Unknown employee.', 404);
    const reason = cleanReason(req.body.reason), rerr = reasonError(reason); if (rerr) return bad(res, rerr);
    const { data: old, error: e0 } = await supabase.from('payroll_employees').select('*').eq('id', req.params.id).maybeSingle();
    if (e0) throw e0; if (!old) return bad(res, 'Employee not found.', 404);
    const cfg = await getConfig(), p = P.parseEmployee({ ...old, ...req.body }, cfg);
    if (p.error) return bad(res, p.error);
    const changes = Object.keys(p.fields).filter(k => String(old[k] == null ? '' : old[k]) !== String(p.fields[k] == null ? '' : p.fields[k])).map(k => ({ field: k, from: old[k] == null ? '' : String(old[k]), to: p.fields[k] == null ? '' : String(p.fields[k]) }));
    if (!changes.length) return res.json({ success: true, employee: old, unchanged: true });
    const { data, error } = await supabase.from('payroll_employees').update({ ...p.fields, updated_by_name: who(req), updated_at: new Date().toISOString() }).eq('id', old.id).select().single();
    if (error) throw error;
    const action = changes.some(c => c.field === 'monthly_ctc') ? 'employee_ctc_changed' : 'employee_edited';
    await logActivity(req, { category: 'payroll', action, entityType: 'payroll_employee', entityId: old.id, entityLabel: `${old.emp_code} ${old.name}`, reason, changes: changes.map(c => (c.field === 'monthly_ctc' || /^(bank|ifsc|pan|uan|esi)/.test(c.field) ? { ...c, from: c.field === 'monthly_ctc' ? c.from : '(changed)', to: c.field === 'monthly_ctc' ? c.to : '(changed)' } : c)) });
    res.json({ success: true, employee: data });
  } catch (e) { fail(res, e, 'PUT /payroll/employees/:id'); }
});

/* ── attendance ── */
const lockedMsg = m => `Attendance for ${P.monthName(m)} is locked. Unlock the month first.`;
router.get('/attendance', requirePerm('payroll.view'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const [cfg, mrow, emps, att] = await Promise.all([getConfig(), monthRow(month), allEmployees(), attendanceOf(month)]);
    const recs = recsByEmp(att);
    const rows = emps.filter(e => inMonth(e, month)).map(e => {
      const s = P.paidSummary(e, month, recs[e.id] || {}, cfg);
      return { id: e.id, emp_code: e.emp_code, name: e.name, designation: e.designation, site: e.site, joined_on: String(e.joined_on).slice(0, 10), left_on: e.left_on, days: recs[e.id] || {}, summary: s };
    });
    res.json({ success: true, month, days: P.daysInMonth(month), weekly_off: cfg.weekly_off, holidays: cfg.holidays.filter(h => h.date.slice(0, 7) === month), locked: !!mrow.attendance_locked, status: mrow.status, rows });
  } catch (e) { fail(res, e, 'GET /payroll/attendance'); }
});
async function writeAttendance(req, items, month) {
  const emps = await allEmployees(), byId = {}; emps.forEach(e => { byId[e.id] = e; });
  const up = [], del = [];
  for (const it of items) {
    const e = byId[it && it.employee_id]; if (!e) throw Object.assign(new Error('Unknown employee.'), { user: true });
    const date = String(it.date || ''); if (!P.validDay(date) || date.slice(0, 7) !== month) throw Object.assign(new Error('A date is outside the month.'), { user: true });
    if (date < String(e.joined_on).slice(0, 10) || (e.left_on && date > String(e.left_on).slice(0, 10))) throw Object.assign(new Error(`${e.name} was not employed on ${P.dmy(date)}.`), { user: true });
    if (it.status === '' || it.status === null) { del.push({ employee_id: e.id, att_date: date }); continue; }
    if (!P.STATUSES.includes(it.status)) throw Object.assign(new Error('Unknown attendance status.'), { user: true });
    const ot = it.ot_hours === undefined || it.ot_hours === '' ? 0 : Number(it.ot_hours);
    if (!Number.isFinite(ot) || ot < 0 || ot > 24) throw Object.assign(new Error('Overtime hours must be from 0 to 24.'), { user: true });
    up.push({ employee_id: e.id, att_date: date, status: it.status, ot_hours: ot, note: P.clean(it.note, 120), marked_by_name: who(req), updated_at: new Date().toISOString() });
  }
  if (up.length) { const { error } = await supabase.from('payroll_attendance').upsert(up, { onConflict: 'employee_id,att_date' }); if (error) throw error; }
  for (const d of del) { const { error } = await supabase.from('payroll_attendance').delete().eq('employee_id', d.employee_id).eq('att_date', d.att_date); if (error) throw error; }
  return up.length + del.length;
}
async function guardOpen(req, res, month) {
  const m = await monthRow(month);
  if (m.attendance_locked || m.status === 'finalised' || m.status === 'paid') { bad(res, lockedMsg(month), 409); return false; }
  return true;
}
router.put('/attendance', requirePerm('payroll.attendance'), async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!items.length || items.length > 3000) return bad(res, 'Nothing to save.');
    const month = String(items[0].date || '').slice(0, 7); if (!P.validMonth(month)) return bad(res, 'A date is not valid.');
    if (!(await guardOpen(req, res, month))) return;
    const n = await writeAttendance(req, items, month);
    await logActivity(req, { category: 'payroll', action: 'attendance_saved', entityType: 'payroll', entityLabel: `Attendance ${P.monthName(month)} (${n} change${n === 1 ? '' : 's'})` });
    res.json({ success: true, saved: n });
  } catch (e) { if (e.user) return bad(res, e.message); fail(res, e, 'PUT /payroll/attendance'); }
});
router.post('/attendance/mark-day', requirePerm('payroll.attendance'), async (req, res) => {
  try {
    const date = String(req.body.date || ''), status = String(req.body.status || 'P');
    if (!P.validDay(date)) return bad(res, 'Choose a valid date.'); if (!P.STATUSES.includes(status)) return bad(res, 'Unknown attendance status.');
    const month = date.slice(0, 7); if (!(await guardOpen(req, res, month))) return;
    const site = P.clean(req.body.site, 80);
    const emps = (await allEmployees()).filter(e => e.status === 'active' || (e.left_on && date <= String(e.left_on).slice(0, 10)));
    const have = new Set((await attendanceOf(month)).filter(r => String(r.att_date).slice(0, 10) === date).map(r => r.employee_id));
    const items = emps.filter(e => String(e.joined_on).slice(0, 10) <= date && (!site || e.site === site) && !have.has(e.id)).map(e => ({ employee_id: e.id, date, status }));
    const n = items.length ? await writeAttendance(req, items, month) : 0;
    await logActivity(req, { category: 'payroll', action: 'attendance_saved', entityType: 'payroll', entityLabel: `Marked ${P.dmy(date)} ${P.STATUS_TEXT[status]} for ${n} employee${n === 1 ? '' : 's'}${site ? ' at ' + site : ''}` });
    res.json({ success: true, saved: n });
  } catch (e) { if (e.user) return bad(res, e.message); fail(res, e, 'POST /payroll/attendance/mark-day'); }
});
router.post('/months/:month/lock', requirePerm('payroll.attendance'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return; await ensureMonth(month);
    const { error } = await supabase.from('payroll_months').update({ attendance_locked: true, updated_at: new Date().toISOString() }).eq('month', month); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'attendance_locked', entityType: 'payroll', entityLabel: `Attendance ${P.monthName(month)} locked` });
    res.json({ success: true });
  } catch (e) { fail(res, e, 'POST lock'); }
});
router.post('/months/:month/unlock', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const reason = cleanReason(req.body.reason), rerr = reasonError(reason); if (rerr) return bad(res, rerr);
    const m = await monthRow(month); if (m.status === 'finalised' || m.status === 'paid') return bad(res, 'This month is finalised. Reopen the payroll first.', 409);
    await ensureMonth(month);
    const { error } = await supabase.from('payroll_months').update({ attendance_locked: false, updated_at: new Date().toISOString() }).eq('month', month); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'attendance_unlocked', entityType: 'payroll', entityLabel: `Attendance ${P.monthName(month)} unlocked`, reason });
    res.json({ success: true });
  } catch (e) { fail(res, e, 'POST unlock'); }
});

/* ── monthly payroll ── */
router.get('/months/:month', requirePerm('payroll.run'), async (req, res) => {
  try { const month = monthOf(req, res); if (!month) return; res.json({ success: true, month_info: undefined, ...(await payrollOf(month)) }); } catch (e) { fail(res, e, 'GET /payroll/months/:month'); }
});
router.put('/months/:month/adjustments', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const m = await monthRow(month); if (m.status === 'finalised' || m.status === 'paid') return bad(res, 'This month is finalised. Reopen it to make changes.', 409);
    const id = req.body.employee_id; if (!ID_RE.test(String(id))) return bad(res, 'Unknown employee.');
    const list = Array.isArray(req.body.adjustments) ? req.body.adjustments : []; if (list.length > 20) return bad(res, 'Too many lines.');
    const adj = [];
    for (const a of list.filter(x => !(x && x.auto))) {
      if (!['earning', 'deduction'].includes(a.kind)) return bad(res, 'Choose earning or deduction.');
      const amt = Number(a.amount); if (!Number.isFinite(amt) || amt <= 0 || amt > 10000000) return bad(res, 'Each amount must be more than 0.');
      const label = P.clean(a.label, 60); if (!label) return bad(res, 'Give every line a name (for example Advance).');
      adj.push({ kind: a.kind, label, amount: P.r0(amt) });
    }
    const { data: emp } = await supabase.from('payroll_employees').select('id').eq('id', id).maybeSingle(); if (!emp) return bad(res, 'Employee not found.', 404);
    await ensureMonth(month);
    const { error } = await supabase.from('payroll_lines').upsert({ month, employee_id: id, adjustments: adj }, { onConflict: 'month,employee_id' }); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'payroll_adjusted', entityType: 'payroll', entityLabel: `${P.monthName(month)} - ${adj.length} line${adj.length === 1 ? '' : 's'} for one employee` });
    res.json({ success: true, ...(await payrollOf(month)) });
  } catch (e) { fail(res, e, 'PUT adjustments'); }
});
const FLOW = { draft: ['reviewed'], reviewed: ['finalised', 'draft'], finalised: ['paid', 'draft'], paid: ['draft'] };
const PAY_MODES = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque' };
router.post('/months/:month/status', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const to = String(req.body.to || ''), cur = await monthRow(month), now = new Date().toISOString();
    if (!(FLOW[cur.status] || []).includes(to)) return bad(res, `A ${cur.status} payroll cannot be moved to ${to}.`, 409);
    let reason = null;
    if (to === 'draft') { reason = cleanReason(req.body.reason); const re = reasonError(reason); if (re) return bad(res, re); if (cur.status === 'paid' && !hasPerm(req, 'payroll.config')) return bad(res, 'Only the Admin can reopen a month that is already paid.', 403); }
    await ensureMonth(month);
    const patch = { status: to, updated_at: now };
    if (to === 'finalised') {
      const pr = await payrollOf(month);
      if (!pr.lines.length) return bad(res, 'There are no employees in this month.');
      for (const l of pr.lines) { const { error } = await supabase.from('payroll_lines').upsert({ month, employee_id: l.employee_id, data: l, adjustments: l.adjustments.filter(a => !a.auto) }, { onConflict: 'month,employee_id' }); if (error) throw error; }
      Object.assign(patch, { attendance_locked: true, finalised_by_name: who(req), finalised_at: now });
    } else if (to === 'draft') {
      const { error } = await supabase.from('payroll_lines').update({ data: null, payslip_at: null, shared_at: null }).eq('month', month); if (error) throw error;
      Object.assign(patch, { attendance_locked: false, finalised_by_name: null, finalised_at: null, paid_by_name: null, paid_at: null, paid_on: null, pay_mode: null, pay_ref: null, pay_remarks: null });
    } else if (to === 'paid') {
      const paid_on = String(req.body.paid_on || P.todayIST()).trim(); if (!P.validDay(paid_on)) return bad(res, 'Choose the date paid.');
      const pay_mode = String(req.body.pay_mode || 'bank'); if (!PAY_MODES[pay_mode]) return bad(res, 'Choose how it was paid.');
      Object.assign(patch, { paid_by_name: who(req), paid_at: now, paid_on, pay_mode, pay_ref: P.clean(req.body.pay_ref, 40), pay_remarks: P.clean(req.body.pay_remarks, 120) });
    }
    const { error } = await supabase.from('payroll_months').update(patch).eq('month', month); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'payroll_' + (to === 'draft' ? 'reopened' : to), entityType: 'payroll', entityLabel: `Payroll ${P.monthName(month)}`, reason });
    res.json({ success: true, ...(await payrollOf(month)) });
  } catch (e) { fail(res, e, 'POST status'); }
});

/* ── overview ── */
router.get('/overview', requirePerm('payroll.view'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const [cfg, mrow, emps, att] = await Promise.all([getConfig(), monthRow(month), allEmployees(), attendanceOf(month)]);
    const recs = recsByEmp(att), active = emps.filter(e => inMonth(e, month));
    const sums = active.map(e => ({ e, s: P.paidSummary(e, month, recs[e.id] || {}, cfg) }));
    const attention = [];
    const unmarked = sums.filter(x => x.s.unmarked); if (unmarked.length) attention.push({ kind: 'unmarked', text: `${unmarked.length} employee${unmarked.length === 1 ? ' has' : 's have'} days not marked`, names: unmarked.slice(0, 6).map(x => x.e.name) });
    const nobank = active.filter(e => !e.bank_account); if (nobank.length) attention.push({ kind: 'bank', text: `${nobank.length} employee${nobank.length === 1 ? '' : 's'} without bank details`, names: nobank.slice(0, 6).map(x => x.name) });
    const noid = active.filter(e => e.pf_applicable && !e.uan); if (noid.length && cfg.pf.on) attention.push({ kind: 'uan', text: `${noid.length} employee${noid.length === 1 ? '' : 's'} with PF but no UAN`, names: noid.slice(0, 6).map(x => x.name) });
    let totals = null;
    if (hasPerm(req, 'payroll.run')) totals = (await payrollOf(month)).totals;
    const markedDays = att.length;
    res.json({ success: true, month, status: mrow.status, locked: !!mrow.attendance_locked, employees: active.length, onboarded: emps.length, attendance_marked: markedDays, attendance_complete: active.length > 0 && !unmarked.length, totals, attention, paid_at: mrow.paid_at, finalised_at: mrow.finalised_at });
  } catch (e) { fail(res, e, 'GET /payroll/overview'); }
});

/* ── Excel export ── */
router.get('/months/:month/export', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const pr = await payrollOf(month);
    const rows = pr.lines.map(l => ({ code: l.emp_code, name: l.name, desig: l.designation, site: l.site, ctc: l.monthly_ctc, paid: l.paid_days, basic: l.basic, hra: l.hra, special: l.special, ot: l.ot_pay, other_e: l.other_earnings, gross: l.total_earnings, pf: l.pf, esi: l.esi, pt: l.pt, other_d: l.other_deductions, net: l.net, bank: l.bank_name, acc: l.bank_account, ifsc: l.ifsc }));
    const t = pr.totals; rows.push({ _kind: 'total', name: 'TOTAL', gross: t.gross, pf: t.pf, esi: t.esi, pt: t.pt, other_d: t.other, net: t.net, ctc: t.ctc });
    const columns = [['code', 'Emp ID', 9], ['name', 'Name', 22], ['desig', 'Designation', 18], ['site', 'Site', 16], ['ctc', 'Monthly CTC', 13, 1], ['paid', 'Paid days', 10, 1], ['basic', 'Basic', 11, 1], ['hra', 'HRA', 11, 1], ['special', 'Special allow.', 13, 1], ['ot', 'Overtime', 11, 1], ['other_e', 'Other earn.', 11, 1], ['gross', 'Gross pay', 12, 1], ['pf', 'PF', 10, 1], ['esi', 'ESI', 10, 1], ['pt', 'PT', 9, 1], ['other_d', 'Other ded.', 11, 1], ['net', 'Net pay', 12, 1], ['bank', 'Bank', 18], ['acc', 'Account no.', 18], ['ifsc', 'IFSC', 13]]
      .map(([key, header, width, right]) => ({ key, header, width, weight: width, ...(right ? { align: 'right', numFmt: key === 'paid' ? '0.0' : '#,##0', fmt: n => (key === 'paid' ? String(n) : Number(n).toLocaleString('en-IN')) } : {}) }));
    const buf = await buildTableXlsx({ sheetName: 'Payroll', title: `Payroll ${P.monthName(month)}`, columns, rows, meta: { user: who(req) || '', subtitle: `${P.monthName(month)} - ${pr.month.status}` } });
    await logActivity(req, { category: 'payroll', action: 'payroll_exported', entityType: 'payroll', entityLabel: `Payroll ${P.monthName(month)} exported` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Payroll-${month}.xlsx"`);
    res.send(Buffer.from(buf));
  } catch (e) { fail(res, e, 'GET export'); }
});

/* ── pay slips ── */
router.get('/payslips/:month', requirePerm('payroll.payslips'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const pr = await payrollOf(month);
    res.json({ success: true, month: pr.month, lines: pr.lines, can_generate: pr.month.status === 'finalised' || pr.month.status === 'paid', company: { name: pr.cfg.company_name, address: pr.cfg.slip.address } });
  } catch (e) { fail(res, e, 'GET payslips'); }
});
router.get('/payslips/:month/:id.pdf', requirePerm('payroll.payslips'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const pr = await payrollOf(month);
    if (!(pr.month.status === 'finalised' || pr.month.status === 'paid')) return bad(res, 'Pay slips are made after the payroll is finalised.', 409);
    const lines = req.params.id === 'all' ? pr.lines : pr.lines.filter(l => l.employee_id === req.params.id);
    if (!lines.length) return bad(res, 'Pay slip not found.', 404);
    const pdf = await require('../utils/payslipPdf').build(lines, month, pr.cfg);
    const now = new Date().toISOString();
    for (const l of lines) await supabase.from('payroll_lines').update({ payslip_at: now }).eq('month', month).eq('employee_id', l.employee_id);
    await logActivity(req, { category: 'payroll', action: 'payslip_generated', entityType: 'payroll', entityLabel: req.params.id === 'all' ? `All pay slips ${P.monthName(month)} (${lines.length})` : `Pay slip ${lines[0].name} ${P.monthName(month)}` });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id === 'all' ? `PaySlips-${month}` : `PaySlip-${lines[0].emp_code}-${month}`}.pdf"`);
    res.send(pdf);
  } catch (e) { fail(res, e, 'GET payslip pdf'); }
});

/* ── month controls (Admin: payroll.config) ── */
router.get('/months', requirePerm('payroll.config'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('payroll_months').select('*').limit(500); if (error) throw error;
    const by = {}; (data || []).forEach(m => { by[m.month] = m; });
    const out = []; let m = P.todayIST().slice(0, 7);
    for (let i = 0; i < 14; i++) { const r = by[m] || { month: m, status: 'draft', attendance_locked: false }; out.push({ month: m, status: r.status || 'draft', attendance_locked: !!r.attendance_locked, finalised_by_name: r.finalised_by_name || null, finalised_at: r.finalised_at || null, paid_at: r.paid_at || null, paid_on: r.paid_on || null }); m = P.prevMonth(m); }
    res.json({ success: true, months: out });
  } catch (e) { fail(res, e, 'GET /payroll/months'); }
});

/* ── advances and loans ── */
router.get('/loans', requirePerm('payroll.run'), async (req, res) => {
  try {
    const [loans, emps, mrows] = await Promise.all([loansOf(), allEmployees(), supabase.from('payroll_months').select('month,status').limit(500)]);
    const done = new Set(((mrows.data) || []).filter(x => x.status === 'finalised' || x.status === 'paid').map(x => x.month));
    const name = {}; emps.forEach(e => { name[e.id] = e.name; });
    const cur = P.todayIST().slice(0, 7);
    const out = loans.sort((a, b) => (a.given_on < b.given_on ? 1 : -1)).map(l => {
      const ms = P.loanMonths(l), paid = ms.filter(x => done.has(x)), paidAmt = paid.reduce((t, x) => t + P.loanInstalment(l, x), 0);
      const next = l.status === 'closed' ? null : ms.find(x => !done.has(x)) || null;
      const balance = l.status === 'closed' ? 0 : Math.max(0, l.amount - paidAmt);
      return { id: l.id, employee_id: l.employee_id, employee: name[l.employee_id] || '', kind: l.kind, amount: l.amount, emi: l.emi, instalments: l.instalments, given_on: String(l.given_on).slice(0, 10), first_month: l.first_month, paid_count: paid.length, balance, next_month: next, this_month: l.status === 'active' ? P.loanInstalment(l, cur) : 0, status: l.status === 'closed' || balance === 0 ? 'closed' : 'active', note: l.note, closed_reason: l.closed_reason || null };
    });
    res.json({ success: true, loans: out, outstanding: out.reduce((t, l) => t + l.balance, 0), this_month: out.reduce((t, l) => t + l.this_month, 0), employees: emps.filter(e => e.status === 'active').map(e => ({ id: e.id, name: e.name, emp_code: e.emp_code })) });
  } catch (e) { fail(res, e, 'GET /payroll/loans'); }
});
router.post('/loans', requirePerm('payroll.run'), async (req, res) => {
  try {
    const p = P.parseLoan(req.body); if (p.error) return bad(res, p.error);
    const id = req.body.employee_id; if (!ID_RE.test(String(id))) return bad(res, 'Choose the employee.');
    const { data: emp } = await supabase.from('payroll_employees').select('id,name').eq('id', id).maybeSingle(); if (!emp) return bad(res, 'Employee not found.', 404);
    const frozen = (await monthRow(p.fields.first_month)).status; if (frozen === 'finalised' || frozen === 'paid') return bad(res, `${P.monthName(p.fields.first_month)} is already finalised. Choose a later first deduction month.`);
    const { data, error } = await supabase.from('payroll_loans').insert({ ...p.fields, employee_id: id, created_by_name: who(req) }).select().single(); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'loan_added', entityType: 'payroll_loan', entityId: data.id, entityLabel: `${emp.name} ${p.fields.kind} ${p.fields.amount} in ${p.fields.instalments}` });
    res.status(201).json({ success: true, loan: data });
  } catch (e) { fail(res, e, 'POST /payroll/loans'); }
});
router.post('/loans/:id/close', requirePerm('payroll.run'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return bad(res, 'Unknown entry.', 404);
    const reason = cleanReason(req.body.reason), rerr = reasonError(reason); if (rerr) return bad(res, rerr);
    const { error } = await supabase.from('payroll_loans').update({ status: 'closed', closed_reason: reason }).eq('id', req.params.id); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'loan_closed', entityType: 'payroll_loan', entityId: req.params.id, entityLabel: 'Advance / loan closed', reason });
    res.json({ success: true });
  } catch (e) { fail(res, e, 'POST loan close'); }
});

/* ── bank transfer file (CSV) ── */
const csv = v => { const s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' '); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
router.get('/months/:month/bank-file', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const pr = await payrollOf(month);
    if (!(pr.month.status === 'finalised' || pr.month.status === 'paid')) return bad(res, 'Finalise the payroll first.', 409);
    const ok = pr.lines.filter(l => l.bank_account && l.net > 0);
    const text = ['Beneficiary name,Account number,IFSC,Amount,Narration'].concat(ok.map(l => [l.name, l.bank_account, l.ifsc, l.net, `Salary ${P.monthName(month)}`].map(csv).join(','))).join('\r\n') + '\r\n';
    await logActivity(req, { category: 'payroll', action: 'payroll_exported', entityType: 'payroll', entityLabel: `Bank file ${P.monthName(month)} (${ok.length})` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="Bank-transfer-${month}.csv"`);
    res.setHeader('X-Skipped', String(pr.lines.length - ok.length)); res.send('﻿' + text);
  } catch (e) { fail(res, e, 'GET bank-file'); }
});

/* ── pay slip shared on WhatsApp ── */
router.post('/payslips/:month/:id/shared', requirePerm('payroll.payslips'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return; if (!ID_RE.test(req.params.id)) return bad(res, 'Unknown employee.', 404);
    const { data: ln } = await supabase.from('payroll_lines').select('data').eq('month', month).eq('employee_id', req.params.id).maybeSingle();
    if (!ln || !ln.data) return bad(res, 'This pay slip is not ready.', 409);
    const { error } = await supabase.from('payroll_lines').update({ shared_at: new Date().toISOString(), payslip_at: new Date().toISOString() }).eq('month', month).eq('employee_id', req.params.id); if (error) throw error;
    await logActivity(req, { category: 'payroll', action: 'payslip_shared', entityType: 'payroll', entityLabel: `Pay slip ${ln.data.name} ${P.monthName(month)} shared on WhatsApp` });
    res.json({ success: true });
  } catch (e) { fail(res, e, 'POST shared'); }
});

/* ── attendance Excel: export and import ── */
const EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
router.get('/attendance/export', requirePerm('payroll.view'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const [cfg, emps, att] = await Promise.all([getConfig(), allEmployees(), attendanceOf(month)]);
    const recs = recsByEmp(att), dim = P.daysInMonth(month), blank = req.query.blank === '1';
    const columns = [{ key: 'code', header: 'Emp ID', width: 9, weight: 9 }, { key: 'name', header: 'Name', width: 24, weight: 24 }];
    for (let d = 1; d <= dim; d++) columns.push({ key: 'd' + d, header: String(d), width: 5, weight: 5, align: 'center' });
    const rows = emps.filter(e => inMonth(e, month)).map(e => { const r = { code: e.emp_code, name: e.name }; for (let d = 1; d <= dim; d++) { const k = recs[e.id] && recs[e.id][P.dayOf(month, d)]; r['d' + d] = blank ? '' : (k ? k.s : ''); } return r; });
    const buf = await buildTableXlsx({ sheetName: 'Attendance', title: `Attendance ${P.monthName(month)}`, columns, rows, meta: { user: who(req) || '', subtitle: 'P present · A absent · H half day · L paid leave · W weekly off. Fill the day boxes and import this file again.' } });
    res.setHeader('Content-Type', EXCEL); res.setHeader('Content-Disposition', `attachment; filename="Attendance-${month}${blank ? '-template' : ''}.xlsx"`); res.send(Buffer.from(buf));
  } catch (e) { fail(res, e, 'GET attendance/export'); }
});
router.post('/attendance/import', requirePerm('payroll.attendance'), async (req, res) => {
  try {
    const month = String(req.body.month || ''); if (!P.validMonth(month)) return bad(res, 'Choose a valid month.');
    if (!(await guardOpen(req, res, month))) return;
    let buf; try { buf = Buffer.from(String(req.body.file || ''), 'base64'); } catch { buf = null; }
    if (!buf || buf.length < 100 || buf.slice(0, 2).toString() !== 'PK') return bad(res, 'Choose an Excel (.xlsx) file.');
    const ExcelJS = require('../utils/reports').lib('exceljs'), wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch { return bad(res, 'That file could not be read as an Excel workbook.'); }
    const ws = wb.worksheets[0]; if (!ws) return bad(res, 'The workbook is empty.');
    let hr = 0, idCol = 0; const dayCol = {};
    ws.eachRow((row, n) => { if (hr) return; row.eachCell((c, ci) => { if (String(c.value).trim().toLowerCase() === 'emp id') { hr = n; idCol = ci; } }); });
    if (!hr) return bad(res, 'The file has no "Emp ID" column. Download the template and fill that.');
    ws.getRow(hr).eachCell((c, ci) => { const d = Number(c.value); if (Number.isInteger(d) && d >= 1 && d <= P.daysInMonth(month)) dayCol[d] = ci; });
    if (!Object.keys(dayCol).length) return bad(res, 'The day columns (1, 2, 3 …) were not found.');
    const emps = await allEmployees(), byCode = {}; emps.forEach(e => { byCode[String(e.emp_code).toUpperCase()] = e; });
    const recs = recsByEmp(await attendanceOf(month)), items = [], problems = []; let same = 0;
    ws.eachRow((row, n) => {
      if (n <= hr) return;
      const code = String(row.getCell(idCol).value == null ? '' : row.getCell(idCol).value).trim().toUpperCase(); if (!code) return;
      const e = byCode[code]; if (!e) { problems.push(`Row ${n}: no employee with ID ${code}.`); return; }
      for (const d of Object.keys(dayCol)) {
        const raw = row.getCell(dayCol[d]).value; const v = String(raw == null ? '' : (raw.result !== undefined ? raw.result : raw)).trim().toUpperCase(); if (!v) continue;
        const date = P.dayOf(month, d);
        if (!P.STATUSES.includes(v)) { problems.push(`${e.name}, day ${d}: "${v}" is not P, A, H, L or W.`); continue; }
        if (date < String(e.joined_on).slice(0, 10) || (e.left_on && date > String(e.left_on).slice(0, 10))) { problems.push(`${e.name}, day ${d}: not employed on that day.`); continue; }
        const old = recs[e.id] && recs[e.id][date];
        if (old && old.s === v) { same++; continue; }
        items.push({ employee_id: e.id, date, status: v, ot_hours: old ? old.ot : 0, note: old ? old.note : '' });
      }
    });
    if (req.body.apply && items.length) {
      for (let i = 0; i < items.length; i += 500) await writeAttendance(req, items.slice(i, i + 500), month);
      await logActivity(req, { category: 'payroll', action: 'attendance_saved', entityType: 'payroll', entityLabel: `Attendance ${P.monthName(month)} imported from Excel (${items.length} change${items.length === 1 ? '' : 's'})` });
    }
    res.json({ success: true, applied: !!req.body.apply, changes: items.length, unchanged: same, problems: problems.slice(0, 40), problem_count: problems.length });
  } catch (e) { if (e.user) return bad(res, e.message); fail(res, e, 'POST attendance/import'); }
});

module.exports = router;
module.exports.payrollOf = payrollOf;
