/* ── Role → Tab access map ──────────────────────────────────────────────────── */
const ROLE_TABS = {
  entry:     ['supervisor', 'admin'],
  records:   ['owner', 'admin'],
  summary:   ['owner', 'admin'],
  documents: ['owner', 'admin'],
  payments:  ['supervisor', 'owner', 'admin'],
  inventory: ['admin'],
  users:     ['admin'],
  logs:      ['owner', 'admin'],
};
const TAB_ORDER = ['entry', 'records', 'summary', 'documents', 'payments', 'inventory', 'users', 'logs'];

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
  initPhotoFields();
  initExportMenu();
  initReportMenus();
  initLogSelection();

  document.getElementById('header-user').textContent = `${user.name} / ${capitalize(user.role)}`;
  document.getElementById('f-date').value = today();
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await loadDropdownData();
  setupAutoCalculate();
  toggleCategoryFields('f');
  initLoadPoints();
  loadUnloadPoints();

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
  if (name === 'summary')   loadSummary();
  if (name === 'documents') loadDocuments();
  if (name === 'payments')  initPayments();
  if (name === 'inventory') loadInventory();
  if (name === 'users')     loadUsers();
  if (name === 'logs')      loadLogs(true);
}

/* ── Form ────────────────────────────────────────────────────────────────────── */
function clearForm() {
  ['f-vehicle','f-vehicle-text','f-start','f-close','f-hours','f-diesel','f-loads','f-operator','f-operator-text','f-remarks','f-site']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('f-date').value = today();
  document.getElementById('f-category').value = 'own';
  toggleCategoryFields('f');
  resetCalcHint();
  clearLoadPoints('f');
  releasePhotos('f', true);   // photos that were never saved are thrown away
}

