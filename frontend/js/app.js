/* ── Role → Tab access map ──────────────────────────────────────────────────── */
const ROLE_TABS = {
  entry:     ['supervisor', 'admin'],
  records:   ['owner', 'admin'],
  summary:   ['owner', 'admin'],
  inventory: ['admin'],
  users:     ['admin'],
};
const TAB_ORDER = ['entry', 'records', 'summary', 'inventory', 'users'];

/* ── Boot ────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Auth guard
  if (!sessionStorage.getItem('scc_token')) {
    window.location.href = '/login.html';
    return;
  }
  const ok = await Auth.verify();
  if (!ok) return; // api.js will redirect

  const user = Auth.currentUser();
  if (!user) { Auth.logout(); return; }

  applyRoleUI(user.role);

  document.getElementById('header-user').textContent = `${user.name} / ${capitalize(user.role)}`;
  document.getElementById('f-date').value = today();
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await loadDropdownData();
  setupAutoCalculate();

  const firstTab = TAB_ORDER.find(t => ROLE_TABS[t].includes(user.role)) || 'entry';
  switchTab(firstTab);
});

/* ── Role-based UI ───────────────────────────────────────────────────────────── */
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function applyRoleUI(role) {
  document.querySelectorAll('.tab[data-roles]').forEach(tab => {
    const roles = tab.dataset.roles.split(',');
    tab.style.display = roles.includes(role) ? '' : 'none';
  });
  document.body.classList.toggle('is-admin', role === 'admin');
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function today() { return new Date().toISOString().split('T')[0]; }

// Keep the last loaded records in memory so the Edit modal can look them up
// without an extra round-trip to the server.
let currentRecords = [];

/* ── Vehicle / Operator dropdowns (sourced from Inventory) ───────────────────── */
async function loadDropdownData() {
  try {
    const [vRes, oRes] = await Promise.all([Inventory.getVehicles(), Inventory.getOperators()]);
    const vehicles  = (vRes && vRes.data) || [];
    const operators = (oRes && oRes.data) || [];
    populateSelect('f-vehicle',  vehicles,  'vehicle_no', 'Select vehicle…');
    populateSelect('f-operator', operators, 'name',       'Select operator…');
    populateSelect('e-vehicle',  vehicles,  'vehicle_no', 'Select vehicle…');
    populateSelect('e-operator', operators, 'name',       'Select operator…');
  } catch {
    /* dropdowns stay empty if this role can't reach inventory (shouldn't happen) */
  }
}

function populateSelect(id, items, field, placeholder) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  items.filter(i => i.active !== false).forEach(i => {
    const opt = document.createElement('option');
    opt.value = i[field];
    opt.textContent = i[field];
    sel.appendChild(opt);
  });
  if (cur) sel.value = cur;
}

