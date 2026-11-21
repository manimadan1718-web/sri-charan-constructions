/* ═══════════════════════════════════════════════════════════════════════════════
   Vehicle documents (Renewals > "Vehicle documents"): one row per vehicle with its Insurance, Permit, Tax, FC and PUCC
   expiry dates and its Registration date. Loaded after app.js and api.js.
   ═══════════════════════════════════════════════════════════════════════════════ */
const VD = { rows: [], kinds: [], summary: null, today: '', setup: false, q: '', show: 'all', editing: null, timer: null, ready: false };
const VD_CHIP = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', upcoming: 'Valid', renewed: 'Renewed' };
const vdEl = id => document.getElementById(id);

function showRnPane(p) {
  const v = p === 'vehicles';
  vdEl('rn-pane-list').hidden = v; vdEl('rn-pane-vehicles').hidden = !v;
  [['list', !v], ['vehicles', v]].forEach(([n, on]) => { const b = vdEl('rntab-' + n); b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
  if (v) loadVehicleDocs();
}

function vdWhen(c) {
  if (c.status === 'renewed') return 'Renewed';
  const n = Math.abs(c.days_left), s = n === 1 ? '' : 's';
  if (c.state === 'overdue') return `Overdue by ${n} day${s}`;
  if (c.state === 'today') return 'Expires today';
  return `Expires in ${n} day${s}`;
}
function vdCell(v, k) {
  const c = v.docs[k.key], add = can('renewals.add');
  if (!c) return add ? `<button type="button" class="vd-cell vd-empty" data-vd-veh="${esc(v.id)}" data-vd-kind="${esc(k.key)}">+ Add date</button>` : '<span class="pl-none">—</span>';
  const state = c.status === 'renewed' ? 'renewed' : c.state;
  const inner = `<strong>${esc(fmtDate(c.date))}</strong><span class="rn-chip rn-chip-${state}">${VD_CHIP[state]}</span><span class="vd-when">${esc(vdWhen(c))}</span>`;
  return add ? `<button type="button" class="vd-cell vd-${state}" data-vd-veh="${esc(v.id)}" data-vd-kind="${esc(k.key)}" title="Change the ${esc(k.label)} date">${inner}</button>` : `<div class="vd-cell vd-${state}">${inner}</div>`;
}
function vdRegCell(v) {
  const add = can('renewals.add');
  if (!v.registration_date) return add ? `<button type="button" class="vd-cell vd-empty" data-vd-veh="${esc(v.id)}" data-vd-kind="registration">+ Add date</button>` : '<span class="pl-none">—</span>';
  return add ? `<button type="button" class="vd-cell" data-vd-veh="${esc(v.id)}" data-vd-kind="registration" title="Change the registration date"><strong>${esc(fmtDate(v.registration_date))}</strong></button>` : `<strong>${esc(fmtDate(v.registration_date))}</strong>`;
}
function vdFiltered() {
  const q = VD.q.trim().toLowerCase();
  return VD.rows.filter(v => (!q || String(v.vehicle_no).toLowerCase().includes(q))
    && (VD.show === 'all' || (VD.show === 'attention' ? VD.kinds.some(k => { const c = v.docs[k.key]; return c && c.status !== 'renewed' && ['overdue', 'today', 'soon'].includes(c.state); }) : VD.kinds.some(k => !v.docs[k.key]))));
}
function renderVd() {
  const s = VD.summary || { overdue: 0, today: 0, soon: 0, ok: 0, missing: 0 };
  const card = (cls, label, n, note) => `<div class="rn-card rn-c-${cls}"><span class="pl-lbl">${label}</span><span class="rn-num">${n}</span><span class="pl-note">${note}</span></div>`;
  vdEl('vd-chips').innerHTML = card('overdue', 'Overdue', s.overdue, s.overdue ? 'Past the expiry date' : 'Nothing overdue') + card('today', 'Due today', s.today, s.today ? 'Renew today' : 'Nothing due today')
    + card('soon', 'Due soon', s.soon, 'Inside the reminder window') + card('upcoming', 'Valid', s.ok, `${s.missing} date${s.missing === 1 ? '' : 's'} not entered`);
  const rows = vdFiltered(), body = vdEl('vd-body');
  vdEl('vd-count').textContent = VD.setup ? 'Needs a one-time database update — run run-in-supabase-18-vehicle-documents.sql in Supabase, then reload this page.'
    : VD.rows.length ? (rows.length === VD.rows.length ? plural(VD.rows.length, 'vehicle') : `Showing ${rows.length} of ${plural(VD.rows.length, 'vehicle')}`) : 'No vehicles yet.';
  if (!rows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="8">${VD.rows.length ? 'No vehicles match these filters.' : 'No vehicles yet. Add them in Inventory first.'}</td></tr>`; return; }
  body.innerHTML = rows.map((v, i) => `<tr class="vd-row">
      <td data-label="Sl No">${i + 1}</td>
      <td data-label="Vehicle No"><strong>${esc(v.vehicle_no)}</strong>${v.type ? `<span class="vd-type">${esc(v.type)}</span>` : ''}</td>
      ${VD.kinds.map(k => `<td data-label="${esc(k.label)}" class="vd-td">${vdCell(v, k)}</td>`).join('')}
      <td data-label="Registration date" class="vd-td">${vdRegCell(v)}</td></tr>`).join('');
}
async function loadVehicleDocs() {
  if (!VD.ready) {
    VD.ready = true; vdEl('vd-chips').classList.add('rn-cards');
    vdEl('vd-q').addEventListener('input', ev => { VD.q = ev.target.value; clearTimeout(VD.timer); VD.timer = setTimeout(renderVd, 150); });
    vdEl('vd-show').addEventListener('change', ev => { VD.show = ev.target.value; renderVd(); });
    vdEl('vd-clear').addEventListener('click', () => { VD.q = ''; VD.show = 'all'; vdEl('vd-q').value = ''; vdEl('vd-show').value = 'all'; renderVd(); });
    vdEl('vd-body').addEventListener('click', ev => { const b = ev.target.closest('[data-vd-veh]'); if (b) openVd(b.dataset.vdVeh, b.dataset.vdKind); });
    vdEl('vd-date').addEventListener('keydown', ev => { if (ev.key === 'Enter') saveVd(); });
  }
  try {
    const r = await VehicleDocs.list();
    VD.rows = r.data || []; VD.kinds = r.kinds || []; VD.summary = r.summary; VD.today = r.today; VD.setup = !!r.setup_required;
    renderVd();
  } catch (e) { vdEl('vd-body').innerHTML = `<tr class="empty-row"><td colspan="8">${esc(e.message || 'The vehicle documents could not be loaded.')}</td></tr>`; }
}

/* ── set / change one date ── */
function openVd(vehId, kind) {
  const v = VD.rows.find(x => String(x.id) === String(vehId)); if (!v) return;
  const reg = kind === 'registration', k = VD.kinds.find(x => x.key === kind), cur = reg ? v.registration_date : (v.docs[kind] && v.docs[kind].date) || null;
  VD.editing = { v, kind, reg, cur, label: reg ? 'Registration date' : k.label };
  vdEl('vd-title').textContent = `${VD.editing.label} — ${v.vehicle_no}`;
  vdEl('vd-intro').innerHTML = cur ? `Now saved: <strong>${esc(fmtDate(cur))}</strong>` : 'No date saved yet.';
  vdEl('vd-date-label').textContent = reg ? 'Registration date *' : 'Valid till (expiry date) *';
  vdEl('vd-hint').textContent = !cur ? '' : reg ? 'Changing it needs a reason.' : 'A later date counts as renewed and starts new reminders. An earlier date is a correction and needs a reason.';
  vdEl('vd-date').value = reg ? (cur || '') : ''; vdEl('vd-date').max = reg ? today() : '';
  vdEl('vd-err').textContent = ''; vdEl('vd-overlay').classList.add('open');
  setTimeout(() => vdEl('vd-date').focus(), 50);
}
function closeVd() { vdEl('vd-overlay').classList.remove('open'); VD.editing = null; }
async function saveVd() {
  const e = VD.editing; if (!e) return;
  const date = vdEl('vd-date').value, err = vdEl('vd-err'), btn = vdEl('vd-save'); err.textContent = '';
  if (!date) { err.textContent = 'Choose the date.'; return; }
  if (e.cur && date === e.cur) { closeVd(); return; }
  if (e.reg && date > today()) { err.textContent = 'The registration date cannot be in the future.'; return; }
  let reason;
  if (e.cur && (e.reg || date < e.cur)) {
    if (!can('renewals.edit')) { err.textContent = 'Changing a saved date needs the Edit permission. Ask the Admin.'; return; }
    reason = await askReason({ title: 'Why is the date being changed?', intro: `<strong>${esc(e.v.vehicle_no)}</strong> — ${esc(e.label)}: ${esc(fmtDate(e.cur))} → ${esc(fmtDate(date))}`, confirmLabel: 'Confirm & Save' });
    if (!reason) return;
  }
  btn.disabled = true;
  try { await VehicleDocs.setDate(e.v.id, e.kind, date, reason); closeVd(); showToast(`${e.label} saved for ${e.v.vehicle_no}.`); await loadVehicleDocs(); if (typeof loadRenewals === 'function') loadRenewals(); if (typeof refreshBell === 'function') refreshBell(true); }
  catch (x) { err.textContent = x.message || 'The date could not be saved.'; }
  finally { btn.disabled = false; }
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && vdEl('vd-overlay') && vdEl('vd-overlay').classList.contains('open')) closeVd(); });