async function saveEntry() {
  const date       = document.getElementById('f-date').value;
  const vehicle_no = getVehicleValue('f');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }
  if (photosBusy('f')) { showToast('Please wait — the photo is still uploading.', true); return; }
  const lpProblem = validateLoadPoints('f');
  if (lpProblem) { showToast(lpProblem, true); return; }

  const payload = {
    date, vehicle_no,
    start_photo: photoPath('f-start'),
    close_photo: photoPath('f-close'),
    diesel_photo: photoPath('f-diesel'),
    site: document.getElementById('f-site').value.trim(),
    category: document.getElementById('f-category').value,
    start_reading: document.getElementById('f-start').value.trim(),
    close_reading: document.getElementById('f-close').value.trim(),
    working_hours: document.getElementById('f-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('f-diesel').value) || 0,
    loads:   parseInt(document.getElementById('f-loads').value)    || 0,
    operator: getOperatorValue('f'),
    remarks:  document.getElementById('f-remarks').value.trim(),
    load_points: readLoadPoints('f'),
  };

  try {
    await Entries.create(payload);
    showToast('✅ Entry saved successfully!');
    releasePhotos('f', false);   // the photos now belong to the entry — keep them
    clearForm();
    loadUnloadPoints();          // a new point name may have been used
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
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${isAdmin ? 15 : 13}">No records found.</td></tr>`;
    return;
  }

  entries.forEach((e, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${fmtDate(e.date)}</td>
      <td>${esc(e.site) || '–'}</td>
      <td>${e.category === 'rental' ? '<span class="pill pill-rental">Rental</span>' : '<span class="pill pill-own">Own</span>'}</td>
      <td><strong>${esc(e.vehicle_no)}</strong></td>
      <td><span class="reading-cell">${esc(e.start_reading) || '–'}${photoChipHtml(e.start_photo, `Starting reading · ${e.vehicle_no} · ${fmtDate(e.date)}`)}</span></td>
      <td><span class="reading-cell">${esc(e.close_reading) || '–'}${photoChipHtml(e.close_photo, `Closing reading · ${e.vehicle_no} · ${fmtDate(e.date)}`)}</span></td>
      <td>${esc(e.working_hours) || '–'}</td>
      <td><span class="reading-cell">${esc(e.diesel ?? 0)}${photoChipHtml(e.diesel_photo, `Diesel · ${e.vehicle_no} · ${fmtDate(e.date)}`)}</span></td>
      <td>${esc(e.loads ?? 0)}${pointsMini(e)}</td>
      <td>${esc(e.operator) || '–'}</td>
      <td style="max-width:200px;white-space:normal;">${esc(e.remarks) || '–'}</td>
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

/* ── Export report (Excel / PDF / CSV) ───────────────────────────────────────── */
// The report is built by the server from the records on screen, so it always matches what you
// are looking at (filters included). Excel and PDF show the reading photos; CSV can't, so it says Yes / No.
const EXPORT_LABELS = { xlsx: 'Excel', pdf: 'PDF', csv: 'CSV' };
let exporting = false;

function exportItems() { return [...document.querySelectorAll('#export-pop [role="menuitem"]')]; }

function openExportMenu() {
  if (exporting) return;
  document.getElementById('export-pop').hidden = false;
  document.getElementById('export-btn').setAttribute('aria-expanded', 'true');
  const first = exportItems()[0];
  if (first) first.focus();
}

function closeExportMenu(returnFocus) {
  const pop = document.getElementById('export-pop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  const btn = document.getElementById('export-btn');
  btn.setAttribute('aria-expanded', 'false');
  if (returnFocus) btn.focus();
}

function toggleExportMenu(ev) {
  if (ev) ev.stopPropagation();
  const pop = document.getElementById('export-pop');
  if (pop.hidden) openExportMenu(); else closeExportMenu(false);
}

function initExportMenu() {
  const menu = document.getElementById('export-menu');
  if (!menu) return;
  document.addEventListener('click', ev => { if (!ev.target.closest('#export-menu')) closeExportMenu(false); });
  menu.addEventListener('keydown', ev => {
    const pop = document.getElementById('export-pop');
    if (pop.hidden) return;
    const items = exportItems();
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape')    { ev.preventDefault(); closeExportMenu(true); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (ev.key === 'ArrowUp')   { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (ev.key === 'Tab')  { closeExportMenu(false); }
  });
}

/** "From 01/10/2026 · Site: ISKCON" — printed at the top of Excel / PDF reports. */
function describeFilters() {
  const val = id => document.getElementById(id).value;
  const parts = [];
  if (val('filter-date-from')) parts.push(`From ${fmtDate(val('filter-date-from'))}`);
  if (val('filter-date-to'))   parts.push(`To ${fmtDate(val('filter-date-to'))}`);
  if (val('filter-category'))  parts.push(`Category: ${val('filter-category') === 'rental' ? 'Rental' : 'Own'}`);
  if (val('filter-type'))      parts.push(`Type: ${val('filter-type')}`);
  if (val('filter-vehicle'))   parts.push(`Vehicle: ${val('filter-vehicle')}`);
  if (val('filter-site'))      parts.push(`Site: ${val('filter-site')}`);
  return parts.join(' · ');
}

function setExportBusy(on, label) {
  const btn = document.getElementById('export-btn');
  btn.disabled = on;
  btn.classList.toggle('is-busy', on);
  document.getElementById('export-label').textContent = on ? `Preparing ${label}…` : '⬇ Export';
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportReport(format) {
  closeExportMenu(false);
  if (exporting) return;
  if (!currentRecords.length) { showToast('No records to export.', true); return; }

  const label = EXPORT_LABELS[format] || 'report';
  exporting = true;
  setExportBusy(true, label);
  try {
    const blob = await Reports.entries({ format, ids: currentRecords.map(e => e.id), filtersText: describeFilters() });
    saveBlob(blob, `SCC-site-log-${today()}.${format}`);
    showToast(`✅ ${label} report downloaded.`);
  } catch (e) {
    showToast('❌ ' + (e.message || 'The report could not be prepared.'), true);
  } finally {
    exporting = false;
    setExportBusy(false);
  }
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
  setLoadPoints('e', entry.load_points || []);
  releasePhotos('e', true);
  setExistingPhoto('e-start', entry.start_photo || null);
  setExistingPhoto('e-close', entry.close_photo || null);
  setExistingPhoto('e-diesel', entry.diesel_photo || null);

  document.getElementById('edit-modal-overlay').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal-overlay').classList.remove('open');
  releasePhotos('e', true);   // a photo that was picked but never saved is thrown away
}

async function submitEditEntry() {
  const id         = document.getElementById('e-id').value;
  const date       = document.getElementById('e-date').value;
  const vehicle_no = getVehicleValue('e');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }
  if (photosBusy('e')) { showToast('Please wait — the photo is still uploading.', true); return; }
  const lpProblem = validateLoadPoints('e');
  if (lpProblem) { showToast(lpProblem, true); return; }

  const payload = {
    date, vehicle_no,
    start_photo: photoPath('e-start'),
    close_photo: photoPath('e-close'),
    diesel_photo: photoPath('e-diesel'),
    site: document.getElementById('e-site').value.trim(),
    category: document.getElementById('e-category').value,
    start_reading: document.getElementById('e-start').value.trim(),
    close_reading: document.getElementById('e-close').value.trim(),
    working_hours: document.getElementById('e-hours').value.trim(),
    diesel:  parseFloat(document.getElementById('e-diesel').value) || 0,
    loads:   parseInt(document.getElementById('e-loads').value)    || 0,
    operator: getOperatorValue('e'),
    remarks:  document.getElementById('e-remarks').value.trim(),
    load_points: readLoadPoints('e'),
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
    releasePhotos('e', false);   // saved — keep the photos
    closeEditModal();
    loadRecords();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Update failed.'), true);
  }
}

/* ── Summary ─────────────────────────────────────────────────────────────────── */
const ymd = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
function addDaysLocal(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}

/** The period chosen above the Summary as { from, to } (empty = no limit). */
function summaryPeriod() {
  const v = document.getElementById('sum-range').value;
  const t = today();
  if (v === 'today')     return { from: t, to: t };
  if (v === 'yesterday') { const y = addDaysLocal(t, -1); return { from: y, to: y }; }
  if (v === '7')         return { from: addDaysLocal(t, -6), to: t };
  if (v === '30')        return { from: addDaysLocal(t, -29), to: t };
  if (v === 'custom')    return { from: document.getElementById('sum-from').value, to: document.getElementById('sum-to').value };
  return { from: '', to: '' };
}

function summaryRangeText({ from, to }) {
  if (from && to) return from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
  if (from) return `From ${fmtDate(from)}`;
  if (to)   return `Up to ${fmtDate(to)}`;
  return 'All time';
}

function onSummaryRangeChange() {
  const custom = document.getElementById('sum-range').value === 'custom';
  document.getElementById('sum-custom').hidden = !custom;
  if (custom && !document.getElementById('sum-from').value && !document.getElementById('sum-to').value) {
    document.getElementById('sum-from').value = addDaysLocal(today(), -6);     // a sensible starting point the person can change
    document.getElementById('sum-to').value   = today();
  }
  loadSummary();
}

let summarySeq = 0;
async function loadSummary() {
  const period = summaryPeriod();
  if (period.from && period.to && period.from > period.to) { showToast('The "from" date cannot be after the "to" date.', true); return; }
  document.getElementById('sum-range-text').textContent = `Showing: ${summaryRangeText(period)}`;
  const filters = {};
  if (period.from) filters.from = period.from;
  if (period.to)   filters.to   = period.to;

  const seq = ++summarySeq;
  try {
    const res = await Entries.stats(filters);
    if (seq !== summarySeq) return;                       // a newer choice has already been made
    const s = res.data || {};
    document.getElementById('s-entries').textContent  = s.total_entries  ?? '–';
    document.getElementById('s-diesel').textContent   = s.total_diesel   ?? '–';
    document.getElementById('s-loads').textContent    = s.total_loads    ?? '–';
    document.getElementById('s-vehicles').textContent = s.vehicles_with_loads ?? '–';
    renderVehicleBreakdown(s.vehicles || []);
  } catch (e) {
    if (seq !== summarySeq) return;
    document.getElementById('vehicle-summary-body').innerHTML = `<tr class="empty-row"><td colspan="4">${esc(e.message || 'Could not load the summary.')}</td></tr>`;
  }
}

function renderVehicleBreakdown(list) {
  const tbody = document.getElementById('vehicle-summary-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No vehicles with loads in this period.</td></tr>';
    return;
  }
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(v.vehicle_no)}</strong></td>
      <td>${esc(v.entries)}</td>
      <td>${esc(v.diesel)}</td>
      <td>${esc(v.loads)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ── Inventory (Admin) — Vehicles / Sites / Operators as three sub-sections ───────────── */
const INV = {
  vehicles:  { title: 'Edit vehicle',  l1: 'Vehicle / Machine No. *', k1: 'vehicle_no', l2: 'Type',     k2: 'type',     noun: 'vehicle',  hint: 'Records that were already saved keep the number they were saved with.',
               update: (id, b) => Inventory.updateVehicle(id, b),  remove: id => Inventory.deleteVehicle(id),  empty: 'No vehicles yet. Add one above.' },
  sites:     { title: 'Edit site',     l1: 'Site Name *',             k1: 'name',       l2: 'Location', k2: 'location', noun: 'site',     hint: 'Records that were already saved keep the site name they were saved with.',
               update: (id, b) => Inventory.updateSite(id, b),     remove: id => Inventory.deleteSite(id),     empty: 'No sites yet. Add one above.' },
  operators: { title: 'Edit operator', l1: 'Name *',                  k1: 'name',       l2: 'Phone',    k2: 'phone',    noun: 'operator', hint: 'Records that were already saved keep the name they were saved with.',
               update: (id, b) => Inventory.updateOperator(id, b), remove: id => Inventory.deleteOperator(id), empty: 'No operators yet. Add one above.' },
};
const invLists = { vehicles: [], sites: [], operators: [] };
let invTab = 'vehicles';
let invEditing = null;     // { type, id }

function showInvTab(name) {
  if (!INV[name]) return;
  invTab = name;
  Object.keys(INV).forEach(k => {
    const on = k === name;
    const tab = document.getElementById(`invtab-${k}`);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    document.getElementById(`inv-panel-${k}`).hidden = !on;
  });
}

async function loadInventory() {
  const [v, o, st] = await Promise.all([
    Inventory.getVehicles().catch(() => null),
    Inventory.getOperators().catch(() => null),
    Inventory.getSites().catch(() => null),
  ]);
  if (v)  { invLists.vehicles  = v.data  || []; renderVehiclesTable(invLists.vehicles); }  else showToast('Failed to load vehicles.', true);
  if (o)  { invLists.operators = o.data  || []; renderOperatorsTable(invLists.operators); } else showToast('Failed to load operators.', true);
  if (st) { invLists.sites     = st.data || []; renderSitesTable(invLists.sites); }         else showToast('Failed to load sites.', true);
  Object.keys(INV).forEach(k => { document.getElementById(`inv-count-${k}`).textContent = invLists[k].length; });
  showInvTab(invTab);
}

const statusBtn = (active, fn, id) => `
      <button class="btn ${active ? 'btn-green' : 'btn-outline'} btn-sm" onclick="${fn}('${esc(id)}', ${!!active})">${active ? 'Active' : 'Inactive'}</button>`;
const editBtn = (type, id, label) =>
  `<button class="btn btn-outline btn-sm" onclick="openInvEdit('${type}', '${esc(id)}')" aria-label="Edit ${esc(label)}">✏️ Edit</button>`;

function renderVehiclesTable(list) {
  const tbody = document.getElementById('vehicles-body');
  tbody.innerHTML = '';
  if (!list.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${INV.vehicles.empty}</td></tr>`; return; }
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(v.vehicle_no)}</strong></td>
      <td>${esc(v.type) || '–'}</td>
      <td>${statusBtn(v.active, 'toggleVehicleActive', v.id)}</td>
      <td>${editBtn('vehicles', v.id, v.vehicle_no)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteVehicle('${esc(v.id)}')" aria-label="Delete ${esc(v.vehicle_no)}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderOperatorsTable(list) {
  const tbody = document.getElementById('operators-body');
  tbody.innerHTML = '';
  if (!list.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${INV.operators.empty}</td></tr>`; return; }
  list.forEach(o => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(o.name)}</strong></td>
      <td>${esc(o.phone) || '–'}</td>
      <td>${statusBtn(o.active, 'toggleOperatorActive', o.id)}</td>
      <td>${editBtn('operators', o.id, o.name)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteOperator('${esc(o.id)}')" aria-label="Delete ${esc(o.name)}">🗑</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderSitesTable(list) {
  const tbody = document.getElementById('sites-body');
  tbody.innerHTML = '';
  if (!list.length) { tbody.innerHTML = `<tr class="empty-row"><td colspan="5">${INV.sites.empty}</td></tr>`; return; }
  list.forEach(st => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(st.name)}</strong></td>
      <td>${esc(st.location) || '–'}</td>
      <td>${statusBtn(st.active, 'toggleSiteActive', st.id)}</td>
      <td>${editBtn('sites', st.id, st.name)}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteSite('${esc(st.id)}')" aria-label="Delete ${esc(st.name)}">🗑</button></td>`;
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
  try { await Inventory.updateVehicle(id, { active: !currentActive }); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('❌ ' + (e.message || 'Update failed.'), true); }
}

async function deleteVehicle(id) {
  if (!confirm('Remove this vehicle from inventory?')) return;
  try { await Inventory.deleteVehicle(id); showToast('Vehicle removed.'); loadInventory(); loadDropdownData(); }
  catch { showToast('Delete failed.', true); }
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
  try { await Inventory.updateOperator(id, { active: !currentActive }); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('❌ ' + (e.message || 'Update failed.'), true); }
}

async function deleteOperator(id) {
  if (!confirm('Remove this operator from inventory?')) return;
  try { await Inventory.deleteOperator(id); showToast('Operator removed.'); loadInventory(); loadDropdownData(); }
  catch { showToast('Delete failed.', true); }
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
  try { await Inventory.updateSite(id, { active: !currentActive }); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('❌ ' + (e.message || 'Update failed.'), true); }
}

async function deleteSite(id) {
  if (!confirm('Remove this site from inventory?')) return;
  try { await Inventory.deleteSite(id); showToast('Site removed.'); loadInventory(); loadDropdownData(); }
  catch { showToast('Delete failed.', true); }
}

/* Edit a vehicle / site / operator in a small dialog */
function openInvEdit(type, id) {
  const def = INV[type];
  const item = (invLists[type] || []).find(x => String(x.id) === String(id));
  if (!def || !item) return;
  invEditing = { type, id, before: { v1: item[def.k1] || '', v2: item[def.k2] || '' } };
  document.getElementById('inv-edit-title').textContent = def.title;
  document.getElementById('inv-edit-l1').textContent = def.l1;
  document.getElementById('inv-edit-l2').textContent = def.l2;
  document.getElementById('inv-edit-f1').value = item[def.k1] || '';
  document.getElementById('inv-edit-f2').value = item[def.k2] || '';
  document.getElementById('inv-edit-hint').textContent = def.hint;
  document.getElementById('inv-edit-error').textContent = '';
  document.getElementById('inv-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('inv-edit-f1').focus(), 50);
}

function closeInvEdit() {
  document.getElementById('inv-edit-overlay').classList.remove('open');
  invEditing = null;
}

async function saveInvEdit() {
  if (!invEditing) return;
  const def = INV[invEditing.type];
  const v1 = document.getElementById('inv-edit-f1').value.trim();
  const v2 = document.getElementById('inv-edit-f2').value.trim();
  const err = document.getElementById('inv-edit-error');
  err.textContent = '';
  if (!v1) { err.textContent = `${def.l1.replace(' *', '')} cannot be empty.`; return; }
  if (v1 === invEditing.before.v1 && v2 === invEditing.before.v2) { showToast('No changes were made.'); closeInvEdit(); return; }

  const btn = document.getElementById('inv-edit-save');
  btn.disabled = true;
  try {
    await def.update(invEditing.id, { [def.k1]: v1, [def.k2]: v2 });
    showToast(`✅ ${capitalize(def.noun)} updated.`);
    closeInvEdit();
    loadInventory();
    loadDropdownData();
  } catch (e) {
    err.textContent = e.message || 'Could not save the changes.';
  } finally {
    btn.disabled = false;
  }
}


/* ── Users (Admin) ────────────────────────────────────────────────────────── */
let usersList = [];
let userEditingId = null;

async function loadUsers() {
  try {
    const res = await Users.getAll();
    usersList = res.data || [];
    renderUsersTable(usersList);
  } catch (e) {
    showToast('Failed to load users.', true);
  }
}

const ROLE_PILL = { admin: 'pill-orange', owner: 'pill-sky', supervisor: 'pill-gray' };

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
      <td><span class="pill ${ROLE_PILL[u.role] || 'pill-gray'}">${esc(capitalize(u.role))}</span></td>
      <td><span class="pill ${u.active ? 'pill-green' : 'pill-gray'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td><button class="btn btn-outline btn-sm" onclick="openUserEdit('${esc(u.id)}')" aria-label="Edit ${esc(u.name)}">✏️ Edit</button></td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${esc(u.id)}')" aria-label="Delete ${esc(u.name)}" ${isSelf ? 'disabled title="You cannot delete your own account"' : ''}>🗑</button>
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

function openUserEdit(id) {
  const u = usersList.find(x => String(x.id) === String(id));
  if (!u) return;
  const me = Auth.currentUser();
  const isSelf = !!(me && u.id === me.id);
  userEditingId = u.id;
  document.getElementById('user-edit-title').textContent = `Edit ${u.name}`;
  document.getElementById('ue-name').value = u.name;
  document.getElementById('ue-role').value = u.role;
  document.getElementById('ue-active').value = String(!!u.active);
  document.getElementById('ue-pin').value = '';
  document.getElementById('ue-role').disabled = isSelf;       // the server refuses these too
  document.getElementById('ue-active').disabled = isSelf;
  document.getElementById('ue-self-note').hidden = !isSelf;
  document.getElementById('ue-error').textContent = '';
  document.getElementById('user-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('ue-name').focus(), 50);
}

function closeUserEdit() {
  document.getElementById('user-edit-overlay').classList.remove('open');
  document.getElementById('ue-pin').value = '';
  userEditingId = null;
}

async function saveUserEdit() {
  if (!userEditingId) return;
  const u = usersList.find(x => String(x.id) === String(userEditingId));
  const err = document.getElementById('ue-error');
  err.textContent = '';
  const name = document.getElementById('ue-name').value.trim();
  const pin  = document.getElementById('ue-pin').value.trim();
  if (!name) { err.textContent = 'Name cannot be empty.'; return; }

  const payload = { name, role: document.getElementById('ue-role').value, active: document.getElementById('ue-active').value === 'true' };
  if (pin) payload.pin = pin;

  const btn = document.getElementById('ue-save');
  btn.disabled = true;
  try {
    const res = await Users.update(userEditingId, payload);
    closeUserEdit();
    showToast(res.unchanged ? 'No changes were made.' : '✅ User updated.');
    loadUsers();
  } catch (e) {
    err.textContent = e.message || 'Could not save the changes.';
  } finally {
    btn.disabled = false;
  }
}

async function deleteUser(id) {
  const u = usersList.find(x => String(x.id) === String(id));
  const ok = await askDanger({
    title: `Delete ${u ? u.name : 'this user'}?`,
    message: 'They will no longer be able to log in and will disappear from this list. Their record is kept in the downloadable Users report, marked as deleted.',
    confirmLabel: 'Delete user',
  });
  if (!ok) return;
  try {
    await Users.delete(id);
    showToast('User deleted.');
    loadUsers();
  } catch (e) {
    showToast('❌ ' + (e.message || 'Delete failed.'), true);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Confirm-a-delete dialog (optionally makes the person type DELETE first)
   ═══════════════════════════════════════════════════════════════════════════════ */
function askDanger({ title, message, confirmLabel = 'Delete', typeToConfirm = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('danger-overlay');
    const ok = document.getElementById('danger-ok');
    const cancel = document.getElementById('danger-cancel');
    const input = document.getElementById('danger-type');
    const wrap = document.getElementById('danger-type-wrap');
    document.getElementById('danger-title').textContent = title;
    document.getElementById('danger-msg').textContent = message;
    ok.textContent = confirmLabel;
    wrap.hidden = !typeToConfirm;
    input.value = '';
    ok.disabled = !!typeToConfirm;

    const done = result => {
      overlay.classList.remove('open');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      input.removeEventListener('input', onInput);
      document.removeEventListener('keydown', onKey, true);
      overlay.removeEventListener('mousedown', onBackdrop);
      resolve(result);
    };
    const onOk = () => { if (!ok.disabled) done(true); };
    const onCancel = () => done(false);
    const onInput = () => { ok.disabled = input.value.trim().toUpperCase() !== 'DELETE'; };
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
      else if (ev.key === 'Enter' && !ok.disabled && document.activeElement !== cancel) { ev.preventDefault(); done(true); }
    };
    const onBackdrop = ev => { if (ev.target === overlay) done(false); };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    input.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', onBackdrop);
    overlay.classList.add('open');
    setTimeout(() => (typeToConfirm ? input : cancel).focus(), 50);     // the safe choice is focused first
  });
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Excel / PDF download menus (Inventory lists, Users, Activity Logs)
   ═══════════════════════════════════════════════════════════════════════════════ */
const RM_LABELS = { xlsx: 'Excel', pdf: 'PDF' };
let rmBusy = false;

const rmItems = menu => [...menu.querySelectorAll('[role="menuitem"]')];

function closeRm(menu, returnFocus) {
  const pop = menu.querySelector('.export-pop');
  if (!pop || pop.hidden) return;
  pop.hidden = true;
  const btn = menu.querySelector('.rm-btn');
  btn.setAttribute('aria-expanded', 'false');
  if (returnFocus) btn.focus();
}
function closeAllRm() { document.querySelectorAll('.rm').forEach(m => closeRm(m, false)); }

function openRm(menu) {
  if (rmBusy) return;
  closeAllRm();
  if (menu.querySelector('#log-note-xlsx')) updateLogExportNotes();
  menu.querySelector('.export-pop').hidden = false;
  menu.querySelector('.rm-btn').setAttribute('aria-expanded', 'true');
  const first = rmItems(menu)[0];
  if (first) first.focus();
}

function initReportMenus() {
  document.addEventListener('click', ev => {
    const toggle = ev.target.closest('.rm-btn');
    if (toggle) {
      const menu = toggle.closest('.rm');
      if (menu.querySelector('.export-pop').hidden) openRm(menu); else closeRm(menu, false);
      return;
    }
    const item = ev.target.closest('.rm [data-rm-kind]');
    if (item) { closeAllRm(); runTableReport(item.dataset.rmKind, item.dataset.rmFormat, item); return; }
    if (!ev.target.closest('.rm')) closeAllRm();
  });
  document.addEventListener('keydown', ev => {
    const menu = ev.target.closest && ev.target.closest('.rm');
    if (!menu || menu.querySelector('.export-pop').hidden) return;
    const items = rmItems(menu);
    const i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape')         { ev.preventDefault(); closeRm(menu, true); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (ev.key === 'ArrowUp')   { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (ev.key === 'Tab')       { closeRm(menu, false); }
  });
}

/** kind = 'inventory:vehicles' | 'inventory:sites' | 'inventory:operators' | 'users' | 'logs' */
async function runTableReport(kind, format, itemEl) {
  if (rmBusy) return;
  const [group, type] = kind.split(':');
  const label = RM_LABELS[format] || 'report';
  let call, name;
  if (group === 'inventory')  { call = () => Reports.inventory({ type, format }); name = type; }
  else if (group === 'users') { call = () => Reports.users({ format }); name = 'users'; }
  else if (group === 'logs')  { call = () => Reports.logs(logsReportBody(format)); name = 'activity-logs'; }
  else if (group === 'summary') {
    const per = summaryPeriod();
    if (per.from && per.to && per.from > per.to) { showToast('The "from" date cannot be after the "to" date.', true); return; }
    call = () => Reports.summary({ format, from: per.from || undefined, to: per.to || undefined }); name = 'summary';
  }
  else return;

  const menu = itemEl.closest('.rm');
  const btn = menu.querySelector('.rm-btn');
  rmBusy = true;
  btn.disabled = true;
  btn.classList.add('is-busy');
  menu.querySelector('.rm-label').textContent = `Preparing ${label}…`;
  try {
    const blob = await call();
    saveBlob(blob, `SCC-${name}-${today()}.${format}`);
    showToast(`✅ ${label} report downloaded.`);
  } catch (e) {
    showToast('❌ ' + (e.message || 'The report could not be prepared.'), true);
  } finally {
    rmBusy = false;
    btn.disabled = false;
    btn.classList.remove('is-busy');
    menu.querySelector('.rm-label').textContent = '⬇ Export';
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
  ['start_photo',   'Start photo', 'photo'],
  ['close_photo',   'Close photo', 'photo'],
  ['diesel_photo',  'Diesel photo', 'photo'],
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
function diffEntry(before, after) {
  const out = [];
  ENTRY_FIELDS.forEach(([col, label, kind]) => {
    if (kind === 'photo') {
      if (!(col in after)) return;
      const was = _n(before[col]);
      const now = _n(after[col]);       // a new upload has a different path, so a swap counts as a change
      if (was !== now) out.push({ field: label, from: was ? 'Attached' : null, to: now ? (was ? 'Replaced' : 'Attached') : null });
      return;
    }
    const a = fieldValue(kind, before[col]);
    const b = fieldValue(kind, after[col]);
    if (a !== b) out.push({ field: label, from: a, to: b });
  });
  // Loads breakup: compared as text, so re-ordering the lines is not a change.
  if (after.load_points !== undefined) {
    const was = pointsText(before.load_points), now = pointsText(after.load_points);
    if (was !== now) out.push({ field: 'Unload points', from: was, to: now });
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
    if ($('photo-modal-overlay').classList.contains('open')) closePhotoViewer();
    else if ($('reason-modal-overlay').classList.contains('open')) finishReason(null);
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

const NOUNS = { entry: 'Entry', summary: 'Summary', vehicle: 'Vehicle', operator: 'Operator', site: 'Site', user: 'User', document: 'Document', payment: 'Payment' };
const SPECIAL_ACTIONS = {
  login:         { label: 'Login',          cls: 'pill-green'  },
  login_failed:  { label: 'Failed login',   cls: 'pill-red'    },
  login_blocked: { label: 'Login blocked',  cls: 'pill-red'    },
  logout:        { label: 'Logout',         cls: 'pill-gray'   },
  entry_updated: { label: 'Entry edited',   cls: 'pill-orange' },
  report_exported: { label: 'Report exported', cls: 'pill-sky' },
  access_denied: { label: 'Access denied', cls: 'pill-red' },
  document_uploaded:   { label: 'Document uploaded',   cls: 'pill-sky'  },
  document_downloaded: { label: 'Document downloaded', cls: 'pill-sky'  },
  payments_added:      { label: 'Payments added',      cls: 'pill-sky'  },
  logs_deleted:  { label: 'Logs deleted',  cls: 'pill-orange' },
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
let logSel = new Set();            // ids ticked in the list
let logAllMatching = false;        // "select all N matching the filters"
const PROTECTED_LOG_ACTION = 'logs_deleted';
const isAdminUser = () => { const u = Auth.currentUser(); return !!u && u.role === 'admin'; };

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

/** The filters currently chosen above the list (empty ones left out). */
function currentLogFilters() {
  const f = { category: $('log-category').value, q: $('log-q').value.trim(), from: dayStart($('log-from').value), to: dayEnd($('log-to').value) };
  Object.keys(f).forEach(k => { if (!f[k]) delete f[k]; });
  return f;
}

async function loadLogs(reset = true) {
  const seq = ++logsSeq;
  const body = $('logs-body');
  const moreBtn = $('logs-more-btn');
  $('logs-table').classList.toggle('readonly', !isAdminUser());      // only an Admin sees tick-boxes and delete buttons
  if (reset) {
    logsShown = 0;
    clearLogSelection();
    body.innerHTML = '<tr class="empty-row"><td colspan="7"><span class="spinner"></span>Loading…</td></tr>';
    moreBtn.style.display = 'none';
  } else {
    moreBtn.disabled = true;
  }

  try {
    const res = await Logs.list({ limit: LOGS_PAGE, offset: logsShown, ...currentLogFilters() });
    if (seq !== logsSeq) return;

    const rows = res.data || [];
    logsTotal = res.total ?? rows.length;
    if (reset) body.innerHTML = '';
    if (!rows.length && reset) {
      body.innerHTML = '<tr class="empty-row"><td colspan="7">No activity found for these filters.</td></tr>';
    }
    rows.forEach(l => body.insertAdjacentHTML('beforeend', logRowHtml(l)));
    logsShown += rows.length;

    $('logs-count').textContent = logsTotal ? `Showing ${logsShown} of ${logsTotal}` : '';
    moreBtn.style.display = logsShown < logsTotal ? '' : 'none';
    syncLogSelectionUi();
  } catch (e) {
    if (seq !== logsSeq) return;
    const setup = e.data && e.data.setup_required;
    body.innerHTML = `<tr class="empty-row"><td colspan="7">${setup
      ? '⚠️ The activity log table has not been created yet.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-logs.sql</strong>, then reload this page.</small>'
      : esc(e.message || 'Could not load the activity logs.')}</td></tr>`;
    $('logs-count').textContent = '';
    moreBtn.style.display = 'none';
  } finally {
    moreBtn.disabled = false;
  }
}

const LOCK_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function logRowHtml(l) {
  const meta = actionMeta(l.action);
  const protectedRow = l.action === PROTECTED_LOG_ACTION;
  const who  = l.user_name
    ? `<strong>${esc(l.user_name)}</strong>${l.user_role ? ` <span class="pill pill-gray">${esc(l.user_role)}</span>` : ''}`
    : '<span class="chg-none">Not signed in</span>';
  const details =
    (l.entity_label ? `<div class="log-label">${esc(l.entity_label)}</div>` : '') +
    (l.reason ? `<div class="tl-reason"><span>Reason</span>${esc(l.reason)}</div>` : '') +
    logChangesHtml(l);
  const select = protectedRow
    ? `<span class="lg-lock" title="A permanent record that the log was cleaned — it cannot be deleted" aria-label="Permanent record">${LOCK_SVG}</span>`
    : `<input type="checkbox" class="lg-check" data-id="${esc(l.id)}" aria-label="Select this entry" ${logSel.has(String(l.id)) || logAllMatching ? 'checked' : ''}>`;
  const del = protectedRow ? '' : `<button type="button" class="btn btn-danger btn-sm lg-del-btn" data-id="${esc(l.id)}" title="Delete this entry" aria-label="Delete this entry">🗑</button>`;
  return `<tr${protectedRow ? ' class="is-protected"' : ''}>
    <td class="lg-select">${select}</td>
    <td class="log-time">${fmtDateTime(l.created_at)}</td>
    <td>${who}</td>
    <td><span class="pill ${meta.cls}">${esc(meta.label)}</span></td>
    <td class="log-details">${details || '<span class="chg-none">—</span>'}</td>
    <td class="log-device">${esc(l.ip || '–')}${l.user_agent ? `<br><span title="${esc(l.user_agent)}">${esc(deviceLabel(l.user_agent))}</span>` : ''}</td>
    <td class="lg-del">${del}</td>
  </tr>`;
}

/* ── Picking log entries (Admin) ───────────────────────────────────────────── */
const selectableLogBoxes = () => [...document.querySelectorAll('#logs-body .lg-check')];

function initLogSelection() {
  const body = document.getElementById('logs-body');
  if (!body) return;
  body.addEventListener('change', ev => {
    const box = ev.target.closest('.lg-check');
    if (!box) return;
    if (box.checked) logSel.add(box.dataset.id); else { logSel.delete(box.dataset.id); logAllMatching = false; }
    syncLogSelectionUi();
  });
  body.addEventListener('click', ev => {
    const b = ev.target.closest('.lg-del-btn');
    if (b) deleteOneLog(b.dataset.id);
  });
}

function toggleSelectAllLogs(checked) {
  logAllMatching = false;
  selectableLogBoxes().forEach(b => { b.checked = checked; if (checked) logSel.add(b.dataset.id); else logSel.delete(b.dataset.id); });
  syncLogSelectionUi();
}

function selectAllMatchingLogs() {
  logAllMatching = true;
  selectableLogBoxes().forEach(b => { b.checked = true; });
  syncLogSelectionUi();
}

function clearLogSelection() {
  logSel.clear();
  logAllMatching = false;
  selectableLogBoxes().forEach(b => { b.checked = false; });
  syncLogSelectionUi();
}

/** Keeps the tick-all box, the blue bar and the Export menu notes in step with what is ticked. */
function syncLogSelectionUi() {
  const boxes = selectableLogBoxes();
  const ticked = boxes.filter(b => b.checked).length;
  const all = $('log-select-all');
  if (all) { all.checked = boxes.length > 0 && ticked === boxes.length; all.indeterminate = ticked > 0 && ticked < boxes.length; }
  const bar = $('log-bar');
  if (!bar) return;
  const n = logAllMatching ? logsTotal : logSel.size;
  bar.hidden = n === 0;
  $('log-bar-text').textContent = logAllMatching
    ? `All ${logsTotal} entries matching the filters are selected.`
    : `${n} entr${n === 1 ? 'y' : 'ies'} selected.`;
  const more = $('log-bar-matching');
  const offerAll = !logAllMatching && boxes.length > 0 && ticked === boxes.length && logsTotal > logsShown;
  more.hidden = !offerAll;
  if (offerAll) more.textContent = `Select all ${logsTotal} entries matching the filters`;
  updateLogExportNotes();
}

function updateLogExportNotes() {
  const n = logAllMatching ? logsTotal : logSel.size;
  const text = !isAdminUser() || n === 0
    ? `all ${logsTotal} matching entr${logsTotal === 1 ? 'y' : 'ies'}`
    : `${n} selected entr${n === 1 ? 'y' : 'ies'}`;
  const x = $('log-note-xlsx'), p = $('log-note-pdf');
  if (x) x.textContent = `.xlsx · ${text}`;
  if (p) p.textContent = `.pdf · ${text}`;
}

/** What the Export menu sends: the ticked entries if any, otherwise everything matching the filters. */
function logsReportBody(format) {
  if (isAdminUser() && logSel.size && !logAllMatching) return { format, ids: [...logSel] };
  return { format, filters: currentLogFilters() };
}

/* ── Deleting log entries (Admin) ──────────────────────────────────────────── */
async function runLogDelete(body) {
  try {
    const res = await Logs.remove(body);
    const kept = res.skipped ? ` (${res.skipped} permanent record${res.skipped === 1 ? ' was' : 's were'} kept)` : '';
    showToast(res.deleted ? `🗑 Deleted ${res.deleted} log entr${res.deleted === 1 ? 'y' : 'ies'}.${kept}` : `Nothing was deleted${kept}.`);
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not delete.'), true);
  }
  loadLogs(true);
}

async function deleteOneLog(id) {
  const ok = await askDanger({
    title: 'Delete this log entry?',
    message: 'It is removed from the Activity Log permanently.',
    confirmLabel: 'Delete entry',
  });
  if (ok) runLogDelete({ ids: [id] });
}

async function deleteSelectedLogs() {
  if (logAllMatching) {
    const ok = await askDanger({
      title: `Delete all ${logsTotal} matching log entries?`,
      message: 'Everything that matches the current filters is removed permanently. A permanent note ("Logs deleted") will record who cleaned the log, when, and how much.',
      confirmLabel: `Delete ${logsTotal} entries`,
      typeToConfirm: true,
    });
    if (ok) runLogDelete({ filters: currentLogFilters(), confirm: 'DELETE' });
    return;
  }
  const ids = [...logSel];
  if (!ids.length) return;
  const many = ids.length > 1;
  const ok = await askDanger({
    title: many ? `Delete ${ids.length} log entries?` : 'Delete this log entry?',
    message: many
      ? 'The selected entries are removed permanently. A permanent note ("Logs deleted") will record who cleaned the log, when, and how much.'
      : 'It is removed from the Activity Log permanently.',
    confirmLabel: many ? `Delete ${ids.length} entries` : 'Delete entry',
    typeToConfirm: many,
  });
  if (ok) runLogDelete(many ? { ids, confirm: 'DELETE' } : { ids });
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Photo proof for the Starting / Closing reading and the Diesel
   ───────────────────────────────────────────────────────────────────────────────
   • The photo is shrunk in the browser first (≈150 KB instead of 3–8 MB) so it uploads
     quickly on site mobile data and doesn't fill the storage.
   • It uploads as soon as it is picked, so a problem shows up right at the field —
     not after pressing Save. Until the entry is saved it is only a "pending" upload;
     removing it or clearing the form discards it.
   ═══════════════════════════════════════════════════════════════════════════════ */
const PHOTO_MAX_EDGE  = 1280;                 // longest side, in pixels — plenty to read a dial or odometer
const PHOTO_QUALITY   = 0.72;
const PHOTO_MAX_INPUT = 30 * 1024 * 1024;     // refuse absurdly large originals before even trying
const PHOTO_GROUPS    = { f: ['f-start', 'f-close', 'f-diesel'], e: ['e-start', 'e-close', 'e-diesel'] };

const CAMERA_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';

// key → { saved: path already stored with the entry (edit only), path: what will be saved,
//         preview: local thumbnail URL, busy, fresh: [pending uploads not yet saved], error }
const photoState = {};
const blankPhoto = () => ({ saved: null, path: null, preview: null, busy: false, fresh: [], error: '' });
function ps(key) { return photoState[key] || (photoState[key] = blankPhoto()); }
const photoBox = key => document.querySelector(`.photo-field[data-key="${key}"]`);

function photoFieldHtml() {
  return `
    <input type="file" class="photo-file" accept="image/*" hidden>
    <button type="button" class="photo-add">${CAMERA_SVG}<span>Add photo proof</span></button>
    <div class="photo-chip" hidden>
      <button type="button" class="photo-thumb" title="View photo" aria-label="View photo">
        <img alt="" hidden><span class="photo-icon">${CAMERA_SVG}</span>
      </button>
      <span class="photo-status"></span>
      <button type="button" class="photo-replace">Replace</button>
      <button type="button" class="photo-x" title="Remove photo" aria-label="Remove photo">✕</button>
    </div>
    <div class="photo-err" role="alert"></div>`;
}

function initPhotoFields() {
  document.querySelectorAll('.photo-field[data-key]').forEach(box => {
    const key = box.dataset.key;
    box.innerHTML = photoFieldHtml();
    const file = box.querySelector('.photo-file');
    box.querySelector('.photo-add').addEventListener('click', () => file.click());
    box.querySelector('.photo-replace').addEventListener('click', () => file.click());
    box.querySelector('.photo-thumb').addEventListener('click', () => viewFieldPhoto(key));
    box.querySelector('.photo-x').addEventListener('click', () => removePhoto(key));
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      file.value = '';                       // so picking the same photo again still fires "change"
      if (f) onPhotoChosen(key, f);
    });
    renderPhoto(key);
  });

  // Camera buttons in the Records table
  const body = document.getElementById('records-body');
  if (body) body.addEventListener('click', ev => {
    const b = ev.target.closest('.photo-view');
    if (b) viewSavedPhoto(b.dataset.path, b.dataset.title);
  });
}

function renderPhoto(key) {
  const box = photoBox(key);
  if (!box) return;
  const st = ps(key);
  const has = !!st.path || st.busy;
  box.querySelector('.photo-add').hidden = has;
  const chip = box.querySelector('.photo-chip');
  chip.hidden = !has;
  chip.classList.toggle('is-busy', st.busy);

  const img = chip.querySelector('img'), icon = chip.querySelector('.photo-icon');
  if (st.preview) { img.src = st.preview; img.hidden = false; icon.hidden = true; }
  else            { img.removeAttribute('src'); img.hidden = true; icon.hidden = false; }

  chip.querySelector('.photo-status').textContent =
    st.busy ? 'Uploading…' : (st.path && st.path === st.saved ? 'On file' : 'Attached ✓');
  chip.querySelector('.photo-replace').disabled = st.busy;
  chip.querySelector('.photo-x').disabled = st.busy;
  box.querySelector('.photo-err').textContent = st.error || '';
}

const photoPath  = key => ps(key).path || null;
const photosBusy = group => (PHOTO_GROUPS[group] || []).some(k => ps(k).busy);

function discardPendingPhoto(path) {
  Uploads.discard(path).catch(() => {});     // a leftover file is harmless — never bother the person
}

/** Shows a photo that is already saved with an entry (edit dialog). */
function setExistingPhoto(key, path) {
  photoState[key] = { ...blankPhoto(), saved: path, path };
  renderPhoto(key);
}

/** Clears a group of photo fields. discard=true also throws away uploads that were never saved. */
function releasePhotos(group, discard) {
  (PHOTO_GROUPS[group] || []).forEach(key => {
    const st = ps(key);
    if (discard) st.fresh.forEach(discardPendingPhoto);
    if (st.preview) URL.revokeObjectURL(st.preview);
    photoState[key] = blankPhoto();
    renderPhoto(key);
  });
}

function removePhoto(key) {
  const st = ps(key);
  if (st.busy) return;
  if (st.path && st.fresh.includes(st.path)) {
    discardPendingPhoto(st.path);
    st.fresh = st.fresh.filter(p => p !== st.path);
  }
  if (st.preview) URL.revokeObjectURL(st.preview);
  st.path = null; st.preview = null; st.error = '';
  renderPhoto(key);
}

/** Shrinks a photo to a JPEG no wider/taller than PHOTO_MAX_EDGE. */
async function compressImage(file) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('unsupported-image'));
      i.src = src;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error('unsupported-image');
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';                  // PNG transparency would otherwise turn black
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);       // browsers apply the phone's rotation here
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', PHOTO_QUALITY));
    if (!blob) throw new Error('unsupported-image');
    return blob;
  } finally {
    URL.revokeObjectURL(src);
  }
}

function photoErrorText(e) {
  if (e && e.message === 'unsupported-image') return 'That file could not be read as a photo. Please choose a JPG or PNG picture.';
  return (e && e.message) || 'The photo could not be uploaded. Please try again.';
}

async function onPhotoChosen(key, file) {
  const st = ps(key);
  if (st.busy) return;
  st.error = '';
  if (file.size > PHOTO_MAX_INPUT) { st.error = 'That photo is too large. Please choose a smaller one.'; renderPhoto(key); return; }

  const prev = { path: st.path, preview: st.preview };
  st.busy = true;
  renderPhoto(key);
  let newPreview = null;
  try {
    const blob = await compressImage(file);
    newPreview = URL.createObjectURL(blob);
    st.preview = newPreview;
    renderPhoto(key);                        // show the thumbnail while it uploads
    const res = await Uploads.reading(blob);

    // The form/dialog may have been cleared or closed while uploading — then this photo isn't wanted.
    if (photoState[key] !== st) { discardPendingPhoto(res.path); URL.revokeObjectURL(newPreview); return; }

    if (prev.path && st.fresh.includes(prev.path)) {       // the earlier unsaved upload is replaced
      discardPendingPhoto(prev.path);
      st.fresh = st.fresh.filter(p => p !== prev.path);
    }
    if (prev.preview) URL.revokeObjectURL(prev.preview);
    st.path = res.path;
    st.fresh.push(res.path);
  } catch (e) {
    if (photoState[key] !== st) { if (newPreview) URL.revokeObjectURL(newPreview); return; }
    if (newPreview) URL.revokeObjectURL(newPreview);
    st.preview = prev.preview;               // back to how it was
    st.error = photoErrorText(e);
  } finally {
    if (photoState[key] === st) { st.busy = false; renderPhoto(key); }
  }
}

/* ── Viewing photos ─────────────────────────────────────────────────────────── */
let photoViewerSeq = 0;

function photoChipHtml(path, title) {
  if (!path) return '';
  return `<button type="button" class="photo-view" data-path="${esc(path)}" data-title="${esc(title)}" title="View photo proof" aria-label="View photo proof">${CAMERA_SVG}</button>`;
}

function openPhotoViewer(title) {
  document.getElementById('photo-title').textContent = title || 'Reading photo';
  const img = document.getElementById('photo-img');
  img.hidden = true; img.removeAttribute('src');
  document.getElementById('photo-open').hidden = true;
  document.getElementById('photo-msg').textContent = '';
  document.getElementById('photo-modal-overlay').classList.add('open');
}

function setPhotoViewerMessage(text) {
  const img = document.getElementById('photo-img');
  img.hidden = true; img.removeAttribute('src');
  document.getElementById('photo-open').hidden = true;
  document.getElementById('photo-msg').textContent = text;
}

function setPhotoViewerImage(url, canOpenFull) {
  const img = document.getElementById('photo-img');
  const msg = document.getElementById('photo-msg');
  const link = document.getElementById('photo-open');
  msg.textContent = '';
  img.onload  = () => { img.hidden = false; msg.textContent = ''; };
  img.onerror = () => setPhotoViewerMessage('The photo could not be loaded. The link may have expired — close this and open it again.');
  img.src = url;
  if (canOpenFull) { link.href = url; link.hidden = false; }
}

function closePhotoViewer() {
  photoViewerSeq++;                          // ignore any link that is still being fetched
  const img = document.getElementById('photo-img');
  img.onload = img.onerror = null;
  img.removeAttribute('src');
  document.getElementById('photo-modal-overlay').classList.remove('open');
}

/** Opens a photo that is saved with an entry. The server hands out a link that works for 10 minutes. */
async function viewSavedPhoto(path, title) {
  const seq = ++photoViewerSeq;
  openPhotoViewer(title);
  setPhotoViewerMessage('Loading photo…');
  try {
    const res = await Uploads.signedUrl(path);
    if (seq !== photoViewerSeq) return;
    setPhotoViewerImage(res.url, true);
  } catch (e) {
    if (seq !== photoViewerSeq) return;
    setPhotoViewerMessage((e && e.message) || 'That photo could not be opened.');
  }
}

function viewFieldPhoto(key) {
  const st = ps(key);
  const box = photoBox(key);
  const title = (box && box.dataset.label) || 'Reading photo';
  if (st.preview) { photoViewerSeq++; openPhotoViewer(title); setPhotoViewerImage(st.preview, false); }
  else if (st.path) viewSavedPhoto(st.path, title);
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Loads breakup — an entry's Loads split by unloading point
   The lines are optional, but when present they must add up to Loads.
   Used by the Data Entry form (prefix "f") and the Edit dialog (prefix "e").
   ═══════════════════════════════════════════════════════════════════════════════ */
const LP_MAX = 30;
const lpEl = (p, part) => document.getElementById(`${p}-lp-${part}`);
const lpTotalLoads = p => parseInt(document.getElementById(`${p}-loads`).value, 10) || 0;

/** "Yard A: 5 · Yard B: 7" — the same text however the lines are ordered (null when there are none). */
function pointsText(points) {
  if (!Array.isArray(points) || !points.length) return null;
  return [...points]
    .sort((a, b) => String(a.point_name).toLowerCase().localeCompare(String(b.point_name).toLowerCase()))
    .map(x => `${x.point_name}: ${x.loads}`).join(' · ');
}
function pointsMini(e) {
  const t = pointsText(e.load_points);
  return t ? `<div class="lp-mini" title="Loads by unloading point">${esc(t)}</div>` : '';
}

async function loadUnloadPoints() {
  const u = Auth.currentUser();
  if (!u || !['supervisor', 'admin'].includes(u.role)) return;
  try {
    const res = await Entries.unloadPoints();
    document.getElementById('unload-points-list').innerHTML = (res.data || []).map(n => `<option value="${esc(n)}"></option>`).join('');
  } catch { /* suggestions are a convenience only */ }
}

function initLoadPoints() {
  ['f', 'e'].forEach(p => {
    document.getElementById(`${p}-loads`).addEventListener('input', () => updateLpTotal(p));
    const rows = lpEl(p, 'rows');
    rows.addEventListener('input', () => updateLpTotal(p));
    rows.addEventListener('click', ev => {
      const b = ev.target.closest('.lp-del');
      if (b) { b.closest('.lp-row').remove(); updateLpTotal(p); }
    });
    updateLpTotal(p);
  });
}

function sumLoadPoints(p) {
  return readLoadPoints(p).reduce((a, r) => a + (Number.isFinite(r.loads) ? r.loads : 0), 0);
}

function addLoadPoint(p, name = '', count = '', focus = true) {
  const wrap = lpEl(p, 'rows');
  if (wrap.children.length >= LP_MAX) { showToast(`At most ${LP_MAX} unloading points per entry.`, true); return; }
  // A new empty line starts with the loads that are still unallocated — usually exactly what the person wants.
  if (name === '' && count === '') {
    const left = lpTotalLoads(p) - sumLoadPoints(p);
    if (left > 0) count = left;
  }
  const row = document.createElement('div');
  row.className = 'lp-row';
  row.innerHTML = `
    <input type="text" class="lp-name" list="unload-points-list" placeholder="Unloading point (e.g. Yard A)" maxlength="80" autocomplete="off" aria-label="Unloading point name" value="${esc(name)}">
    <input type="number" class="lp-count" min="1" step="1" inputmode="numeric" placeholder="Loads" aria-label="Number of loads" value="${esc(count)}">
    <button type="button" class="lp-del" aria-label="Remove this line">✕</button>`;
  wrap.appendChild(row);
  updateLpTotal(p);
  if (focus) row.querySelector('.lp-name').focus();
}

/** The lines as typed (names tidied; completely empty lines left out). */
function readLoadPoints(p) {
  return [...lpEl(p, 'rows').querySelectorAll('.lp-row')].map(row => {
    const raw = row.querySelector('.lp-count').value.trim();
    return { point_name: row.querySelector('.lp-name').value.replace(/\s+/g, ' ').trim(), loads: raw === '' ? '' : Number(raw) };
  }).filter(r => r.point_name || r.loads !== '');
}

function setLoadPoints(p, points) {
  lpEl(p, 'rows').innerHTML = '';
  [...(points || [])]
    .sort((a, b) => String(a.point_name).toLowerCase().localeCompare(String(b.point_name).toLowerCase()))
    .forEach(x => addLoadPoint(p, x.point_name, x.loads, false));
  updateLpTotal(p);
}
function clearLoadPoints(p) { lpEl(p, 'rows').innerHTML = ''; updateLpTotal(p); }

/** The little "8 of 12 loads allocated" line — green when it matches, amber while loads are left, red when over. */
function updateLpTotal(p) {
  const el = lpEl(p, 'total');
  if (!el) return;
  const rows = readLoadPoints(p);
  if (!rows.length) { el.textContent = ''; el.className = 'lp-total'; return; }
  const total = lpTotalLoads(p), sum = sumLoadPoints(p);
  let text, cls;
  if (!total)            { text = 'Enter the total Loads above first'; cls = 'warn'; }
  else if (sum === total) { text = `✓ ${sum} of ${total} loads allocated`; cls = 'ok'; }
  else if (sum < total)   { text = `${sum} of ${total} loads allocated · ${total - sum} left`; cls = 'warn'; }
  else                    { text = `${sum} of ${total} loads · ${sum - total} too many`; cls = 'bad'; }
  el.textContent = text;
  el.className = `lp-total ${cls}`;
}

/** Returns a message if the lines are not acceptable, otherwise null. Mirrors the server's rules. */
function validateLoadPoints(p) {
  const rows = readLoadPoints(p);
  if (!rows.length) return null;
  const seen = new Set();
  for (const r of rows) {
    if (!r.point_name) return 'Each unloading point needs a name.';
    if (!Number.isInteger(r.loads) || r.loads < 1) return `Loads for "${r.point_name}" must be a whole number of 1 or more.`;
    const key = r.point_name.toLowerCase();
    if (seen.has(key)) return `"${r.point_name}" is listed twice. Combine them into one line.`;
    seen.add(key);
  }
  const total = lpTotalLoads(p), sum = sumLoadPoints(p);
  if (sum !== total) return `The unloading points add up to ${sum} load${sum === 1 ? '' : 's'}, but Loads is ${total}. They must match.`;
  return null;
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Documents (Owner + Admin) — work orders, tax invoices, …
   ═══════════════════════════════════════════════════════════════════════════════ */
const DOC = { meta: { categories: [], max_mb: 25, blocked: [] }, list: [], file: null, editingId: null, sites: [], debounce: null };

const humanSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);
const fileExt = name => { const m = /\.([A-Za-z0-9]{1,10})$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };
const DOC_FORMATS = {
  pdf: 'PDF', doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word', xls: 'Excel', xlsx: 'Excel', csv: 'CSV', ods: 'Excel',
  ppt: 'PowerPoint', pptx: 'PowerPoint', odp: 'PowerPoint', jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', webp: 'Image',
  bmp: 'Image', tif: 'Image', tiff: 'Image', heic: 'Image', svg: 'Image', dwg: 'CAD', dxf: 'CAD', zip: 'Archive', rar: 'Archive', '7z': 'Archive',
  txt: 'Text', md: 'Text', xml: 'XML', json: 'JSON',
};
const docFormat = ext => (ext ? (DOC_FORMATS[ext] || ext.toUpperCase()) : 'File');
const FMT_CLASS = { PDF: 'fm-pdf', Word: 'fm-word', Excel: 'fm-excel', CSV: 'fm-excel', PowerPoint: 'fm-ppt', Image: 'fm-img', CAD: 'fm-cad', Archive: 'fm-zip' };
const fmtBadge = label => `<span class="fmt-badge ${FMT_CLASS[label] || 'fm-other'}">${esc(label)}</span>`;

function fillSelect(sel, items, current, firstLabel) {
  const keep = current !== undefined ? current : sel.value;
  sel.innerHTML = (firstLabel !== undefined ? `<option value="">${esc(firstLabel)}</option>` : '') +
    items.map(i => `<option value="${esc(i)}">${esc(i)}</option>`).join('');
  if (keep && ![...sel.options].some(o => o.value === keep)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(keep)}">${esc(keep)}</option>`);
  sel.value = keep || '';
}

function loadDocumentsDebounced() {
  clearTimeout(DOC.debounce);
  DOC.debounce = setTimeout(loadDocuments, 300);
}
function clearDocFilters() {
  document.getElementById('doc-filter-category').value = '';
  document.getElementById('doc-search').value = '';
  loadDocuments();
}

let docSeq = 0;
async function loadDocuments() {
  const seq = ++docSeq;
  const body = document.getElementById('documents-body');
  try {
    const [res, sites] = await Promise.all([
      Documents.list({ category: document.getElementById('doc-filter-category').value, q: document.getElementById('doc-search').value.trim() }),
      DOC.sites.length ? Promise.resolve(null) : Inventory.getSites().catch(() => null),
    ]);
    if (seq !== docSeq) return;
    if (res.meta) DOC.meta = res.meta;
    if (sites) DOC.sites = (sites.data || []).filter(x => x.active).map(x => x.name);
    DOC.list = res.data || [];
    fillSelect(document.getElementById('doc-category'), DOC.meta.categories, undefined, 'Select type…');
    fillSelect(document.getElementById('doc-filter-category'), DOC.meta.categories, undefined, 'All types');
    fillSelect(document.getElementById('doc-site'), DOC.sites, undefined, '—');
    document.getElementById('doc-hint').textContent =
      `Any file type — PDF, Word, Excel, pictures, drawings and more. Up to ${DOC.meta.max_mb} MB. Programs and scripts (.exe, .bat, .js …) are not allowed.`;
    renderDocuments();
  } catch (e) {
    if (seq !== docSeq) return;
    const setup = e.data && e.data.setup_required;
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${setup
      ? '⚠️ Documents need a one-time database update.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-3-new-features.sql</strong>, then reload this page.</small>'
      : esc(e.message || 'Could not load the documents.')}</td></tr>`;
    document.getElementById('doc-count').textContent = '';
  }
}

function renderDocuments() {
  const body = document.getElementById('documents-body');
  body.innerHTML = '';
  const n = DOC.list.length;
  document.getElementById('doc-count').textContent = n ? `${n} document${n === 1 ? '' : 's'}` : '';
  if (!n) {
    const filtered = document.getElementById('doc-search').value.trim() || document.getElementById('doc-filter-category').value;
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${filtered ? 'No documents match these filters.' : 'No documents yet. Upload the first one above.'}</td></tr>`;
    return;
  }
  DOC.list.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="doc-name-cell">
        <strong>${esc(d.name)}</strong>
        <div class="doc-sub">${esc(d.original_filename || '')}</div>
        ${d.site ? `<div class="doc-sub">📍 ${esc(d.site)}</div>` : ''}
        ${d.notes ? `<div class="doc-notes">${esc(d.notes)}</div>` : ''}
      </td>
      <td><span class="pill pill-orange">${esc(d.category)}</span></td>
      <td>${fmtBadge(d.format)}</td>
      <td class="doc-size">${esc(humanSize(d.size_bytes))}</td>
      <td class="log-time">${fmtDateTime(d.created_at)}<br>${esc(d.uploaded_by_name || '')}</td>
      <td><button type="button" class="btn btn-green btn-sm" onclick="downloadDocument('${esc(d.id)}')" aria-label="Download ${esc(d.name)}">⬇ Download</button></td>
      <td><button type="button" class="btn btn-outline btn-sm" onclick="openDocEdit('${esc(d.id)}')" aria-label="Edit ${esc(d.name)}">✏️ Edit</button></td>
      <td class="admin-only-col"><button type="button" class="btn btn-danger btn-sm" onclick="deleteDocument('${esc(d.id)}')" aria-label="Delete ${esc(d.name)}">🗑</button></td>`;
    body.appendChild(tr);
  });
}

function onDocFileChosen() {
  const input = document.getElementById('doc-file');
  const f = input.files[0] || null;
  const info = document.getElementById('doc-file-info');
  const err = document.getElementById('doc-error');
  err.textContent = '';
  DOC.file = null;
  if (!f) { info.hidden = true; return; }
  const ext = fileExt(f.name);
  let problem = '';
  if ((DOC.meta.blocked || []).includes(ext)) problem = `".${ext}" files cannot be stored here because they can run programs on a computer. Use a document format such as PDF, Word or Excel.`;
  else if (f.size === 0) problem = 'That file is empty.';
  else if (f.size > DOC.meta.max_mb * 1048576) problem = `That file is ${humanSize(f.size)}. The limit is ${DOC.meta.max_mb} MB.`;
  if (problem) { err.textContent = problem; input.value = ''; info.hidden = true; return; }
  DOC.file = f;
  info.hidden = false;
  info.innerHTML = `${fmtBadge(docFormat(ext))} <strong>${esc(f.name)}</strong> <span class="doc-size">${esc(humanSize(f.size))}</span>`;
  const nameBox = document.getElementById('doc-name');
  if (!nameBox.value.trim()) nameBox.value = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 120);   // a starting point — editable
}

function resetDocForm() {
  ['doc-name', 'doc-notes', 'doc-file'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('doc-category').value = '';
  document.getElementById('doc-site').value = '';
  document.getElementById('doc-file-info').hidden = true;
  document.getElementById('doc-error').textContent = '';
  document.getElementById('doc-progress').hidden = true;
  DOC.file = null;
}

async function uploadDocument() {
  const err = document.getElementById('doc-error');
  const name = document.getElementById('doc-name').value.trim();
  const category = document.getElementById('doc-category').value;
  err.textContent = '';
  if (!name)      { err.textContent = 'Give the document a name.'; document.getElementById('doc-name').focus(); return; }
  if (!category)  { err.textContent = 'Choose the type of document (for example Work Order or Tax Invoice).'; document.getElementById('doc-category').focus(); return; }
  if (!DOC.file)  { err.textContent = 'Choose a file to upload.'; return; }

  const meta = { name, category };
  const site = document.getElementById('doc-site').value, notes = document.getElementById('doc-notes').value.trim();
  if (site) meta.site = site;
  if (notes) meta.notes = notes;

  const btn = document.getElementById('doc-upload-btn'), bar = document.getElementById('doc-progress-bar');
  const prog = document.getElementById('doc-progress'), txt = document.getElementById('doc-progress-text');
  btn.disabled = true; prog.hidden = false; bar.style.width = '0%'; txt.textContent = 'Uploading…';
  try {
    await Documents.upload(DOC.file, meta, f => {
      bar.style.width = `${Math.round(f * 100)}%`;
      txt.textContent = f >= 1 ? 'Saving…' : `Uploading… ${Math.round(f * 100)}%`;
    });
    showToast('✅ Document uploaded.');
    resetDocForm();
    loadDocuments();
  } catch (e) {
    err.textContent = e.message || 'The upload failed.';
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
}

async function downloadDocument(id) {
  try {
    const r = await Documents.url(id);
    const a = document.createElement('a');          // the link makes the browser DOWNLOAD the file (it is never opened in our page)
    a.href = r.url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    showToast('⬇ Download started.');
  } catch (e) {
    showToast('❌ ' + (e.message || 'Could not start the download.'), true);
  }
}

function openDocEdit(id) {
  const d = DOC.list.find(x => String(x.id) === String(id));
  if (!d) return;
  DOC.editingId = d.id;
  document.getElementById('doc-edit-title').textContent = 'Edit document';
  document.getElementById('de-name').value = d.name;
  fillSelect(document.getElementById('de-category'), DOC.meta.categories, d.category);
  fillSelect(document.getElementById('de-site'), DOC.sites, d.site || '', '—');
  document.getElementById('de-notes').value = d.notes || '';
  document.getElementById('de-error').textContent = '';
  document.getElementById('doc-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('de-name').focus(), 50);
}
function closeDocEdit() { document.getElementById('doc-edit-overlay').classList.remove('open'); DOC.editingId = null; }

async function saveDocEdit() {
  if (!DOC.editingId) return;
  const err = document.getElementById('de-error');
  err.textContent = '';
  const name = document.getElementById('de-name').value.trim();
  if (!name) { err.textContent = 'The document needs a name.'; return; }
  const btn = document.getElementById('de-save');
  btn.disabled = true;
  try {
    const res = await Documents.update(DOC.editingId, {
      name, category: document.getElementById('de-category').value,
      site: document.getElementById('de-site').value, notes: document.getElementById('de-notes').value.trim(),
    });
    closeDocEdit();
    showToast(res.unchanged ? 'No changes were made.' : '✅ Document updated.');
    loadDocuments();
  } catch (e) {
    err.textContent = e.message || 'Could not save the changes.';
  } finally {
    btn.disabled = false;
  }
}

async function deleteDocument(id) {
  const d = DOC.list.find(x => String(x.id) === String(id));
  const ok = await askDanger({
    title: `Delete "${d ? d.name : 'this document'}"?`,
    message: 'The record and the stored file are removed permanently. The deletion is written to the Activity Log.',
    confirmLabel: 'Delete document',
  });
  if (!ok) return;
  try { await Documents.remove(id); showToast('Document deleted.'); loadDocuments(); }
  catch (e) { showToast('❌ ' + (e.message || 'Delete failed.'), true); }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Payments — Weekly (food, …) and Monthly (salary, …)
   A supervisor adds one line per person; once saved, the Owner and Admin see them.
   The same person cannot be saved twice for the same week / month.
   ═══════════════════════════════════════════════════════════════════════════════ */
const PAY = { tab: 'weekly', built: false, lists: { weekly: [], monthly: [] }, mine: [], editing: null };
const PAY_MAX_DAYS = { weekly: 7, monthly: 31 };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const payRole = () => (Auth.currentUser() || {}).role;
const payCanAdd  = () => ['supervisor', 'admin'].includes(payRole());
const payCanView = () => ['owner', 'admin'].includes(payRole());

/** Monday–Sunday week that contains a date (local calendar maths, no time-zone surprises). */
function weekRange(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return { start: ymd(new Date(y, m - 1, d - dow)), end: ymd(new Date(y, m - 1, d - dow + 6)) };
}
const payPeriodLabel = (type, start, end) => (type === 'weekly' ? `${fmtDate(start)} – ${fmtDate(end)}` : `${MONTHS[+start.slice(5, 7) - 1]} ${start.slice(0, 4)}`);
const nameKey = n => String(n || '').replace(/\s+/g, ' ').trim().toLowerCase();

function payPanelHtml(t) {
  const week = t === 'weekly';
  const IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg>';
  const add = !payCanAdd() ? '' : `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="ic">${IC}</span> Add ${week ? 'weekly' : 'monthly'} payments</div></div>
      <div class="pay-period">
        <div class="form-group">
          <label for="pay-${t}-period">${week ? 'Any date in the week' : 'Month'} *</label>
          <input type="${week ? 'date' : 'month'}" id="pay-${t}-period" onchange="onPayPeriodChange('${t}')">
        </div>
        <p class="pay-period-text" id="pay-${t}-period-text"></p>
      </div>
      <div class="pay-head" aria-hidden="true"><span>Employee name</span><span>Days worked</span><span>Amount (₹)</span><span></span></div>
      <div class="pay-rows" id="pay-${t}-rows"></div>
      <button type="button" class="btn btn-outline btn-sm" onclick="addPayRow('${t}')">＋ Add person</button>
      <div class="pay-total" id="pay-${t}-total" aria-live="polite"></div>
      <div class="form-error" id="pay-${t}-error" role="alert"></div>
      <div class="btn-group">
        <button type="button" class="btn btn-primary" id="pay-${t}-save" onclick="savePayments('${t}')">💾 Save payments</button>
        <button type="button" class="btn btn-outline" onclick="resetPayForm('${t}')">✕ Clear</button>
      </div>
    </div>`;
  const mine = payRole() !== 'supervisor' ? '' : `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="ic">${IC}</span> Recently saved by you</div></div>
      <div class="table-wrap"><table>
        <thead><tr><th>${week ? 'Week' : 'Month'}</th><th>Employee</th><th>Days</th><th>Amount</th><th>Saved</th></tr></thead>
        <tbody id="pay-${t}-mine"></tbody>
      </table></div>
    </div>`;
  const admin = payRole() === 'admin';
  const list = !payCanView() ? '' : `
    <div class="card">
      <div class="card-header"><div class="card-title"><span class="ic">${IC}</span> Saved ${week ? 'weekly' : 'monthly'} payments</div><span class="doc-count" id="pay-${t}-count"></span></div>
      <div class="log-filters">
        <select id="pay-${t}-filter-period" onchange="renderPayList('${t}')" aria-label="Choose ${week ? 'week' : 'month'}"></select>
        <input type="text" id="pay-${t}-search" placeholder="Search employee…" oninput="renderPayList('${t}')" autocomplete="off">
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>${week ? 'Week' : 'Month'}</th><th>Employee</th><th>Days</th><th>Amount</th><th>Added by</th><th>Added on</th>${admin ? '<th>Edit</th><th>Delete</th>' : ''}</tr></thead>
        <tbody id="pay-${t}-list"></tbody>
      </table></div>
      <div class="pay-footer" id="pay-${t}-footer"></div>
    </div>`;
  return add + mine + list;
}

function showPayTab(t) {
  PAY.tab = t;
  ['weekly', 'monthly'].forEach(k => {
    const on = k === t;
    const tab = document.getElementById(`paytab-${k}`);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    document.getElementById(`pay-panel-${k}`).hidden = !on;
  });
}

function initPayments() {
  if (!PAY.built) {
    ['weekly', 'monthly'].forEach(t => {
      const panel = document.getElementById(`pay-panel-${t}`);
      panel.innerHTML = payPanelHtml(t);
      const rows = document.getElementById(`pay-${t}-rows`);
      if (rows) {
        // Once the person changes something, the old complaint (and its red marking) is out of date — clear it.
        const clearPayError = () => {
          document.getElementById(`pay-${t}-error`).textContent = '';
          rows.querySelectorAll('.has-error').forEach(r => r.classList.remove('has-error'));
        };
        rows.addEventListener('input', () => { clearPayError(); updatePayTotal(t); });
        rows.addEventListener('click', ev => { const b = ev.target.closest('.lp-del'); if (b) { b.closest('.pay-row').remove(); clearPayError(); updatePayTotal(t); } });
        rows.addEventListener('keydown', ev => {
          // Enter in the last amount box starts the next line — quick entry for a long list.
          if (ev.key === 'Enter' && ev.target.classList.contains('pr-amount') && ev.target.closest('.pay-row') === rows.lastElementChild) { ev.preventDefault(); addPayRow(t); }
        });
        resetPayForm(t);
      }
    });
    PAY.built = true;
  }
  showPayTab(PAY.tab);
  refreshPayments();
}

async function refreshPayments() {
  if (payCanAdd()) {
    Payments.employees().then(res => {
      document.getElementById('pay-employees').innerHTML = (res.data || []).map(n => `<option value="${esc(n)}"></option>`).join('');
    }).catch(() => {});
    Payments.mine().then(res => { PAY.mine = res.data || []; renderPayMine(); }).catch(() => {});
  }
  if (payCanView()) {
    for (const t of ['weekly', 'monthly']) {
      // eslint-disable-next-line no-await-in-loop
      await loadPayList(t);
    }
  }
}

function onPayPeriodChange(t) {
  const v = document.getElementById(`pay-${t}-period`).value;
  const el = document.getElementById(`pay-${t}-period-text`);
  if (!v) { el.textContent = ''; return; }
  if (t === 'weekly') { const w = weekRange(v); el.textContent = `Week: ${fmtDate(w.start)} (Mon) – ${fmtDate(w.end)} (Sun)`; }
  else el.textContent = `Month: ${MONTHS[+v.slice(5, 7) - 1]} ${v.slice(0, 4)}`;
}

function resetPayForm(t) {
  const period = document.getElementById(`pay-${t}-period`);
  if (!period) return;
  period.value = t === 'weekly' ? today() : today().slice(0, 7);
  onPayPeriodChange(t);
  document.getElementById(`pay-${t}-rows`).innerHTML = '';
  document.getElementById(`pay-${t}-error`).textContent = '';
  addPayRow(t, '', '', '', false);
  updatePayTotal(t);
}

function addPayRow(t, name = '', days = '', amount = '', focus = true) {
  const wrap = document.getElementById(`pay-${t}-rows`);
  if (wrap.children.length >= 100) { showToast('At most 100 people can be saved at once.', true); return; }
  const row = document.createElement('div');
  row.className = 'pay-row';
  row.innerHTML = `
    <input type="text" class="pr-name" list="pay-employees" placeholder="Employee name" maxlength="80" autocomplete="off" aria-label="Employee name" value="${esc(name)}">
    <input type="number" class="pr-days" min="0" max="${PAY_MAX_DAYS[t]}" step="0.5" inputmode="decimal" placeholder="Days" aria-label="Days worked" value="${esc(days)}">
    <input type="number" class="pr-amount" min="0" step="0.01" inputmode="decimal" placeholder="Amount" aria-label="Amount in rupees" value="${esc(amount)}">
    <button type="button" class="lp-del" aria-label="Remove this person">✕</button>`;
  wrap.appendChild(row);
  updatePayTotal(t);
  if (focus) row.querySelector('.pr-name').focus();
}

function readPayRows(t) {
  return [...document.getElementById(`pay-${t}-rows`).querySelectorAll('.pay-row')].map(row => ({
    row,
    employee_name: row.querySelector('.pr-name').value.replace(/\s+/g, ' ').trim(),
    days_worked: row.querySelector('.pr-days').value.trim(),
    amount: row.querySelector('.pr-amount').value.trim(),
  })).filter(r => r.employee_name || r.days_worked !== '' || r.amount !== '');
}

function updatePayTotal(t) {
  const el = document.getElementById(`pay-${t}-total`);
  if (!el) return;
  const rows = readPayRows(t);
  const total = rows.reduce((a, r) => a + (Number(r.amount) > 0 ? Number(r.amount) : 0), 0);
  el.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'person' : 'people'} · Total ${inr(total)}` : '';
}

/** Returns { error, bad: [rows] } — mirrors the server's rules so mistakes are caught before saving. */
function checkPayRows(t, rows) {
  if (!rows.length) return { error: 'Add at least one person.', bad: [] };
  const seen = new Map();
  for (const r of rows) {
    const label = r.employee_name || 'This line';
    if (!r.employee_name) return { error: "Enter the employee's name on every line.", bad: [r.row] };
    const d = Number(r.days_worked);
    if (r.days_worked === '' || !Number.isFinite(d) || d < 0 || d > PAY_MAX_DAYS[t] || Math.round(d * 2) / 2 !== d) {
      return { error: `${label}: days worked must be between 0 and ${PAY_MAX_DAYS[t]} (half days are allowed).`, bad: [r.row] };
    }
    const a = Number(r.amount);
    if (r.amount === '' || !Number.isFinite(a) || a <= 0) return { error: `${label}: enter an amount greater than 0.`, bad: [r.row] };
    const k = nameKey(r.employee_name);
    if (seen.has(k)) return { error: `"${r.employee_name}" is on the list twice. Each person can be paid only once for the same period.`, bad: [seen.get(k), r.row] };
    seen.set(k, r.row);
  }
  return { error: null, bad: [] };
}

async function savePayments(t) {
  const err = document.getElementById(`pay-${t}-error`);
  err.textContent = '';
  const period = document.getElementById(`pay-${t}-period`).value;
  if (!period) { err.textContent = t === 'weekly' ? 'Choose a date inside the week.' : 'Choose the month.'; return; }
  document.querySelectorAll(`#pay-${t}-rows .pay-row`).forEach(r => r.classList.remove('has-error'));
  const rows = readPayRows(t);
  const check = checkPayRows(t, rows);
  if (check.error) { err.textContent = check.error; check.bad.forEach(r => r.classList.add('has-error')); (check.bad[0] && check.bad[0].querySelector('input'))?.focus(); return; }

  const btn = document.getElementById(`pay-${t}-save`);
  btn.disabled = true;
  try {
    const res = await Payments.create({
      pay_type: t, period,
      items: rows.map(r => ({ employee_name: r.employee_name, days_worked: Number(r.days_worked), amount: Number(r.amount) })),
    });
    showToast(`✅ Saved ${res.count} ${res.count === 1 ? 'payment' : 'payments'} for ${res.period.label} — total ${inr(res.total)}.`);
    resetPayForm(t);
    refreshPayments();
  } catch (e) {
    err.textContent = e.message || 'Could not save the payments.';
    const dups = new Set(((e.data && e.data.duplicates) || []).map(d => nameKey(d.employee_name)));   // point at exactly who is already saved
    rows.forEach(r => { if (dups.has(nameKey(r.employee_name))) r.row.classList.add('has-error'); });
  } finally {
    btn.disabled = false;
  }
}

function renderPayMine() {
  ['weekly', 'monthly'].forEach(t => {
    const body = document.getElementById(`pay-${t}-mine`);
    if (!body) return;
    const rows = PAY.mine.filter(r => r.pay_type === t).slice(0, 20);
    body.innerHTML = rows.length ? rows.map(r => `
      <tr><td>${esc(payPeriodLabel(t, r.period_start, r.period_end))}</td><td><strong>${esc(r.employee_name)}</strong></td>
      <td>${esc(r.days_worked)}</td><td>${esc(inr(r.amount))}</td><td class="log-time">${fmtDateTime(r.created_at)}</td></tr>`).join('')
      : '<tr class="empty-row"><td colspan="5">Nothing saved by you yet.</td></tr>';
  });
}

async function loadPayList(t) {
  const body = document.getElementById(`pay-${t}-list`);
  if (!body) return;
  try {
    const res = await Payments.list(t);
    PAY.lists[t] = res.data || [];
    renderPayList(t, true);
  } catch (e) {
    const setup = e.data && e.data.setup_required;
    body.innerHTML = `<tr class="empty-row"><td colspan="8">${setup
      ? '⚠️ Payments need a one-time database update.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-3-new-features.sql</strong>, then reload this page.</small>'
      : esc(e.message || 'Could not load the payments.')}</td></tr>`;
  }
}

function renderPayList(t, rebuildPeriods = false) {
  const body = document.getElementById(`pay-${t}-list`);
  if (!body) return;
  const all = PAY.lists[t] || [];
  const sel = document.getElementById(`pay-${t}-filter-period`);
  if (rebuildPeriods || !sel.options.length) {
    const keep = sel.value;
    const seen = new Map();
    all.forEach(r => { if (!seen.has(r.period_start)) seen.set(r.period_start, r.period_end); });      // already newest first
    sel.innerHTML = '<option value="">All periods</option>' + [...seen].map(([s, e]) => `<option value="${esc(s)}">${esc(payPeriodLabel(t, s, e))}</option>`).join('');
    const first = [...seen.keys()][0] || '';
    sel.value = rebuildPeriods && keep && seen.has(keep) ? keep : (rebuildPeriods && !sel.dataset.touched ? first : (keep || ''));
    sel.dataset.touched = '1';
  }
  const q = document.getElementById(`pay-${t}-search`).value.trim().toLowerCase();
  const rows = all.filter(r => (!sel.value || r.period_start === sel.value) && (!q || r.employee_name.toLowerCase().includes(q)));
  const admin = payRole() === 'admin';
  body.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td>${esc(payPeriodLabel(t, r.period_start, r.period_end))}</td>
      <td><strong>${esc(r.employee_name)}</strong></td>
      <td>${esc(r.days_worked)}</td>
      <td class="pay-amount">${esc(inr(r.amount))}</td>
      <td>${esc(r.created_by_name || '')}</td>
      <td class="log-time">${fmtDateTime(r.created_at)}</td>
      ${admin ? `<td><button type="button" class="btn btn-outline btn-sm" onclick="openPayEdit('${t}','${esc(r.id)}')" aria-label="Edit ${esc(r.employee_name)}">✏️ Edit</button></td>
      <td><button type="button" class="btn btn-danger btn-sm" onclick="deletePayment('${t}','${esc(r.id)}')" aria-label="Delete ${esc(r.employee_name)}">🗑</button></td>` : ''}
    </tr>`).join('')
    : `<tr class="empty-row"><td colspan="8">${all.length ? 'No payments match these filters.' : 'No payments saved yet.'}</td></tr>`;
  const total = rows.reduce((a, r) => a + r.amount, 0);
  document.getElementById(`pay-${t}-footer`).textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'line' : 'lines'} · Total ${inr(total)}` : '';
  document.getElementById(`pay-${t}-count`).textContent = all.length ? `${all.length} in total` : '';
}

/* Admin: edit / delete a saved line (both need a written reason, like entries) */
function openPayEdit(t, id) {
  const row = (PAY.lists[t] || []).find(r => String(r.id) === String(id));
  if (!row) return;
  PAY.editing = { t, row };
  document.getElementById('pay-edit-title').textContent = 'Edit payment';
  document.getElementById('pay-edit-period').textContent = `${t === 'weekly' ? 'Week' : 'Month'}: ${payPeriodLabel(t, row.period_start, row.period_end)}`;
  document.getElementById('pe-name').value = row.employee_name;
  document.getElementById('pe-days').value = row.days_worked;
  document.getElementById('pe-days').max = PAY_MAX_DAYS[t];
  document.getElementById('pe-amount').value = row.amount;
  document.getElementById('pe-error').textContent = '';
  document.getElementById('pay-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pe-name').focus(), 50);
}
function closePayEdit() { document.getElementById('pay-edit-overlay').classList.remove('open'); PAY.editing = null; }

async function savePayEdit() {
  if (!PAY.editing) return;
  const { t, row } = PAY.editing;
  const err = document.getElementById('pe-error');
  err.textContent = '';
  const body = {
    employee_name: document.getElementById('pe-name').value.replace(/\s+/g, ' ').trim(),
    days_worked: document.getElementById('pe-days').value.trim(),
    amount: document.getElementById('pe-amount').value.trim(),
  };
  const chk = checkPayRows(t, [{ row: null, ...body }]);
  if (chk.error) { err.textContent = chk.error; return; }
  body.days_worked = Number(body.days_worked); body.amount = Number(body.amount);

  const changes = [];
  if (body.employee_name !== row.employee_name) changes.push({ field: 'Employee', from: row.employee_name, to: body.employee_name });
  if (body.days_worked !== row.days_worked)     changes.push({ field: 'Days worked', from: String(row.days_worked), to: String(body.days_worked) });
  if (body.amount !== row.amount)               changes.push({ field: 'Amount', from: inr(row.amount), to: inr(body.amount) });
  if (!changes.length) { showToast('No changes were made.'); closePayEdit(); return; }

  const reason = await askReason({ title: 'Reason for Changes', intro: 'Please explain why this payment is being changed. It is saved in the Activity Log.', confirmLabel: 'Confirm & Save', changes });
  if (!reason) return;
  const btn = document.getElementById('pe-save');
  btn.disabled = true;
  try {
    await Payments.update(row.id, { ...body, reason });
    closePayEdit();
    showToast('✅ Payment updated.');
    loadPayList(t);
  } catch (e) {
    err.textContent = e.message || 'Could not save the changes.';
  } finally {
    btn.disabled = false;
  }
}

async function deletePayment(t, id) {
  const row = (PAY.lists[t] || []).find(r => String(r.id) === String(id));
  if (!row) return;
  const reason = await askReason({
    title: 'Delete this payment?',
    intro: `<strong>${esc(row.employee_name)}</strong> · ${esc(payPeriodLabel(t, row.period_start, row.period_end))} · ${esc(inr(row.amount))}<br>Please explain why it is being deleted. This is saved in the Activity Log.`,
    confirmLabel: 'Delete payment', danger: true,
  });
  if (!reason) return;
  try { await Payments.remove(row.id, reason); showToast('Payment deleted.'); loadPayList(t); }
  catch (e) { showToast('❌ ' + (e.message || 'Delete failed.'), true); }
}