/* ── Auto-calculate Working Hours / Reading ──────────────────────────────────── */
function setupAutoCalculate() {
  const startEl = document.getElementById('f-start');
  const closeEl = document.getElementById('f-close');
  const hoursEl = document.getElementById('f-hours');
  const hintEl  = document.getElementById('calc-hint');
  if (!startEl || !closeEl || !hoursEl) return;

  // A value only counts as a plain numeric reading (odometer, meter hours...)
  // if the ENTIRE string is a number — e.g. "1250" or "1250.5".
  // Anything containing letters or a colon (":") is treated as a time instead,
  // so "8:30" is never misread as the number 8.
  function isPureNumber(str) {
    return /^\d+(\.\d+)?$/.test(str);
  }

  // Handle 12-hour: 8:00 AM, 06:00 PM, 6:30PM   —   or 24-hour: 08:00, 18:45
  function parseTime(str) {
    const ampm = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      const period = ampm[3].toUpperCase();
      if (h < 1 || h > 12 || m > 59) return null;
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }
    const h24 = str.match(/^(\d{1,2}):(\d{2})$/);
    if (h24) {
      const h = parseInt(h24[1], 10);
      const m = parseInt(h24[2], 10);
      if (h > 23 || m > 59) return null;
      return h * 60 + m;
    }
    return null;
  }

  function calculate() {
    const s = startEl.value.trim();
    const c = closeEl.value.trim();
    if (!s || !c) return;

    // ── Try time format first (24-hour HH:MM or 12-hour H:MM AM/PM) ─────────
    const sMin = parseTime(s);
    const cMin = parseTime(c);
    if (sMin !== null && cMin !== null) {
      let diff = cMin - sMin;
      if (diff < 0) diff += 24 * 60; // crossed midnight
      const hrs  = Math.floor(diff / 60);
      const mins = diff % 60;
      hoursEl.value = mins === 0 ? `${hrs} hrs` : `${hrs} hrs ${mins} mins`;
      if (hintEl) hintEl.textContent = `✅ Auto-calculated: ${hoursEl.value}`;
      hoursEl.style.borderColor = 'var(--green)';
      return;
    }

    // ── Try numeric (odometer/reading) — only if BOTH are pure numbers ──────
    if (isPureNumber(s) && isPureNumber(c)) {
      const sNum = parseFloat(s);
      const cNum = parseFloat(c);
      const diff = cNum - sNum;
      if (diff >= 0) {
        hoursEl.value = diff % 1 === 0 ? diff.toString() : diff.toFixed(1);
        if (hintEl) hintEl.textContent = `✅ Auto-calculated: ${cNum} − ${sNum} = ${hoursEl.value}`;
        hoursEl.style.borderColor = 'var(--green)';
      } else {
        if (hintEl) hintEl.textContent = '⚠️ Closing reading is less than starting reading.';
        hoursEl.style.borderColor = 'var(--red)';
      }
      return;
    }

    // Can't parse — let supervisor type manually
    if (hintEl) hintEl.textContent = 'Enter manually or use format: 08:00 AM / 18:45 / 1250';
    hoursEl.style.borderColor = 'var(--border)';
  }

  startEl.addEventListener('input', calculate);
  closeEl.addEventListener('input', calculate);

  hoursEl.addEventListener('focus', () => {
    hoursEl.style.borderColor = '';
    if (hintEl) hintEl.textContent = '';
  });
}

function resetCalcHint() {
  const hoursEl = document.getElementById('f-hours');
  const hintEl  = document.getElementById('calc-hint');
  if (hoursEl) hoursEl.style.borderColor = '';
  if (hintEl)  hintEl.textContent = '';
}

function fmtDate(d) {
  if (!d) return '–';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' is-error' : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

/* ── Tab ─────────────────────────────────────────────────────────────────────── */
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + name);
  if (tabEl) tabEl.classList.add('active');

  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  const sectionEl = document.getElementById('section-' + name);
  if (sectionEl) sectionEl.classList.add('active');

  if (name === 'records')   loadRecords();
  if (name === 'summary')   { loadSummary(); populateMonthFilter(); }
  if (name === 'inventory') loadInventory();
  if (name === 'users')     loadUsers();
}

/* ── Breakup rows (New Entry form) ───────────────────────────────────────────── */
function addBreakup() {
  const row = document.createElement('div');
  row.className = 'breakup-row';
  row.innerHTML = `
    <input type="text" placeholder="Description" class="bu-desc">
    <input type="text" placeholder="Qty / Hours" class="bu-qty" style="max-width:150px;">
    <button class="remove-breakup-btn" onclick="removeBreakup(this)">×</button>`;
  document.getElementById('breakup-rows').appendChild(row);
}

function removeBreakup(btn) {
  const container = document.getElementById('breakup-rows');
  if (container.querySelectorAll('.breakup-row').length > 1) {
    btn.closest('.breakup-row').remove();
  }
}

function getBreakupData() {
  return [...document.querySelectorAll('#breakup-rows .breakup-row')]
    .map(r => ({
      description: r.querySelector('.bu-desc').value.trim(),
      quantity:    r.querySelector('.bu-qty').value.trim(),
    }))
    .filter(r => r.description || r.quantity);
}

function clearBreakup() {
  document.getElementById('breakup-rows').innerHTML = `
    <div class="breakup-row">
      <input type="text" placeholder="Description (e.g. Earthwork, Levelling...)" class="bu-desc">
      <input type="text" placeholder="Qty / Hours" class="bu-qty" style="max-width:150px;">
      <button class="remove-breakup-btn" onclick="removeBreakup(this)">×</button>
    </div>`;
}

