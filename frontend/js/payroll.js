/* Payroll — a full-screen workspace opened from the "Switch to Payroll" button.
   Screens: Overview · Attendance · Employee Onboarding · Monthly Payroll · Pay Slips · Payroll Configuration.
   Everything is calculated on the server; the screen only shows it (except the live "breakup" preview while onboarding). */
const PR = { open: false, view: 'overview', month: '', meta: null, cfg: null, emps: null, att: null, pay: null, slips: null, ov: null, site: '', q: '', day: '', mode: '', wiz: null, busy: false };
const PR_NAV = [['overview', 'Overview', null], ['attendance', 'Attendance', 1], ['employees', 'Employee Onboarding', 2], ['payroll', 'Monthly Payroll', 3], ['payslips', 'Pay Slips', 4], ['config', 'Payroll Configuration', 5]];
const prCan = k => PR.meta && PR.meta.can && PR.meta.can[k];
const prInr = n => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const prNum = n => Math.round(Number(n) || 0).toLocaleString('en-IN');
const prMonthName = m => { const [y, mo] = m.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][+mo - 1] + ' ' + y; };
const prShift = (m, d) => { const dt = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + d, 1)); return dt.toISOString().slice(0, 7); };
const prDim = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const prDay = (m, d) => `${m}-${String(d).padStart(2, '0')}`;
const prDow = date => new Date(date + 'T00:00:00Z').getUTCDay();
const PR_ST = { P: ['Present', 'p'], A: ['Absent', 'a'], H: ['Half day', 'h'], L: ['Paid leave', 'l'], W: ['Weekly off', 'w'] };
const PR_STATUS = { draft: 'Draft', reviewed: 'Reviewed', finalised: 'Finalised', paid: 'Paid' };
const prQ = id => document.getElementById(id);
const prErr = e => (e && e.message) || 'Something went wrong.';

function prShell() {
  let root = prQ('pr-root');
  if (root) return root;
  root = document.createElement('div'); root.id = 'pr-root'; root.className = 'pr-root'; root.hidden = true;
  root.innerHTML = `
    <header class="pr-top">
      <div class="pr-brand"><span class="pr-tag">PAYROLL</span><span class="pr-co">Sri Charan Constructions</span></div>
      <div class="pr-top-r"><span class="pr-date" id="pr-date"></span><span class="pr-who" id="pr-who"></span>
        <button type="button" class="pr-back" id="pr-back"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h13l-3-3M17 17H4l3 3"/></svg><span>Back to Site Log</span></button></div>
    </header>
    <div class="pr-body">
      <nav class="pr-nav" id="pr-nav" aria-label="Payroll sections"></nav>
      <div class="pr-main" id="pr-main" role="main" tabindex="-1"></div>
    </div>
    <div class="pr-pop" id="pr-pop" hidden></div>
    <div class="pr-modal" id="pr-modal" hidden></div>`;
  document.body.appendChild(root);
  prQ('pr-back').addEventListener('click', () => closePayroll());
  prQ('pr-nav').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) prGo(b.dataset.v); });
  document.addEventListener('click', e => { const p = prQ('pr-pop'); if (p && !p.hidden && !e.target.closest('#pr-pop') && !e.target.closest('[data-cell]')) p.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && PR.open) { if (!prQ('pr-pop').hidden) prQ('pr-pop').hidden = true; else if (!prQ('pr-modal').hidden) prModalClose(); } });
  window.addEventListener('popstate', () => { if (PR.open) closePayroll(true); });
  return root;
}

async function openPayroll() {
  if (!can('payroll.view')) return;
  const root = prShell();
  if (typeof closeMobileMenu === 'function') { try { closeMobileMenu(false); } catch { /* menu may be closed */ } }
  root.hidden = false; PR.open = true; document.body.classList.add('pr-open');
  try { history.pushState({ pr: 1 }, ''); } catch { /* ignore */ }
  const me = Auth.currentUser() || {};
  prQ('pr-who').textContent = me.name || '';
  prQ('pr-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  if (!PR.month) PR.month = today().slice(0, 7);
  prQ('pr-main').innerHTML = '<div class="pr-empty">Loading payroll…</div>';
  try { PR.meta = await Payroll.meta(); PR.cfg = PR.meta.config; } catch (e) { prQ('pr-main').innerHTML = `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  if (!PR.day) PR.day = PR.meta.today;
  prRenderNav(); prGo(PR.view || 'overview');
}
function closePayroll(fromPop) {
  if (!PR.open) return;
  PR.open = false; document.body.classList.remove('pr-open'); prQ('pr-root').hidden = true; prQ('pr-pop').hidden = true; prModalClose();
  if (!fromPop) { try { if (history.state && history.state.pr) history.back(); } catch { /* ignore */ } }
}
function prRenderNav() {
  const ok = { overview: true, attendance: true, employees: true, payroll: prCan('run'), payslips: can('payroll.payslips'), config: prCan('config') };
  prQ('pr-nav').innerHTML = PR_NAV.filter(n => ok[n[0]]).map(([k, label, n]) => `<button type="button" data-v="${k}" class="${PR.view === k ? 'on' : ''}">${n ? `<i>${n}</i>` : '<i class="h">⌂</i>'}<span>${label}</span></button>`).join('');
}
async function prGo(v) {
  PR.view = v; prRenderNav(); prQ('pr-pop').hidden = true;
  const main = prQ('pr-main'); main.innerHTML = '<div class="pr-empty">Loading…</div>'; main.scrollTop = 0;
  try { await ({ overview: prOverview, attendance: prAttendance, employees: prEmployees, payroll: prPayroll, payslips: prPayslips, config: prConfig }[v] || prOverview)(); }
  catch (e) { main.innerHTML = `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; }
}
const prMonthBar = (extra = '') => `<div class="pr-mbar"><button type="button" class="pr-ib" data-mshift="-1" aria-label="Previous month">‹</button><strong id="pr-mname">${prMonthName(PR.month)}</strong><button type="button" class="pr-ib" data-mshift="1" aria-label="Next month">›</button><input type="month" id="pr-month" value="${PR.month}" aria-label="Choose month">${extra}</div>`;
function prWireMonth() {
  const main = prQ('pr-main');
  main.querySelectorAll('[data-mshift]').forEach(b => b.addEventListener('click', () => { PR.month = prShift(PR.month, +b.dataset.mshift); PR.day = ''; prGo(PR.view); }));
  const mi = prQ('pr-month'); if (mi) mi.addEventListener('change', () => { if (/^\d{4}-\d{2}$/.test(mi.value)) { PR.month = mi.value; PR.day = ''; prGo(PR.view); } });
}
function prModal(html, wide) { const m = prQ('pr-modal'); m.innerHTML = `<div class="pr-mcard${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`; m.hidden = false; m.onclick = e => { if (e.target === m) prModalClose(); }; return m; }
function prModalClose() { const m = prQ('pr-modal'); if (m) { m.hidden = true; m.innerHTML = ''; } }
const prHead = (title, sub, actions = '') => `<div class="pr-ph"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="pr-acts">${actions}</div></div>`;
const prNote = html => `<div class="pr-warn">${html}</div>`;
function prSetup(e) { return e && e.data && e.data.setup_required ? `<div class="pr-empty pr-bad"><strong>One-time setup needed</strong><p>${esc(e.message)}</p></div>` : null; }

/* ───────────── 0. Overview ───────────── */
async function prOverview() {
  const main = prQ('pr-main');
  let o; try { o = await Payroll.overview(PR.month); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  PR.ov = o;
  const st = o.status, step = (n, label, done, view, sub) => `<button type="button" class="pr-step ${done ? 'done' : ''}" data-go="${view}"><i>${done ? '✓' : n}</i><b>${label}</b><small>${sub}</small></button>`;
  const t = o.totals;
  main.innerHTML = prHead('Payroll overview', 'Where this month stands.', '') + prMonthBar() + `
    <div class="pr-steps">
      ${step(1, 'Attendance', o.attendance_complete, 'attendance', o.attendance_complete ? 'All days marked' : `${o.attendance_marked} days marked`)}
      ${step(2, 'Monthly payroll', st !== 'draft', 'payroll', PR_STATUS[st])}
      ${step(3, 'Pay slips', st === 'finalised' || st === 'paid', 'payslips', st === 'finalised' || st === 'paid' ? 'Ready' : 'After finalising')}
      ${step(4, 'Paid', st === 'paid', 'payroll', st === 'paid' ? 'Done' : 'Not yet')}
    </div>
    <div class="pr-stats">
      <div class="pr-stat"><small>Employees this month</small><b>${o.employees}</b></div>
      ${t ? `<div class="pr-stat"><small>Gross pay</small><b>${prInr(t.gross)}</b></div><div class="pr-stat"><small>Deductions</small><b>${prInr(t.deductions)}</b></div><div class="pr-stat hl"><small>Net payable</small><b>${prInr(t.net)}</b></div>` : '<div class="pr-stat"><small>Salary figures</small><b>—</b></div>'}
    </div>
    <div class="card pr-card"><div class="pr-ct">Needs attention</div>${o.attention.length ? o.attention.map(a => `<div class="pr-att"><b>${esc(a.text)}</b><span>${esc(a.names.join(', '))}${a.names.length < 1 ? '' : ''}</span></div>`).join('') : '<p class="pr-muted">Nothing needs attention.</p>'}</div>
    ${o.employees ? '' : `<div class="pr-warn">No employees yet. Start with <b>Employee Onboarding</b> to add people and their monthly CTC.</div>`}`;
  prWireMonth(); main.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => prGo(b.dataset.go)));
}

