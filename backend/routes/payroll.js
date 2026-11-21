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
async function payrollOf(month) {
  const [cfg, mrow, emps, att, lines] = await Promise.all([getConfig(), monthRow(month), allEmployees(), attendanceOf(month), linesOf(month)]);
  const recs = recsByEmp(att), byEmp = {}; lines.forEach(l => { byEmp[l.employee_id] = l; });
  const frozen = mrow.status === 'finalised' || mrow.status === 'paid';
  const out = [];
  for (const e of emps) {
    const l = byEmp[e.id];
    if (frozen) { if (l && l.data) out.push({ ...l.data, payslip_at: l.payslip_at || null }); continue; }
    if (!inMonth(e, month)) continue;
    out.push({ ...P.computeLine(e, month, recs[e.id] || {}, l && l.adjustments, cfg), payslip_at: l && l.payslip_at || null });
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
    res.json({ success: true, month, days: P.daysInMonth(month), weekly_off: cfg.weekly_off, locked: !!mrow.attendance_locked, status: mrow.status, rows });
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
    for (const a of list) {
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
const FLOW = { draft: ['reviewed'], reviewed: ['finalised', 'draft'], finalised: ['paid', 'draft'], paid: [] };
router.post('/months/:month/status', requirePerm('payroll.run'), async (req, res) => {
  try {
    const month = monthOf(req, res); if (!month) return;
    const to = String(req.body.to || ''), cur = await monthRow(month), now = new Date().toISOString();
    if (!(FLOW[cur.status] || []).includes(to)) return bad(res, `A ${cur.status} payroll cannot be moved to ${to}.`, 409);
    let reason = null;
    if (to === 'draft') { reason = cleanReason(req.body.reason); const re = reasonError(reason); if (re) return bad(res, re); if (cur.status === 'paid') return bad(res, 'A paid payroll cannot be reopened.', 409); }
    await ensureMonth(month);
    const patch = { status: to, updated_at: now };
    if (to === 'finalised') {
      const pr = await payrollOf(month);
      if (!pr.lines.length) return bad(res, 'There are no employees in this month.');
      for (const l of pr.lines) { const { error } = await supabase.from('payroll_lines').upsert({ month, employee_id: l.employee_id, data: l, adjustments: l.adjustments }, { onConflict: 'month,employee_id' }); if (error) throw error; }
      Object.assign(patch, { attendance_locked: true, finalised_by_name: who(req), finalised_at: now });
    } else if (to === 'draft') {
      const { error } = await supabase.from('payroll_lines').update({ data: null, payslip_at: null }).eq('month', month); if (error) throw error;
      Object.assign(patch, { finalised_by_name: null, finalised_at: null });
    } else if (to === 'paid') Object.assign(patch, { paid_by_name: who(req), paid_at: now });
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

module.exports = router;
module.exports.payrollOf = payrollOf;