/* ── Form ────────────────────────────────────────────────────────────────────── */
function clearForm() {
  ['f-vehicle','f-start','f-close','f-hours','f-diesel','f-loads','f-operator','f-remarks']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-date').value = today();
  clearBreakup();
  resetCalcHint();
}

async function saveEntry() {
  const date       = document.getElementById('f-date').value;
  const vehicle_no = document.getElementById('f-vehicle').value.trim();
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }

  const payload = {
    date, vehicle_no,
    start_reading: document.getElementById('f-start').value.trim(),
    close_reading: document.getElementById('f-close').value.trim(),
    working_hours: document.getElementById('f-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('f-diesel').value) || 0,
    loads:   parseInt(document.getElementById('f-loads').value)    || 0,
    operator: document.getElementById('f-operator').value.trim(),
    remarks:  document.getElementById('f-remarks').value.trim(),
    breakup_rows: getBreakupData(),
  };

  try {
    await Entries.create(payload);
    showToast('✅ Entry saved successfully!');
    clearForm();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Save failed.'), true);
  }
}

/* ── Records ─────────────────────────────────────────────────────────────────── */
async function loadRecords() {
  const loading = document.getElementById('records-loading');
  const table   = document.getElementById('records-table');
  loading.style.display = 'block';
  table.style.display   = 'none';

  const filters = {};
  const fFrom = document.getElementById('filter-date-from').value;
  const fTo   = document.getElementById('filter-date-to').value;
  const fVeh  = document.getElementById('filter-vehicle').value.trim();
  if (fFrom) filters.date_from = fFrom;
  if (fTo)   filters.date_to   = fTo;
  if (fVeh)  filters.vehicle   = fVeh;

  try {
    const res = await Entries.getAll(filters);
    currentRecords = res.data || [];
    renderRecordsTable(currentRecords);
  } catch (e) {
    showToast('Failed to load records.', true);
  }

  loading.style.display = 'none';
  table.style.display   = 'block';
}