/* ───────────── 1. Attendance ───────────── */
const prMobile = () => window.matchMedia('(max-width: 760px)').matches;
async function prAttendance() {
  const main = prQ('pr-main');
  let a; try { a = await Payroll.attendance(PR.month); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  PR.att = a; if (!PR.mode) PR.mode = prMobile() ? 'day' : 'grid';
  const sites = [...new Set(a.rows.map(r => r.site).filter(Boolean))].sort();
  const rows = a.rows.filter(r => (!PR.site || r.site === PR.site) && (!PR.q || (r.name + ' ' + r.emp_code).toLowerCase().includes(PR.q.toLowerCase())));
  const can_ = prCan('attendance') && !a.locked && a.status !== 'finalised' && a.status !== 'paid';
  const sum = rows.reduce((t, r) => ({ p: t.p + r.summary.present, a: t.a + r.summary.absent, d: t.d + r.summary.paid_days }), { p: 0, a: 0, d: 0 });
  const acts = `<button type="button" class="btn btn-outline btn-sm" id="pr-imp">Import Excel</button><button type="button" class="btn btn-outline btn-sm" id="pr-exp-att">Export Excel</button><div class="pr-seg"><button type="button" data-mode="grid" class="${PR.mode === 'grid' ? 'on' : ''}">Monthly grid</button><button type="button" data-mode="day" class="${PR.mode === 'day' ? 'on' : ''}">Day by day</button></div>${can_ ? '<button type="button" class="btn btn-outline btn-sm" id="pr-lock">Lock month</button>' : ''}${a.locked && prCan('run') && a.status !== 'finalised' && a.status !== 'paid' ? '<button type="button" class="btn btn-outline btn-sm" id="pr-unlock">Unlock</button>' : ''}`;
  main.innerHTML = prHead('Attendance', 'P present · A absent · H half day · L paid leave · W weekly off', acts) + prMonthBar() +
    (a.locked ? prNote(`Attendance for ${prMonthName(PR.month)} is <b>locked</b>${a.status === 'finalised' || a.status === 'paid' ? ' (payroll finalised)' : ''}. It can be viewed but not changed.`) : '') +
    (prCan('attendance') ? '' : prNote('You can view attendance but not change it.')) +
    `<div class="pr-filters"><input type="search" id="pr-q" placeholder="Search name or ID" value="${esc(PR.q)}"><select id="pr-site"><option value="">All sites</option>${sites.map(s => `<option ${s === PR.site ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <span class="pr-sum"><b>${sum.p}</b> present days · <b>${sum.a}</b> absent · <b>${Math.round(sum.d * 10) / 10}</b> paid days</span></div>`
    + (!rows.length ? '<div class="pr-empty">No employees to show. Add employees in Employee Onboarding.</div>' : PR.mode === 'day' ? prDayView(a, rows, can_) : prGrid(a, rows, can_));
  prWireMonth();
  prQ('pr-exp-att').addEventListener('click', async () => { try { saveBlob(await Payroll.attendanceExcel(PR.month, false), `SCC-Attendance-${PR.month}.xlsx`); } catch (e) { showToast(prErr(e), true); } });
  prQ('pr-imp').addEventListener('click', () => prImport(a));
  main.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { PR.mode = b.dataset.mode; prAttendance(); }));
  const q = prQ('pr-q'); q.addEventListener('input', () => { PR.q = q.value; clearTimeout(q._t); q._t = setTimeout(prAttendance, 250); });
  prQ('pr-site').addEventListener('change', e => { PR.site = e.target.value; prAttendance(); });
  const lk = prQ('pr-lock'); if (lk) lk.addEventListener('click', async () => { if (!(await askConfirm({ title: 'Lock attendance?', message: `Nobody can change ${prMonthName(PR.month)} attendance until it is unlocked.`, yesLabel: 'Lock', noLabel: 'Cancel' }))) return; try { await Payroll.lock(PR.month); showToast('Attendance locked'); prAttendance(); } catch (e) { showToast(prErr(e), true); } });
  const ul = prQ('pr-unlock'); if (ul) ul.addEventListener('click', async () => { const reason = await askReason({ title: 'Unlock attendance', intro: 'Say why this month needs to be changed.', confirmLabel: 'Unlock' }); if (!reason) return; try { await Payroll.unlock(PR.month, reason); showToast('Unlocked'); prAttendance(); } catch (e) { showToast(prErr(e), true); } });
  if (can_) { if (PR.mode === 'grid') prWireGrid(a); else prWireDay(a, rows); }
}
const prHolSet = a => new Set((a.holidays || []).map(h => h.date));
const prCellHtml = (rec, date, off, hol) => { const s = rec && rec.s; return `<button type="button" class="pr-c ${s ? 'c-' + PR_ST[s][1] : hol ? 'c-hol' : off ? 'c-off' : ''}" data-cell="${date}" ${hol && !s ? `title="${esc(hol)}"` : rec && rec.ot ? `title="Overtime ${rec.ot} h"` : ''}>${s || (hol ? 'H' : off ? '' : '·')}${rec && rec.ot ? '<sup>+</sup>' : ''}</button>`; };
function prGrid(a, rows, editable) {
  const days = []; for (let d = 1; d <= a.days; d++) days.push(d);
  const wk = ['S', 'M', 'T', 'W', 'T', 'F', 'S'], hn = {}; (a.holidays || []).forEach(h => { hn[h.date] = h.name; });
  return `<div class="pr-gridwrap"><table class="pr-grid"><thead><tr><th class="sticky">Employee</th>${days.map(d => { const date = prDay(PR.month, d), off = a.weekly_off.includes(prDow(date)); return `<th class="${off ? 'off' : ''}">${editable ? `<button type="button" class="pr-dh" data-markday="${date}" title="Mark everyone present on ${d}">${d}<small>${wk[prDow(date)]}</small></button>` : `${d}<small>${wk[prDow(date)]}</small>`}</th>`; }).join('')}<th>Present</th><th>Absent</th><th>Paid days</th></tr></thead><tbody>
    ${rows.map(r => `<tr data-emp="${r.id}"><td class="sticky"><b>${esc(r.name)}</b><small>${esc(r.emp_code)}${r.site ? ' · ' + esc(r.site) : ''}</small></td>${days.map(d => { const date = prDay(PR.month, d); const out = date < r.joined_on || (r.left_on && date > String(r.left_on).slice(0, 10)); return `<td>${out ? '<span class="pr-c c-out">–</span>' : prCellHtml(r.days[date], date, a.weekly_off.includes(prDow(date)), hn[date])}</td>`; }).join('')}<td class="n">${r.summary.present}</td><td class="n">${r.summary.absent}</td><td class="n"><b>${r.summary.paid_days}</b></td></tr>`).join('')}
  </tbody></table></div><p class="pr-muted">${editable ? 'Tap a day to change it. Tap a date at the top to mark everyone not yet marked as present.' : ''} <span class="pr-legend"><i class="c-hol">H</i>Company holiday (paid) <i class="c-p">P</i>Present <i class="c-a">A</i>Absent <i class="c-h">H</i>Half <i class="c-l">L</i>Leave <i class="c-w">W</i>Off <sup>+</sup> overtime</span></p>`;
}
async function prSaveCells(items, emp) {
  try { await Payroll.saveAttendance(items); } catch (e) { showToast(prErr(e), true); return false; }
  const a = PR.att; const row = a.rows.find(r => r.id === emp);
  items.forEach(it => { if (!it.status) delete row.days[it.date]; else row.days[it.date] = { s: it.status, ot: Number(it.ot_hours) || 0, note: it.note || '' }; });
  return true;
}
function prWireGrid(a) {
  const main = prQ('pr-main');
  main.querySelectorAll('[data-markday]').forEach(b => b.addEventListener('click', async () => { try { const r = await Payroll.markDay(b.dataset.markday, 'P', PR.site); showToast(r.saved ? `Marked ${r.saved} present` : 'Everyone is already marked'); prAttendance(); } catch (e) { showToast(prErr(e), true); } }));
  main.querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', ev => { ev.stopPropagation(); prCellEditor(b, a); }));
}
function prCellEditor(btn, a) {
  const emp = btn.closest('tr').dataset.emp, date = btn.dataset.cell, row = a.rows.find(r => r.id === emp), rec = row.days[date] || {};
  const pop = prQ('pr-pop'), r = btn.getBoundingClientRect();
  pop.innerHTML = `<div class="pr-pt"><b>${esc(row.name)}</b><span>${fmtDate(date)}</span></div><div class="pr-pb">${Object.entries(PR_ST).map(([k, [t, c]]) => `<button type="button" data-s="${k}" class="c-${c} ${rec.s === k ? 'sel' : ''}">${k}<small>${t}</small></button>`).join('')}</div>
    <label>Overtime hours<input type="number" id="pr-ot" min="0" max="24" step="0.5" value="${rec.ot || ''}" placeholder="0"></label><label>Note<input type="text" id="pr-nt" maxlength="120" value="${esc(rec.note || '')}"></label>
    <div class="pr-pa"><button type="button" class="btn btn-primary btn-sm" id="pr-ps">Save</button><button type="button" class="btn btn-outline btn-sm" id="pr-pc">Clear day</button></div>`;
  pop.hidden = false; let st = rec.s || '';
  pop.style.left = Math.min(window.innerWidth - 262, Math.max(8, r.left - 80)) + 'px'; pop.style.top = Math.min(window.innerHeight - 290, r.bottom + 6) + 'px';
  pop.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { st = b.dataset.s; pop.querySelectorAll('[data-s]').forEach(x => x.classList.toggle('sel', x === b)); }));
  const done = async items => { if (await prSaveCells(items, emp)) { pop.hidden = true; prAttendance(); } };
  prQ('pr-ps').onclick = () => { if (!st) { showToast('Choose P, A, H, L or W.', true); return; } done([{ employee_id: emp, date, status: st, ot_hours: prQ('pr-ot').value || 0, note: prQ('pr-nt').value }]); };
  prQ('pr-pc').onclick = () => done([{ employee_id: emp, date, status: '' }]);
}
function prDayView(a, rows, editable) {
  const d = PR.day && PR.day.startsWith(PR.month) ? PR.day : (PR.meta.today.startsWith(PR.month) ? PR.meta.today : prDay(PR.month, 1)); PR.day = d;
  const strip = []; for (let i = 1; i <= a.days; i++) { const dt = prDay(PR.month, i); strip.push(`<button type="button" class="pr-dstrip ${dt === d ? 'on' : ''} ${a.weekly_off.includes(prDow(dt)) ? 'off' : ''}" data-day="${dt}"><small>${'SMTWTFS'[prDow(dt)]}</small>${i}</button>`); }
  const elig = rows.filter(r => d >= r.joined_on && !(r.left_on && d > String(r.left_on).slice(0, 10)));
  return `<div class="pr-strip">${strip.join('')}</div><div class="pr-dayhead"><b>${fmtDate(d)}</b>${editable ? '<button type="button" class="btn btn-outline btn-sm" id="pr-allp">Mark all present</button>' : ''}</div>
   <div class="pr-dlist">${elig.map(r => { const rec = r.days[d] || {}; return `<div class="pr-drow" data-emp="${r.id}"><div><b>${esc(r.name)}</b><small>${esc(r.designation)}${r.site ? ' · ' + esc(r.site) : ''}${rec.ot ? ' · OT ' + rec.ot + ' h' : ''}</small></div><div class="pr-dbtns">${['P', 'A', 'H', 'L'].map(k => `<button type="button" ${editable ? '' : 'disabled'} data-set="${k}" class="c-${PR_ST[k][1]} ${rec.s === k ? 'sel' : ''}">${k}</button>`).join('')}</div></div>`; }).join('') || '<div class="pr-empty">Nobody to mark on this day.</div>'}</div>`;
}
function prWireDay(a, rows) {
  const main = prQ('pr-main');
  main.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { PR.day = b.dataset.day; prAttendance(); }));
  const ap = prQ('pr-allp'); if (ap) ap.addEventListener('click', async () => { try { const r = await Payroll.markDay(PR.day, 'P', PR.site); showToast(r.saved ? `Marked ${r.saved} present` : 'Everyone is already marked'); prAttendance(); } catch (e) { showToast(prErr(e), true); } });
  main.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', async () => {
    const emp = b.closest('[data-emp]').dataset.emp, row = a.rows.find(r => r.id === emp), cur = row.days[PR.day] || {}, next = cur.s === b.dataset.set ? '' : b.dataset.set;
    if (await prSaveCells([{ employee_id: emp, date: PR.day, status: next, ot_hours: cur.ot || 0, note: cur.note || '' }], emp)) { b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b && !!next)); }
  }));
}

function prImport(a) {
  let b64 = '';
  prModal(`<div class="card-header"><div class="card-title">Import attendance · ${prMonthName(PR.month)}</div><button type="button" class="btn btn-outline btn-sm" id="im-x">Close</button></div>
    <div class="btn-group"><button type="button" class="btn btn-outline btn-sm" id="im-tpl">Download blank template</button><button type="button" class="btn btn-outline btn-sm" id="im-cur">Download current attendance</button></div>
    <div class="form-group"><label for="im-file">Choose the filled Excel file (.xlsx)</label><input id="im-file" type="file" accept=".xlsx"></div>
    <p class="pr-muted">Rows are matched by Employee ID. Letters: P, A, H, L, W. Empty boxes are left as they are. You see a preview first; nothing is saved until you press Import.</p>
    <div id="im-res"></div><div class="form-error" id="im-err" role="alert"></div><div class="btn-group"><button type="button" class="btn btn-primary" id="im-go" disabled>Import</button></div>`, false);
  prQ('im-x').onclick = prModalClose;
  const dl = blank => async () => { try { saveBlob(await Payroll.attendanceExcel(PR.month, blank), `SCC-Attendance-${PR.month}${blank ? '-template' : ''}.xlsx`); } catch (e) { prQ('im-err').textContent = prErr(e); } };
  prQ('im-tpl').onclick = dl(true); prQ('im-cur').onclick = dl(false);
  prQ('im-file').onchange = ev => {
    const f = ev.target.files[0]; prQ('im-go').disabled = true; prQ('im-res').innerHTML = ''; prQ('im-err').textContent = ''; if (!f) return;
    if (f.size > 120000) { prQ('im-err').textContent = 'That file is too big (limit about 120 KB). Use the template.'; return; }
    const rd = new FileReader();
    rd.onload = async () => {
      b64 = String(rd.result).split(',')[1] || '';
      try { const r = await Payroll.importAttendance(PR.month, b64, false); prQ('im-res').innerHTML = `<div class="pr-warn">${r.changes ? `<b>${r.changes}</b> day${r.changes === 1 ? '' : 's'} will be added or changed` : 'Nothing to change'}${r.unchanged ? `, ${r.unchanged} already the same` : ''}.${r.problem_count ? `<br><b>${r.problem_count} problem${r.problem_count === 1 ? '' : 's'}</b> (those boxes are skipped):<ul>${r.problems.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`; prQ('im-go').disabled = !r.changes; } catch (e) { prQ('im-err').textContent = prErr(e); }
    };
    rd.readAsDataURL(f);
  };
  prQ('im-go').onclick = async () => { try { const r = await Payroll.importAttendance(PR.month, b64, true); prModalClose(); showToast(`Imported ${r.changes} change${r.changes === 1 ? '' : 's'}`); prAttendance(); } catch (e) { prQ('im-err').textContent = prErr(e); } };
}

