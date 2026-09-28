/* ── Role → Tab access map ──────────────────────────────────────────────────── */
const ROLE_TABS = {
  entry:     ['supervisor', 'admin'],
  records:   ['owner', 'admin'],
  summary:   ['owner', 'admin'],
  inventory: ['admin'],
  users:     ['admin'],
  logs:      ['owner', 'admin'],
};
const TAB_ORDER = ['entry', 'records', 'summary', 'inventory', 'users', 'logs'];

/* ── Boot ────────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Auth guard
  if (!sessionStorage.getItem('scc_token')) {
    window.location.href = '/login.html';
    return;
  }
  const ok = await Auth.verify();
  if (!ok) {
    // A 401 is redirected to the login page by api.js. Anything else
    // (server down, network error) would otherwise leave a blank page.
    if (sessionStorage.getItem('scc_token')) {
      showToast('Cannot reach the server. Please refresh in a moment.', true);
    }
    return;
  }

  const user = Auth.currentUser();
  if (!user) { Auth.logout(); return; }

  applyRoleUI(user.role);
  initReasonModal();

  document.getElementById('header-user').textContent = `${user.name} / ${capitalize(user.role)}`;
  document.getElementById('f-date').value = today();
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await loadDropdownData();
  setupAutoCalculate();
  toggleCategoryFields('f');

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
// Local calendar date as YYYY-MM-DD. (toISOString() is UTC, which gives
// *yesterday's* date in India before 5:30 AM.)
function today() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Everything that comes from the database or a user is escaped before being
// put into innerHTML, otherwise a remark like <img onerror=...> would run.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Select a value even if it isn't in the dropdown (e.g. the vehicle/site/operator
// was later marked inactive). Without this the select silently resets to blank
// and saving the edit would wipe that field.
function setSelectValue(id, value) {
  const sel = document.getElementById(id);
  if (!sel) return;
  if (value && ![...sel.options].some(o => o.value === value)) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    sel.appendChild(opt);
  }
  sel.value = value || '';
}

// Keep the last loaded records in memory so the Edit modal can look them up
// without an extra round-trip to the server.
let currentRecords = [];

/* ── Vehicle / Operator dropdowns (sourced from Inventory) ───────────────────── */
async function loadDropdownData() {
  try {
    const [vRes, oRes, sRes] = await Promise.all([Inventory.getVehicles(), Inventory.getOperators(), Inventory.getSites()]);
    const vehicles  = (vRes && vRes.data) || [];
    const operators = (oRes && oRes.data) || [];
    const sites     = (sRes && sRes.data) || [];
    populateSelect('f-vehicle',  vehicles,  'vehicle_no', 'Select vehicle…');
    populateSelect('f-operator', operators, 'name',       'Select operator…');
    populateSelect('f-site',     sites,     'name',       'Select site…');
    populateSelect('e-vehicle',  vehicles,  'vehicle_no', 'Select vehicle…');
    populateSelect('e-operator', operators, 'name',       'Select operator…');
    populateSelect('e-site',     sites,     'name',       'Select site…');
    // Records filters: everything in the inventory — including inactive items,
    // because old records can still belong to them.
    populateFilterSelect('filter-vehicle', vehicles, 'vehicle_no', 'All vehicles');
    populateFilterSelect('filter-site',    sites,    'name',       'All sites');
    populateFilterSelect('filter-type',    distinctTypes(vehicles), 'type', 'All types');
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

// Types typed as "Tipper" and "tipper" are the same type — list each once.
function distinctTypes(vehicles) {
  const seen = new Map();
  vehicles.forEach(v => {
    const t = (v.type || '').trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  });
  return [...seen.values()].sort((x, y) => x.localeCompare(y)).map(type => ({ type }));
}

// The dropdowns list what is in Inventory. Records can also hold values that are NOT
// in Inventory (rental vehicles are typed in by hand; a site may have been removed).
// Those are discovered from the records themselves and added, so nothing is unfindable.
const filterLists  = {};                                          // id → { items, field, placeholder }
const extraFilterValues = { 'filter-vehicle': new Set(), 'filter-site': new Set() };

function populateFilterSelect(id, items, field, placeholder) {
  filterLists[id] = { items, field, placeholder };
  renderFilterSelect(id);
}

function renderFilterSelect(id) {
  const sel = $(id);
  const cfg = filterLists[id];
  if (!sel || !cfg) return;
  const cur = sel.value;
  sel.innerHTML = '';
  sel.appendChild(new Option(cfg.placeholder, ''));
  const inInventory = new Set();
  cfg.items.forEach(i => {
    inInventory.add(i[cfg.field]);
    const inactive = i.active === false;
    sel.appendChild(new Option(inactive ? `${i[cfg.field]} (inactive)` : i[cfg.field], i[cfg.field]));
  });
  [...(extraFilterValues[id] || [])].filter(v => !inInventory.has(v)).sort()
    .forEach(v => sel.appendChild(new Option(`${v} (not in inventory)`, v)));
  // keep the current choice if it still exists
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : '';
}

function rememberRecordValues(records) {
  records.forEach(r => {
    if (r.vehicle_no) extraFilterValues['filter-vehicle'].add(r.vehicle_no);
    if (r.site)       extraFilterValues['filter-site'].add(r.site);
  });
  renderFilterSelect('filter-vehicle');
  renderFilterSelect('filter-site');
}

const FILTER_IDS = ['filter-date-from', 'filter-date-to', 'filter-category', 'filter-vehicle', 'filter-site', 'filter-type'];
function syncFilterHighlights() {
  FILTER_IDS.forEach(id => {
    const el = $(id);
    if (el && el.closest('.filter-field')) el.closest('.filter-field').classList.toggle('is-active', !!el.value);
  });
}

/* ── Own vs Rental: swap the Vehicle/Operator dropdowns for free-text fields ─── */
function toggleCategoryFields(prefix) {
  const category      = document.getElementById(prefix + '-category').value;
  const vehicleSelect  = document.getElementById(prefix + '-vehicle');
  const vehicleText    = document.getElementById(prefix + '-vehicle-text');
  const operatorSelect = document.getElementById(prefix + '-operator');
  const operatorText   = document.getElementById(prefix + '-operator-text');
  const isRental = category === 'rental';

  vehicleSelect.style.display  = isRental ? 'none' : '';
  vehicleText.style.display    = isRental ? '' : 'none';
  operatorSelect.style.display = isRental ? 'none' : '';
  operatorText.style.display   = isRental ? '' : 'none';

  // Clear whichever pair just became hidden, so a stale value can't get submitted.
  if (isRental) {
    vehicleSelect.value  = '';
    operatorSelect.value = '';
  } else {
    vehicleText.value  = '';
    operatorText.value = '';
  }
}

function getVehicleValue(prefix) {
  const category = document.getElementById(prefix + '-category').value;
  const el = document.getElementById(prefix + (category === 'rental' ? '-vehicle-text' : '-vehicle'));
  return el.value.trim();
}

function getOperatorValue(prefix) {
  const category = document.getElementById(prefix + '-category').value;
  const el = document.getElementById(prefix + (category === 'rental' ? '-operator-text' : '-operator'));
  return el.value.trim();
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
  // An optional unit (km, hrs...) after the number is fine: "1250 km".
  function parseReading(str) {
    const m = str.match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/);
    return m ? { num: parseFloat(m[1]), unit: m[2].toLowerCase() } : null;
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

    // ── Try numeric (odometer/reading) — only if BOTH are numbers with the same unit ──
    const sRead = parseReading(s);
    const cRead = parseReading(c);
    if (sRead && cRead && sRead.unit === cRead.unit) {
      const sNum = sRead.num;
      const cNum = cRead.num;
      const diff = cNum - sNum;
      if (diff >= 0) {
        const unit = sRead.unit ? ' ' + sRead.unit : '';
        // round to 2 dp to avoid floating-point noise like 130.10000000000002
        hoursEl.value = (Math.round(diff * 100) / 100).toString() + unit;
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
  if (name === 'logs')      loadLogs(true);
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
  ['f-vehicle','f-vehicle-text','f-start','f-close','f-hours','f-diesel','f-loads','f-operator','f-operator-text','f-remarks','f-site']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-date').value = today();
  document.getElementById('f-category').value = 'own';
  toggleCategoryFields('f');
  clearBreakup();
  resetCalcHint();
}

async function saveEntry() {
  const date       = document.getElementById('f-date').value;
  const vehicle_no = getVehicleValue('f');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }

  const payload = {
    date, vehicle_no,
    site: document.getElementById('f-site').value.trim(),
    category: document.getElementById('f-category').value,
    start_reading: document.getElementById('f-start').value.trim(),
    close_reading: document.getElementById('f-close').value.trim(),
    working_hours: document.getElementById('f-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('f-diesel').value) || 0,
    loads:   parseInt(document.getElementById('f-loads').value)    || 0,
    operator: getOperatorValue('f'),
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
let recordsRequestSeq = 0;
let recordsDebounce = null;

// Used by the text filters (vehicle / site) so we don't fire a request per keystroke.
function loadRecordsDebounced() {
  clearTimeout(recordsDebounce);
  recordsDebounce = setTimeout(loadRecords, 300);
}

async function loadRecords() {
  const seq = ++recordsRequestSeq;
  const loading = document.getElementById('records-loading');
  const table   = document.getElementById('records-table');
  loading.style.display = 'block';
  table.style.display   = 'none';

  const filters = {};
  const fFrom = document.getElementById('filter-date-from').value;
  const fTo   = document.getElementById('filter-date-to').value;
  const fVeh  = document.getElementById('filter-vehicle').value;
  const fSite = document.getElementById('filter-site').value;
  const fCat  = document.getElementById('filter-category').value;
  const fType = document.getElementById('filter-type').value;
  if (fType) filters.type       = fType;       // vehicle type from Inventory (Tipper, JCB…)
  if (fFrom) filters.date_from  = fFrom;
  if (fTo)   filters.date_to    = fTo;
  if (fVeh)  filters.vehicle_no = fVeh;      // exact — the value comes from the dropdown
  if (fSite) filters.site_name  = fSite;
  if (fCat)  filters.category   = fCat;

  try {
    const res = await Entries.getAll(filters);
    if (seq !== recordsRequestSeq) return; // a newer request superseded this one
    currentRecords = res.data || [];
    // With no filter on, this is the complete list — learn any vehicles / sites that aren't in Inventory.
    if (!Object.keys(filters).length) rememberRecordValues(currentRecords);
    syncFilterHighlights();
    const n = currentRecords.length;
    document.getElementById('records-count').textContent =
      `${n} record${n === 1 ? '' : 's'}${Object.keys(filters).length ? ' match your filters' : ''}`;
    renderRecordsTable(currentRecords);
    loadHistoryCounts(seq);
  } catch (e) {
    if (seq !== recordsRequestSeq) return;
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${isAdmin ? 16 : 14}">No records found.</td></tr>`;
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
      <td>${esc(e.site) || '–'}</td>
      <td>${e.category === 'rental' ? '<span class="pill pill-rental">Rental</span>' : '<span class="pill pill-own">Own</span>'}</td>
      <td><strong>${esc(e.vehicle_no)}</strong></td>
      <td>${esc(e.start_reading) || '–'}</td>
      <td>${esc(e.close_reading) || '–'}</td>
      <td>${esc(e.working_hours) || '–'}</td>
      <td>${esc(e.diesel ?? 0)}</td>
      <td>${esc(e.loads ?? 0)}</td>
      <td>${esc(e.operator) || '–'}</td>
      <td style="max-width:160px;white-space:normal;">${esc(e.remarks) || '–'}</td>
      <td style="max-width:180px;white-space:normal;font-size:12px;color:var(--mid);">${esc(breakupText)}</td>
      <td class="hist-col"><button class="btn btn-outline btn-sm hist-btn" data-id="${esc(e.id)}" onclick="openHistory(this.dataset.id)" title="View history">${CLOCK_SVG}<span class="hist-count"></span></button></td>
      ${isAdmin ? `<td class="edit-col"><button class="btn btn-outline btn-sm" onclick="openEditModal('${esc(e.id)}')">✏️</button></td>
      <td class="del-col"><button class="btn btn-danger btn-sm" onclick="deleteEntry('${esc(e.id)}')">🗑</button></td>` : ''}`;
    tbody.appendChild(tr);
  });
}

function clearFilters() {
  document.getElementById('filter-date-from').value = '';
  document.getElementById('filter-date-to').value   = '';
  document.getElementById('filter-vehicle').value   = '';
  document.getElementById('filter-site').value      = '';
  document.getElementById('filter-category').value  = '';
  document.getElementById('filter-type').value      = '';
  loadRecords();
}

async function deleteEntry(id) {
  const entry = findRecordById(id);
  const what  = entry ? `${entry.vehicle_no} · ${fmtDate(entry.date)}` : 'this entry';
  const reason = await askReason({
    title: 'Reason for Deletion',
    intro: `You are deleting <strong>${esc(what)}</strong>. This cannot be undone, but the deletion and a copy of the entry are kept in the Activity Logs.`,
    confirmLabel: 'Delete Entry',
    danger: true,
  });
  if (!reason) return;
  try {
    await Entries.delete(id, reason);
    showToast('Entry deleted.');
    loadRecords();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Delete failed.'), true);
  }
}

/* ── Export CSV ──────────────────────────────────────────────────────────────── */
function csvEscape(val) {
  let s = (val === null || val === undefined) ? '' : String(val);
  // Text starting with = + - @ is executed as a formula by Excel/Sheets
  // (CSV injection). Prefix it with a quote so it stays plain text.
  // Real numbers are left alone so negative values still export as numbers.
  if (typeof val === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV() {
  if (!currentRecords.length) { showToast('No records to export.', true); return; }

  const headers = ['Date','Site','Category','Vehicle No.','Start','Close','Working Hrs','Diesel (L)','Loads','Operator','Remarks','Breakup'];
  const rows = currentRecords.map(e => {
    const breakupText = (e.breakup_rows || [])
      .map(b => `${b.description || ''}: ${b.quantity || ''}`)
      .join(' | ');
    return [
      fmtDate(e.date), e.site || '', e.category === 'rental' ? 'Rental' : 'Own', e.vehicle_no,
      e.start_reading || '', e.close_reading || '',
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
  setSelectValue('e-site', entry.site || '');
  document.getElementById('e-category').value = entry.category === 'rental' ? 'rental' : 'own';
  toggleCategoryFields('e');
  if (entry.category === 'rental') {
    document.getElementById('e-vehicle-text').value  = entry.vehicle_no || '';
    document.getElementById('e-operator-text').value = entry.operator || '';
  } else {
    setSelectValue('e-vehicle',  entry.vehicle_no || '');
    setSelectValue('e-operator', entry.operator || '');
  }
  document.getElementById('e-start').value    = entry.start_reading || '';
  document.getElementById('e-close').value    = entry.close_reading || '';
  document.getElementById('e-hours').value    = entry.working_hours || '';
  document.getElementById('e-diesel').value   = entry.diesel ?? '';
  document.getElementById('e-loads').value    = entry.loads ?? '';
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
    <input type="text" placeholder="Description" class="bu-desc" value="${esc(desc)}">
    <input type="text" placeholder="Qty / Hours" class="bu-qty" style="max-width:150px;" value="${esc(qty)}">
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
  const vehicle_no = getVehicleValue('e');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }

  const payload = {
    date, vehicle_no,
    site: document.getElementById('e-site').value.trim(),
    category: document.getElementById('e-category').value,
    start_reading: document.getElementById('e-start').value.trim(),
    close_reading: document.getElementById('e-close').value.trim(),
    working_hours: document.getElementById('e-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('e-diesel').value) || 0,
    loads:   parseInt(document.getElementById('e-loads').value)    || 0,
    operator: getOperatorValue('e'),
    remarks:  document.getElementById('e-remarks').value.trim(),
    breakup_rows: getEditBreakupData(),
  };

  // Work out what actually changed. Nothing changed → nothing to save (or explain).
  const original = findRecordById(id);
  const changes  = original ? diffEntry(original, payload) : [];
  if (original && !changes.length) {
    showToast('No changes were made.');
    return;
  }

  // Every change must be explained: popup asks for a reason of 10+ characters.
  const reason = await askReason({
    title: 'Reason for Changes',
    intro: 'Please explain why this entry is being changed. It is saved in the entry\'s history.',
    confirmLabel: 'Confirm & Save',
    changes,
  });
  if (!reason) return;
  payload.reason = reason;

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
      <td><strong>${esc(vehicle)}</strong></td>
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
      <td><strong>${esc(s.period) || '–'}</strong></td>
      <td>${esc(s.total_diesel ?? 0)} L</td>
      <td>${esc(s.total_hours) || '–'}</td>
      <td>${esc(s.total_loads ?? 0)}</td>
      <td style="max-width:200px;white-space:normal;font-size:12px;">${esc(s.notes) || '–'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteSummary('${esc(s.id)}')">🗑</button></td>`;
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

  try {
    const res = await Inventory.getSites();
    renderSitesTable(res.data || []);
  } catch { showToast('Failed to load sites.', true); }
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
      <td><strong>${esc(v.vehicle_no)}</strong></td>
      <td>${esc(v.type) || '–'}</td>
      <td>
        <button class="btn ${v.active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="toggleVehicleActive('${esc(v.id)}', ${!!v.active})">
          ${v.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteVehicle('${esc(v.id)}')">🗑</button></td>`;
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
      <td><strong>${esc(o.name)}</strong></td>
      <td>${esc(o.phone) || '–'}</td>
      <td>
        <button class="btn ${o.active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="toggleOperatorActive('${esc(o.id)}', ${!!o.active})">
          ${o.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteOperator('${esc(o.id)}')">🗑</button></td>`;
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

/* ── Sites (Inventory, Admin) ────────────────────────────────────────────── */
function renderSitesTable(list) {
  const tbody = document.getElementById('sites-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No sites yet. Add one above.</td></tr>';
    return;
  }
  list.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.location) || '–'}</td>
      <td>
        <button class="btn ${s.active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="toggleSiteActive('${esc(s.id)}', ${!!s.active})">
          ${s.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteSite('${esc(s.id)}')">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

async function addSite() {
  const name     = document.getElementById('inv-site-name').value.trim();
  const location = document.getElementById('inv-site-location').value.trim();
  if (!name) { showToast('Site name is required.', true); return; }

  try {
    await Inventory.addSite({ name, location });
    showToast('✅ Site added!');
    document.getElementById('inv-site-name').value = '';
    document.getElementById('inv-site-location').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not add site.'), true);
  }
}

async function toggleSiteActive(id, currentActive) {
  try {
    await Inventory.updateSite(id, { active: !currentActive });
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

async function deleteSite(id) {
  if (!confirm('Remove this site from inventory?')) return;
  try {
    await Inventory.deleteSite(id);
    showToast('Site removed.');
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
      <td><strong>${esc(u.name)}</strong>${isSelf ? ' <span class="badge">You</span>' : ''}</td>
      <td>
        <button class="btn btn-outline btn-sm" data-id="${esc(u.id)}" data-name="${esc(u.name)}" onclick="resetUserPin(this)">🔑 Reset PIN</button>
      </td>
      <td>
        <select onchange="updateUserRole('${esc(u.id)}', this.value)" ${isSelf ? 'disabled title="You cannot change your own role"' : ''} style="width:auto;padding:6px 8px;">
          <option value="supervisor" ${u.role === 'supervisor' ? 'selected' : ''}>Supervisor</option>
          <option value="owner" ${u.role === 'owner' ? 'selected' : ''}>Owner</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td>
        <button class="btn ${u.active ? 'btn-green' : 'btn-outline'} btn-sm"
          onclick="toggleUserActive('${esc(u.id)}', ${!!u.active})"
          ${isSelf ? 'disabled title="You cannot deactivate your own account"' : ''}>
          ${u.active ? 'Active' : 'Inactive'}
        </button>
      </td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${esc(u.id)}')" ${isSelf ? 'disabled title="You cannot delete your own account"' : ''}>🗑</button>
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

async function resetUserPin(btn) {
  const { id, name } = btn.dataset;
  const pin = (prompt(`New PIN for ${name} (4–10 characters, no spaces):`) || '').trim();
  if (!pin) return;
  try {
    await Users.update(id, { pin });
    showToast('✅ PIN updated.');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not update PIN.'), true);
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


/* ═══════════════════════════════════════════════════════════════════════════════
   Change detection  (mirrors the server, which is the final judge)
   ═══════════════════════════════════════════════════════════════════════════════ */
const ENTRY_FIELDS = [
  ['date',          'Date',        'date'],
  ['site',          'Site',        'text'],
  ['category',      'Category',    'cat'],
  ['vehicle_no',    'Vehicle',     'text'],
  ['start_reading', 'Start',       'text'],
  ['close_reading', 'Close',       'text'],
  ['working_hours', 'Working Hrs', 'text'],
  ['diesel',        'Diesel (L)',  'num'],
  ['loads',         'Loads',       'num'],
  ['operator',      'Operator',    'text'],
  ['remarks',       'Remarks',     'text'],
];
const _n = v => (v === null || v === undefined ? '' : String(v).trim());

function fieldValue(kind, v) {
  const t = _n(v);
  if (kind === 'cat')  return t === 'rental' ? 'Rental' : 'Own';
  if (t === '')        return null;
  if (kind === 'date') return fmtDate(t);
  if (kind === 'num')  return Number.isFinite(Number(t)) ? String(Number(t)) : t;
  return t;
}
function breakupPlain(rows) {
  return (rows || []).filter(r => _n(r.description) || _n(r.quantity))
    .map(r => `${_n(r.description)}: ${_n(r.quantity)}`).join(' | ') || null;
}
function breakupKey(rows) {   // order-insensitive
  return (rows || []).filter(r => _n(r.description) || _n(r.quantity))
    .map(r => `${_n(r.description)}\u0001${_n(r.quantity)}`).sort().join('\u0002');
}
function diffEntry(before, after) {
  const out = [];
  ENTRY_FIELDS.forEach(([col, label, kind]) => {
    const a = fieldValue(kind, before[col]);
    const b = fieldValue(kind, after[col]);
    if (a !== b) out.push({ field: label, from: a, to: b });
  });
  if (breakupKey(before.breakup_rows) !== breakupKey(after.breakup_rows)) {
    out.push({ field: 'Work Breakup', from: breakupPlain(before.breakup_rows), to: breakupPlain(after.breakup_rows) });
  }
  return out;
}


/* ═══════════════════════════════════════════════════════════════════════════════
   "Reason" popup — edits and deletes must be explained (10+ characters)
   ═══════════════════════════════════════════════════════════════════════════════ */
const MIN_REASON = 10;
let reasonResolve = null;

const $ = id => document.getElementById(id);

function reasonLen() { return $('reason-text').value.trim().length; }

function updateReasonUI() {
  const n = reasonLen();
  const valid = n >= MIN_REASON;
  $('reason-confirm').disabled = !valid;
  const c = $('reason-count');
  c.textContent = valid ? `${n} characters ✓` : `${n} / ${MIN_REASON} minimum`;
  c.classList.toggle('is-ok', valid);
  if (valid) $('reason-error').textContent = '';
}

function finishReason(value) {
  $('reason-modal-overlay').classList.remove('open');
  const done = reasonResolve;
  reasonResolve = null;
  if (done) done(value);
}

function initReasonModal() {
  const box = $('reason-text');
  box.addEventListener('input', updateReasonUI);
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('reason-confirm').click(); }
  });
  $('reason-cancel').addEventListener('click', () => finishReason(null));
  $('reason-confirm').addEventListener('click', () => {
    const text = box.value.trim();
    if (text.length < MIN_REASON) {
      $('reason-error').textContent = `Please write at least ${MIN_REASON} characters.`;
      box.focus();
      return;
    }
    finishReason(text);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if ($('reason-modal-overlay').classList.contains('open')) finishReason(null);
    else if ($('history-modal-overlay').classList.contains('open')) closeHistory();
  });
}

/**
 * Opens the popup and resolves with the reason text, or null if cancelled.
 *   changes: [{field, from, to}]  — shown so the person can double-check what they're saving
 */
function askReason({ title, intro, confirmLabel, danger = false, changes = [] }) {
  return new Promise(resolve => {
    if (reasonResolve) reasonResolve(null);       // never leave an earlier popup hanging
    reasonResolve = resolve;

    $('reason-title').textContent = title;
    $('reason-intro').innerHTML   = intro || '';
    $('reason-changes').innerHTML = changes.length ? changeListHtml(changes) : '';
    $('reason-changes').style.display = changes.length ? '' : 'none';
    const btn = $('reason-confirm');
    btn.textContent = confirmLabel;
    btn.classList.toggle('btn-danger-solid', danger);
    btn.classList.toggle('btn-primary', !danger);
    $('reason-modal-overlay').classList.toggle('is-danger', danger);
    $('reason-text').value = '';
    $('reason-error').textContent = '';
    updateReasonUI();
    $('reason-modal-overlay').classList.add('open');
    setTimeout(() => $('reason-text').focus(), 60);
  });
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Shared log rendering
   ═══════════════════════════════════════════════════════════════════════════════ */
const CLOCK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

function fmtDateTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}

const NOUNS = { entry: 'Entry', summary: 'Summary', vehicle: 'Vehicle', operator: 'Operator', site: 'Site', user: 'User' };
const SPECIAL_ACTIONS = {
  login:         { label: 'Login',          cls: 'pill-green'  },
  login_failed:  { label: 'Failed login',   cls: 'pill-red'    },
  login_blocked: { label: 'Login blocked',  cls: 'pill-red'    },
  logout:        { label: 'Logout',         cls: 'pill-gray'   },
  entry_updated: { label: 'Entry edited',   cls: 'pill-orange' },
};
function actionMeta(action) {
  if (SPECIAL_ACTIONS[action]) return SPECIAL_ACTIONS[action];
  const m = /^([a-z]+)_(added|created|updated|deleted)$/.exec(action || '');
  if (m) {
    return {
      label: `${NOUNS[m[1]] || capitalize(m[1])} ${m[2]}`,
      cls: m[2] === 'deleted' ? 'pill-red' : m[2] === 'updated' ? 'pill-orange' : 'pill-sky',
    };
  }
  return { label: capitalize(String(action || 'activity').replace(/_/g, ' ')), cls: 'pill-gray' };
}

function deviceLabel(ua) {
  if (!ua) return '';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome'
          : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
          : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return o ? `${b} · ${o}` : b;
}

const dash = v => (v === null || v === undefined || v === '' ? '<span class="chg-none">—</span>' : esc(v));

/** "Diesel (L):  42 → 45" lines */
function changeListHtml(changes) {
  return '<div class="chg-list">' + changes.map(c => `
    <div class="chg">
      <span class="chg-field">${esc(c.field)}</span>
      <span class="chg-from">${dash(c.from)}</span>
      <span class="chg-arrow">→</span>
      <span class="chg-to">${dash(c.to)}</span>
    </div>`).join('') + '</div>';
}

/** A snapshot ("created" / "deleted") lists values; an edit shows before → after. */
function logChangesHtml(l) {
  const ch = Array.isArray(l.changes) ? l.changes : [];
  if (!ch.length) return '';
  const isEdit = /_updated$/.test(l.action);
  if (isEdit) return changeListHtml(ch);
  const rows = ch.map(c => `<div class="snap"><span class="snap-f">${esc(c.field)}</span><span class="snap-v">${esc(c.to !== null && c.to !== undefined ? c.to : c.from)}</span></div>`).join('');
  return `<details class="log-snap"><summary>${ch.length} field${ch.length === 1 ? '' : 's'}</summary>${rows}</details>`;
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Per-entry history (Records tab → clock button)
   ═══════════════════════════════════════════════════════════════════════════════ */
async function loadHistoryCounts(seq) {
  const ids = currentRecords.map(r => r.id);
  if (!ids.length) return;
  try {
    const res = await Logs.entryCounts(ids);
    if (seq !== recordsRequestSeq) return;            // a newer load replaced this table
    const counts = (res && res.counts) || {};
    document.querySelectorAll('#records-body .hist-btn').forEach(btn => {
      const n = counts[btn.dataset.id] || 0;
      const badge = btn.querySelector('.hist-count');
      badge.textContent = n ? n : '';
      btn.classList.toggle('has-edits', n > 0);
      btn.title = n ? `Edited ${n} time${n === 1 ? '' : 's'} — view history` : 'View history';
    });
  } catch { /* non-critical: the buttons still work without the counts */ }
}

function closeHistory() { $('history-modal-overlay').classList.remove('open'); }

async function openHistory(id) {
  const entry = findRecordById(id);
  $('history-entry').innerHTML = entry
    ? `<strong>${esc(entry.vehicle_no)}</strong><span>${fmtDate(entry.date)}</span>${entry.site ? `<span>${esc(entry.site)}</span>` : ''}`
    : '';
  const body = $('history-body');
  body.innerHTML = '<div class="loading"><span class="spinner"></span>Loading history…</div>';
  $('history-modal-overlay').classList.add('open');

  try {
    const res = await Logs.forEntry(id);
    body.innerHTML = timelineHtml(res.data || []);
  } catch (e) {
    body.innerHTML = `<div class="log-empty">${esc(e.message || 'Could not load the history.')}</div>`;
  }
}

function timelineHtml(logs) {
  if (!logs.length) {
    return '<div class="log-empty">No history yet for this entry.<br><small>Entries saved before activity logging was switched on have no history.</small></div>';
  }
  const verb = { entry_created: 'Created', entry_updated: 'Edited', entry_deleted: 'Deleted' };
  const dot  = { entry_created: 'dot-sky', entry_updated: 'dot-orange', entry_deleted: 'dot-red' };
  return '<ol class="timeline">' + logs.map(l => `
    <li class="tl-item">
      <span class="tl-dot ${dot[l.action] || ''}"></span>
      <div class="tl-head">
        <span class="tl-title">${verb[l.action] || esc(actionMeta(l.action).label)}</span>
        <span class="tl-by">by <strong>${esc(l.user_name || 'Unknown')}</strong>${l.user_role ? ` <span class="pill pill-gray">${esc(l.user_role)}</span>` : ''}</span>
        <span class="tl-time">${fmtDateTime(l.created_at)}</span>
      </div>
      ${l.reason ? `<div class="tl-reason"><span>Reason</span>${esc(l.reason)}</div>` : ''}
      ${logChangesHtml(l)}
    </li>`).join('') + '</ol>';
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Activity Logs tab (Owner + Admin)
   ═══════════════════════════════════════════════════════════════════════════════ */
const LOGS_PAGE = 50;
let logsShown = 0, logsTotal = 0, logsSeq = 0, logsDebounce = null;

function loadLogsDebounced() {
  clearTimeout(logsDebounce);
  logsDebounce = setTimeout(() => loadLogs(true), 350);
}

function clearLogFilters() {
  ['log-category', 'log-from', 'log-to', 'log-q'].forEach(id => { $(id).value = ''; });
  loadLogs(true);
}

// A date picked in the browser means that day in the viewer's own time zone.
const dayStart = d => (d ? new Date(`${d}T00:00:00`).toISOString() : '');
const dayEnd   = d => (d ? new Date(`${d}T23:59:59.999`).toISOString() : '');

async function loadLogs(reset = true) {
  const seq = ++logsSeq;
  const body = $('logs-body');
  const moreBtn = $('logs-more-btn');
  if (reset) {
    logsShown = 0;
    body.innerHTML = '<tr class="empty-row"><td colspan="5"><span class="spinner"></span>Loading…</td></tr>';
    moreBtn.style.display = 'none';
  } else {
    moreBtn.disabled = true;
  }

  try {
    const res = await Logs.list({
      limit: LOGS_PAGE, offset: logsShown,
      category: $('log-category').value,
      q: $('log-q').value.trim(),
      from: dayStart($('log-from').value),
      to:   dayEnd($('log-to').value),
    });
    if (seq !== logsSeq) return;

    const rows = res.data || [];
    logsTotal = res.total ?? rows.length;
    if (reset) body.innerHTML = '';
    if (!rows.length && reset) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No activity found for these filters.</td></tr>';
    }
    rows.forEach(l => body.insertAdjacentHTML('beforeend', logRowHtml(l)));
    logsShown += rows.length;

    $('logs-count').textContent = logsTotal ? `Showing ${logsShown} of ${logsTotal}` : '';
    moreBtn.style.display = logsShown < logsTotal ? '' : 'none';
  } catch (e) {
    if (seq !== logsSeq) return;
    const setup = e.data && e.data.setup_required;
    body.innerHTML = `<tr class="empty-row"><td colspan="5">${setup
      ? '⚠️ The activity log table has not been created yet.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-logs.sql</strong>, then reload this page.</small>'
      : esc(e.message || 'Could not load the activity logs.')}</td></tr>`;
    $('logs-count').textContent = '';
    moreBtn.style.display = 'none';
  } finally {
    moreBtn.disabled = false;
  }
}

function logRowHtml(l) {
  const meta = actionMeta(l.action);
  const who  = l.user_name
    ? `<strong>${esc(l.user_name)}</strong>${l.user_role ? ` <span class="pill pill-gray">${esc(l.user_role)}</span>` : ''}`
    : '<span class="chg-none">Not signed in</span>';
  const details =
    (l.entity_label ? `<div class="log-label">${esc(l.entity_label)}</div>` : '') +
    (l.reason ? `<div class="tl-reason"><span>Reason</span>${esc(l.reason)}</div>` : '') +
    logChangesHtml(l);
  return `<tr>
    <td class="log-time">${fmtDateTime(l.created_at)}</td>
    <td>${who}</td>
    <td><span class="pill ${meta.cls}">${esc(meta.label)}</span></td>
    <td class="log-details">${details || '<span class="chg-none">—</span>'}</td>
    <td class="log-device">${esc(l.ip || '–')}${l.user_agent ? `<br><span title="${esc(l.user_agent)}">${esc(deviceLabel(l.user_agent))}</span>` : ''}</td>
  </tr>`;
}