function renderRecordsTable(entries) {
  const tbody   = document.getElementById('records-body');
  const isAdmin = document.body.classList.contains('is-admin');
  tbody.innerHTML = '';

  if (!entries.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${isAdmin ? 13 : 11}">No records found.</td></tr>`;
    return;
  }

  entries.forEach((e, i) => {
    const breakupText = (e.breakup_rows || [])
      .map(b => `${b.description || ''}: ${b.quantity || ''}`)
      .join(' | ') || '–';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${fmtDate(e.date)}</td>
      <td><strong>${e.vehicle_no}</strong></td>
      <td>${e.start_reading || '–'}</td>
      <td>${e.close_reading || '–'}</td>
      <td>${e.working_hours || '–'}</td>
      <td>${e.diesel ?? 0}</td>
      <td>${e.loads ?? 0}</td>
      <td>${e.operator || '–'}</td>
      <td style="max-width:160px;white-space:normal;">${e.remarks || '–'}</td>
      <td style="max-width:180px;white-space:normal;font-size:12px;color:var(--mid);">${breakupText}</td>
      ${isAdmin ? `<td><button class="btn btn-outline btn-sm" onclick="openEditModal('${e.id}')">✏️</button></td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteEntry('${e.id}')">🗑</button></td>` : ''}`;
    tbody.appendChild(tr);
  });
}

function clearFilters() {
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value   = '';
  document.getElementById('filter-vehicle').value   = '';
  loadRecords();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  try {
    await Entries.delete(id);
    showToast('Entry deleted.');
    loadRecords();
  } catch (e) {
    showToast('Delete failed.', true);
  }
}

/* ── Export CSV ──────────────────────────────────────────────────────────────── */
function csvEscape(val) {
  const s = (val === null || val === undefined) ? '' : String(val);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV() {
  if (!currentRecords.length) { showToast('No records to export.', true); return; }

  const headers = ['Date','Vehicle No.','Start','Close','Working Hrs','Diesel (L)','Loads','Operator','Remarks','Breakup'];
  const rows = currentRecords.map(e => {
    const breakupText = (e.breakup_rows || [])
      .map(b => `${b.description || ''}: ${b.quantity || ''}`)
      .join(' | ');
    return [
      fmtDate(e.date), e.vehicle_no, e.start_reading || '', e.close_reading || '',
      e.working_hours || '', e.diesel ?? 0, e.loads ?? 0, e.operator || '', e.remarks || '', breakupText
    ];
  });

  const csv = [headers, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `SCC-site-log-${today()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ── Edit Entry Modal (Admin only) ─────────────────────────────────────────── */
function findRecordById(id) {
  return currentRecords.find(e => String(e.id) === String(id));
}

function openEditModal(id) {
  const entry = findRecordById(id);
  if (!entry) { showToast('Could not find that entry — try reloading records.', true); return; }

  document.getElementById('e-id').value       = entry.id;
  document.getElementById('e-date').value     = entry.date || '';
  document.getElementById('e-vehicle').value  = entry.vehicle_no || '';
  document.getElementById('e-start').value    = entry.start_reading || '';
  document.getElementById('e-close').value    = entry.close_reading || '';
  document.getElementById('e-hours').value    = entry.working_hours || '';
  document.getElementById('e-diesel').value   = entry.diesel ?? '';
  document.getElementById('e-loads').value    = entry.loads ?? '';
  document.getElementById('e-operator').value = entry.operator || '';
  document.getElementById('e-remarks').value  = entry.remarks || '';

  const buContainer = document.getElementById('e-breakup-rows');
  buContainer.innerHTML = '';
  const rows = (entry.breakup_rows && entry.breakup_rows.length) ? entry.breakup_rows : [{ description: '', quantity: '' }];
  rows.forEach(r => addEditBreakup(r.description, r.quantity));

  document.getElementById('edit-modal-overlay').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('open');
}

function addEditBreakup(desc = '', qty = '') {
  const row = document.createElement('div');
  row.className = 'breakup-row';
  row.innerHTML = `
    <input type="text" placeholder="Description" class="bu-desc" value="${(desc || '').replace(/"/g, '&quot;')}">
    <input type="text" placeholder="Qty / Hours" class="bu-qty" style="max-width:150px;" value="${(qty || '').replace(/"/g, '&quot;')}">
    <button class="remove-breakup-btn" onclick="removeEditBreakup(this)">×</button>`;
  document.getElementById('e-breakup-rows').appendChild(row);
}

function removeEditBreakup(btn) {
  const container = document.getElementById('e-breakup-rows');
  if (container.querySelectorAll('.breakup-row').length > 1) {
    btn.closest('.breakup-row').remove();
  }
}

function getEditBreakupData() {
  return [...document.querySelectorAll('#e-breakup-rows .breakup-row')]
    .map(r => ({
      description: r.querySelector('.bu-desc').value.trim(),
      quantity:    r.querySelector('.bu-qty').value.trim(),
    }))
    .filter(r => r.description || r.quantity);
}

async function submitEditEntry() {
  const id         = document.getElementById('e-id').value;
  const date       = document.getElementById('e-date').value;
  const vehicle_no = document.getElementById('e-vehicle').value.trim();
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }

  const payload = {
    date, vehicle_no,
    start_reading: document.getElementById('e-start').value.trim(),
    close_reading: document.getElementById('e-close').value.trim(),
    working_hours: document.getElementById('e-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('e-diesel').value) || 0,
    loads:   parseInt(document.getElementById('e-loads').value)    || 0,
    operator: document.getElementById('e-operator').value.trim(),
    remarks:  document.getElementById('e-remarks').value.trim(),
    breakup_rows: getEditBreakupData(),
  };

  try {
    await Entries.update(id, payload);
    showToast('✅ Entry updated successfully!');
    closeEditModal();
    loadRecords();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

/* ── Summary ─────────────────────────────────────────────────────────────────── */
async function loadSummary() {
  const month = document.getElementById('sum-month').value;
  const filters = month ? { month } : {};

  try {
    const res = await Entries.stats(filters);
    const s   = res.data || {};
    document.getElementById('s-entries').textContent  = s.total_entries  ?? '–';
    document.getElementById('s-diesel').textContent   = s.total_diesel   ?? '–';
    document.getElementById('s-loads').textContent    = s.total_loads    ?? '–';
    document.getElementById('s-vehicles').textContent = s.unique_vehicles ?? '–';
  } catch { /* non-critical */ }

  try {
    const res = await Entries.getAll(filters);
    renderVehicleBreakdown(res.data || []);
  } catch { /* non-critical */ }

  try {
    const res = await Summaries.getAll();
    renderSummariesTable(res.data || []);
  } catch { /* non-critical */ }
}

function renderVehicleBreakdown(entries) {
  const tbody = document.getElementById('vehicle-summary-body');
  tbody.innerHTML = '';

  if (!entries.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No records yet.</td></tr>';
    return;
  }

  const byVehicle = {};
  entries.forEach(e => {
    const key = e.vehicle_no || 'Unknown';
    if (!byVehicle[key]) byVehicle[key] = { entries: 0, diesel: 0, loads: 0 };
    byVehicle[key].entries += 1;
    byVehicle[key].diesel  += parseFloat(e.diesel) || 0;
    byVehicle[key].loads   += parseInt(e.loads) || 0;
  });

  Object.keys(byVehicle).sort().forEach(vehicle => {
    const v = byVehicle[vehicle];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${vehicle}</strong></td>
      <td>${v.entries}</td>
      <td>${v.diesel.toFixed(2)}</td>
      <td>${v.loads}</td>`;
    tbody.appendChild(tr);
  });
}

function renderSummariesTable(list) {
  const tbody = document.getElementById('summaries-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No manual summaries yet.</td></tr>';
    return;
  }
  list.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${s.period || '–'}</strong></td>
      <td>${s.total_diesel ?? 0} L</td>
      <td>${s.total_hours || '–'}</td>
      <td>${s.total_loads ?? 0}</td>
      <td style="max-width:200px;white-space:normal;font-size:12px;">${s.notes || '–'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteSummary('${s.id}')">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

async function saveSummary() {
  const period = document.getElementById('ms-period').value.trim();
  if (!period) { showToast('Period is required.', true); return; }

  const payload = {
    period,
    total_diesel: parseFloat(document.getElementById('ms-diesel').value) || 0,
    total_hours:  document.getElementById('ms-hours').value.trim(),
    total_loads:  parseInt(document.getElementById('ms-loads').value)    || 0,
    notes:        document.getElementById('ms-notes').value.trim(),
  };

  try {
    await Summaries.create(payload);
    showToast('✅ Summary saved!');
    ['ms-period','ms-diesel','ms-hours','ms-loads','ms-notes']
      .forEach(id => document.getElementById(id).value = '');
    loadSummary();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Save failed.'), true);
  }
}

async function deleteSummary(id) {
  if (!confirm('Delete this summary?')) return;
  try {
    await Summaries.delete(id);
    showToast('Summary deleted.');
    loadSummary();
  } catch (e) {
    showToast('Delete failed.', true);
  }
}

/* ── Month filter dropdown ───────────────────────────────────────────────────── */
async function populateMonthFilter() {
  try {
    const res     = await Entries.getAll();
    const entries = res.data || [];
    const months  = [...new Set(
      entries.map(e => e.date ? e.date.substring(0, 7) : null).filter(Boolean)
    )].sort().reverse();

    const sel = document.getElementById('sum-month');
    const cur = sel.value;
    sel.innerHTML = '<option value="">All Time</option>';
    months.forEach(m => {
      const [y, mo] = m.split('-');
      const label = new Date(y, mo - 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = label;
      if (m === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch { /* non-critical */ }
}

/* ── Inventory (Admin) ─────────────────────────────────────────────────────── */
async function loadInventory() {
  try {
    const res = await Inventory.getVehicles();
    renderVehiclesTable(res.data || []);
  } catch { showToast('Failed to load vehicles.', true); }

  try {
    const res = await Inventory.getOperators();
    renderOperatorsTable(res.data || []);
  } catch { showToast('Failed to load operators.', true); }
}

function renderVehiclesTable(list) {
  const tbody = document.getElementById('vehicles-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No vehicles yet. Add one above.</td></tr>';
    return;
  }
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${v.vehicle_no}</strong></td>
      <td>${v.type || '–'}</td>
      <td>
        <button class="btn ${v.active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="toggleVehicleActive('${v.id}', ${v.active})">
          ${v.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteVehicle('${v.id}')">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderOperatorsTable(list) {
  const tbody = document.getElementById('operators-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No operators yet. Add one above.</td></tr>';
    return;
  }
  list.forEach(o => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${o.name}</strong></td>
      <td>${o.phone || '–'}</td>
      <td>
        <button class="btn ${o.active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="toggleOperatorActive('${o.id}', ${o.active})">
          ${o.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteOperator('${o.id}')">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

async function addVehicle() {
  const vehicle_no = document.getElementById('inv-vehicle-no').value.trim();
  const type       = document.getElementById('inv-vehicle-type').value.trim();
  if (!vehicle_no) { showToast('Vehicle / Machine No. is required.', true); return; }

  try {
    await Inventory.addVehicle({ vehicle_no, type });
    showToast('✅ Vehicle added!');
    document.getElementById('inv-vehicle-no').value = '';
    document.getElementById('inv-vehicle-type').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not add vehicle.'), true);
  }
}

async function toggleVehicleActive(id, currentActive) {
  try {
    await Inventory.updateVehicle(id, { active: !currentActive });
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

async function deleteVehicle(id) {
  if (!confirm('Remove this vehicle from inventory?')) return;
  try {
    await Inventory.deleteVehicle(id);
    showToast('Vehicle removed.');
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('Delete failed.', true);
  }
}

async function addOperator() {
  const name  = document.getElementById('inv-operator-name').value.trim();
  const phone = document.getElementById('inv-operator-phone').value.trim();
  if (!name) { showToast('Operator name is required.', true); return; }

  try {
    await Inventory.addOperator({ name, phone });
    showToast('✅ Operator added!');
    document.getElementById('inv-operator-name').value = '';
    document.getElementById('inv-operator-phone').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not add operator.'), true);
  }
}

async function toggleOperatorActive(id, currentActive) {
  try {
    await Inventory.updateOperator(id, { active: !currentActive });
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

async function deleteOperator(id) {
  if (!confirm('Remove this operator from inventory?')) return;
  try {
    await Inventory.deleteOperator(id);
    showToast('Operator removed.');
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('Delete failed.', true);
  }
}

/* ── Users (Admin) ────────────────────────────────────────────────────────── */
async function loadUsers() {
  try {
    const res = await Users.getAll();
    renderUsersTable(res.data || []);
  } catch (e) {
    showToast('Failed to load users.', true);
  }
}

function renderUsersTable(list) {
  const tbody = document.getElementById('users-body');
  const me    = Auth.currentUser();
  tbody.innerHTML = '';

  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No users yet.</td></tr>';
    return;
  }

  list.forEach(u => {
    const isSelf = me && u.id === me.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${u.name}</strong>${isSelf ? ' <span class="badge">You</span>' : ''}</td>
      <td>${u.pin}</td>
      <td>
        <select onchange="updateUserRole('${u.id}', this.value)" ${isSelf ? 'disabled title="You cannot change your own role"' : ''} style="width:auto;padding:6px 8px;">
          <option value="supervisor" ${u.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
          <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>
        <button class="btn ${u.active ? 'btn-green' : 'btn-outline'} btn-sm"
          onclick="toggleUserActive('${u.id}', ${u.active})"
          ${isSelf ? 'disabled title="You cannot deactivate your own account"' : ''}>
          ${u.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${u.id}')" ${isSelf ? 'disabled title="You cannot delete your own account"' : ''}>🗑</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function createUser() {
  const name = document.getElementById('u-name').value.trim();
  const pin  = document.getElementById('u-pin').value.trim();
  const role = document.getElementById('u-role').value;
  if (!name || !pin) { showToast('Name and PIN are required.', true); return; }

  try {
    await Users.create({ name, pin, role });
    showToast('✅ User created!');
    document.getElementById('u-name').value = '';
    document.getElementById('u-pin').value  = '';
    loadUsers();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not create user.'), true);
  }
}

async function updateUserRole(id, role) {
  try {
    await Users.update(id, { role });
    showToast('✅ Role updated.');
    loadUsers();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
    loadUsers();
  }
}

async function toggleUserActive(id, currentActive) {
  try {
    await Users.update(id, { active: !currentActive });
    loadUsers();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

async function deleteUser(id) {
  if (!confirm('Delete this user? They will no longer be able to log in.')) return;
  try {
    await Users.delete(id);
    showToast('User deleted.');
    loadUsers();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Delete failed.'), true);
  }
}