/* ───────────── 2. Employee onboarding ───────────── */
function prBreakup(ctc, key, f) {
  const c = PR.cfg, t = c.templates.find(x => x.key === key) || c.templates[0], r = n => Math.round(n);
  const basic = r(ctc * t.basic_pct / 100), hra = r(basic * t.hra_pct / 100), pfE = c.pf.on && f.pf ? r(c.pf.employer_pct / 100 * Math.min(basic, c.pf.wage_limit)) : 0;
  const special = Math.max(0, r(ctc) - basic - hra - pfE), gross = basic + hra + special;
  const pf = c.pf.on && f.pf ? r(c.pf.employee_pct / 100 * Math.min(basic, c.pf.wage_limit)) : 0;
  const esi = c.esi.on && f.esi && gross <= c.esi.gross_limit ? r(c.esi.employee_pct / 100 * gross) : 0;
  let pt = 0; if (c.pt.on && f.pt) for (const s of c.pt.slabs) { if (s.upto === null || gross <= s.upto) { pt = s.amount; break; } }
  return { basic, hra, special, pfE, gross, pf, esi, pt, take: gross - pf - esi - pt };
}
async function prEmployees() {
  const main = prQ('pr-main');
  let d; try { d = await Payroll.employees(); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  PR.emps = d.employees; PR.nextCode = d.next_code;
  const show = prCan('employees') || prCan('run'), f = PR.fq || '', st = PR.fs || 'active';
  const list = d.employees.filter(e => (st === 'all' || e.status === st) && (!f || (e.name + ' ' + e.emp_code + ' ' + e.designation + ' ' + e.site).toLowerCase().includes(f.toLowerCase())));
  const miss = e => [!e.bank_account && 'Bank', e.pf_applicable && !e.uan && 'UAN', !e.phone && 'Phone'].filter(Boolean);
  main.innerHTML = prHead('Employee onboarding', `${d.employees.filter(e => e.status === 'active').length} active employees`, prCan('employees') ? '<button type="button" class="btn btn-primary btn-sm" id="pr-addemp">+ Add employee</button>' : '') +
    `<div class="pr-filters"><input type="search" id="pr-eq" placeholder="Search name, ID, designation or site" value="${esc(f)}"><select id="pr-es"><option value="active" ${st === 'active' ? 'selected' : ''}>Active</option><option value="left" ${st === 'left' ? 'selected' : ''}>Left</option><option value="all" ${st === 'all' ? 'selected' : ''}>All</option></select></div>` +
    (list.length ? `<div class="table-wrap"><table class="pr-table"><thead><tr><th>ID</th><th>Name</th><th>Designation</th><th>Site</th><th>Joined</th>${show ? '<th class="r">Monthly CTC</th>' : ''}<th>Profile</th><th></th></tr></thead><tbody>${list.map(e => { const m = miss(e); return `<tr><td data-label="ID">${esc(e.emp_code)}</td><td data-label="Name"><b>${esc(e.name)}</b>${e.status === 'left' ? ' <span class="pr-chip off">Left</span>' : ''}</td><td data-label="Designation">${esc(e.designation)}</td><td data-label="Site">${esc(e.site) || '–'}</td><td data-label="Joined">${fmtDate(String(e.joined_on).slice(0, 10))}</td>${show ? `<td class="r" data-label="Monthly CTC">${prInr(e.monthly_ctc)}</td>` : ''}<td data-label="Profile">${m.length ? `<span class="pr-chip warn">Missing: ${m.join(', ')}</span>` : '<span class="pr-chip ok">Complete</span>'}</td><td>${prCan('employees') ? `<button type="button" class="btn btn-outline btn-sm" data-edit="${e.id}">Edit</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="pr-empty">No employees yet.</div>');
  const q = prQ('pr-eq'); q.addEventListener('input', () => { PR.fq = q.value; clearTimeout(q._t); q._t = setTimeout(prEmployees, 250); });
  prQ('pr-es').addEventListener('change', e => { PR.fs = e.target.value; prEmployees(); });
  const ad = prQ('pr-addemp'); if (ad) ad.addEventListener('click', () => prWizard(null));
  main.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => prWizard(PR.emps.find(e => e.id === b.dataset.edit))));
}
const PR_STEPS = ['Personal', 'Job', 'Salary (CTC)', 'Bank & statutory', 'Review'];
function prWizard(emp) {
  const e = emp || {};
  PR.wiz = { id: emp && emp.id, step: 0, f: { name: e.name || '', phone: e.phone || '', address: e.address || '', emergency_name: e.emergency_name || '', emergency_phone: e.emergency_phone || '', designation: e.designation || '', site: e.site || '', joined_on: e.joined_on ? String(e.joined_on).slice(0, 10) : today(), left_on: e.left_on ? String(e.left_on).slice(0, 10) : '', emp_code: e.emp_code || '', notes: e.notes || '',
    monthly_ctc: e.monthly_ctc || '', structure: e.structure || PR.cfg.templates[0].key, pf_applicable: e.pf_applicable !== false, esi_applicable: e.esi_applicable !== false, pt_applicable: e.pt_applicable !== false,
    bank_name: e.bank_name || '', bank_account: e.bank_account || '', ifsc: e.ifsc || '', pan: e.pan || '', uan: e.uan || '', esi_no: e.esi_no || '' } };
  prWizRender();
}
function prWizField(label, id, val, o = {}) { return `<div class="form-group ${o.full ? 'full' : ''}"><label for="${id}">${label}${o.req ? ' *' : ''}</label>${o.type === 'select' ? `<select id="${id}">${o.opts.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>` : o.type === 'area' ? `<textarea id="${id}" rows="2" maxlength="250">${esc(val)}</textarea>` : `<input id="${id}" type="${o.type || 'text'}" value="${esc(val)}" ${o.attrs || ''}>`}${o.help ? `<small class="pll-help">${o.help}</small>` : ''}</div>`; }
function prWizCollect() { const w = PR.wiz; Object.keys(w.f).forEach(k => { const el = prQ('pw-' + k); if (!el) return; w.f[k] = el.type === 'checkbox' ? el.checked : el.value; }); }
function prWizRender() {
  const w = PR.wiz, f = w.f, s = w.step, sites = PR.meta.sites;
  let body = '';
  if (s === 0) body = `<div class="form-grid">${prWizField('Full name', 'pw-name', f.name, { req: 1 })}${prWizField('Phone', 'pw-phone', f.phone, { type: 'tel', attrs: 'inputmode="numeric" maxlength="15"' })}${prWizField('Address', 'pw-address', f.address, { type: 'area', full: 1 })}${prWizField('Emergency contact', 'pw-emergency_name', f.emergency_name)}${prWizField('Emergency phone', 'pw-emergency_phone', f.emergency_phone, { type: 'tel', attrs: 'inputmode="numeric" maxlength="15"' })}</div>`;
  if (s === 1) body = `<div class="form-grid">${prWizField('Designation', 'pw-designation', f.designation, { req: 1, help: 'For example Site Supervisor, Operator, Accountant.' })}${prWizField('Site', 'pw-site', f.site, { type: 'select', opts: [['', 'Not fixed']].concat(sites.map(x => [x, x])).concat(f.site && !sites.includes(f.site) ? [[f.site, f.site]] : []) })}${prWizField('Date of joining', 'pw-joined_on', f.joined_on, { type: 'date', req: 1 })}${w.id ? prWizField('Last working day', 'pw-left_on', f.left_on, { type: 'date', help: 'Fill only when the person has left. Salary is paid up to this day.' }) : ''}${prWizField('Employee ID', 'pw-emp_code', f.emp_code, { help: w.id ? 'Cannot be changed.' : `Leave empty to use ${PR.nextCode}.`, attrs: w.id ? 'disabled' : 'maxlength="12"' })}${prWizField('Notes', 'pw-notes', f.notes, { full: 1 })}</div>`;
  if (s === 2) body = `<div class="pr-two"><div><div class="form-grid one-col">${prWizField('Monthly CTC (₹)', 'pw-monthly_ctc', f.monthly_ctc, { req: 1, type: 'number', attrs: 'min="0" step="100" inputmode="numeric"', help: 'Cost to company per month, before any deduction. Salary is calculated from this.' })}${prWizField('Salary structure', 'pw-structure', f.structure, { type: 'select', opts: PR.cfg.templates.map(t => [t.key, `${t.name} (Basic ${t.basic_pct}% · HRA ${t.hra_pct}% of Basic)`]) })}</div>
    <label class="pr-chk"><input type="checkbox" id="pw-pf_applicable" ${f.pf_applicable ? 'checked' : ''}> Provident fund (PF) applies</label><label class="pr-chk"><input type="checkbox" id="pw-esi_applicable" ${f.esi_applicable ? 'checked' : ''}> ESI applies (when gross is within the limit)</label><label class="pr-chk"><input type="checkbox" id="pw-pt_applicable" ${f.pt_applicable ? 'checked' : ''}> Professional tax applies</label></div><div class="pr-break" id="pr-break"></div></div>`;
  if (s === 3) body = `<div class="form-grid">${prWizField('Bank name', 'pw-bank_name', f.bank_name)}${prWizField('Account number', 'pw-bank_account', f.bank_account, { attrs: 'inputmode="numeric" maxlength="20"' })}${prWizField('IFSC', 'pw-ifsc', f.ifsc, { attrs: 'maxlength="11" style="text-transform:uppercase"' })}${prWizField('PAN', 'pw-pan', f.pan, { attrs: 'maxlength="10" style="text-transform:uppercase"' })}${prWizField('UAN (PF)', 'pw-uan', f.uan, { attrs: 'inputmode="numeric" maxlength="12"' })}${prWizField('ESI number', 'pw-esi_no', f.esi_no, { attrs: 'inputmode="numeric" maxlength="17"' })}</div><p class="pr-muted">These can be added later, but a salary cannot be paid by bank transfer without the account number.</p>`;
  if (s === 4) { const b = prBreakup(+f.monthly_ctc || 0, f.structure, { pf: f.pf_applicable, esi: f.esi_applicable, pt: f.pt_applicable }); body = `<dl class="pr-review"><dt>Name</dt><dd>${esc(f.name)}</dd><dt>Designation</dt><dd>${esc(f.designation)}${f.site ? ' · ' + esc(f.site) : ''}</dd><dt>Joined</dt><dd>${fmtDate(f.joined_on)}${f.left_on ? ' · left ' + fmtDate(f.left_on) : ''}</dd><dt>Monthly CTC</dt><dd><b>${prInr(f.monthly_ctc)}</b> · estimated take-home ${prInr(b.take)}</dd><dt>Bank</dt><dd>${f.bank_account ? esc(f.bank_name) + ' ' + esc(f.bank_account) : '<span class="pr-chip warn">Not added</span>'}</dd></dl>${w.id ? '<div class="form-group"><label>Why are you changing this? (needed for changes)</label><small class="pll-help">You will be asked for a reason when you save.</small></div>' : ''}`; }
  prModal(`<div class="card-header"><div class="card-title">${w.id ? 'Edit employee' : 'New employee'}</div><button type="button" class="btn btn-outline btn-sm" id="pw-x">Close</button></div>
    <ol class="pr-wsteps">${PR_STEPS.map((t, i) => `<li class="${i === s ? 'on' : i < s ? 'done' : ''}"><i>${i < s ? '✓' : i + 1}</i>${t}</li>`).join('')}</ol>${body}<div class="form-error" id="pw-err" role="alert"></div>
    <div class="btn-group">${s > 0 ? '<button type="button" class="btn btn-outline" id="pw-back">Back</button>' : ''}${s < 4 ? '<button type="button" class="btn btn-primary" id="pw-next">Next</button>' : `<button type="button" class="btn btn-primary" id="pw-save">${w.id ? 'Save changes' : 'Save employee'}</button>`}</div>`, true);
  prQ('pw-x').onclick = prModalClose;
  const upd = () => { const bx = prQ('pr-break'); if (!bx) return; prWizCollect(); const b = prBreakup(+w.f.monthly_ctc || 0, w.f.structure, { pf: w.f.pf_applicable, esi: w.f.esi_applicable, pt: w.f.pt_applicable });
    bx.innerHTML = `<h4>Monthly breakup (full month)</h4><table><tr><td>Basic</td><td>${prInr(b.basic)}</td></tr><tr><td>House rent allowance</td><td>${prInr(b.hra)}</td></tr><tr><td>Special allowance</td><td>${prInr(b.special)}</td></tr><tr class="t"><td>Gross pay</td><td>${prInr(b.gross)}</td></tr><tr class="m"><td>Employer PF (part of CTC)</td><td>${prInr(b.pfE)}</td></tr><tr class="m"><td>Employee PF</td><td>− ${prInr(b.pf)}</td></tr><tr class="m"><td>ESI</td><td>− ${prInr(b.esi)}</td></tr><tr class="m"><td>Professional tax</td><td>− ${prInr(b.pt)}</td></tr><tr class="t hl"><td>Estimated take-home</td><td>${prInr(b.take)}</td></tr></table><p class="pr-muted">Shown for a month with full attendance. Real pay follows the attendance.</p>`; };
  if (s === 2) { upd(); prQ('pr-root').querySelectorAll('#pr-modal input,#pr-modal select').forEach(el => el.addEventListener('input', upd)); }
  const err = m => { prQ('pw-err').textContent = m; };
  const need = () => { prWizCollect(); const f = w.f; if (s === 0 && f.name.trim().length < 2) return 'Enter the employee\'s name.'; if (s === 1) { if (!f.designation.trim()) return 'Enter the designation.'; if (!f.joined_on) return 'Choose the date of joining.'; } if (s === 2 && !(+f.monthly_ctc >= 1000)) return 'Enter the monthly CTC (at least ₹1,000).'; return ''; };
  const nx = prQ('pw-next'); if (nx) nx.onclick = () => { const m = need(); if (m) return err(m); w.step++; prWizRender(); };
  const bk = prQ('pw-back'); if (bk) bk.onclick = () => { prWizCollect(); w.step--; prWizRender(); };
  const sv = prQ('pw-save'); if (sv) sv.onclick = async () => {
    const body = { ...w.f, monthly_ctc: Number(w.f.monthly_ctc) }; if (!body.emp_code) delete body.emp_code;
    try {
      if (w.id) { const reason = await askReason({ title: 'Save changes to this employee', intro: 'Salary and bank changes are recorded in the Activity Log. Say why you are changing them.', confirmLabel: 'Save changes' }); if (!reason) return; body.reason = reason; await Payroll.editEmployee(w.id, body); }
      else await Payroll.addEmployee(body);
      prModalClose(); showToast(w.id ? 'Employee updated' : 'Employee added'); prEmployees();
    } catch (e2) { err(prErr(e2)); }
  };
}

/* ───────────── 3. Monthly payroll ───────────── */
async function prPayroll() {
  if (PR.ptab === 'loans') return prLoans();
  const main = prQ('pr-main');
  let d; try { d = await Payroll.month(PR.month); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  PR.pay = d; const st = d.month.status, t = d.totals, open = st === 'draft' || st === 'reviewed';
  const flow = [['draft', 'Draft'], ['reviewed', 'Reviewed'], ['finalised', 'Finalised'], ['paid', 'Paid']], idx = flow.findIndex(x => x[0] === st);
  const acts = `<button type="button" class="btn btn-outline btn-sm" id="pr-exp">Export Excel</button>${st === 'draft' ? '<button type="button" class="btn btn-primary btn-sm" data-to="reviewed">Mark as reviewed</button>' : ''}${st === 'reviewed' ? '<button type="button" class="btn btn-primary btn-sm" data-to="finalised">Finalise payroll</button>' : ''}${st === 'finalised' ? '<button type="button" class="btn btn-primary btn-sm" data-to="paid">Mark as paid</button>' : ''}${st === 'reviewed' || st === 'finalised' ? '<button type="button" class="btn btn-outline btn-sm" data-to="draft">Reopen</button>' : ''}`;
  main.innerHTML = prHead('Monthly payroll', 'Salary is calculated from each person\'s monthly CTC and the attendance.', acts) + prPayTabs('pay') + prMonthBar() +
    `<ol class="pr-flow">${flow.map((x, i) => `<li class="${i < idx ? 'done' : i === idx ? 'on' : ''}"><i>${i < idx ? '✓' : i + 1}</i>${x[1]}</li>`).join('')}</ol>` +
    (open ? '' : prNote(`This payroll is <b>${PR_STATUS[st].toLowerCase()}</b>. The figures are saved and will not change${st === 'paid' ? '' : ' unless you reopen it'}.`)) +
    `<div class="pr-stats"><div class="pr-stat"><small>Employees</small><b>${t.count}</b></div><div class="pr-stat"><small>Gross pay</small><b>${prInr(t.gross)}</b></div><div class="pr-stat"><small>Deductions</small><b>${prInr(t.deductions)}</b></div><div class="pr-stat hl"><small>Net payable</small><b>${prInr(t.net)}</b></div></div>` +
    (d.lines.length ? `<div class="table-wrap"><table class="pr-table"><thead><tr><th>Employee</th><th class="r">Paid days</th><th class="r">Gross pay</th><th class="r">PF</th><th class="r">ESI</th><th class="r">PT</th><th class="r">Other ded.</th><th class="r">Net pay</th><th>Check</th></tr></thead><tbody>${d.lines.map(l => `<tr class="pr-click" data-l="${l.employee_id}"><td data-label="Employee"><b>${esc(l.name)}</b><small>${esc(l.emp_code)} · ${esc(l.designation)}</small></td><td class="r" data-label="Paid days">${l.paid_days}/${l.salary_days}</td><td class="r" data-label="Gross pay">${prNum(l.total_earnings)}</td><td class="r" data-label="PF">${prNum(l.pf)}</td><td class="r" data-label="ESI">${prNum(l.esi)}</td><td class="r" data-label="PT">${prNum(l.pt)}</td><td class="r" data-label="Other ded.">${prNum(l.other_deductions)}</td><td class="r" data-label="Net pay"><b>${prNum(l.net)}</b></td><td data-label="Check">${l.flags.length ? `<span class="pr-chip warn" title="${esc(l.flags.join(', '))}">${esc(l.flags[0])}${l.flags.length > 1 ? ' +' + (l.flags.length - 1) : ''}</span>` : '<span class="pr-chip ok">OK</span>'}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total</td><td></td><td class="r">${prNum(t.gross)}</td><td class="r">${prNum(t.pf)}</td><td class="r">${prNum(t.esi)}</td><td class="r">${prNum(t.pt)}</td><td class="r">${prNum(t.other)}</td><td class="r">${prNum(t.net)}</td><td></td></tr></tfoot></table></div><p class="pr-muted">Tap a row to see the calculation${open ? ' and add a bonus, overtime or deduction such as an advance' : ''}.</p>` : '<div class="pr-empty">No employees in this month.</div>');
  prWireMonth(); prWireTabs();
  prQ('pr-exp').onclick = async () => { try { saveBlob(await Payroll.exportMonth(PR.month), `SCC-Payroll-${PR.month}.xlsx`); } catch (e) { showToast(prErr(e), true); } };
  main.querySelectorAll('[data-to]').forEach(b => b.addEventListener('click', () => prMove(b.dataset.to)));
  main.querySelectorAll('[data-l]').forEach(r => r.addEventListener('click', () => prDrawer(r.dataset.l, open)));
}
async function prMove(to) {
  let reason;
  if (to === 'draft') { reason = await askReason({ title: 'Reopen payroll', intro: 'Say why this month has to be reopened. Saved figures will be recalculated.', confirmLabel: 'Reopen' }); if (!reason) return; }
  else if (to === 'paid') return prPaidDialog();
  else { const msg = { reviewed: 'Mark this payroll as reviewed?', finalised: `Finalise payroll for ${prMonthName(PR.month)}? The figures are saved and attendance is locked.`, paid: 'Mark this month as paid?' }[to]; if (!(await askConfirm({ title: 'Please confirm', message: msg, yesLabel: 'Yes', noLabel: 'Cancel' }))) return; }
  try { await Payroll.setStatus(PR.month, to, reason); showToast('Payroll ' + (to === 'draft' ? 'reopened' : to)); prPayroll(); } catch (e) { showToast(prErr(e), true); }
}
async function prPaidDialog() {
  const t = PR.pay.totals;
  prModal(`<div class="card-header"><div class="card-title">Mark ${prMonthName(PR.month)} as paid</div><button type="button" class="btn btn-outline btn-sm" id="pp-x">Close</button></div>
    <p class="pr-muted">${t.count} employees · net payable <b>${prInr(t.net)}</b></p>
    <div class="form-grid"><div class="form-group"><label for="pp-d">Paid on *</label><input id="pp-d" type="date" value="${PR.meta.today}"></div>
    <div class="form-group"><label for="pp-m">Payment mode *</label><select id="pp-m"><option value="bank">Bank transfer (NEFT)</option><option value="upi">UPI</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select></div>
    <div class="form-group"><label for="pp-r">Bank reference / UTR</label><input id="pp-r" maxlength="40" placeholder="Optional"></div><div class="form-group"><label for="pp-n">Remarks</label><input id="pp-n" maxlength="120"></div></div>
    <div class="pr-warn">Need the bank upload file? <b>Download bank transfer file</b> gives a CSV with name, account number, IFSC and amount. Employees without bank details are left out.</div>
    <div class="form-error" id="pp-err" role="alert"></div><div class="btn-group"><button type="button" class="btn btn-outline" id="pp-bank">Download bank transfer file</button><button type="button" class="btn btn-primary" id="pp-go">Mark as paid</button></div>`, false);
  prQ('pp-x').onclick = prModalClose;
  prQ('pp-bank').onclick = async () => { try { saveBlob(await Payroll.bankFile(PR.month), `SCC-Bank-transfer-${PR.month}.csv`); } catch (e) { prQ('pp-err').textContent = prErr(e); } };
  prQ('pp-go').onclick = async () => { try { await Payroll.setStatus(PR.month, 'paid', undefined, { paid_on: prQ('pp-d').value, pay_mode: prQ('pp-m').value, pay_ref: prQ('pp-r').value, pay_remarks: prQ('pp-n').value }); prModalClose(); showToast('Marked as paid'); prPayroll(); } catch (e) { prQ('pp-err').textContent = prErr(e); } };
}
const prPayTabs = on => `<div class="pr-seg pr-tabs"><button type="button" data-ptab="pay" class="${on === 'pay' ? 'on' : ''}">Monthly payroll</button><button type="button" data-ptab="loans" class="${on === 'loans' ? 'on' : ''}">Advances &amp; loans</button></div>`;
const prWireTabs = () => prQ('pr-main').querySelectorAll('[data-ptab]').forEach(b => b.addEventListener('click', () => { PR.ptab = b.dataset.ptab; prPayroll(); }));
async function prLoans() {
  const main = prQ('pr-main');
  let d; try { d = await Payroll.loans(); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  main.innerHTML = prHead('Advances & loans', 'An EMI is deducted automatically from each month\'s salary.', '<button type="button" class="btn btn-primary btn-sm" id="ln-add">+ New advance / loan</button>') + prPayTabs('loans') +
    `<div class="pr-stats"><div class="pr-stat"><small>Outstanding</small><b>${prInr(d.outstanding)}</b></div><div class="pr-stat"><small>Deducting this month</small><b>${prInr(d.this_month)}</b></div><div class="pr-stat"><small>Entries</small><b>${d.loans.length}</b></div></div>` +
    (d.loans.length ? `<div class="table-wrap"><table class="pr-table"><thead><tr><th>Employee</th><th>Type</th><th class="r">Amount</th><th class="r">EMI</th><th class="r">Paid</th><th class="r">Balance</th><th>Next deduction</th><th>Status</th><th></th></tr></thead><tbody>${d.loans.map(l => `<tr><td data-label="Employee"><b>${esc(l.employee)}</b></td><td data-label="Type"><span class="pr-chip ${l.kind === 'loan' ? 'ok' : 'warn'}">${l.kind === 'loan' ? 'Loan' : 'Advance'}</span></td><td class="r" data-label="Amount">${prInr(l.amount)}</td><td class="r" data-label="EMI">${prInr(l.emi)} × ${l.instalments}</td><td class="r" data-label="Paid">${l.paid_count} of ${l.instalments}</td><td class="r" data-label="Balance"><b>${prInr(l.balance)}</b></td><td data-label="Next">${l.next_month ? prMonthName(l.next_month) : '–'}</td><td data-label="Status"><span class="pr-chip ${l.status === 'active' ? 'ok' : 'off'}">${l.status === 'active' ? 'Active' : 'Closed'}</span></td><td>${l.status === 'active' ? `<button type="button" class="btn btn-outline btn-sm" data-close="${l.id}">Close</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="pr-empty">No advances or loans yet.</div>');
  prWireTabs();
  main.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', async () => { const reason = await askReason({ title: 'Close this advance / loan', intro: 'No more instalments will be deducted. Say why.', confirmLabel: 'Close it' }); if (!reason) return; try { await Payroll.closeLoan(b.dataset.close, reason); showToast('Closed'); prLoans(); } catch (e) { showToast(prErr(e), true); } }));
  prQ('ln-add').onclick = () => {
    const nm = prShift(PR.month, 1);
    prModal(`<div class="card-header"><div class="card-title">New advance or loan</div><button type="button" class="btn btn-outline btn-sm" id="ln-x">Close</button></div>
      <div class="form-grid"><div class="form-group"><label for="ln-e">Employee *</label><select id="ln-e">${d.employees.map(e => `<option value="${e.id}">${esc(e.name)} (${esc(e.emp_code)})</option>`).join('')}</select></div>
      <div class="form-group"><label for="ln-k">Type *</label><select id="ln-k"><option value="advance">Advance</option><option value="loan">Loan</option></select></div>
      <div class="form-group"><label for="ln-a">Amount (₹) *</label><input id="ln-a" type="number" min="100" step="100" inputmode="numeric"></div><div class="form-group"><label for="ln-g">Given on *</label><input id="ln-g" type="date" value="${PR.meta.today}"></div>
      <div class="form-group"><label for="ln-n">Deduct in (instalments) *</label><input id="ln-n" type="number" min="1" max="60" value="1"></div><div class="form-group"><label for="ln-f">First deduction month *</label><input id="ln-f" type="month" value="${nm}"></div></div>
      <div class="pr-warn" id="ln-sum"></div><div class="form-error" id="ln-err" role="alert"></div><div class="btn-group"><button type="button" class="btn btn-primary" id="ln-save">Save</button></div>`, false);
    prQ('ln-x').onclick = prModalClose;
    const sum = () => { const a = +prQ('ln-a').value, n = +prQ('ln-n').value, f = prQ('ln-f').value; prQ('ln-sum').innerHTML = a > 0 && n > 0 && f ? `<b>${prInr(Math.round(a / n))} × ${n} month${n === 1 ? '' : 's'}</b> · ${prMonthName(f)} to ${prMonthName(prShift(f, n - 1))}.` : 'Enter the amount and instalments to see the schedule.'; };
    ['ln-a', 'ln-n', 'ln-f'].forEach(i => prQ(i).addEventListener('input', sum)); sum();
    prQ('ln-save').onclick = async () => { try { await Payroll.addLoan({ employee_id: prQ('ln-e').value, kind: prQ('ln-k').value, amount: prQ('ln-a').value, given_on: prQ('ln-g').value, instalments: prQ('ln-n').value, first_month: prQ('ln-f').value }); prModalClose(); showToast('Saved'); prLoans(); } catch (e) { prQ('ln-err').textContent = prErr(e); } };
  };
}
function prDrawer(id, editable) {
  const l = PR.pay.lines.find(x => x.employee_id === id); if (!l) return;
  const row = (k, v, c = '') => `<tr class="${c}"><td>${k}</td><td>${v}</td></tr>`;
  const adj = (l.adjustments || []).filter(a => !a.auto).map(a => ({ ...a })), autoAdj = (l.adjustments || []).filter(a => a.auto);
  const draw = () => {
    prModal(`<div class="card-header"><div class="card-title">${esc(l.name)} <small class="pr-muted">${esc(l.emp_code)}</small></div><button type="button" class="btn btn-outline btn-sm" id="pd-x">Close</button></div>
      <div class="pr-two"><div><h4>Attendance</h4><table class="pr-kv">${row('Days in month', l.days_in_month)}${row('Present', l.present)}${row('Absent', l.absent)}${row('Half days', l.half)}${row('Paid leave', l.leave)}${row('Weekly off', l.weekly_off)}${row('Not marked', l.unmarked, l.unmarked ? 'bad' : '')}${l.outside ? row('Before joining / after leaving', l.outside) : ''}${row('Paid days', `<b>${l.paid_days} of ${l.salary_days}</b>`, 't')}</table></div>
      <div><h4>Salary</h4><table class="pr-kv">${row('Monthly CTC', prInr(l.monthly_ctc))}${row('Basic', prInr(l.basic) + `<small> of ${prNum(l.full.basic)}</small>`)}${row('HRA', prInr(l.hra) + `<small> of ${prNum(l.full.hra)}</small>`)}${row('Special allowance', prInr(l.special) + `<small> of ${prNum(l.full.special)}</small>`)}${l.ot_pay ? row(`Overtime (${l.ot_hours} h)`, prInr(l.ot_pay)) : ''}${adj.filter(a => a.kind === 'earning').map(a => row(esc(a.label), prInr(a.amount))).join('')}${row('Total earnings', prInr(l.total_earnings), 't')}${row('PF', '− ' + prInr(l.pf))}${row('ESI', '− ' + prInr(l.esi))}${row('Professional tax', '− ' + prInr(l.pt))}${adj.filter(a => a.kind === 'deduction').map(a => row(esc(a.label), '− ' + prInr(a.amount))).join('')}${autoAdj.map(a => row(esc(a.label) + ' <small>(automatic)</small>', '− ' + prInr(a.amount))).join('')}${row('Net pay', prInr(l.net), 't hl')}</table></div></div>
      ${editable ? `<h4>Bonus, overtime or deduction</h4><div id="pd-adj">${adj.map((a, i) => `<div class="pr-adj"><select data-k="${i}"><option value="earning" ${a.kind === 'earning' ? 'selected' : ''}>Earning</option><option value="deduction" ${a.kind === 'deduction' ? 'selected' : ''}>Deduction</option></select><input data-n="${i}" value="${esc(a.label)}" placeholder="Name (e.g. Advance)" maxlength="60"><input data-a="${i}" type="number" min="1" value="${a.amount}" inputmode="numeric"><button type="button" class="btn btn-outline btn-sm" data-rm="${i}">Remove</button></div>`).join('')}</div><div class="btn-group"><button type="button" class="btn btn-outline btn-sm" id="pd-add">+ Add line</button><button type="button" class="btn btn-primary btn-sm" id="pd-save">Save and recalculate</button></div>` : ''}
      <div class="form-error" id="pd-err" role="alert"></div>`, true);
    prQ('pd-x').onclick = prModalClose;
    if (!editable) return;
    const sync = () => { prQ('pd-adj').querySelectorAll('[data-k]').forEach(el => { const i = +el.dataset.k; adj[i].kind = el.value; }); prQ('pd-adj').querySelectorAll('[data-n]').forEach(el => { adj[+el.dataset.n].label = el.value; }); prQ('pd-adj').querySelectorAll('[data-a]').forEach(el => { adj[+el.dataset.a].amount = el.value; }); };
    prQ('pd-add').onclick = () => { sync(); adj.push({ kind: 'deduction', label: '', amount: '' }); draw(); };
    prQ('pd-adj').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { sync(); adj.splice(+b.dataset.rm, 1); draw(); });
    prQ('pd-save').onclick = async () => { sync(); try { await Payroll.adjust(PR.month, id, adj.filter(a => a.label || a.amount)); prModalClose(); showToast('Saved'); prPayroll(); } catch (e) { prQ('pd-err').textContent = prErr(e); } };
  };
  draw();
}

/* ───────────── 4. Pay slips ───────────── */
const prWaNumber = ph => { const d = String(ph || '').replace(/\D/g, ''); if (d.length === 10) return '91' + d; if (d.length >= 11 && d.length <= 15) return d; return ''; };
async function prPayslips() {
  const main = prQ('pr-main');
  let d; try { d = await Payroll.payslips(PR.month); } catch (e) { main.innerHTML = prSetup(e) || `<div class="pr-empty pr-bad">${esc(prErr(e))}</div>`; return; }
  PR.slips = d;
  const status = l => (l.shared_at ? '<span class="pr-chip share">Shared</span>' : l.payslip_at ? '<span class="pr-chip ok">Generated</span>' : '<span class="pr-chip off">Not generated</span>');
  main.innerHTML = prHead('Pay slips', 'Pay slips are made from the finalised payroll.', d.can_generate && d.lines.length ? '<button type="button" class="btn btn-primary btn-sm" id="ps-all">Download all (PDF)</button>' : '') + prMonthBar() +
    (d.can_generate ? '' : prNote(`${prMonthName(PR.month)} is not finalised yet. Finalise it in <b>Monthly Payroll</b> to generate pay slips.`)) +
    (d.can_generate && !d.company.address ? prNote('Add the company address in <b>Payroll Configuration → Pay slip template</b> so it prints on the slip.') : '') +
    (d.lines.length && d.can_generate ? `<div class="table-wrap"><table class="pr-table"><thead><tr><th>Employee</th><th>WhatsApp number</th><th class="r">Net pay</th><th>Status</th><th></th></tr></thead><tbody>${d.lines.map(l => `<tr><td data-label="Employee"><b>${esc(l.name)}</b><small>${esc(l.emp_code)} · ${esc(l.designation)}</small></td><td data-label="WhatsApp">${l.phone ? esc(l.phone) : '<span class="pr-chip warn">No phone number</span>'}</td><td class="r" data-label="Net pay"><b>${prNum(l.net)}</b></td><td data-label="Status">${status(l)}</td><td class="pr-rowact"><button type="button" class="btn btn-outline btn-sm" data-view="${l.employee_id}">Preview</button> <button type="button" class="btn btn-outline btn-sm" data-pdf="${l.employee_id}">PDF</button> ${prWaNumber(l.phone) ? `<button type="button" class="btn btn-sm pr-wa" data-share="${l.employee_id}">${PR_WA_ICON}Share</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : (d.can_generate ? '<div class="pr-empty">No employees in this month.</div>' : ''));
  prWireMonth();
  const find = id => d.lines.find(x => x.employee_id === id);
  const dl = async (id, name) => { try { saveBlob(await Payroll.payslipPdf(PR.month, id), name); showToast('Pay slip downloaded'); prPayslips(); } catch (e) { showToast(prErr(e), true); } };
  const al = prQ('ps-all'); if (al) al.onclick = () => dl('all', `SCC-PaySlips-${PR.month}.pdf`);
  main.querySelectorAll('[data-pdf]').forEach(b => b.addEventListener('click', () => { const l = find(b.dataset.pdf); dl(l.employee_id, `SCC-PaySlip-${l.emp_code}-${PR.month}.pdf`); }));
  main.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => prSlipPreview(find(b.dataset.view))));
  main.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => prShare(find(b.dataset.share))));
}
const PR_WA_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="#fff" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15l-1.3 5 5.1-1.3A10 10 0 1 0 12 2zm5.2 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1.1.1-1.8-.1a15 15 0 0 1-5.6-4.9c-.5-.7-1.5-2-1.5-3.3s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.7 1.2 1.5 1.9 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.4.1.2.1.7-.1 1.2z"/></svg>';
const prSlipFile = l => `SCC-PaySlip-${l.emp_code}-${PR.month}.pdf`;
const prShareText = l => `Hi ${String(l.name).split(' ')[0]}, your pay slip for ${prMonthName(PR.month)} is attached. Net pay ${prInr(l.net)}. – ${PR.cfg.company_name}`;
/** Phones that can share a file: the share sheet opens with the PDF attached. Computers: a short dialog, then WhatsApp opens on the employee's number. */
async function prShare(l) {
  const phone = prWaNumber(l.phone); if (!phone) { showToast('Add this employee\'s phone number in Employee Onboarding.', true); return; }
  let probe = null; try { probe = new File([new Blob(['x'], { type: 'application/pdf' })], 'x.pdf', { type: 'application/pdf' }); } catch { /* old browser */ }
  if (probe && navigator.canShare && navigator.canShare({ files: [probe] }) && prMobile()) {
    try {
      const blob = await Payroll.payslipPdf(PR.month, l.employee_id), file = new File([blob], prSlipFile(l), { type: 'application/pdf' });
      await navigator.share({ files: [file], text: prShareText(l), title: prSlipFile(l) });
      await Payroll.markShared(PR.month, l.employee_id); showToast('Marked as shared'); prPayslips();
    } catch (e) { if (e && e.name !== 'AbortError') showToast(prErr(e), true); }
    return;
  }
  prModal(`<div class="card-header"><div class="card-title">Share pay slip on WhatsApp</div><button type="button" class="btn btn-outline btn-sm" id="sh-x">Close</button></div><p class="pr-muted">${esc(l.name)} · ${prMonthName(PR.month)}</p>
    <ol class="pr-steps3"><li><b>The PDF downloads to this computer</b><small>${esc(prSlipFile(l))}</small></li><li><b>WhatsApp opens on +${phone.slice(0, 2)} ${esc(phone.slice(2))}</b><small>WhatsApp Web or the WhatsApp Desktop app, with the message already typed.</small></li><li><b>Drag the PDF into the chat and press Send</b><small>A computer cannot attach the file for you. On a phone it is attached automatically.</small></li></ol>
    <div class="pr-wamsg"><small>MESSAGE</small>${esc(prShareText(l))}</div><div class="form-error" id="sh-err" role="alert"></div>
    <div class="btn-group"><button type="button" class="btn btn-outline" id="sh-c">Cancel</button><button type="button" class="btn pr-wa" id="sh-go">${PR_WA_ICON}Download PDF and open WhatsApp</button></div>`, false);
  prQ('sh-x').onclick = prQ('sh-c').onclick = prModalClose;
  prQ('sh-go').onclick = async () => {
    try {
      saveBlob(await Payroll.payslipPdf(PR.month, l.employee_id), prSlipFile(l));
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(prShareText(l))}`, '_blank', 'noopener');
      await Payroll.markShared(PR.month, l.employee_id); prModalClose(); showToast('Marked as shared'); prPayslips();
    } catch (e) { prQ('sh-err').textContent = prErr(e); }
  };
}
function prSlipPreview(l) {
  const sl = PR.cfg.slip, earn = [['Basic', l.basic], ['House rent allowance', l.hra], ['Special allowance', l.special]]; if (l.ot_pay) earn.push([`Overtime (${l.ot_hours} h)`, l.ot_pay]); (l.adjustments || []).filter(a => a.kind === 'earning').forEach(a => earn.push([a.label, a.amount]));
  const ded = []; if (l.pf) ded.push(['Provident fund (PF)', l.pf]); if (l.esi) ded.push(['ESI', l.esi]); if (l.pt) ded.push(['Professional tax', l.pt]); (l.adjustments || []).filter(a => a.kind === 'deduction').forEach(a => ded.push([a.label, a.amount]));
  const n = Math.max(earn.length, ded.length, 1), kv = (k, v) => `<div><small>${k}</small><b>${esc(v) || '–'}</b></div>`;
  const words = typeof prWordsOf === 'function' ? prWordsOf(l.net) : '';
  prModal(`<div class="card-header"><div class="card-title">Pay slip preview</div><button type="button" class="btn btn-outline btn-sm" id="pv-x">Close</button></div><p class="pr-muted">Same layout as the PDF. What you see here is what gets downloaded and shared.</p>
    <div class="pr-slipbg"><div class="pr-slip">
    <div class="pr-slip-h">${sl.logo ? '<img src="/img/logo.png" alt="" class="pr-slip-logo">' : ''}<div class="pr-slip-co"><b>${esc(PR.cfg.company_name.toUpperCase())}</b>${sl.address_on && sl.address ? `<small>${esc(sl.address)}</small>` : ''}${sl.gstin ? `<small><strong>GSTIN: ${esc(sl.gstin)}</strong></small>` : ''}</div><div class="pr-slip-ti"><b>PAY SLIP</b><small>${prMonthName(PR.month)}</small></div></div>
    <div class="pr-slip-g">${kv('EMPLOYEE NAME', l.name)}${kv('EMPLOYEE ID', l.emp_code)}${kv('DESIGNATION', l.designation)}${kv('SITE', l.site)}${kv('DATE OF JOINING', l.joined_on ? l.joined_on.split('-').reverse().join('-') : '')}${kv('PAID DAYS', l.paid_days + ' of ' + l.salary_days)}${kv('BANK A/C', l.bank_account)}${kv('PAN', l.pan)}${kv('UAN', l.uan)}</div>
    <div class="pr-slip-two"><table class="pr-slip-t"><thead><tr><th>EARNINGS (₹)</th><th></th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr><td>${earn[i] ? esc(earn[i][0]) : '&nbsp;'}</td><td class="r">${earn[i] ? prNum(earn[i][1]) : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total earnings</td><td class="r">${prNum(l.total_earnings)}</td></tr></tfoot></table>
    <table class="pr-slip-t"><thead><tr><th>DEDUCTIONS (₹)</th><th></th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr><td>${ded[i] ? esc(ded[i][0]) : i === 0 && !ded.length ? 'No deductions' : '&nbsp;'}</td><td class="r">${ded[i] ? prNum(ded[i][1]) : ''}</td></tr>`).join('')}</tbody><tfoot><tr><td>Total deductions</td><td class="r">${prNum(l.total_deductions)}</td></tr></tfoot></table></div>
    <div class="pr-slip-net"><div><small>NET PAY</small>${sl.words_on ? `<span>${esc(words)}</span>` : ''}</div><b>${prInr(l.net)}</b></div>${sl.footer ? `<p class="pr-slip-f">${esc(sl.footer)}</p>` : ''}</div></div>
    <div class="btn-group"><button type="button" class="btn btn-primary" id="pv-dl">Download PDF</button><button type="button" class="btn btn-outline" id="pv-pr">Print</button>${prWaNumber(l.phone) ? `<button type="button" class="btn pr-wa" id="pv-wa">${PR_WA_ICON}Share on WhatsApp</button>` : ''}</div>`, true);
  prQ('pv-x').onclick = prModalClose;
  prQ('pv-dl').onclick = async () => { try { saveBlob(await Payroll.payslipPdf(PR.month, l.employee_id), prSlipFile(l)); prModalClose(); prPayslips(); } catch (e) { showToast(prErr(e), true); } };
  prQ('pv-pr').onclick = async () => { try { const url = URL.createObjectURL(await Payroll.payslipPdf(PR.month, l.employee_id)); const w = window.open(url, '_blank'); if (!w) showToast('Allow pop-ups to print, or use Download PDF.', true); } catch (e) { showToast(prErr(e), true); } };
  const wa = prQ('pv-wa'); if (wa) wa.onclick = () => { prModalClose(); prShare(l); };
}
function prWordsOf(n) {
  n = Math.round(Math.abs(Number(n) || 0)); const ones = 'Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' '), tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')), three = x => (x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' + two(x % 100) : ''}` : two(x));
  if (!n) return 'Rupees Zero only'; const out = [];
  for (const [div, name] of [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]) if (n >= div) { out.push(`${two(Math.floor(n / div))} ${name}`); n %= div; }
  if (n) out.push(three(n)); return `Rupees ${out.join(' ')} only`;
}

/* ───────────── 5. Configuration ───────────── */
async function prConfig() {
  const c = PR.cfg, main = prQ('pr-main'), ed = prCan('config'), dis = ed ? '' : 'disabled';
  PR.hol = (c.holidays || []).map(h => ({ ...h }));
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const inp = (id, v, o = {}) => `<div class="form-group"><label for="${id}">${o.l}</label><input id="${id}" type="${o.t || 'number'}" ${o.t === 'text' ? '' : 'step="any"'} ${o.m ? `maxlength="${o.m}"` : ''} value="${esc(v)}" ${dis}>${o.h ? `<small class="pll-help">${o.h}</small>` : ''}</div>`;
  const sw = (id, on, l) => `<label class="pr-chk"><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis}> ${l}</label>`;
  main.innerHTML = prHead('Payroll configuration', ed ? 'These rules decide how salaries are calculated. Check the statutory rates with your accountant.' : 'You can view these settings but not change them.', ed ? '<button type="button" class="btn btn-primary btn-sm" id="cf-save">Save configuration</button>' : '') +
    (ed ? '<div class="card pr-card"><div class="pr-ct">Month controls</div><p class="pr-muted">Unlock attendance or reopen a month that was locked or finalised. A reason is always needed and is written to the Activity Log.</p><div id="cf-months"><div class="pr-muted">Loading…</div></div></div>' : '') +
    `<div class="card pr-card"><div class="pr-ct">Pay cycle</div><div class="form-grid">
      <div class="form-group"><label for="cf-sd">Salary days in a month</label><select id="cf-sd" ${dis}><option value="calendar" ${c.salary_days === 'calendar' ? 'selected' : ''}>Calendar days of the month</option><option value="fixed" ${c.salary_days === 'fixed' ? 'selected' : ''}>A fixed number</option></select></div>${inp('cf-fd', c.fixed_days, { l: 'Fixed days (if chosen)', h: 'For example 26.' })}${inp('cf-pd', c.pay_day, { l: 'Salary is paid on day', h: 'Day of the next month (1–28).' })}${inp('cf-cn', c.company_name, { t: 'text', l: 'Company name on pay slips' })}</div>
      <div class="pr-days"><span>Weekly off:</span>${days.map((n, i) => `<label class="pr-chk"><input type="checkbox" data-wo="${i}" ${c.weekly_off.includes(i) ? 'checked' : ''} ${dis}> ${n.slice(0, 3)}</label>`).join('')}</div></div>
    <div class="card pr-card"><div class="pr-ct">Holidays</div><p class="pr-muted">Paid for everyone. Shown as H in the attendance grid and counted as a paid day (unless you mark that day yourself).</p><div id="cf-hol"></div>${ed ? '<div class="btn-group"><button type="button" class="btn btn-outline btn-sm" id="cf-holadd">+ Add holiday</button></div>' : ''}</div>
    <div class="card pr-card"><div class="pr-ct">Salary structures</div><p class="pr-muted">Basic is a % of CTC; HRA is a % of Basic; Employer PF is taken out of the CTC; Special allowance is what remains.</p><div id="cf-tpl">${c.templates.map((t, i) => `<div class="pr-adj" data-t="${i}"><input data-f="name" value="${esc(t.name)}" maxlength="40" ${dis}><label>Basic % <input data-f="basic_pct" type="number" step="any" value="${t.basic_pct}" ${dis}></label><label>HRA % <input data-f="hra_pct" type="number" step="any" value="${t.hra_pct}" ${dis}></label></div>`).join('')}</div></div>
    <div class="card pr-card"><div class="pr-ct">Statutory</div><div class="pr-3">
      <div><h4>Provident fund</h4>${sw('cf-pfon', c.pf.on, 'Switched on')}${inp('cf-pfe', c.pf.employee_pct, { l: 'Employee %' })}${inp('cf-pfr', c.pf.employer_pct, { l: 'Employer %' })}${inp('cf-pfl', c.pf.wage_limit, { l: 'Wage limit (₹)', h: 'PF is worked out on Basic up to this amount.' })}</div>
      <div><h4>ESI</h4>${sw('cf-esion', c.esi.on, 'Switched on')}${inp('cf-esie', c.esi.employee_pct, { l: 'Employee %' })}${inp('cf-esir', c.esi.employer_pct, { l: 'Employer %' })}${inp('cf-esil', c.esi.gross_limit, { l: 'Gross limit (₹)', h: 'ESI applies when the full-month gross is within this.' })}</div>
      <div><h4>Professional tax</h4>${sw('cf-pton', c.pt.on, 'Switched on')}<div id="cf-pt">${c.pt.slabs.map((s, i) => `<div class="pr-adj" data-s="${i}">${s.upto === null ? '<span>Above</span><span></span>' : `<span>Up to ₹</span><input data-f="upto" type="number" value="${s.upto}" ${dis}>`}<span>tax ₹</span><input data-f="amount" type="number" value="${s.amount}" ${dis}></div>`).join('')}</div><small class="pll-help">Slabs depend on your state — set them as your accountant advises.</small></div></div></div>
    <div class="card pr-card"><div class="pr-ct">Attendance and overtime</div><div class="form-grid">${inp('cf-hv', c.attendance.half_value, { l: 'A half day counts as', h: '0.5 = half a day paid.' })}${inp('cf-hd', c.attendance.hours_per_day, { l: 'Working hours in a day' })}${inp('cf-om', c.attendance.ot_multiplier, { l: 'Overtime rate (× hourly pay)', h: 'Hourly pay = CTC ÷ salary days ÷ hours.' })}${inp('cf-ld', c.attendance.lock_day, { l: 'Remind to lock attendance on day' })}</div>${sw('cf-oton', c.attendance.ot_on, 'Pay overtime')}</div>
    <div class="card pr-card"><div class="pr-ct">Pay slip template</div><div class="form-grid">${inp('cf-sa', c.slip.address, { t: 'text', l: 'Company address on pay slip', m: 400 })}${inp('cf-sg', c.slip.gstin || '', { t: 'text', l: 'GSTIN', m: 20, h: 'Printed under the address. Leave empty to hide.' })}${inp('cf-sf', c.slip.footer, { t: 'text', l: 'Footer line', m: 160 })}</div>${sw('cf-slogo', c.slip.logo, 'Show logo')}${sw('cf-saon', c.slip.address_on, 'Show address')}${sw('cf-swon', c.slip.words_on, 'Show net pay in words')}</div>
    <div class="form-error" id="cf-err" role="alert"></div>`;
  const drawHol = () => { prQ('cf-hol').innerHTML = PR.hol.length ? PR.hol.map((h, i) => `<div class="pr-adj" data-h="${i}"><input data-f="date" type="date" value="${h.date}" ${dis}><input data-f="name" value="${esc(h.name)}" maxlength="60" placeholder="Holiday name" ${dis}>${ed ? `<button type="button" class="btn btn-outline btn-sm" data-hrm="${i}">Remove</button>` : ''}</div>`).join('') : '<p class="pr-muted">No holidays added.</p>'; };
  const syncHol = () => { prQ('cf-hol').querySelectorAll('[data-h]').forEach(el => { const i = +el.dataset.h; PR.hol[i].date = el.querySelector('[data-f=date]').value; PR.hol[i].name = el.querySelector('[data-f=name]').value; }); };
  drawHol();
  if (ed) {
    prQ('cf-holadd').onclick = () => { syncHol(); PR.hol.push({ date: '', name: '' }); drawHol(); };
    prQ('cf-hol').addEventListener('click', e => { const b = e.target.closest('[data-hrm]'); if (b) { syncHol(); PR.hol.splice(+b.dataset.hrm, 1); drawHol(); } });
    prMonthControls();
  }
  const sv = prQ('cf-save'); if (!sv) return;
  const v = id => prQ(id).value, ch = id => prQ(id).checked;
  sv.onclick = async () => {
    syncHol();
    const body = { company_name: v('cf-cn'), salary_days: v('cf-sd'), fixed_days: v('cf-fd'), pay_day: v('cf-pd'), weekly_off: [...main.querySelectorAll('[data-wo]')].filter(x => x.checked).map(x => +x.dataset.wo), holidays: PR.hol,
      templates: [...main.querySelectorAll('[data-t]')].map((el, i) => ({ key: c.templates[i].key, name: el.querySelector('[data-f=name]').value, basic_pct: el.querySelector('[data-f=basic_pct]').value, hra_pct: el.querySelector('[data-f=hra_pct]').value })),
      pf: { on: ch('cf-pfon'), employee_pct: v('cf-pfe'), employer_pct: v('cf-pfr'), wage_limit: v('cf-pfl') }, esi: { on: ch('cf-esion'), employee_pct: v('cf-esie'), employer_pct: v('cf-esir'), gross_limit: v('cf-esil') },
      pt: { on: ch('cf-pton'), slabs: [...main.querySelectorAll('[data-s]')].map(el => ({ upto: el.querySelector('[data-f=upto]') ? el.querySelector('[data-f=upto]').value : null, amount: el.querySelector('[data-f=amount]').value })) },
      attendance: { half_value: v('cf-hv'), hours_per_day: v('cf-hd'), ot_multiplier: v('cf-om'), lock_day: v('cf-ld'), ot_on: ch('cf-oton') },
      slip: { logo: ch('cf-slogo'), address_on: ch('cf-saon'), words_on: ch('cf-swon'), address: v('cf-sa'), gstin: v('cf-sg'), footer: v('cf-sf') } };
    try { const r = await Payroll.saveConfig(body); PR.cfg = r.config; PR.meta.config = r.config; showToast('Configuration saved'); prConfig(); } catch (e) { prQ('cf-err').textContent = prErr(e); }
  };
}
async function prMonthControls() {
  const box = prQ('cf-months'); if (!box) return;
  let d; try { d = await Payroll.months(); } catch (e) { box.innerHTML = `<div class="pr-bad pr-empty">${esc(prErr(e))}</div>`; return; }
  const chip = s => `<span class="pr-chip ${{ draft: 'off', reviewed: 'info', finalised: 'warn', paid: 'ok' }[s]}">${PR_STATUS[s]}</span>`;
  box.innerHTML = `<div class="table-wrap"><table class="pr-table"><thead><tr><th>Month</th><th>Payroll</th><th>Attendance</th><th>Finalised by</th><th></th></tr></thead><tbody>${d.months.filter((m, i) => i < 6 || m.status !== 'draft' || m.attendance_locked).map(m => {
    const act = m.status === 'draft' ? (m.attendance_locked ? ['unlock', 'Unlock attendance'] : ['lock', 'Lock attendance']) : [m.status === 'paid' ? 'reopen' : 'reopen', m.status === 'paid' ? 'Reopen (Admin)' : 'Reopen payroll'];
    return `<tr><td data-label="Month"><b>${prMonthName(m.month)}</b></td><td data-label="Payroll">${chip(m.status)}</td><td data-label="Attendance">${m.attendance_locked || m.status === 'finalised' || m.status === 'paid' ? '<span class="pr-chip off">🔒 Locked</span>' : '<span class="pr-chip ok">Open</span>'}</td><td data-label="Finalised by">${m.finalised_by_name ? esc(m.finalised_by_name) + (m.finalised_at ? ', ' + fmtDate(String(m.finalised_at).slice(0, 10)) : '') + (m.paid_on ? ' · paid ' + fmtDate(m.paid_on) : '') : '–'}</td><td class="pr-rowact"><button type="button" class="btn btn-outline btn-sm" data-mc="${act[0]}" data-m="${m.month}">${act[1]}</button></td></tr>`; }).join('')}</tbody></table></div>`;
  box.querySelectorAll('[data-mc]').forEach(b => b.addEventListener('click', async () => {
    const m = b.dataset.m, k = b.dataset.mc;
    try {
      if (k === 'lock') { await Payroll.lock(m); showToast('Attendance locked'); }
      else if (k === 'unlock') { const reason = await askReason({ title: `Unlock ${prMonthName(m)} attendance`, intro: 'Say why this month needs to be changed.', confirmLabel: 'Unlock' }); if (!reason) return; await Payroll.unlock(m, reason); showToast('Unlocked'); }
      else { const reason = await askReason({ title: `Reopen ${prMonthName(m)} payroll`, intro: 'The month goes back to Draft, attendance is unlocked and the salary is calculated again. Pay slips already made for it are cleared. A reason is needed.', confirmLabel: 'Reopen payroll' }); if (!reason) return; await Payroll.setStatus(m, 'draft', reason); showToast('Payroll reopened'); }
      prMonthControls();
    } catch (e) { showToast(prErr(e), true); }
  }));
}

document.addEventListener('click', e => { const b = e.target.closest('[data-pr-open]'); if (b) { e.preventDefault(); openPayroll(); } });
