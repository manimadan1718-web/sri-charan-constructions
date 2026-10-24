/* Small line icons for the icon-only buttons (the same drawing style everywhere) */
const ICON_EDIT = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_TRASH = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';
/* ── Permissions → Tabs ─────────────────────────────────────────────────────── */
// What a person may do is decided by the SERVER (their role, plus anything the Admin switched on or off for them) and
// sent when they sign in. A tab is shown when the person has ANY of the permissions listed for it.
const TAB_PERMS = {
  entry:       ['entry.add'],
  records:     ['records.view'],
  progress:    ['progress.view'],
  renewals:    ['renewals.view'],
  archive:     ['archive.manage'],
  home:        [],
  purchases:   ['purchases.add', 'purchases.view'],
  summary:     ['summary.view'],
  documents:   ['documents.view'],
  payments:    ['payments.add', 'payments.view'],
  inventory:   ['inventory.manage'],
  users:       ['users.manage'],
  logs:        ['logs.view'],
  permissions: ['permissions.manage'],
};
const TAB_ORDER = ['home', 'entry', 'records', 'progress', 'purchases', 'summary', 'documents', 'renewals', 'payments', 'inventory', 'users', 'logs', 'permissions', 'archive'];
const ALL_PERMS = ['archive.manage', 'entry.add', 'progress.add', 'progress.view', 'progress.delete', 'renewals.view', 'renewals.add', 'renewals.edit', 'records.view', 'records.export', 'records.edit', 'records.delete', 'purchases.add', 'purchases.view', 'purchases.edit', 'summary.view',
  'documents.view', 'documents.print', 'documents.upload', 'documents.delete', 'payments.add', 'payments.view', 'payments.edit', 'inventory.manage', 'logs.view', 'logs.delete', 'users.manage', 'permissions.manage'];
// Only used when the server has not sent a list (a session that started before permissions existed): the role's defaults.
const ROLE_FALLBACK = {
  admin: ALL_PERMS,
  owner: ['records.view', 'records.export', 'progress.view', 'renewals.view', 'renewals.add', 'purchases.view', 'summary.view', 'documents.view', 'documents.print', 'documents.upload', 'payments.view', 'logs.view'],
  supervisor: ['entry.add', 'progress.add', 'purchases.add', 'payments.add'],
};
function myPerms() {
  const u = Auth.currentUser();
  if (!u) return [];
  return Array.isArray(u.permissions) ? u.permissions : (ROLE_FALLBACK[u.role] || []);
}
const can = key => myPerms().includes(key);
const canTab = name => name === 'home' || (!!TAB_PERMS[name] && TAB_PERMS[name].some(can));       // Home is for everyone who is signed in
const visibleTabs = () => TAB_ORDER.filter(canTab);

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

  applyPermUI();
  initMobileMenu(user);
  initBrandLink();
  initTableLabels();
  initNetBanner();
  initReasonModal();
  initPhotoFields();
  initExportMenu();
  initReportMenus();
  initLogSelection();

  document.getElementById('header-user').textContent = `${user.name} / ${capitalize(user.role)}`;
  fillSideUser(user);
  document.getElementById('f-date').value = today();
  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  await loadDropdownData();
  setupAutoCalculate();
  toggleCategoryFields('f');
  initLoadPoints();
  initProgressAdd();
  initBell();
  loadUnloadPoints();

  const firstTab = visibleTabs()[0];
  if (firstTab) switchTab(firstTab);
  else document.getElementById('section-noaccess').classList.add('active');       // nothing has been switched on for this person
});

/* ── Role-based UI ───────────────────────────────────────────────────────────── */
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function applyPermUI() {
  document.querySelectorAll('.tab[data-perms]').forEach(tab => {
    tab.style.display = tab.dataset.perms.split(',').some(can) ? '' : 'none';
  });
  const me = Auth.currentUser();
  document.body.classList.toggle('is-admin', !!me && me.role === 'admin');
  // one class per permission, so the stylesheet can hide what a person may not use  (e.g. body.can-records-edit)
  ALL_PERMS.forEach(k => document.body.classList.toggle('can-' + k.replace(/\./g, '-'), can(k)));
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
    addOtherOption('f-vehicle');
    populateSelect('f-operator', operators, 'name',       'Select operator…');
    populateSelect('f-site',     sites,     'name',       'Select site…');
    populateSelect('e-vehicle',  vehicles,  'vehicle_no', 'Select vehicle…');
    addOtherOption('e-vehicle');
    populateSelect('pu-site',    sites,     'name',       'Select site…');
    populateSelect('pue-site',   sites,     'name',       'Select site…');
    populateFilterSelect('pu-filter-site', sites, 'name', 'All sites');
    populateSelect('e-operator', operators, 'name',       'Select operator…');
    populateSelect('e-site',     sites,     'name',       'Select site…');
    // Records filters: everything in the inventory — including inactive items,
    // because old records can still belong to them.
    populateFilterSelect('filter-vehicle', vehicles, 'vehicle_no', 'All vehicles');
    // Vehicles that were typed in by hand ("Others") can be found in the Records filter as well.
    const me = Auth.currentUser();
    if (can('records.view')) {
      Entries.vehicleNumbers().then(r => {
        ((r && r.data) || []).forEach(v => extraFilterValues['filter-vehicle'].add(v));
        renderFilterSelect('filter-vehicle');
      }).catch(() => { /* the filter simply lists the inventory vehicles */ });
    }
    populateFilterSelect('filter-site',    sites,    'name',       'All sites');
    populateFilterSelect('pgv-site',       sites,    'name',       'All sites');
    populateFilterSelect('filter-type',    distinctTypes(vehicles), 'type', 'All types');
  } catch (e) {
    // Without the lists a supervisor cannot pick a vehicle or site — say so instead of leaving empty boxes.
    showToast("Couldn't load the vehicle, site and operator lists. Check your connection, then reload this page.", true);
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
  vehicleText.style.display    = (isRental || vehicleSelect.value === OTHER_VEHICLE) ? '' : 'none';
  vehicleText.placeholder      = isRental ? 'Rental vehicle / machine no.' : 'Type the vehicle / machine name';
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
  const sel = document.getElementById(prefix + '-vehicle'), txt = document.getElementById(prefix + '-vehicle-text');
  // A rental vehicle — or "Others" picked in the list — is typed in by hand.
  if (category === 'rental' || sel.value === OTHER_VEHICLE) return txt.value.trim();
  return sel.value.trim();
}

/* ── "Others": a vehicle that is not in the Inventory list can be typed in ───── */
const OTHER_VEHICLE = '__other__';

function addOtherOption(id) {
  const sel = document.getElementById(id);
  if (!sel || [...sel.options].some(o => o.value === OTHER_VEHICLE)) return;
  const opt = document.createElement('option');
  opt.value = OTHER_VEHICLE;
  opt.textContent = 'Others — type the name…';
  sel.appendChild(opt);
}

function onVehicleChange(prefix) {
  if (document.getElementById(prefix + '-category').value === 'rental') return;    // rentals always type the number
  const sel = document.getElementById(prefix + '-vehicle'), txt = document.getElementById(prefix + '-vehicle-text');
  const other = sel.value === OTHER_VEHICLE;
  txt.style.display = other ? '' : 'none';
  txt.placeholder = 'Type the vehicle / machine name';
  if (other) txt.focus(); else txt.value = '';
}

/** Used when an entry is opened for editing: a vehicle that is not in the list shows as "Others" with its name typed in. */
function setVehicleSelect(prefix, value) {
  const sel = document.getElementById(prefix + '-vehicle'), txt = document.getElementById(prefix + '-vehicle-text');
  const inList = value && [...sel.options].some(o => o.value === value && o.value !== OTHER_VEHICLE);
  if (!value || inList) { sel.value = value || ''; txt.value = ''; }
  else { sel.value = OTHER_VEHICLE; txt.value = value; }
  txt.style.display = sel.value === OTHER_VEHICLE ? '' : 'none';
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
      if (hintEl) hintEl.textContent = `Auto-calculated: ${hoursEl.value}`;
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
        if (hintEl) hintEl.textContent = `Auto-calculated: ${cNum} − ${sNum} = ${hoursEl.value}`;
        hoursEl.style.borderColor = 'var(--green)';
      } else {
        if (hintEl) hintEl.textContent = '⚠ Closing reading is less than starting reading.';
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
const TAB_LABELS = { entry: 'Data Entry', records: 'Records', progress: 'Progress', purchases: 'Purchases', summary: 'Summary', documents: 'Documents', renewals: 'Renewals', archive: 'Archived', home: 'Home', payments: 'Payments', inventory: 'Inventory', users: 'Users', logs: 'Activity Logs', permissions: 'Permissions' };

function switchTab(name) {
  // Only open a screen the signed-in role is meant to have (the server enforces this too; this keeps the screen honest).
  const me = Auth.currentUser();
  if (!me || !canTab(name)) return;

  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + name);
  if (tabEl) tabEl.classList.add('active');
  document.title = `${TAB_LABELS[name]} – Sri Charan Constructions`;          // each screen has its own page title
  const cur = document.getElementById('menu-current');
  if (cur) cur.textContent = TAB_LABELS[name];
  document.querySelectorAll('.mm-item').forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });

  document.querySelectorAll('.section').forEach(el => el.classList.remove('active'));
  const sectionEl = document.getElementById('section-' + name);
  if (sectionEl) sectionEl.classList.add('active');

  if (name === 'records')   loadRecords();
  if (name === 'progress')  loadProgressTab();
  if (name === 'renewals')  initRenewals();
  if (name === 'home')      initHome();
  if (name === 'archive')   initArchive();
  setCrumb(name);
  if (name === 'summary')   loadSummary();
  if (name === 'documents') loadDocuments();
  if (name === 'payments')  initPayments();
  if (name === 'purchases') initPurchases();
  if (name === 'permissions') initPermissions();
  if (name === 'inventory') loadInventory();
  if (name === 'users')     loadUsers();
  if (name === 'logs')      loadLogs(true);
  const activeTab = document.getElementById('tab-' + name); if (activeTab && activeTab.scrollIntoView) activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });       // the tab bar scrolls sideways when there are many
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
  pgReset(false);
}

async function saveEntry() {
  const date       = document.getElementById('f-date').value;
  const vehicle_no = getVehicleValue('f');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return; }
  const siteEl = document.getElementById('f-site');
  if (!siteEl.value.trim()) {
    siteEl.setAttribute('aria-invalid', 'true'); siteEl.focus();
    siteEl.addEventListener('change', () => siteEl.removeAttribute('aria-invalid'), { once: true });
    showToast('Select the site.', true); return;
  }
  if (photosBusy('f')) { showToast('Please wait — the photo is still uploading.', true); return; }
  if (pgBusy()) { showToast('Please wait — a progress photo is still uploading.', true); return; }
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
    progress_photos: pgPayload(),
  };

  const sure = await askConfirm({ title: 'Save this entry?', message: `${fmtDate(date)} · ${payload.site} · ${vehicle_no}` });
  if (!sure) return;                                     // "No": nothing is saved, and everything typed stays on the form

  try {
    await Entries.create(payload);
    showToast('Entry saved successfully!');
    releasePhotos('f', false);   // the photos now belong to the entry — keep them
    pgReset(true);               // …and so do the progress pictures
    clearForm();
    loadUnloadPoints();          // a new point name may have been used
  } catch (e) {
    showToast('' + (e.message || 'Save failed.'), true);
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
    const res = await Entries.getAll({ ...filters, order: document.getElementById('records-order').value });     // oldest first unless asked otherwise
    if (seq !== recordsRequestSeq) return; // a newer request superseded this one
    currentRecords = res.data || [];
    // With no filter on, this is the complete list — learn any vehicles / sites that aren't in Inventory.
    if (!Object.keys(filters).length) rememberRecordValues(currentRecords);
    syncFilterHighlights();
    const n = currentRecords.length;
    document.getElementById('records-count').textContent =
      `${n} record${n === 1 ? '' : 's'}${Object.keys(filters).length ? ' match your filters' : ''}`;
    renderRecordsTable(currentRecords);
    renderRecordsTotals(currentRecords, fFrom, fTo);
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
  const canEdit = can('records.edit'), canDelete = can('records.delete');
  tbody.innerHTML = '';

  if (!entries.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="${14 + (canEdit ? 1 : 0) + (canDelete ? 1 : 0)}">No records found.</td></tr>`;
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
      <td class="mileage-cell">${esc(fmtEntryMileage(e) || '–')}</td>
      <td>${esc(e.loads ?? 0)}${pointsMini(e)}</td>
      <td>${esc(e.operator) || '–'}</td>
      <td style="max-width:200px;white-space:normal;">${esc(e.remarks) || '–'}</td>
      <td class="hist-col"><button class="btn btn-outline btn-sm hist-btn" data-id="${esc(e.id)}" onclick="openHistory(this.dataset.id)" title="View history">${CLOCK_SVG}<span class="hist-count"></span></button></td>
      ${canEdit ? `<td class="edit-col"><button class="btn btn-outline btn-sm" onclick="openEditModal('${esc(e.id)}')" aria-label="Edit this entry">${ICON_EDIT}</button></td>` : ''}
      ${canDelete ? `<td class="del-col"><button class="btn btn-danger btn-sm" onclick="deleteEntry('${esc(e.id)}')" aria-label="Delete this entry">${ICON_TRASH}</button></td>` : ''}`;
    tbody.appendChild(tr);
  });
}

/* ── Working hours ───────────────────────────────────────────────────────────── */
// Entries store working hours as text ("8 hrs", "8 hrs 30 mins", "6.8", "8:30"). This reads them the SAME way the server does
// (backend/utils/workHours.js): whole minutes, or null when it is not a length of time ("130 km", "No work", more than a day).
const WH = '(?:h|hr|hrs|hour|hours)', WM = '(?:m|min|mins|minute|minutes)';
const WH_DECIMAL = new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${WH}?$`, 'i'), WH_HM = new RegExp(`^(\\d+)\\s*${WH}\\s*(\\d+)\\s*${WM}$`, 'i');
const WH_MIN = new RegExp(`^(\\d+)\\s*${WM}$`, 'i'), WH_CLOCK = /^(\d{1,2}):([0-5]\d)$/;
function parseWorkingMinutes(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return null;
  let m, min = null;
  if ((m = WH_DECIMAL.exec(t))) min = Math.round(parseFloat(m[1]) * 60);
  else if ((m = WH_HM.exec(t))) min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  else if ((m = WH_MIN.exec(t))) min = parseInt(m[1], 10);
  else if ((m = WH_CLOCK.exec(t))) min = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return min !== null && Number.isFinite(min) && min <= 24 * 60 ? min : null;
}
const fmtHours = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/* ── Mileage ─────────────────────────────────────────────────────────────────── */
// The same rules as the server (backend/utils/mileage.js): litres per hour for work measured in hours, km per litre when the
// reading says km. Totals use the whole period together, and only vehicles that were measured.
const KM_RE = /^(\d+(?:\.\d+)?)\s*(?:km|kms|kilometer|kilometers|kilometre|kilometres)$/i;
function parseKm(text) {
  const m = KM_RE.exec(String(text == null ? '' : text).trim());
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v <= 3000 ? v : null;
}
const round1 = n => Math.round(n * 10) / 10;
function entryMileage(e) {
  const d = Number(e && e.diesel) || 0;
  if (d <= 0) return null;
  const km = parseKm(e.working_hours);
  if (km !== null && km > 0) return { value: round1(km / d), unit: 'km/L' };
  const min = parseWorkingMinutes(e.working_hours);
  if (min !== null && min > 0) return { value: round1(d / (min / 60)), unit: 'L/hr' };
  return null;
}
function mileageOf(entries) {
  const byVehicle = new Map();
  for (const e of entries || []) {
    const key = e.vehicle_no || 'Unknown';
    const v = byVehicle.get(key) || { litres: 0, minutes: 0, km: 0 };
    v.litres += parseFloat(e.diesel) || 0;
    const m = parseWorkingMinutes(e.working_hours); if (m !== null) v.minutes += m;
    const k = parseKm(e.working_hours);            if (k !== null) v.km += k;
    byVehicle.set(key, v);
  }
  let hL = 0, hMin = 0, kL = 0, kKm = 0;
  for (const v of byVehicle.values()) {
    if (v.minutes > 0) { hL += v.litres; hMin += v.minutes; }
    if (v.km > 0)      { kL += v.litres; kKm += v.km; }
  }
  return { lph: hMin > 0 && hL > 0 ? round1(hL / (hMin / 60)) : null, kpl: kKm > 0 && kL > 0 ? round1(kKm / kL) : null };
}
const fmtMileageText = m => !m ? '' : [m.lph != null ? `${Number(m.lph).toFixed(1)} L/hr` : '', m.kpl != null ? `${Number(m.kpl).toFixed(1)} km/L` : ''].filter(Boolean).join(' · ');
const fmtEntryMileage = e => { const m = entryMileage(e); return m ? `${m.value.toFixed(1)} ${m.unit}` : ''; };
/** For a big card: the number, and what it is measured in. */
function mileageCard(m) {
  if (m && m.lph != null) return { value: m.lph.toFixed(1), unit: 'L per hour' + (m.kpl != null ? ` · also ${m.kpl.toFixed(1)} km/L` : '') };
  if (m && m.kpl != null) return { value: m.kpl.toFixed(1), unit: 'km per litre' };
  return { value: '–', unit: 'needs diesel and hours' };
}

/** The totals under the Records table (and in print): what is listed above, added up. */
function renderRecordsTotals(entries, from, to) {
  const box = document.getElementById('records-totals');
  if (!entries.length) { box.hidden = true; return; }
  const diesel = entries.reduce((a, e) => a + (Number(e.diesel) || 0), 0);
  const loads = entries.reduce((a, e) => a + (parseInt(e.loads, 10) || 0), 0);
  const dates = entries.map(e => e.date).filter(Boolean).sort();
  document.getElementById('rt-count').textContent = String(entries.length);
  document.getElementById('rt-range').textContent = dates.length ? (dates[0] === dates[dates.length - 1] ? fmtDate(dates[0]) : `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}`) : '';
  document.getElementById('rt-diesel').textContent = diesel.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('rt-loads').textContent = loads.toLocaleString('en-IN');
  // working hours: only entries whose hours really are a length of time are added up (not "130 km", not "No work")
  const mins = entries.map(e => parseWorkingMinutes(e.working_hours)).filter(m => m !== null);
  document.getElementById('rt-hours').textContent = mins.length ? fmtHours(Math.round(mins.reduce((a, m) => a + m, 0) / 60 * 100) / 100) : '0.0';
  document.getElementById('rt-hours-note').textContent = mins.length === entries.length ? 'Hours' : `Hours · from ${mins.length} of ${entries.length} entries`;
  const mc = mileageCard(mileageOf(entries));
  document.getElementById('rt-mileage').textContent = mc.value;
  document.getElementById('rt-mileage-note').textContent = mc.unit;
  document.getElementById('rt-mileage-help').hidden = false;
  box.hidden = false;
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
    showToast('' + (e.message || 'Delete failed.'), true);
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
  document.getElementById('export-label').textContent = on ? `Preparing ${label}…` : 'Export';
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
    showToast(`${label} report downloaded.`);
  } catch (e) {
    showToast('' + (e.message || 'The report could not be prepared.'), true);
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
    setVehicleSelect('e', entry.vehicle_no || '');
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
    showToast('Entry updated successfully!');
    releasePhotos('e', false);   // saved — keep the photos
    closeEditModal();
    loadRecords();
  } catch (e) {
    showToast('' + (e.message || 'Update failed.'), true);
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
  const siteSel = document.getElementById('sum-site');
  const site = siteSel.value;
  const siteName = siteSel.selectedIndex > 0 ? siteSel.options[siteSel.selectedIndex].textContent : '';
  document.getElementById('sum-range-text').textContent = `Showing: ${summaryRangeText(period)}${site ? ` · Site: ${siteName}` : ' · All sites'}`;
  const filters = {};
  if (period.from) filters.from = period.from;
  if (period.to)   filters.to   = period.to;
  if (site)        filters.site = site;

  const seq = ++summarySeq;
  try {
    const res = await Entries.stats(filters);
    if (seq !== summarySeq) return;                       // a newer choice has already been made
    const s = res.data || {};
    document.getElementById('s-entries').textContent  = s.total_entries  ?? '–';
    document.getElementById('s-diesel').textContent   = s.total_diesel   ?? '–';
    document.getElementById('s-loads').textContent    = s.total_loads    ?? '–';
    document.getElementById('s-hours').textContent    = s.total_hours === undefined ? '–' : fmtHours(s.total_hours);
    document.getElementById('s-hours-note').textContent = s.hours_entries === undefined || s.hours_entries === s.total_entries ? 'hours' : `hours · from ${s.hours_entries} of ${s.total_entries} entries`;
    const mc = mileageCard(s.mileage);
    document.getElementById('s-mileage').textContent = mc.value;
    document.getElementById('s-mileage-note').textContent = mc.unit;
    fillSummarySites(s.sites || [], site, siteName);
    renderVehicleBreakdown(s.vehicles || []);
    renderSiteBreakdown(s.sites || [], !site);
  } catch (e) {
    if (seq !== summarySeq) return;
    document.getElementById('vehicle-summary-body').innerHTML = `<tr class="empty-row"><td colspan="6">${esc(e.message || 'Could not load the summary.')}</td></tr>`;
  }
}

/** The site list follows the period (every site that has entries in it), and keeps the chosen site even if it has none right now. */
function fillSummarySites(sites, chosen, chosenName) {
  const sel = document.getElementById('sum-site');
  const opts = ['<option value="">All sites</option>'].concat(sites.map(x => `<option value="${esc(x.value)}">${esc(x.site)}</option>`));
  if (chosen && !sites.some(x => x.value === chosen)) opts.push(`<option value="${esc(chosen)}">${esc(chosenName || chosen)}</option>`);
  sel.innerHTML = opts.join('');
  sel.value = chosen || '';
}

function pickSummarySite(value) {
  document.getElementById('sum-site').value = value;
  loadSummary();
  document.getElementById('section-summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Site-wise table: shown only while "All sites" is chosen. */
function renderSiteBreakdown(sites, show) {
  const card = document.getElementById('sum-sites-card'), tbody = document.getElementById('site-summary-body');
  card.hidden = !show;
  tbody.innerHTML = '';
  if (!show) return;
  if (!sites.length) { tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No entries in this period.</td></tr>'; return; }
  sites.forEach(x => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><button type="button" class="link-btn" onclick="pickSummarySite('${esc(x.value)}')" aria-label="Show only ${esc(x.site)}"><strong>${esc(x.site)}</strong></button></td>
      <td>${esc(x.entries)}</td>
      <td>${esc(x.diesel)}</td>
      <td>${esc(x.loads)}</td>
      <td>${esc(fmtHours(x.hours))}</td>
      <td class="mileage-cell">${esc(fmtMileageText(x.mileage) || '–')}</td>`;
    tbody.appendChild(tr);
  });
}

function renderVehicleBreakdown(list) {
  const tbody = document.getElementById('vehicle-summary-body');
  tbody.innerHTML = '';
  if (!list.length) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No vehicles with loads or working hours in this period.</td></tr>';
    return;
  }
  list.forEach(v => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(v.vehicle_no)}</strong></td>
      <td>${esc(v.entries)}</td>
      <td>${esc(v.diesel)}</td>
      <td>${esc(v.loads)}</td>
      <td>${esc(fmtHours(v.hours))}</td>
      <td class="mileage-cell">${esc(fmtMileageText(v.mileage) || '–')}</td>`;
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
  `<button class="btn btn-outline btn-sm" onclick="openInvEdit('${type}', '${esc(id)}')" aria-label="Edit ${esc(label)}">Edit</button>`;

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
      <td><button class="btn btn-danger btn-sm" onclick="deleteVehicle('${esc(v.id)}')" aria-label="Delete ${esc(v.vehicle_no)}">${ICON_TRASH}</button></td>`;
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
      <td><button class="btn btn-danger btn-sm" onclick="deleteOperator('${esc(o.id)}')" aria-label="Delete ${esc(o.name)}">${ICON_TRASH}</button></td>`;
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
      <td><button class="btn btn-danger btn-sm" onclick="deleteSite('${esc(st.id)}')" aria-label="Delete ${esc(st.name)}">${ICON_TRASH}</button></td>`;
    tbody.appendChild(tr);
  });
}

async function addVehicle() {
  const vehicle_no = document.getElementById('inv-vehicle-no').value.trim();
  const type       = document.getElementById('inv-vehicle-type').value.trim();
  if (!vehicle_no) { showToast('Vehicle / Machine No. is required.', true); return; }
  try {
    await Inventory.addVehicle({ vehicle_no, type });
    showToast('Vehicle added!');
    document.getElementById('inv-vehicle-no').value = '';
    document.getElementById('inv-vehicle-type').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('' + (e.message || 'Could not add vehicle.'), true);
  }
}

async function toggleVehicleActive(id, currentActive) {
  try { await Inventory.updateVehicle(id, { active: !currentActive }); showToast(currentActive ? 'Vehicle marked inactive — it no longer appears in the entry form.' : 'Vehicle marked active again.'); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('' + (e.message || 'Update failed.'), true); }
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
    showToast('Operator added!');
    document.getElementById('inv-operator-name').value = '';
    document.getElementById('inv-operator-phone').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('' + (e.message || 'Could not add operator.'), true);
  }
}

async function toggleOperatorActive(id, currentActive) {
  try { await Inventory.updateOperator(id, { active: !currentActive }); showToast(currentActive ? 'Operator marked inactive — it no longer appears in the entry form.' : 'Operator marked active again.'); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('' + (e.message || 'Update failed.'), true); }
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
    showToast('Site added!');
    document.getElementById('inv-site-name').value = '';
    document.getElementById('inv-site-location').value = '';
    loadInventory();
    loadDropdownData();
  } catch (e) {
    showToast('' + (e.message || 'Could not add site.'), true);
  }
}

async function toggleSiteActive(id, currentActive) {
  try { await Inventory.updateSite(id, { active: !currentActive }); showToast(currentActive ? 'Site marked inactive — it no longer appears in the entry form.' : 'Site marked active again.'); loadInventory(); loadDropdownData(); }
  catch (e) { showToast('' + (e.message || 'Update failed.'), true); }
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
    showToast(`${capitalize(def.noun)} updated.`);
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
      <td><button class="btn btn-outline btn-sm" onclick="openUserEdit('${esc(u.id)}')" aria-label="Edit ${esc(u.name)}">Edit</button></td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteUser('${esc(u.id)}')" aria-label="Delete ${esc(u.name)}" ${isSelf ? 'disabled title="You cannot delete your own account"' : ''}>${ICON_TRASH}</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

async function createUser() {
  const name = document.getElementById('u-name').value.trim();
  const pin  = document.getElementById('u-pin').value.trim();
  const role = document.getElementById('u-role').value;
  if (!name || !pin) { showToast('Name and PIN are required.', true); return; }
  if (!role) { document.getElementById('u-role').focus(); showToast('Select a role for this user.', true); return; }

  try {
    await Users.create({ name, pin, role });
    showToast('User created!');
    document.getElementById('u-name').value = '';
    document.getElementById('u-pin').value  = '';
    document.getElementById('u-role').value = '';            // the next user starts on "Select Role" again
    loadUsers();
  } catch (e) {
    showToast('' + (e.message || 'Could not create user.'), true);
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
    showToast(res.unchanged ? 'No changes were made.' : 'User updated.');
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
    showToast('' + (e.message || 'Delete failed.'), true);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Confirm-a-delete dialog (optionally makes the person type DELETE first)
   ═══════════════════════════════════════════════════════════════════════════════ */
/** A plain Yes / No question. Resolves true for Yes; No, Escape or a tap outside is No. */
function askConfirm({ title, message, yesLabel = 'Yes', noLabel = 'No', focusNo = false, icon = null }) {
  return new Promise(resolve => {
    const ic = document.getElementById('confirm-ic');
    if (ic) { if (ic.dataset.original === undefined) ic.dataset.original = ic.innerHTML; ic.innerHTML = icon || ic.dataset.original; }       // (the save icon unless the question brings its own)
    const overlay = document.getElementById('confirm-overlay');
    const yes = document.getElementById('confirm-yes'), no = document.getElementById('confirm-no');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = message || '';
    yes.textContent = yesLabel; no.textContent = noLabel;
    const done = result => {
      overlay.classList.remove('open');
      yes.removeEventListener('click', onYes); no.removeEventListener('click', onNo);
      document.removeEventListener('keydown', onKey, true); overlay.removeEventListener('mousedown', onBackdrop);
      resolve(result);
    };
    const onYes = () => done(true), onNo = () => done(false);
    const onKey = ev => {
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); done(false); }
      else if (ev.key === 'Tab') {                         // keep the keyboard inside the question
        const order = [yes, no], i = order.indexOf(document.activeElement);
        ev.preventDefault(); order[(i + (ev.shiftKey ? order.length - 1 : 1)) % order.length].focus();
      }
    };
    const onBackdrop = ev => { if (ev.target === overlay) done(false); };
    yes.addEventListener('click', onYes); no.addEventListener('click', onNo);
    document.addEventListener('keydown', onKey, true); overlay.addEventListener('mousedown', onBackdrop);
    overlay.classList.add('open');
    setTimeout(() => (focusNo ? no : yes).focus(), 50);
  });
}

/** Every Logout button asks first: "Are you sure you want to log out?"  Yes signs out; No (or Escape, or a tap outside) stays signed in. */
const LOGOUT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
async function confirmLogout() {
  const yes = await askConfirm({ title: 'Log out?', message: 'Are you sure you want to log out?', yesLabel: 'Yes', noLabel: 'No', focusNo: true, icon: LOGOUT_ICON });
  if (yes) Auth.logout();
}

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
  else if (group === 'payments') { call = () => Reports.payments({ format, kind: type, ...plFilters(type) }); name = type === 'all' ? 'payments-cumulative' : `payments-${type}`; }
  else if (group === 'summary') {
    const per = summaryPeriod();
    if (per.from && per.to && per.from > per.to) { showToast('The "from" date cannot be after the "to" date.', true); return; }
    call = () => Reports.summary({ format, from: per.from || undefined, to: per.to || undefined, site: document.getElementById('sum-site').value || undefined }); name = 'summary';
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
    showToast(`${label} report downloaded.`);
  } catch (e) {
    showToast('' + (e.message || 'The report could not be prepared.'), true);
  } finally {
    rmBusy = false;
    btn.disabled = false;
    btn.classList.remove('is-busy');
    menu.querySelector('.rm-label').textContent = 'Export';
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
  document_viewed:     { label: 'Document viewed',     cls: 'pill-sky'  },
  document_printed:    { label: 'Document printed',    cls: 'pill-sky'  },
  progress_deleted:    { label: 'Progress picture deleted', cls: 'pill-red' },
  archive_restored:    { label: 'Restored from Archive', cls: 'pill-green' },
  archive_purged:      { label: 'Deleted permanently', cls: 'pill-red' },
  renewal_added:       { label: 'Renewal added',       cls: 'pill-green' },
  renewal_updated:     { label: 'Renewal changed',     cls: 'pill-orange' },
  renewal_deleted:     { label: 'Renewal deleted',     cls: 'pill-red'  },
  renewal_renewed:     { label: 'Marked renewed',      cls: 'pill-green' },
  renewal_reopened:    { label: 'Renewal reopened',    cls: 'pill-orange' },
  renewal_file_added:  { label: 'Renewal document added', cls: 'pill-green' },
  renewal_file_viewed: { label: 'Renewal document viewed', cls: 'pill-sky' },
  renewal_file_downloaded: { label: 'Renewal document downloaded', cls: 'pill-sky' },
  renewal_file_deleted:{ label: 'Renewal document removed', cls: 'pill-red' },
  reminder_settings_changed: { label: 'Reminder settings changed', cls: 'pill-orange' },
  permissions_changed: { label: 'Permissions changed', cls: 'pill-orange' },
  purchase_created:    { label: 'Purchase added',      cls: 'pill-green' },
  purchase_updated:    { label: 'Purchase updated',    cls: 'pill-orange' },
  purchase_deleted:    { label: 'Purchase deleted',    cls: 'pill-red'  },
  purchase_file_viewed:     { label: 'Purchase file viewed',     cls: 'pill-sky' },
  purchase_file_downloaded: { label: 'Purchase file downloaded', cls: 'pill-sky' },
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
const isAdminUser = () => can('logs.delete');      // (the name is historical) — only people who may delete log entries see tick-boxes and delete buttons

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
      ? '⚠ The activity log table has not been created yet.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-logs.sql</strong>, then reload this page.</small>'
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
  const del = protectedRow ? '' : `<button type="button" class="btn btn-danger btn-sm lg-del-btn" data-id="${esc(l.id)}" title="Delete this entry" aria-label="Delete this entry">${ICON_TRASH}</button>`;
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
    showToast(res.deleted ? `Deleted ${res.deleted} log entr${res.deleted === 1 ? 'y' : 'ies'}.${kept}` : `Nothing was deleted${kept}.`);
  } catch (e) {
    showToast('' + (e.message || 'Could not delete.'), true);
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
      <button type="button" class="photo-x" title="Remove photo" aria-label="Remove photo">×</button>
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
  // The same text the server writes (backend/utils/loadPoints.js): name / material @ location: loads x rate — so a change to ANY field is noticed.
  if (!Array.isArray(points) || !points.length) return null;
  const lc = v => String(v == null ? '' : v);
  return [...points]
    .sort((x, y) => lc(x.point_name).toLowerCase().localeCompare(lc(y.point_name).toLowerCase()) || lc(x.material).localeCompare(lc(y.material)) || lc(x.location).localeCompare(lc(y.location)))
    .map(x => `${x.point_name}${x.material ? ` / ${x.material}` : ''}${x.location ? ` @ ${x.location}` : ''}: ${x.loads}${Number(x.rate) > 0 ? ` x ${money2(x.rate)}` : ''}`)
    .join(' \u00b7 ');
}
function pointsMini(e) {
  const t = pointsText(e.load_points);
  return t ? `<div class="lp-mini" title="Loads by unloading point">${esc(t)}</div>` : '';
}

async function loadUnloadPoints() {
  const u = Auth.currentUser();
  if (!u || !can('entry.add')) return;
  try {
    const res = await Entries.unloadPoints();
    document.getElementById('unload-points-list').innerHTML = (res.data || []).map(n => `<option value="${esc(n)}"></option>`).join('');
  } catch { /* suggestions are a convenience only */ }
}

function initLoadPoints() {
  ['f', 'e'].forEach(p => {
    document.getElementById(`${p}-loads`).addEventListener('input', () => updateLpTotal(p));
    const rows = lpEl(p, 'rows');
    rows.addEventListener('input', ev => { const row = ev.target.closest('.lp-row'); if (row) refreshLpRow(row); updateLpTotal(p); });
    rows.addEventListener('click', ev => {
      const b = ev.target.closest('.lp-del');
      if (b) { b.closest('.lp-row').remove(); renumberLp(p); updateLpTotal(p); }
    });
    updateLpTotal(p);
  });
}

const money2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lpAmount = (loads, rate) => Math.round((Number(loads) || 0) * (Number(rate) || 0) * 100) / 100;

function sumLoadPoints(p) {
  return readLoadPoints(p).reduce((a, r) => a + (Number.isFinite(r.loads) ? r.loads : 0), 0);
}

/** Amount = Loads x Rate, shown on the line as it is typed. */
function refreshLpRow(row) {
  row.querySelector('.lp-amount').textContent = money2(lpAmount(row.querySelector('.lp-count').value, row.querySelector('.lp-rate').value));
}
function renumberLp(p) {
  [...lpEl(p, 'rows').querySelectorAll('.lp-row')].forEach((row, i) => {
    row.querySelector('.lp-sl').textContent = i + 1;
    row.setAttribute('aria-label', `Line ${i + 1}`);
  });
}

/** v = { point_name, material, location, loads, rate } — all optional. */
function addLoadPoint(p, v = {}, focus = true) {
  const wrap = lpEl(p, 'rows');
  if (wrap.children.length >= LP_MAX) { showToast(`At most ${LP_MAX} lines per entry.`, true); return; }
  let loads = v.loads ?? '';
  // A new empty line starts with the loads that are still unallocated — usually exactly what the person wants.
  if (!v.point_name && loads === '') {
    const left = lpTotalLoads(p) - sumLoadPoints(p);
    if (left > 0) loads = left;
  }
  const rate = v.rate === undefined || v.rate === null || Number(v.rate) === 0 ? '' : v.rate;
  const row = document.createElement('div');
  row.className = 'lp-row';
  row.setAttribute('role', 'row');
  row.innerHTML = `
    <span class="lp-sl" data-label="Sl No"></span>
    <label class="lp-f lp-f-name"><span class="lp-fl">Name</span><input type="text" class="lp-name" list="unload-points-list" placeholder="Name (e.g. Yard A)" maxlength="80" autocomplete="off" value="${esc(v.point_name || '')}"></label>
    <label class="lp-f lp-f-material"><span class="lp-fl">Material</span><input type="text" class="lp-material" placeholder="Material" maxlength="80" autocomplete="off" value="${esc(v.material || '')}"></label>
    <label class="lp-f lp-f-location"><span class="lp-fl">Location</span><input type="text" class="lp-location" placeholder="Location" maxlength="120" autocomplete="off" value="${esc(v.location || '')}"></label>
    <label class="lp-f lp-f-count"><span class="lp-fl">Loads</span><input type="number" class="lp-count" min="1" step="1" inputmode="numeric" placeholder="Loads" value="${esc(loads)}"></label>
    <label class="lp-f lp-f-rate"><span class="lp-fl">Rate (₹)</span><input type="number" class="lp-rate" min="0" step="0.01" inputmode="decimal" placeholder="Rate" value="${esc(rate)}"></label>
    <div class="lp-f lp-f-amount"><span class="lp-fl">Amount (₹)</span><output class="lp-amount">0.00</output></div>
    <button type="button" class="lp-del" aria-label="Remove this line">×</button>`;
  wrap.appendChild(row);
  refreshLpRow(row); renumberLp(p); updateLpTotal(p);
  if (focus) row.querySelector('.lp-name').focus();
}

/** The lines as typed (tidied; completely empty lines left out). */
function readLoadPoints(p) {
  const tidy = v => v.replace(/\s+/g, ' ').trim();
  return [...lpEl(p, 'rows').querySelectorAll('.lp-row')].map(row => {
    const rawLoads = row.querySelector('.lp-count').value.trim(), rawRate = row.querySelector('.lp-rate').value.trim();
    return {
      point_name: tidy(row.querySelector('.lp-name').value), material: tidy(row.querySelector('.lp-material').value), location: tidy(row.querySelector('.lp-location').value),
      loads: rawLoads === '' ? '' : Number(rawLoads), rate: rawRate === '' ? '' : Number(rawRate),
    };
  }).filter(r => r.point_name || r.material || r.location || r.loads !== '' || (r.rate !== '' && r.rate !== 0));
}

function setLoadPoints(p, points) {
  lpEl(p, 'rows').innerHTML = '';
  (points || []).forEach(x => addLoadPoint(p, x, false));        // in the order they were typed
  updateLpTotal(p);
}
function clearLoadPoints(p) { lpEl(p, 'rows').innerHTML = ''; updateLpTotal(p); }

/** The little "8 of 12 loads allocated" line, and the table's own Total (loads and amount). */
function updateLpTotal(p) {
  const el = lpEl(p, 'total'), foot = lpEl(p, 'foot');
  if (!el) return;
  const rows = readLoadPoints(p);
  if (foot) {
    foot.hidden = !rows.length;
    lpEl(p, 'sum').textContent = String(sumLoadPoints(p));
    lpEl(p, 'amt').textContent = money2(rows.reduce((a, r) => a + lpAmount(r.loads, r.rate), 0));
  }
  if (!rows.length) { el.textContent = ''; el.className = 'lp-total'; return; }
  const total = lpTotalLoads(p), sum = sumLoadPoints(p);
  let text, cls;
  if (!total)            { text = 'Enter the total Loads above first'; cls = 'warn'; }
  else if (sum === total) { text = `✓ ${sum} of ${total} loads allocated`; cls = 'ok'; }
  else if (sum < total)   { text = `${sum} of ${total} loads allocated — ${total - sum} left`; cls = 'warn'; }
  else                    { text = `${sum} of ${total} loads — ${sum - total} too many`; cls = 'bad'; }
  el.textContent = text;
  el.className = `lp-total ${cls}`;
}

/** Returns a message if the lines are not acceptable, otherwise null. Mirrors the server's rules. */
function validateLoadPoints(p) {
  const rows = readLoadPoints(p);
  if (!rows.length) return null;
  for (const r of rows) {
    if (!r.point_name) return 'Each line needs a name.';
    if (r.point_name.length > 80) return 'A name is too long (80 characters at most).';
    if (r.material.length > 80) return `The material for "${r.point_name}" is too long (80 characters at most).`;
    if (r.location.length > 120) return `The location for "${r.point_name}" is too long (120 characters at most).`;
    if (!Number.isInteger(r.loads) || r.loads < 1) return `Loads for "${r.point_name}" must be a whole number of 1 or more.`;
    if (r.rate !== '' && (!Number.isFinite(r.rate) || r.rate < 0)) return `The rate for "${r.point_name}" must be a number of 0 or more.`;
  }
  const total = lpTotalLoads(p), sum = sumLoadPoints(p);
  if (sum !== total) return `The lines add up to ${sum} load${sum === 1 ? '' : 's'}, but Loads is ${total}. They must match.`;
  return null;
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Site Working Progress Images — added in Data Entry (people who may add them)
   ═══════════════════════════════════════════════════════════════════════════════ */
const PG = { items: [], next: 1 };           // { id, preview, path, caption, busy, error }
const PG_MAX = 12;
const pgBusy = () => PG.items.some(i => i.busy);
const pgPayload = () => PG.items.filter(i => i.path).map(i => ({ path: i.path, caption: i.caption.replace(/\s+/g, ' ').trim() }));

function initProgressAdd() {
  const add = document.getElementById('pg-add'), file = document.getElementById('pg-file'), grid = document.getElementById('pg-grid');
  if (!add || !file) return;
  add.addEventListener('click', () => file.click());
  file.addEventListener('change', () => { const list = [...(file.files || [])]; file.value = ''; if (list.length) pgAddFiles(list); });
  grid.addEventListener('click', ev => { const x = ev.target.closest('.pg-x'); if (x) pgRemove(Number(x.dataset.id)); });
  grid.addEventListener('input', ev => { const c = ev.target.closest('.pg-cap'); if (c) { const it = PG.items.find(i => i.id === Number(c.dataset.id)); if (it) it.caption = c.value; } });
  pgRender();
}

function pgRender() {
  const grid = document.getElementById('pg-grid');
  if (!grid) return;
  grid.innerHTML = PG.items.map((it, n) => `
    <div class="pg-item${it.busy ? ' is-busy' : ''}" data-id="${it.id}">
      <div class="pg-thumb"><img src="${esc(it.preview)}" alt="Progress photo ${n + 1}"><button type="button" class="pg-x" data-id="${it.id}" aria-label="Remove progress photo ${n + 1}" ${it.busy ? 'disabled' : ''}>×</button></div>
      <input type="text" class="pg-cap" data-id="${it.id}" maxlength="200" placeholder="Caption (optional)" aria-label="Caption for progress photo ${n + 1}" value="${esc(it.caption)}">
      <span class="pg-st${it.error ? ' is-bad' : ''}">${it.busy ? 'Uploading…' : (it.error ? esc(it.error) : 'Attached ✓')}</span>
    </div>`).join('');
  const count = document.getElementById('pg-count');
  if (count) { const n = PG.items.filter(i => i.path).length; count.textContent = n ? `${n} photo${n === 1 ? '' : 's'}` : ''; count.className = 'lp-total' + (n ? ' ok' : ''); }
  const add = document.getElementById('pg-add'); if (add) add.disabled = PG.items.length >= PG_MAX;
}

async function pgAddFiles(files) {
  const err = document.getElementById('pg-err'); err.textContent = '';
  const room = PG_MAX - PG.items.length;
  if (files.length > room) { err.textContent = room > 0 ? `Only ${room} more photo${room === 1 ? '' : 's'} can be added (${PG_MAX} at most).` : `At most ${PG_MAX} progress photos per entry.`; files = files.slice(0, Math.max(0, room)); }
  for (const file of files) {
    if (file.size > PHOTO_MAX_INPUT) { err.textContent = 'One photo was too large. Please choose a smaller one.'; continue; }
    const it = { id: PG.next++, preview: '', path: null, caption: '', busy: true, error: '' };
    PG.items.push(it);
    // eslint-disable-next-line no-await-in-loop
    try {
      const blob = await compressImage(file);
      it.preview = URL.createObjectURL(blob); pgRender();
      const res = await Uploads.progress(blob);
      if (!PG.items.includes(it)) { Uploads.discardProgress(res.path).catch(() => {}); URL.revokeObjectURL(it.preview); continue; }     // removed or cleared meanwhile
      it.path = res.path;
    } catch (e) {
      if (!PG.items.includes(it)) continue;
      PG.items = PG.items.filter(x => x !== it);
      if (it.preview) URL.revokeObjectURL(it.preview);
      err.textContent = photoErrorText(e);
    } finally { it.busy = false; pgRender(); }
  }
}

function pgRemove(id) {
  const it = PG.items.find(i => i.id === id);
  if (!it || it.busy) return;
  if (it.path) Uploads.discardProgress(it.path).catch(() => {});
  if (it.preview) URL.revokeObjectURL(it.preview);
  PG.items = PG.items.filter(i => i !== it);
  document.getElementById('pg-err').textContent = '';
  pgRender();
}

/** keep=true: the pictures were saved with the entry, so just forget them. keep=false: throw the unsaved uploads away. */
function pgReset(keep) {
  PG.items.forEach(it => { if (!keep && it.path) Uploads.discardProgress(it.path).catch(() => {}); if (it.preview) URL.revokeObjectURL(it.preview); });
  PG.items = [];
  const err = document.getElementById('pg-err'); if (err) err.textContent = '';
  pgRender();
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Progress tab (Owner + Admin) — the pictures, by day and site
   ═══════════════════════════════════════════════════════════════════════════════ */
const PGV = { items: [], seq: 0, limit: 120, ready: false, total: 0 };

function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); const pad = x => String(x).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function loadProgressTab() {
  if (!PGV.ready) {
    PGV.ready = true;
    document.getElementById('pgv-from').value = daysAgo(30);
    document.getElementById('pgv-to').value = today();
    ['pgv-from', 'pgv-to', 'pgv-site'].forEach(id => document.getElementById(id).addEventListener('change', () => { PGV.limit = 120; fetchProgress(); }));
    document.getElementById('pgv-more').addEventListener('click', () => { PGV.limit += 120; fetchProgress(); });
    document.getElementById('pgv-body').addEventListener('click', ev => {
      const img = ev.target.closest('.pgv-img'), del = ev.target.closest('.pgv-del');
      if (img) openProgressPicture(img.dataset.id);
      if (del) deleteProgressPicture(del.dataset.id);
    });
  }
  fetchProgress();
}

async function fetchProgress() {
  const status = document.getElementById('pgv-status'), body = document.getElementById('pgv-body');
  const from = document.getElementById('pgv-from').value, to = document.getElementById('pgv-to').value, site = document.getElementById('pgv-site').value;
  if (from && to && from > to) { status.textContent = 'The "from" date cannot be after the "to" date.'; return; }
  const seq = ++PGV.seq;
  status.textContent = 'Loading pictures…';
  try {
    const res = await Progress.list({ from, to, site, limit: PGV.limit });
    if (seq !== PGV.seq) return;
    PGV.items = res.data || []; PGV.total = res.total || 0;
    if (res.setup_required) { status.textContent = 'Site working progress images need a one-time database update. Run run-in-supabase-6-breakup-and-progress.sql in Supabase, then reload this page.'; body.innerHTML = ''; document.getElementById('pgv-more').hidden = true; return; }
    renderProgress();
  } catch (e) {
    if (seq !== PGV.seq) return;
    status.textContent = (e && e.message) || 'The pictures could not be loaded.';
  }
}

function renderProgress() {
  const status = document.getElementById('pgv-status'), body = document.getElementById('pgv-body');
  if (!PGV.items.length) { status.textContent = 'No progress pictures in this period.'; body.innerHTML = ''; document.getElementById('pgv-more').hidden = true; return; }
  status.textContent = `${PGV.total} picture${PGV.total === 1 ? '' : 's'}${PGV.items.length < PGV.total ? ` — showing the newest ${PGV.items.length}` : ''}`;
  const groups = new Map();
  PGV.items.forEach(it => { const k = `${it.date}|${it.site}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
  body.innerHTML = [...groups.entries()].map(([k, list]) => `
    <section class="pgv-group" aria-label="${esc(fmtDate(list[0].date))} ${esc(list[0].site || 'No site')}">
      <h3 class="pgv-day">${esc(fmtDate(list[0].date))} <span>· ${esc(list[0].site || '(no site)')}</span></h3>
      <div class="pgv-grid">${list.map(it => `
        <figure class="pgv-card">
          <button type="button" class="pgv-img" data-id="${esc(it.id)}" aria-label="Open this picture${it.caption ? ': ' + esc(it.caption) : ''}">${it.url ? `<img src="${esc(it.url)}" alt="${esc(it.caption || 'Progress picture')}" loading="lazy">` : '<span class="pgv-missing">Not available</span>'}</button>
          <figcaption><strong>${esc(it.vehicle_no)}</strong>${it.uploaded_by_name ? ` · ${esc(it.uploaded_by_name)}` : ''}${it.caption ? `<br>${esc(it.caption)}` : ''}</figcaption>
          <button type="button" class="btn btn-outline btn-sm pgv-del perm-progress-delete" data-id="${esc(it.id)}">Delete</button>
        </figure>`).join('')}</div>
    </section>`).join('');
  document.getElementById('pgv-more').hidden = PGV.items.length >= PGV.total;
}

function openProgressPicture(id) {
  const it = PGV.items.find(x => String(x.id) === String(id));
  if (!it || !it.url) return;
  photoViewerSeq++;
  openPhotoViewer(`${fmtDate(it.date)} · ${it.site || '(no site)'} · ${it.vehicle_no}${it.caption ? ' — ' + it.caption : ''}`);
  setPhotoViewerImage(it.url, true);
}

async function deleteProgressPicture(id) {
  const it = PGV.items.find(x => String(x.id) === String(id));
  if (!it) return;
  const reason = await askReason({ title: 'Delete this picture?', intro: `${esc(fmtDate(it.date))} · ${esc(it.site || '(no site)')} · ${esc(it.vehicle_no)}. It is taken out of view and the reason is recorded in the Activity Log.`, confirmLabel: 'Delete picture', danger: true });
  if (!reason) return;
  try { await Progress.remove(id, reason); showToast('Picture deleted.'); fetchProgress(); }
  catch (e) { showToast('' + ((e && e.message) || 'Could not delete the picture.'), true); }
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
      ? '⚠ Documents need a one-time database update.<br><small>Open Supabase → SQL Editor and run <strong>run-in-supabase-3-new-features.sql</strong>, then reload this page.</small>'
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
        ${d.site ? `<div class="doc-sub">${esc(d.site)}</div>` : ''}
        ${d.notes ? `<div class="doc-notes">${esc(d.notes)}</div>` : ''}
      </td>
      <td><span class="pill pill-orange">${esc(d.category)}</span></td>
      <td>${fmtBadge(d.format)}</td>
      <td class="doc-size">${esc(humanSize(d.size_bytes))}</td>
      <td class="log-time">${fmtDateTime(d.created_at)}<br>${esc(d.uploaded_by_name || '')}</td>
      <td><div class="open-btns">${d.viewable ? `<button type="button" class="btn btn-outline btn-sm" onclick="viewDocument('${esc(d.id)}')" aria-label="View ${esc(d.name)}">View</button>` : ''}${can('documents.print') ? `<button type="button" class="btn btn-outline btn-sm" onclick="printDocument('${esc(d.id)}')" aria-label="Print ${esc(d.name)}">Print</button>` : ''}<button type="button" class="btn btn-green btn-sm" onclick="downloadDocument('${esc(d.id)}')" aria-label="Download ${esc(d.name)}">Download</button></div></td>
      ${can('documents.upload') ? `<td><button type="button" class="btn btn-outline btn-sm" onclick="openDocEdit('${esc(d.id)}')" aria-label="Edit ${esc(d.name)}">Edit</button></td>` : ''}
      ${can('documents.delete') ? `<td><button type="button" class="btn btn-danger btn-sm" onclick="deleteDocument('${esc(d.id)}')" aria-label="Delete ${esc(d.name)}">${ICON_TRASH}</button></td>` : ''}`;
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
    showToast('Document uploaded.');
    resetDocForm();
    loadDocuments();
  } catch (e) {
    err.textContent = e.message || 'The upload failed.';
  } finally {
    btn.disabled = false;
    prog.hidden = true;
  }
}

/** Opens a file in a NEW tab. The tab is opened straight away (inside the tap, so pop-up blockers allow it) and
 *  pointed at the file once the server has handed out its short-lived link. */
async function openInNewTab(getLink) {
  const w = window.open('about:blank', '_blank');
  if (w) { try { w.opener = null; w.document.body.textContent = 'Opening the file…'; } catch { /* a blank tab is fine */ } }
  try {
    const r = await getLink();
    if (w) w.location.href = r.url;
    else showToast('Your browser blocked the new tab. Allow pop-ups for this site, then press View again.', true);
  } catch (e) {
    if (w) w.close();
    showToast('' + (e.message || 'Could not open the file.'), true);
  }
}

function viewDocument(id) { return openInNewTab(() => Documents.viewLink(id)); }

/** Opens the print view in a new tab: the document, ready to print, with the browser's print window (paper size, orientation, scale). */
async function printDocument(id) {
  const d = DOC.list.find(x => String(x.id) === String(id));
  if (d && !d.viewable) {
    showToast(`${d.format || 'This kind of'} files cannot be printed from the browser. Download it and print it from its own program (for example Word or Excel).`, true);
    return;
  }
  const w = window.open('about:blank', '_blank');                  // opened inside the tap, so pop-up blockers allow it
  if (w) { try { w.opener = null; w.document.body.textContent = 'Preparing the print view…'; } catch { /* a blank tab is fine */ } }
  try {
    const r = await Documents.printLink(id);
    const token = new URL(r.url, location.origin).searchParams.get('t');
    const ext = ((d && d.original_filename) || '').split('.').pop().toLowerCase();
    const page = `/print.html?t=${encodeURIComponent(token)}&n=${encodeURIComponent(d ? d.name : 'Document')}&e=${encodeURIComponent(ext)}`;
    if (w) w.location.href = page;
    else showToast('Your browser blocked the new tab. Allow pop-ups for this site, then press Print again.', true);
  } catch (e) {
    if (w) w.close();
    showToast('' + (e.message || 'Could not open the print view.'), true);
  }
}

async function downloadDocument(id) {
  try {
    const r = await Documents.url(id);
    const a = document.createElement('a');          // the link makes the browser DOWNLOAD the file (it is never opened in our page)
    a.href = r.url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Download started.');
  } catch (e) {
    showToast('' + (e.message || 'Could not start the download.'), true);
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
    showToast(res.unchanged ? 'No changes were made.' : 'Document updated.');
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
  catch (e) { showToast('' + (e.message || 'Delete failed.'), true); }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Payments — who we are paying, and reconciling it
     Company Payments  ·  Outside Rental Payments  ·  Cumulative Report (both together)
   Every line:  Sl No · Date · Name · Item · Description · Payable · Paid · Balance · Paid By     (Balance = Payable − Paid, always worked out)
   ═══════════════════════════════════════════════════════════════════════════════ */
const PL_LABEL = { company: 'Company Payments', outside: 'Outside Rental Payments' };
const plBlankFilter = () => ({ q: '', from: '', to: '', name: '', paid_by: '', status: '' });
const PL = { built: false, tab: 'company', rows: { company: null, outside: null }, total: { company: 0, outside: 0 }, filter: { company: plBlankFilter(), outside: plBlankFilter(), all: plBlankFilter() }, editing: null, timer: null };
const PL_STATUS = { due: 'Balance due', settled: 'Settled', over: 'Advance paid' };
const PL_MAX = 60;

const r2 = n => Math.round((Number(n) || 0) * 100 + (Number(n) < 0 ? -1e-9 : 1e-9)) / 100;
const plBal = (payable, paid) => r2((Number(payable) || 0) - (Number(paid) || 0));
const plSt = b => (b > 0.004 ? 'due' : b < -0.004 ? 'over' : 'settled');
const num2 = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrS = n => `${Number(n) < -0.004 ? '−' : ''}₹${num2(Math.abs(Number(n) || 0))}`;
const plTotals = rows => { const payable = r2(rows.reduce((a, x) => a + (Number(x.payable) || 0), 0)), paid = r2(rows.reduce((a, x) => a + (Number(x.paid) || 0), 0)); return { count: rows.length, payable, paid, balance: r2(payable - paid) }; };
const plKinds = () => [...(can('payments.add') || can('payments.view') ? ['company', 'outside'] : []), ...(can('payments.view') ? ['all'] : [])];
const plFilters = k => Object.fromEntries(Object.entries(PL.filter[k] || {}).filter(([, v]) => v));       // only the filters that are set — sent to the server and to the exports

const PL_ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  sum: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>',
};
const plExportMenu = kind => `
  <div class="export-menu rm">
    <button type="button" class="btn btn-outline btn-sm rm-btn" aria-haspopup="menu" aria-expanded="false"><span class="rm-label">Export</span><span class="caret" aria-hidden="true">▾</span></button>
    <div class="export-pop" role="menu" aria-label="Choose a report format" hidden>
      <button type="button" role="menuitem" data-rm-kind="payments:${kind}" data-rm-format="xlsx"><span class="fmt fmt-xlsx">XLS</span><span class="fmt-text"><strong>Excel</strong><small>.xlsx · ${kind === 'all' ? 'complete report' : 'this ledger'} · with the filters set</small></span></button>
      <button type="button" role="menuitem" data-rm-kind="payments:${kind}" data-rm-format="pdf"><span class="fmt fmt-pdf">PDF</span><span class="fmt-text"><strong>PDF</strong><small>.pdf · print-ready · with the filters set</small></span></button>
    </div>
  </div>`;

/** The search filters: they narrow the screen AND the exported report. */
const plFilterBar = k => `
  <div class="pl-filters" data-pl-filters="${k}" role="search" aria-label="Search and filter">
    <label class="pl-flt pl-flt-search"><span>Search</span><input type="search" data-plf="q" placeholder="Name, item, description or paid by…" autocomplete="off"></label>
    <label class="pl-flt"><span>From date</span><input type="date" data-plf="from"></label>
    <label class="pl-flt"><span>To date</span><input type="date" data-plf="to"></label>
    <label class="pl-flt"><span>Name</span><select data-plf="name"><option value="">All names</option></select></label>
    <label class="pl-flt"><span>Paid by</span><select data-plf="paid_by"><option value="">Anyone</option></select></label>
    <label class="pl-flt"><span>Status</span><select data-plf="status"><option value="">All lines</option><option value="due">Balance due</option><option value="settled">Settled</option><option value="over">Advance paid</option></select></label>
    <button type="button" class="btn btn-outline btn-sm pl-flt-clear" data-plf-clear="${k}">Clear filters</button>
  </div>`;

function plFillOptions(k, options) {
  const bar = document.querySelector(`[data-pl-filters="${k}"]`); if (!bar || !options) return;
  const fill = (key, first, list, extra) => {
    const sel = bar.querySelector(`[data-plf="${key}"]`), cur = PL.filter[k][key];
    sel.innerHTML = `<option value="">${first}</option>` + list.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + (extra || '');
    if (cur && ![...sel.options].some(o => o.value === cur)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(cur)}">${esc(cur === '__none__' ? '(not entered)' : cur)}</option>`);
    sel.value = cur || '';
  };
  fill('name', 'All names', options.names || []);
  fill('paid_by', 'Anyone', options.paid_by || [], options.has_blank_paid_by ? '<option value="__none__">(not entered)</option>' : '');
}
const plScheduleReload = k => { clearTimeout(PL.timer); PL.timer = setTimeout(() => (k === 'all' ? loadPlCumulative() : loadPlLedger(k)), 280); };

function initPayments() {
  if (!PL.built) {
    PL.built = true;
    ['company', 'outside'].forEach(buildPlPanel);
    buildPlCumulative();
    const root = document.getElementById('section-payments');
    root.addEventListener('input', ev => {
      const t = ev.target;
      if (t.closest('.pl-rows')) { const row = t.closest('.pl-row'); plRefreshRow(row); plRefreshTotals(row.dataset.kind); }
      if (t.matches('[data-plf]')) { const bar = t.closest('[data-pl-filters]'), k = bar.dataset.plFilters; PL.filter[k][t.dataset.plf] = t.value; plScheduleReload(k); }
    });
    root.addEventListener('change', ev => { const t = ev.target; if (t.matches('select[data-plf]')) { const k = t.closest('[data-pl-filters]').dataset.plFilters; PL.filter[k][t.dataset.plf] = t.value; plScheduleReload(k); } });
    root.addEventListener('click', ev => {
      const del = ev.target.closest('.pl-rm'); if (del) { const row = del.closest('.pl-row'), k = row.dataset.kind; row.remove(); plRenumber(k); plRefreshTotals(k); return; }
      const clr = ev.target.closest('[data-plf-clear]'); if (clr) { const k = clr.dataset.plfClear; PL.filter[k] = plBlankFilter(); clr.closest('[data-pl-filters]').querySelectorAll('[data-plf]').forEach(e => { e.value = ''; }); plScheduleReload(k); return; }
      const ed = ev.target.closest('[data-pl-edit]'); if (ed) { openPayEdit(ed.dataset.plKind, ed.dataset.plEdit); return; }
      const rm = ev.target.closest('[data-pl-del]'); if (rm) deletePayment(rm.dataset.plKind, rm.dataset.plDel);
    });
    ['company', 'outside'].forEach(k => plAddLine(k, {}, false));
    ['pe-payable', 'pe-paid'].forEach(id => document.getElementById(id).addEventListener('input', plEditBalance));
  }
  const allowed = plKinds();
  if (!allowed.includes(PL.tab)) PL.tab = allowed[0] || 'company';
  showPayTab(PL.tab);
}

function showPayTab(kind) {
  if (!plKinds().includes(kind)) return;
  PL.tab = kind;
  ['company', 'outside', 'all'].forEach(k => {
    const on = k === kind, btn = document.getElementById(`pltab-${k}`);
    btn.classList.toggle('active', on); btn.setAttribute('aria-selected', String(on));
    document.getElementById(`pl-panel-${k}`).hidden = !on;
  });
  if (kind === 'all') loadPlCumulative(); else loadPlLedger(kind);
}

/* ── a ledger panel (Company or Outside Rental) ───────────────────────────────────────── */
function buildPlPanel(k) {
  const label = PL_LABEL[k];
  document.getElementById(`pl-panel-${k}`).innerHTML = `
    <div class="pl-cards perm-payments-view" id="pl-cards-${k}"></div>

    <div class="card pl-card perm-payments-add">
      <div class="pl-card-head">
        <div class="pl-card-title"><span class="pl-ic">${PL_ICON.plus}</span><div><h3>Add ${label.toLowerCase()}</h3><p>Each line: the date, who we are paying, for what, how much is payable and how much has been paid. Balance is worked out for you.</p></div></div>
      </div>
      <div class="pl-grid" role="table" aria-label="New ${label.toLowerCase()} lines">
        <div class="pl-thead" role="row"><span>Sl No</span><span>Date</span><span>Name</span><span>Item</span><span>Description</span><span class="r">Payable (₹)</span><span class="r">Paid (₹)</span><span class="r">Balance (₹)</span><span>Paid By</span><span aria-hidden="true"></span></div>
        <div class="pl-rows" id="pl-rows-${k}"></div>
        <div class="pl-foot" id="pl-foot-${k}"><span class="pl-foot-label">Total</span><span class="r" data-l="Payable ₹: " id="pl-t-payable-${k}">0.00</span><span class="r" data-l="Paid ₹: " id="pl-t-paid-${k}">0.00</span><span class="r" data-l="Balance ₹: " id="pl-t-balance-${k}">0.00</span><span aria-hidden="true"></span><span aria-hidden="true"></span></div>
      </div>
      <datalist id="pl-names-${k}"></datalist><datalist id="pl-paidby-${k}"></datalist>
      <div class="form-error" id="pl-err-${k}" role="alert"></div>
      <div class="pl-actions">
        <button type="button" class="btn btn-outline" onclick="plAddLine('${k}')">+ Add line</button>
        <button type="button" class="btn btn-primary" id="pl-save-${k}" onclick="savePayments('${k}')">Save payments</button>
        <button type="button" class="btn btn-outline" onclick="plClear('${k}')">Clear</button>
      </div>
    </div>

    <div class="card pl-card perm-payments-view">
      <div class="pl-card-head">
        <div class="pl-card-title"><span class="pl-ic">${PL_ICON.list}</span><div><h3>${label} — ledger</h3><p id="pl-count-${k}"></p></div></div>
        ${plExportMenu(k)}
      </div>
      ${plFilterBar(k)}
      <div class="table-wrap pl-wrap">
        <table class="pl-table">
          <thead><tr><th>Sl No</th><th>Date</th><th>Name</th><th>Item</th><th>Description</th><th class="r">Payable</th><th class="r">Paid</th><th class="r">Balance</th><th>Paid By</th><th class="pl-act perm-payments-edit">Actions</th></tr></thead>
          <tbody id="pl-body-${k}"></tbody>
          <tfoot id="pl-tfoot-${k}"></tfoot>
        </table>
      </div>
    </div>

    <div class="card pl-card" id="pl-mine-${k}" hidden>
      <div class="pl-card-head"><div class="pl-card-title"><span class="pl-ic">${PL_ICON.list}</span><div><h3>Saved by you</h3><p>Your latest lines. The owner and admin see the full ledger.</p></div></div></div>
      <div class="table-wrap pl-wrap"><table class="pl-table"><thead><tr><th>Date</th><th>Name</th><th>Item</th><th class="r">Payable</th><th class="r">Paid</th><th class="r">Balance</th><th>Paid By</th></tr></thead><tbody id="pl-mine-body-${k}"></tbody></table></div>
    </div>`;
}

function plAddLine(k, v = {}, focus = true) {
  const wrap = document.getElementById(`pl-rows-${k}`);
  if (wrap.children.length >= PL_MAX) { showToast(`At most ${PL_MAX} lines at a time.`, true); return; }
  const prev = wrap.lastElementChild ? wrap.lastElementChild.querySelector('.pl-date').value : '';       // a new line starts on the date of the one above
  const row = document.createElement('div');
  row.className = 'pl-row'; row.dataset.kind = k; row.setAttribute('role', 'row');
  row.innerHTML = `
    <span class="pl-sl" data-label="Sl No"></span>
    <label class="pl-f pl-f-date"><span class="pl-fl">Date</span><input type="date" class="pl-date" value="${esc(v.pay_date || prev || today())}"></label>
    <label class="pl-f pl-f-name"><span class="pl-fl">Name</span><input type="text" class="pl-name" list="pl-names-${k}" placeholder="Who we are paying" maxlength="120" autocomplete="off" value="${esc(v.party_name || '')}"></label>
    <label class="pl-f pl-f-item"><span class="pl-fl">Item</span><input type="text" class="pl-item" placeholder="What for" maxlength="120" autocomplete="off" value="${esc(v.item || '')}"></label>
    <label class="pl-f pl-f-desc"><span class="pl-fl">Description</span><input type="text" class="pl-desc" placeholder="Details (optional)" maxlength="300" autocomplete="off" value="${esc(v.description || '')}"></label>
    <label class="pl-f pl-f-num"><span class="pl-fl">Payable (₹)</span><input type="number" class="pl-payable" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(v.payable || '')}"></label>
    <label class="pl-f pl-f-num"><span class="pl-fl">Paid (₹)</span><input type="number" class="pl-paid" min="0" step="0.01" inputmode="decimal" placeholder="0.00" value="${esc(v.paid || '')}"></label>
    <div class="pl-f pl-f-bal"><span class="pl-fl">Balance (₹)</span><output class="pl-balance">0.00</output></div>
    <label class="pl-f pl-f-by"><span class="pl-fl">Paid By</span><input type="text" class="pl-by" list="pl-paidby-${k}" placeholder="Who paid" maxlength="120" autocomplete="off" value="${esc(v.paid_by || '')}"></label>
    <button type="button" class="pl-rm" aria-label="Remove this line">×</button>`;
  wrap.appendChild(row);
  plRefreshRow(row); plRenumber(k); plRefreshTotals(k);
  if (focus) row.querySelector('.pl-name').focus();
}
function plRenumber(k) { [...document.querySelectorAll(`#pl-rows-${k} .pl-row`)].forEach((row, i) => { row.querySelector('.pl-sl').textContent = i + 1; row.setAttribute('aria-label', `Line ${i + 1}`); }); }
function plRefreshRow(row) {
  const b = plBal(row.querySelector('.pl-payable').value, row.querySelector('.pl-paid').value), out = row.querySelector('.pl-balance');
  out.textContent = (b < -0.004 ? '−' : '') + num2(Math.abs(b)); out.className = `pl-balance pl-bal-${plSt(b)}`;
}
function plReadLines(k) {
  return [...document.querySelectorAll(`#pl-rows-${k} .pl-row`)].map(row => ({
    pay_date: row.querySelector('.pl-date').value, party_name: row.querySelector('.pl-name').value.replace(/\s+/g, ' ').trim(), item: row.querySelector('.pl-item').value.replace(/\s+/g, ' ').trim(),
    description: row.querySelector('.pl-desc').value.replace(/\s+/g, ' ').trim(), payable: row.querySelector('.pl-payable').value.trim(), paid: row.querySelector('.pl-paid').value.trim(),
    paid_by: row.querySelector('.pl-by').value.replace(/\s+/g, ' ').trim(),
  })).filter(r => r.party_name || r.item || r.description || r.payable !== '' || r.paid !== '' || r.paid_by);       // (the date alone does not make a line)
}
function plRefreshTotals(k) {
  const t = plTotals(plReadLines(k).map(r => ({ payable: r.payable, paid: r.paid })));
  document.getElementById(`pl-t-payable-${k}`).textContent = num2(t.payable); document.getElementById(`pl-t-paid-${k}`).textContent = num2(t.paid);
  const b = document.getElementById(`pl-t-balance-${k}`); b.textContent = (t.balance < -0.004 ? '−' : '') + num2(Math.abs(t.balance)); b.className = `r pl-bal-${plSt(t.balance)}`;
}
function plClear(k) { document.getElementById(`pl-rows-${k}`).innerHTML = ''; document.getElementById(`pl-err-${k}`).textContent = ''; plAddLine(k, {}, false); plRefreshTotals(k); }

/** The same rules as the server (backend/utils/payments.js). Returns a message or null. */
function plValidate(lines) {
  if (!lines.length) return 'Add at least one line.';
  for (let i = 0; i < lines.length; i++) {
    const r = lines[i], at = `Line ${i + 1}`;
    if (!r.party_name) return `${at} needs a name.`;
    if (!r.item) return `${at} (${r.party_name}) needs an item.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.pay_date || '') || Number.isNaN(Date.parse(r.pay_date))) return `${at} (${r.party_name}) needs a valid date.`;
    for (const [k, lab] of [['payable', 'Payable'], ['paid', 'Paid']]) { const v = r[k] === '' ? 0 : Number(r[k]); if (!Number.isFinite(v) || v < 0) return `${lab} for ${r.party_name} must be an amount of 0 or more.`; }
    if ((Number(r.payable) || 0) === 0 && (Number(r.paid) || 0) === 0) return `${at} (${r.party_name}) needs a Payable or a Paid amount.`;
  }
  return null;
}

async function savePayments(k) {
  const err = document.getElementById(`pl-err-${k}`); err.textContent = '';
  const lines = plReadLines(k), problem = plValidate(lines);
  if (problem) { err.textContent = problem; return; }
  const btn = document.getElementById(`pl-save-${k}`); btn.disabled = true;
  try {
    const res = await Payments.create({ kind: k, items: lines });
    showToast(`${res.count} line${res.count === 1 ? '' : 's'} saved to ${PL_LABEL[k]}.`);
    plClear(k); loadPlLedger(k);
  } catch (e) { err.textContent = e.message || 'Could not save. Please try again.'; }
  finally { btn.disabled = false; }
}

async function loadPlLedger(k) {
  const canView = can('payments.view'), canAdd = can('payments.add');
  if (canAdd) {
    Payments.names(k).then(r => {
      document.getElementById(`pl-names-${k}`).innerHTML = (r.data || []).map(n => `<option value="${esc(n)}"></option>`).join('');
      document.getElementById(`pl-paidby-${k}`).innerHTML = (r.paid_by || []).map(n => `<option value="${esc(n)}"></option>`).join('');
    }).catch(() => {});
    if (!canView) loadPlMine(k);
  }
  if (!canView) return;
  try {
    const res = await Payments.list(k, plFilters(k));
    PL.rows[k] = res.data || []; PL.total[k] = res.all_count || 0;
    plFillOptions(k, res.options); renderPlCards(k, res.totals); renderPlTable(k);
    if (res.setup_required) document.getElementById(`pl-count-${k}`).textContent = 'Payments need a one-time database update — run run-in-supabase-7-payment-ledger.sql (and then …-8-payment-date-paidby.sql) in Supabase, then reload this page.';
  } catch (e) {
    PL.rows[k] = []; document.getElementById(`pl-count-${k}`).textContent = '';
    document.getElementById(`pl-body-${k}`).innerHTML = `<tr class="empty-row"><td colspan="10">${esc(e.message || 'The payments could not be loaded.')}</td></tr>`; document.getElementById(`pl-tfoot-${k}`).innerHTML = '';
  }
}
async function loadPlMine(k) {
  try {
    const res = await Payments.mine(); const mine = (res.data || []).filter(x => x.kind === k);
    document.getElementById(`pl-mine-${k}`).hidden = false;
    document.getElementById(`pl-mine-body-${k}`).innerHTML = mine.length ? mine.map(x => `<tr><td data-label="Date">${esc(fmtDate(x.pay_date))}</td><td data-label="Name"><strong>${esc(x.party_name)}</strong></td><td data-label="Item">${esc(x.item)}</td><td class="r" data-label="Payable">${inrS(x.payable)}</td><td class="r" data-label="Paid">${inrS(x.paid)}</td><td class="r" data-label="Balance"><span class="pl-bal-${x.status}">${inrS(x.balance)}</span></td><td data-label="Paid By">${esc(x.paid_by) || '<span class="pl-none">—</span>'}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="7">Nothing saved yet.</td></tr>';
  } catch { /* the list is a convenience */ }
}

function renderPlCards(k, totals) {
  const t = totals || plTotals(PL.rows[k] || []), st = plSt(t.balance), filtered = Object.keys(plFilters(k)).length > 0;
  const note = st === 'due' ? 'Still to be paid' : st === 'over' ? 'Paid more than payable (advance)' : 'Fully settled';
  document.getElementById(`pl-cards-${k}`).innerHTML = `
    <div class="pl-stat pl-s-payable"><span class="pl-lbl">Total Payable</span><span class="pl-val">${inrS(t.payable)}</span><span class="pl-note">${t.count}${filtered ? ` of ${PL.total[k]}` : ''} line${t.count === 1 ? '' : 's'}${filtered ? ' · filtered' : ''}</span></div>
    <div class="pl-stat pl-s-paid"><span class="pl-lbl">Total Paid</span><span class="pl-val">${inrS(t.paid)}</span><span class="pl-note">Payments made${filtered ? ' (filtered)' : ' so far'}</span></div>
    <div class="pl-stat pl-s-bal pl-s-${st}"><span class="pl-lbl">Balance</span><span class="pl-val">${inrS(t.balance)}</span><span class="pl-note">${note} · Payable − Paid</span></div>`;
}

function renderPlTable(k) {
  const rows = (PL.rows[k] || []).map((r, i) => ({ ...r, sl: i + 1 })), total = PL.total[k] || 0, filtered = Object.keys(plFilters(k)).length > 0;
  const body = document.getElementById(`pl-body-${k}`), foot = document.getElementById(`pl-tfoot-${k}`), canEdit = can('payments.edit');
  document.getElementById(`pl-count-${k}`).textContent = total ? (filtered ? `Showing ${rows.length} of ${total} line${total === 1 ? '' : 's'}` : `${total} line${total === 1 ? '' : 's'}`) : 'No lines yet.';
  if (!rows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="${canEdit ? 10 : 9}">${total ? 'No lines match these filters.' : 'No payments saved yet.'}</td></tr>`; foot.innerHTML = ''; return; }
  body.innerHTML = rows.map(r => `
    <tr>
      <td data-label="Sl No">${r.sl}</td>
      <td data-label="Date" class="pl-date-cell">${esc(fmtDate(r.pay_date))}</td>
      <td data-label="Name"><strong>${esc(r.party_name)}</strong></td>
      <td data-label="Item">${esc(r.item)}</td>
      <td data-label="Description" class="pl-desc-cell">${esc(r.description) || '<span class="pl-none">—</span>'}</td>
      <td class="r" data-label="Payable">${inrS(r.payable)}</td>
      <td class="r" data-label="Paid">${inrS(r.paid)}</td>
      <td class="r" data-label="Balance"><span class="pl-bal-${r.status}">${inrS(r.balance)}</span><span class="pl-chip pl-chip-${r.status}">${PL_STATUS[r.status]}</span></td>
      <td data-label="Paid By">${esc(r.paid_by) || '<span class="pl-none">—</span>'}</td>
      ${canEdit ? `<td class="pl-act" data-label="Actions"><button type="button" class="btn btn-outline btn-sm" data-pl-edit="${esc(r.id)}" data-pl-kind="${k}" aria-label="Edit line ${r.sl}">Edit</button> <button type="button" class="btn btn-outline btn-sm pl-danger" data-pl-del="${esc(r.id)}" data-pl-kind="${k}" aria-label="Delete line ${r.sl}">Delete</button></td>` : ''}
    </tr>`).join('');
  const t = plTotals(rows), st = plSt(t.balance);
  foot.innerHTML = `<tr class="pl-total"><td colspan="5" data-label="">${filtered ? `Total of the ${rows.length} shown` : 'Total'}</td><td class="r" data-label="Payable">${inrS(t.payable)}</td><td class="r" data-label="Paid">${inrS(t.paid)}</td><td class="r" data-label="Balance"><span class="pl-bal-${st}">${inrS(t.balance)}</span></td><td></td>${canEdit ? '<td></td>' : ''}</tr>`;
}

/* ── the cumulative report: both kinds together ───────────────────────────────────────── */
function buildPlCumulative() {
  document.getElementById('pl-panel-all').innerHTML = `
    <div class="pl-kinds" id="pl-kinds"></div>
    <div class="card pl-card">
      <div class="pl-card-head">
        <div class="pl-card-title"><span class="pl-ic">${PL_ICON.sum}</span><div><h3>Cumulative report</h3><p id="pl-cum-note">Company and outside rental payments together.</p></div></div>
        ${plExportMenu('all')}
      </div>
      ${plFilterBar('all')}
      <h4 class="pl-h4">Party-wise — what each name has been paid and what is left</h4>
      <div class="table-wrap pl-wrap"><table class="pl-table"><thead><tr><th>Sl No</th><th>Name</th><th>Lines</th><th class="r">Payable</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody id="pl-cum-party"></tbody></table></div>
    </div>
    <div class="card pl-card">
      <div class="pl-card-head"><div class="pl-card-title"><span class="pl-ic">${PL_ICON.list}</span><div><h3>Complete statement</h3><p>Every line of both ledgers, oldest date first.</p></div></div></div>
      <div class="table-wrap pl-wrap"><table class="pl-table"><thead><tr><th>Sl No</th><th>Date</th><th>Name</th><th>Item</th><th>Description</th><th class="r">Payable</th><th class="r">Paid</th><th class="r">Balance</th><th>Paid By</th></tr></thead><tbody id="pl-cum-all"></tbody></table></div>
    </div>`;
}

async function loadPlCumulative() {
  try {
    const f = plFilters('all');
    const [sum, c, o] = await Promise.all([Payments.summary(f), Payments.list('company', f), Payments.list('outside', f)]);
    PL.rows.company = c.data || []; PL.rows.outside = o.data || [];
    plFillOptions('all', sum.options); renderPlCumulative(sum.data);
    const filtered = Object.keys(f).length > 0;
    document.getElementById('pl-cum-note').textContent = sum.setup_required ? 'Payments need a one-time database update — run run-in-supabase-7-payment-ledger.sql (and then …-8-payment-date-paidby.sql) in Supabase, then reload this page.'
      : (filtered ? `Showing ${sum.data.overall.count} of ${sum.all_count} line${sum.all_count === 1 ? '' : 's'} — the filters set here are used by the export too.` : 'Company and outside rental payments together.');
  } catch (e) { document.getElementById('pl-cum-party').innerHTML = `<tr class="empty-row"><td colspan="6">${esc(e.message || 'The report could not be loaded.')}</td></tr>`; document.getElementById('pl-cum-all').innerHTML = ''; document.getElementById('pl-kinds').innerHTML = ''; }
}

function renderPlCumulative(sm) {
  const stat = (title, t, cls) => { const st = plSt(t.balance); return `
    <section class="pl-kind ${cls}" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3>
      <dl><div><dt>Payable</dt><dd>${inrS(t.payable)}</dd></div><div><dt>Paid</dt><dd>${inrS(t.paid)}</dd></div><div class="pl-kind-bal pl-s-${st}"><dt>Balance</dt><dd>${inrS(t.balance)}</dd></div></dl>
      <p>${t.count} line${t.count === 1 ? '' : 's'} · ${PL_STATUS[st].toLowerCase()}</p>
    </section>`; };
  document.getElementById('pl-kinds').innerHTML = stat('Company Payments', sm.kinds.company.totals, 'pl-k-company') + stat('Outside Rental Payments', sm.kinds.outside.totals, 'pl-k-outside') + stat('Grand total', sm.overall, 'pl-k-all');
  const tr = (cells, cls = '') => `<tr class="${cls}">${cells}</tr>`;
  const nums = t => `<td class="r" data-label="Payable">${inrS(t.payable)}</td><td class="r" data-label="Paid">${inrS(t.paid)}</td><td class="r" data-label="Balance"><span class="pl-bal-${plSt(t.balance)}">${inrS(t.balance)}</span></td>`;
  let party = '';
  ['company', 'outside'].forEach(k => {
    const kd = sm.kinds[k];
    party += `<tr class="pl-sec"><th colspan="6">${esc(PL_LABEL[k])} — party-wise</th></tr>`;
    party += kd.parties.length ? kd.parties.map((p, i) => tr(`<td data-label="Sl No">${i + 1}</td><td data-label="Name"><strong>${esc(p.party_name)}</strong></td><td data-label="Lines">${p.count}</td>${nums(p)}`)).join('') : '<tr class="empty-row"><td colspan="6">Nothing here.</td></tr>';
    party += tr(`<td colspan="3" data-label="">Total — ${esc(PL_LABEL[k])}</td>${nums(kd.totals)}`, 'pl-subtotal');
  });
  party += tr(`<td colspan="3" data-label="">Grand total</td>${nums(sm.overall)}`, 'pl-total');
  document.getElementById('pl-cum-party').innerHTML = party;
  let all = '';
  ['company', 'outside'].forEach(k => {
    const rows = PL.rows[k] || [];
    all += `<tr class="pl-sec"><th colspan="9">${esc(PL_LABEL[k])}</th></tr>`;
    all += rows.length ? rows.map((r, i) => tr(`<td data-label="Sl No">${i + 1}</td><td data-label="Date" class="pl-date-cell">${esc(fmtDate(r.pay_date))}</td><td data-label="Name"><strong>${esc(r.party_name)}</strong></td><td data-label="Item">${esc(r.item)}</td><td data-label="Description" class="pl-desc-cell">${esc(r.description) || '<span class="pl-none">—</span>'}</td>${nums(r)}<td data-label="Paid By">${esc(r.paid_by) || '<span class="pl-none">—</span>'}</td>`)).join('') : '<tr class="empty-row"><td colspan="9">Nothing here.</td></tr>';
    all += tr(`<td colspan="5" data-label="">Total — ${esc(PL_LABEL[k])}</td>${nums(sm.kinds[k].totals)}<td></td>`, 'pl-subtotal');
  });
  all += tr(`<td colspan="5" data-label="">Grand total — Company + Outside Rental</td>${nums(sm.overall)}<td></td>`, 'pl-total');
  document.getElementById('pl-cum-all').innerHTML = all;
}

/* ── editing and deleting a saved line (Admin; a written reason is always needed) ─────── */
function openPayEdit(k, id) {
  const row = (PL.rows[k] || []).find(r => String(r.id) === String(id)); if (!row) return;
  PL.editing = { id: row.id, row };
  document.getElementById('pe-kind').value = row.kind; document.getElementById('pe-date').value = row.pay_date || today();
  document.getElementById('pe-name').value = row.party_name; document.getElementById('pe-item').value = row.item;
  document.getElementById('pe-desc').value = row.description || ''; document.getElementById('pe-payable').value = row.payable; document.getElementById('pe-paid').value = row.paid;
  document.getElementById('pe-paidby').value = row.paid_by || '';
  document.getElementById('pe-error').textContent = ''; plEditBalance();
  Payments.names().then(r => {
    document.getElementById('pl-names-edit').innerHTML = (r.data || []).map(n => `<option value="${esc(n)}"></option>`).join('');
    document.getElementById('pl-paidby-edit').innerHTML = (r.paid_by || []).map(n => `<option value="${esc(n)}"></option>`).join('');
  }).catch(() => {});
  document.getElementById('pay-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pe-name').focus(), 60);
}
function closePayEdit() { document.getElementById('pay-edit-overlay').classList.remove('open'); PL.editing = null; }
function plEditBalance() {
  const b = plBal(document.getElementById('pe-payable').value, document.getElementById('pe-paid').value), out = document.getElementById('pe-balance');
  out.textContent = (b < -0.004 ? '−' : '') + num2(Math.abs(b)); out.className = `pl-edit-balance pl-bal-${plSt(b)}`;
}
async function savePayEdit() {
  if (!PL.editing) return;
  const err = document.getElementById('pe-error'); err.textContent = '';
  const before = PL.editing.row;
  const body = {
    kind: document.getElementById('pe-kind').value, pay_date: document.getElementById('pe-date').value, party_name: document.getElementById('pe-name').value.replace(/\s+/g, ' ').trim(), item: document.getElementById('pe-item').value.replace(/\s+/g, ' ').trim(),
    description: document.getElementById('pe-desc').value.replace(/\s+/g, ' ').trim(), payable: document.getElementById('pe-payable').value.trim(), paid: document.getElementById('pe-paid').value.trim(),
    paid_by: document.getElementById('pe-paidby').value.replace(/\s+/g, ' ').trim(),
  };
  const problem = plValidate([body]); if (problem) { err.textContent = problem.replace(/^Line 1 /, 'This line '); return; }
  const changes = [];
  const push = (field, a, b) => { if (String(a ?? '') !== String(b ?? '')) changes.push({ field, from: a || null, to: b || null }); };
  push('Paying', PL_LABEL[before.kind], PL_LABEL[body.kind]); push('Date', fmtDate(before.pay_date), fmtDate(body.pay_date)); push('Name', before.party_name, body.party_name); push('Item', before.item, body.item); push('Description', before.description, body.description);
  push('Payable', inrS(before.payable), inrS(Number(body.payable) || 0)); push('Paid', inrS(before.paid), inrS(Number(body.paid) || 0)); push('Paid by', before.paid_by, body.paid_by);
  if (!changes.length) { showToast('No changes were made.'); closePayEdit(); return; }
  const reason = await askReason({ title: 'Reason for change', intro: 'Please explain why this payment line is being changed. It is saved in the Activity Log.', confirmLabel: 'Confirm & Save', changes });
  if (!reason) return;
  try {
    await Payments.update(PL.editing.id, { ...body, reason });
    showToast('Payment line updated.'); closePayEdit();
    if (PL.tab === 'all') loadPlCumulative(); else { loadPlLedger(PL.tab); if (body.kind !== PL.tab) loadPlLedger(body.kind); }
  } catch (e) { err.textContent = e.message || 'Update failed.'; }
}
async function deletePayment(k, id) {
  const row = (PL.rows[k] || []).find(r => String(r.id) === String(id)); if (!row) return;
  const reason = await askReason({ title: 'Delete this payment line?', intro: `<strong>${esc(row.party_name)}</strong> — ${esc(row.item)} — ${esc(fmtDate(row.pay_date))} — payable ${esc(inrS(row.payable))}, paid ${esc(inrS(row.paid))}. The reason is saved in the Activity Log.`, confirmLabel: 'Delete line', danger: true });
  if (!reason) return;
  try { await Payments.remove(row.id, reason); showToast('Payment line deleted.'); loadPlLedger(k); }
  catch (e) { showToast('' + (e.message || 'Delete failed.'), true); }
}



/* ═══════════════════════════════════════════════════════════════════════════════
   Renewals — insurance, permits, licences, subscriptions … with documents and reminders
   ═══════════════════════════════════════════════════════════════════════════════ */
const RN = { built: false, rows: [], total: 0, summary: null, meta: { types: [], today: '', max_files: 10, max_mb: 25, settings_text: '' }, filter: { q: '', status: 'active', type: '', from: '', to: '' }, chosen: [], rowFileFor: null, renewing: null, editing: null, highlight: null, timer: null };
const RN_CHIP = { overdue: 'Overdue', today: 'Due today', soon: 'Due soon', upcoming: 'Upcoming', renewed: 'Renewed' };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const fileSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);
function addMonthsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1)), dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, dim));                                       // 31 Jan + 1 month = 28/29 Feb, not 3 March
  return first.toISOString().slice(0, 10);
}
const rnWhen = r => (r.state === 'renewed' ? `on ${fmtDate(r.renewed_on)}` : r.days_left < 0 ? `${plural(-r.days_left, 'day')} late` : r.days_left === 0 ? 'renew today' : `in ${plural(r.days_left, 'day')}`);

function initRenewals() {
  if (!RN.built) {
    RN.built = true;
    const root = document.getElementById('section-renewals');
    root.addEventListener('input', ev => {
      const t = ev.target;
      if (t.matches('[data-rnf]') && t.dataset.rnf !== 'status' && t.dataset.rnf !== 'type') { RN.filter[t.dataset.rnf] = t.value; scheduleRnLoad(); }
    });
    root.addEventListener('change', ev => {
      const t = ev.target;
      if (t.matches('select[data-rnf]')) { RN.filter[t.dataset.rnf] = t.value; loadRenewals(); }
      if (t.id === 'rn-files') { addChosenFiles([...t.files]); t.value = ''; }
      if (t.id === 'rn-rowfile') { const id = RN.rowFileFor; const files = [...t.files]; t.value = ''; if (id && files.length) uploadToRenewal(id, files); }
    });
    root.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.id === 'rn-files-btn') return document.getElementById('rn-files').click();
      if (b.id === 'rn-save') return saveRenewal();
      if (b.id === 'rn-clear') return clearRenewalForm();
      if (b.id === 'rn-filter-clear') { RN.filter = { q: '', status: 'active', type: '', from: '', to: '' }; syncRnFilters(); return loadRenewals(); }
      if (b.dataset.rnChosenDel !== undefined) { RN.chosen.splice(Number(b.dataset.rnChosenDel), 1); return renderChosen(); }
      if (b.dataset.rnRenew) return openRenew(b.dataset.rnRenew);
      if (b.dataset.rnEdit) return openRnEdit(b.dataset.rnEdit);
      if (b.dataset.rnDel) return deleteRenewal(b.dataset.rnDel);
      if (b.dataset.rnReopen) return reopenRenewal(b.dataset.rnReopen);
      if (b.dataset.rnAdddoc) { RN.rowFileFor = b.dataset.rnAdddoc; return document.getElementById('rn-rowfile').click(); }
      if (b.dataset.rnFile) return openRenewalFile(b.dataset.rnFile, b.dataset.rnViewable === '1');
      if (b.dataset.rnFiledel) return removeRenewalFile(b.dataset.rnFiledel);
    });
    document.getElementById('rnr-save').closest('.modal-card').addEventListener('click', ev => {
      const q = ev.target.closest('[data-rnr-add]'); if (!q || !RN.renewing) return;
      document.getElementById('rnr-next').value = addMonthsISO(RN.renewing.renewal_date, Number(q.dataset.rnrAdd));
    });
    document.getElementById('rn-date').value = '';
  }
  loadRenewals();
}
const scheduleRnLoad = () => { clearTimeout(RN.timer); RN.timer = setTimeout(loadRenewals, 280); };
function syncRnFilters() {
  document.querySelectorAll('#section-renewals [data-rnf]').forEach(el => { el.value = RN.filter[el.dataset.rnf] || ''; });
}

async function loadRenewals() {
  try {
    const f = RN.filter;
    const res = await Renewals.list({ q: f.q.trim(), status: f.status, type: f.type, from: f.from, to: f.to });
    RN.rows = res.data || []; RN.total = res.total || 0; RN.summary = res.summary; RN.meta = res.meta || RN.meta;
    fillRnLists(); renderRnCards(); renderRnTable(res.setup_required);
    syncRnFilters();
    if (RN.highlight) { const row = document.querySelector(`#rn-body tr[data-id="${RN.highlight}"]`); RN.highlight = null; if (row) { row.scrollIntoView({ behavior: 'smooth', block: 'center' }); row.classList.add('rn-flash'); setTimeout(() => row.classList.remove('rn-flash'), 3000); } }
  } catch (e) {
    document.getElementById('rn-body').innerHTML = `<tr class="empty-row"><td colspan="9">${esc(e.message || 'The renewals could not be loaded.')}</td></tr>`;
  }
}
function fillRnLists() {
  const types = RN.meta.types || [];
  document.getElementById('rn-types').innerHTML = types.map(t => `<option value="${esc(t)}"></option>`).join('');
  const names = [...new Set(RN.rows.map(r => r.paid_by).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  document.getElementById('rn-paidby-list').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
  const sel = document.querySelector('#section-renewals select[data-rnf="type"]'), used = [...new Set(RN.rows.map(r => r.renewal_type))];
  const all = [...new Set([...used, RN.filter.type].filter(Boolean))].sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">All types</option>' + all.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
}
function renderRnCards() {
  const s = RN.summary || { overdue: 0, today: 0, soon: 0, upcoming: 0, renewed: 0, active_amount: 0, needs_attention_amount: 0 };
  const card = (cls, label, n, note) => `<div class="rn-card rn-c-${cls}"><span class="pl-lbl">${label}</span><span class="rn-num">${n}</span><span class="pl-note">${note}</span></div>`;
  document.getElementById('rn-cards').innerHTML =
    card('overdue', 'Overdue', s.overdue, s.overdue ? 'Past the renewal date' : 'Nothing overdue') +
    card('today', 'Due today', s.today, s.today ? 'Renew today' : 'Nothing due today') +
    card('soon', 'Due soon', s.soon, 'Inside the reminder window') +
    card('upcoming', 'Upcoming', s.upcoming, `${s.renewed} renewed so far`);
  document.getElementById('rn-note').innerHTML = `${esc(RN.meta.settings_text || '')} ${s.needs_attention_amount ? ` <strong>${esc(inrS(s.needs_attention_amount))}</strong> needs attention (overdue, today and soon).` : ''}`;
}
function renderRnTable(setup) {
  const body = document.getElementById('rn-body'), canAdd = can('renewals.add'), canEdit = can('renewals.edit');
  document.getElementById('rn-count').textContent = setup ? 'Renewals need a one-time database update — run run-in-supabase-9-renewals.sql in Supabase, then reload this page.'
    : RN.total ? (RN.rows.length === RN.total ? plural(RN.total, 'renewal') : `Showing ${RN.rows.length} of ${plural(RN.total, 'renewal')}`) : 'No renewals yet.';
  if (!RN.rows.length) { body.innerHTML = `<tr class="empty-row"><td colspan="9">${RN.total ? 'No renewals match these filters.' : 'No renewals saved yet. Add the first one above.'}</td></tr>`; return; }
  body.innerHTML = RN.rows.map((r, i) => `
    <tr data-id="${esc(r.id)}" class="rn-row rn-${r.state}">
      <td data-label="Sl No">${i + 1}</td>
      <td data-label="Renewal date" class="pl-date-cell"><strong>${esc(fmtDate(r.renewal_date))}</strong></td>
      <td data-label="Type"><strong>${esc(r.renewal_type)}</strong></td>
      <td data-label="Description" class="pl-desc-cell">${esc(r.description) || '<span class="pl-none">—</span>'}</td>
      <td class="r" data-label="Amount">${r.amount ? esc(inrS(r.amount)) : '<span class="pl-none">—</span>'}</td>
      <td data-label="Who paid">${esc(r.paid_by) || '<span class="pl-none">—</span>'}</td>
      <td data-label="Documents" class="rn-docs">${r.files.map(f => `<span class="rn-file"><button type="button" class="rn-file-btn" data-rn-file="${esc(f.id)}" data-rn-viewable="${f.viewable ? 1 : 0}" title="${f.viewable ? 'Open' : 'Download'} ${esc(f.original_filename)} (${esc(f.format)}, ${esc(fileSize(f.size_bytes))})"><span class="rn-ext" aria-hidden="true">${esc((f.ext || 'file').slice(0, 4).toUpperCase())}</span>${esc(f.original_filename)}</button>${canEdit ? `<button type="button" class="rn-file-x" data-rn-filedel="${esc(f.id)}" aria-label="Remove ${esc(f.original_filename)}">×</button>` : ''}</span>`).join('') || '<span class="pl-none">None</span>'}${canAdd && r.files.length < (RN.meta.max_files || 10) ? `<button type="button" class="rn-adddoc" data-rn-adddoc="${esc(r.id)}">+ Add document</button>` : ''}</td>
      <td data-label="Status"><span class="rn-chip rn-chip-${r.state}">${RN_CHIP[r.state]}</span><span class="rn-when">${esc(rnWhen(r))}</span></td>
      <td class="pl-act" data-label="Actions">
        ${r.status === 'active' && canAdd ? `<button type="button" class="btn btn-primary btn-sm" data-rn-renew="${esc(r.id)}">Mark renewed</button>` : ''}
        ${r.status === 'renewed' && canEdit ? `<button type="button" class="btn btn-outline btn-sm" data-rn-reopen="${esc(r.id)}">Reopen</button>` : ''}
        ${canEdit ? `<button type="button" class="btn btn-outline btn-sm" data-rn-edit="${esc(r.id)}" aria-label="Edit ${esc(r.renewal_type)}">Edit</button> <button type="button" class="btn btn-outline btn-sm pl-danger" data-rn-del="${esc(r.id)}" aria-label="Delete ${esc(r.renewal_type)}">Delete</button>` : ''}
      </td>
    </tr>`).join('');
}

/* the "add" form */
function addChosenFiles(files) {
  const max = RN.meta.max_files || 10, mb = RN.meta.max_mb || 25, err = document.getElementById('rn-error'); err.textContent = '';
  for (const f of files) {
    if (RN.chosen.length >= max) { err.textContent = `At most ${max} documents per renewal.`; break; }
    if (f.size > mb * 1048576) { err.textContent = `"${f.name}" is too large (${mb} MB at most).`; continue; }
    if (!f.size) { err.textContent = `"${f.name}" is empty.`; continue; }
    RN.chosen.push(f);
  }
  renderChosen();
}
function renderChosen() {
  document.getElementById('rn-chosen').innerHTML = RN.chosen.map((f, i) => `<li><span class="rn-chosen-name">${esc(f.name)}</span> <small>${esc(fileSize(f.size))}</small><button type="button" class="rn-file-x" data-rn-chosen-del="${i}" aria-label="Remove ${esc(f.name)}">×</button></li>`).join('');
}
function clearRenewalForm() {
  ['rn-type', 'rn-date', 'rn-amount', 'rn-paidby', 'rn-desc'].forEach(id => { document.getElementById(id).value = ''; });
  RN.chosen = []; renderChosen(); document.getElementById('rn-error').textContent = '';
}
async function saveRenewal() {
  const err = document.getElementById('rn-error'); err.textContent = '';
  const body = { renewal_type: document.getElementById('rn-type').value.replace(/\s+/g, ' ').trim(), renewal_date: document.getElementById('rn-date').value, amount: document.getElementById('rn-amount').value.trim(),
    paid_by: document.getElementById('rn-paidby').value.replace(/\s+/g, ' ').trim(), description: document.getElementById('rn-desc').value.replace(/\s+/g, ' ').trim() };
  if (!body.renewal_type) { err.textContent = 'Choose or type the type of renewal (for example Vehicle Insurance).'; document.getElementById('rn-type').focus(); return; }
  if (!body.renewal_date) { err.textContent = 'Choose the renewal date.'; document.getElementById('rn-date').focus(); return; }
  if (body.amount !== '' && (!Number.isFinite(Number(body.amount)) || Number(body.amount) < 0)) { err.textContent = 'The amount must be a number of 0 or more.'; return; }
  const btn = document.getElementById('rn-save'), label = btn.textContent; btn.disabled = true;
  try {
    const res = await Renewals.add(body), id = res.data.id, files = RN.chosen.slice(), failed = [];
    for (let i = 0; i < files.length; i++) {
      btn.textContent = `Uploading ${i + 1} of ${files.length}…`;
      try { await Renewals.uploadFile(id, files[i]); } catch (e) { failed.push(`${files[i].name} — ${e.message}`); }
    }
    showToast(`Renewal saved${files.length ? ` with ${plural(files.length - failed.length, 'document')}` : ''}.`);
    clearRenewalForm();
    if (failed.length) err.textContent = `The renewal was saved, but ${plural(failed.length, 'document')} could not be uploaded: ${failed.join('; ')}. Add them from the list below.`;
    RN.filter.status = 'active'; loadRenewals(); refreshBell(true);
  } catch (e) { err.textContent = e.message || 'Could not save. Please try again.'; }
  finally { btn.disabled = false; btn.textContent = label; }
}
async function uploadToRenewal(id, files) {
  let ok = 0; const failed = [];
  for (const f of files) {
    if (f.size > (RN.meta.max_mb || 25) * 1048576) { failed.push(`${f.name} — too large`); continue; }
    try { await Renewals.uploadFile(id, f); ok++; } catch (e) { failed.push(`${f.name} — ${e.message}`); }
  }
  if (ok) showToast(`${plural(ok, 'document')} added.`);
  if (failed.length) showToast('' + failed.join('; '), true);
  loadRenewals();
}
async function openRenewalFile(fid, viewable) {
  if (viewable) return openInNewTab(() => Renewals.viewLink(fid));
  try {
    const r = await Renewals.fileUrl(fid);
    const a = document.createElement('a'); a.href = r.url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();     // the browser DOWNLOADS it
    showToast('Download started.');
  } catch (e) { showToast('' + (e.message || 'Could not start the download.'), true); }
}
async function removeRenewalFile(fid) {
  const row = RN.rows.find(r => r.files.some(f => String(f.id) === String(fid))), file = row && row.files.find(f => String(f.id) === String(fid));
  if (!file) return;
  const reason = await askReason({ title: 'Remove this document?', intro: `<strong>${esc(file.original_filename)}</strong> — ${esc(row.renewal_type)}. It is taken off this renewal; the reason is saved in the Activity Log.`, confirmLabel: 'Remove document', danger: true });
  if (!reason) return;
  try { await Renewals.removeFile(fid, reason); showToast('Document removed.'); loadRenewals(); }
  catch (e) { showToast('' + (e.message || 'Could not remove the document.'), true); }
}

/* mark as renewed (optionally starting the next cycle) */
function openRenew(id) {
  const r = RN.rows.find(x => String(x.id) === String(id)); if (!r) return;
  RN.renewing = r;
  document.getElementById('rn-renew-intro').innerHTML = `<strong>${esc(r.renewal_type)}</strong> — due ${esc(fmtDate(r.renewal_date))}. Its reminders stop once it is marked as renewed.`;
  document.getElementById('rnr-on').value = today(); document.getElementById('rnr-next').value = ''; document.getElementById('rnr-error').textContent = '';
  document.getElementById('rn-renew-overlay').classList.add('open');
  setTimeout(() => document.getElementById('rnr-on').focus(), 60);
}
function closeRenew() { document.getElementById('rn-renew-overlay').classList.remove('open'); RN.renewing = null; }
async function saveRenew() {
  if (!RN.renewing) return;
  const err = document.getElementById('rnr-error'); err.textContent = '';
  const body = { renewed_on: document.getElementById('rnr-on').value || undefined, next_date: document.getElementById('rnr-next').value || undefined };
  if (body.next_date && body.next_date <= RN.renewing.renewal_date) { err.textContent = 'The next renewal date must be after this renewal\'s date.'; return; }
  const btn = document.getElementById('rnr-save'); btn.disabled = true;
  try {
    const res = await Renewals.renew(RN.renewing.id, body);
    showToast(res.next ? `Marked as renewed — the next one is due ${fmtDate(res.next.renewal_date)}.` : 'Marked as renewed.');
    closeRenew(); loadRenewals(); refreshBell(true);
  } catch (e) { err.textContent = e.message || 'Could not save.'; }
  finally { btn.disabled = false; }
}
async function reopenRenewal(id) {
  const r = RN.rows.find(x => String(x.id) === String(id)); if (!r) return;
  const reason = await askReason({ title: 'Reopen this renewal?', intro: `<strong>${esc(r.renewal_type)}</strong> — due ${esc(fmtDate(r.renewal_date))}. It goes back to the active list and its reminders start again.`, confirmLabel: 'Reopen' });
  if (!reason) return;
  try { await Renewals.reopen(id, reason); showToast('Renewal reopened.'); loadRenewals(); refreshBell(true); }
  catch (e) { showToast('' + (e.message || 'Could not reopen.'), true); }
}

/* edit and delete (Admin; a written reason is always needed) */
function openRnEdit(id) {
  const r = RN.rows.find(x => String(x.id) === String(id)); if (!r) return;
  RN.editing = r;
  document.getElementById('rne-type').value = r.renewal_type; document.getElementById('rne-date').value = r.renewal_date;
  document.getElementById('rne-amount').value = r.amount || ''; document.getElementById('rne-paidby').value = r.paid_by || ''; document.getElementById('rne-desc').value = r.description || '';
  document.getElementById('rne-error').textContent = '';
  document.getElementById('rn-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('rne-type').focus(), 60);
}
function closeRnEdit() { document.getElementById('rn-edit-overlay').classList.remove('open'); RN.editing = null; }
async function saveRnEdit() {
  if (!RN.editing) return;
  const err = document.getElementById('rne-error'); err.textContent = '';
  const before = RN.editing;
  const body = { renewal_type: document.getElementById('rne-type').value.replace(/\s+/g, ' ').trim(), renewal_date: document.getElementById('rne-date').value, amount: document.getElementById('rne-amount').value.trim(),
    paid_by: document.getElementById('rne-paidby').value.replace(/\s+/g, ' ').trim(), description: document.getElementById('rne-desc').value.replace(/\s+/g, ' ').trim() };
  if (!body.renewal_type) { err.textContent = 'Choose or type the type of renewal.'; return; }
  if (!body.renewal_date) { err.textContent = 'Choose the renewal date.'; return; }
  if (body.amount !== '' && (!Number.isFinite(Number(body.amount)) || Number(body.amount) < 0)) { err.textContent = 'The amount must be a number of 0 or more.'; return; }
  const changes = [], push = (field, a, b) => { if (String(a ?? '') !== String(b ?? '')) changes.push({ field, from: a || null, to: b || null }); };
  push('Type', before.renewal_type, body.renewal_type); push('Renewal date', fmtDate(before.renewal_date), fmtDate(body.renewal_date)); push('Description', before.description, body.description);
  push('Amount', inrS(before.amount), inrS(Number(body.amount) || 0)); push('Paid by', before.paid_by, body.paid_by);
  if (!changes.length) { showToast('No changes were made.'); closeRnEdit(); return; }
  const reason = await askReason({ title: 'Reason for change', intro: 'Please explain why this renewal is being changed. It is saved in the Activity Log.', confirmLabel: 'Confirm & Save', changes });
  if (!reason) return;
  try { await Renewals.update(before.id, { ...body, reason }); showToast('Renewal updated.'); closeRnEdit(); loadRenewals(); refreshBell(true); }
  catch (e) { err.textContent = e.message || 'Update failed.'; }
}
async function deleteRenewal(id) {
  const r = RN.rows.find(x => String(x.id) === String(id)); if (!r) return;
  const reason = await askReason({ title: 'Delete this renewal?', intro: `<strong>${esc(r.renewal_type)}</strong> — due ${esc(fmtDate(r.renewal_date))}${r.files.length ? `, with ${plural(r.files.length, 'document')}` : ''}. The reason is saved in the Activity Log.`, confirmLabel: 'Delete renewal', danger: true });
  if (!reason) return;
  try { await Renewals.remove(id, reason); showToast('Renewal deleted.'); loadRenewals(); refreshBell(true); }
  catch (e) { showToast('' + (e.message || 'Delete failed.'), true); }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   The reminder bell — in the header, for everyone who may see renewals
   Reminders arrive as the Admin set them (start N days before, repeat every N hours / days). While the app is open the bell
   is checked every minute; a reminder that repeats shows as unread again, and (if the person turned it on) a phone / computer alert pops up.
   ═══════════════════════════════════════════════════════════════════════════════ */
const BELL = { items: [], unread: 0, rule: '', setup: false, seen: new Map(), first: true, timer: null, built: false, title: '' };

function initBell() {
  if (!can('renewals.view') || BELL.built) return;
  BELL.built = true; BELL.title = document.title;
  const wrap = document.getElementById('bell-wrap'); wrap.hidden = false;
  document.getElementById('bell-btn').addEventListener('click', ev => { ev.stopPropagation(); toggleBell(); });
  document.getElementById('bell-readall').addEventListener('click', async () => { try { const r = await Notifications.read(); applyBell(r); } catch { /* quiet */ } });
  document.getElementById('bell-list').addEventListener('click', ev => { const it = ev.target.closest('[data-bell]'); if (it) openBellItem(it.dataset.bell); });
  document.getElementById('bell-device').addEventListener('click', enableDeviceAlerts);
  document.addEventListener('click', ev => { if (!document.getElementById('bell-panel').hidden && !ev.target.closest('#bell-wrap')) toggleBell(false); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !document.getElementById('bell-panel').hidden) { toggleBell(false); document.getElementById('bell-btn').focus(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBell(); });
  updateDeviceNote();
  refreshBell();
  BELL.timer = setInterval(refreshBell, 60000);
}

/** quiet = after the person's own action (they know what they just did): update the bell, but do not pop a toast over their "saved" message. */
async function refreshBell(quiet) {
  if (!BELL.built) return;
  try { applyBell(await Notifications.list(), quiet !== true); } catch { /* the bell is a convenience: stay quiet */ }
}
function applyBell(r, announce) {
  BELL.items = r.items || []; BELL.unread = r.unread || 0; BELL.rule = r.settings_text || ''; BELL.setup = !!r.setup_required;
  renderBell();
  const fresh = BELL.items.filter(i => i.unread && BELL.seen.get(i.renewal_id) !== i.last_sent_at);       // sent (or sent again) since the last check
  BELL.items.forEach(i => BELL.seen.set(i.renewal_id, i.last_sent_at));
  if (!announce) return;
  if (!fresh.length) { BELL.first = false; return; }
  const first = BELL.first; BELL.first = false;
  const top = fresh[0], more = fresh.length - 1;
  const text = fresh.length === 1 ? `${top.title} — ${top.body}` : `${top.title} — ${top.body}${more ? ` (+ ${plural(more, 'more renewal')})` : ''}`;
  showToast(`${first ? `${plural(BELL.unread, 'renewal reminder')} need${BELL.unread === 1 ? 's' : ''} attention. ` : 'Renewal reminder: '}${first ? '' : text}`.trim());
  deviceNotify(fresh.length === 1 ? top.title : `${plural(fresh.length, 'renewal')} need attention`, fresh.length === 1 ? top.body : fresh.slice(0, 3).map(i => `${i.title}: ${i.body}`).join('\n'));
}
function renderBell() {
  const count = document.getElementById('bell-count');
  count.hidden = BELL.unread === 0; count.textContent = BELL.unread > 9 ? '9+' : String(BELL.unread);
  document.getElementById('bell-btn').setAttribute('aria-label', BELL.unread ? `Renewal reminders: ${plural(BELL.unread, 'unread reminder')}` : 'Renewal reminders: nothing unread');
  document.getElementById('bell-btn').classList.toggle('has-unread', BELL.unread > 0);
  document.title = (BELL.unread ? `(${BELL.unread}) ` : '') + BELL.title;
  document.getElementById('bell-sub').textContent = BELL.items.length ? `${plural(BELL.items.length, 'renewal')} to watch${BELL.unread ? ` · ${BELL.unread} unread` : ''}` : '';
  document.getElementById('bell-readall').hidden = BELL.unread === 0;
  document.getElementById('bell-rule').textContent = BELL.rule;
  const time = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  document.getElementById('bell-list').innerHTML = BELL.setup ? '<p class="bell-empty">Renewals need a one-time database update (run-in-supabase-9-renewals.sql).</p>'
    : BELL.items.length ? BELL.items.map(i => `
      <button type="button" class="bell-item bell-${i.state}${i.unread ? ' is-unread' : ''}" data-bell="${esc(i.renewal_id)}">
        <span class="bell-dot" aria-hidden="true"></span>
        <span class="bell-main"><strong>${esc(i.title)}</strong><span class="bell-when">${esc(i.body)}</span>${i.description ? `<span class="bell-desc">${esc(i.description)}</span>` : ''}<small>Reminded ${esc(plural(i.times, 'time'))} · last ${esc(time(i.last_sent_at))}${i.unread ? '' : ' · read'}</small></span>
      </button>`).join('')
    : '<p class="bell-empty">Nothing to renew soon.</p>';
}
function toggleBell(force) {
  const panel = document.getElementById('bell-panel'), open = force === undefined ? panel.hidden : force;
  panel.hidden = !open; document.getElementById('bell-btn').setAttribute('aria-expanded', String(open));
  if (open) refreshBell();
}
async function openBellItem(id) {
  toggleBell(false);
  try { applyBell(await Notifications.read(id)); } catch { /* quiet */ }
  RN.filter = { q: '', status: 'active', type: '', from: '', to: '' }; RN.highlight = id;
  if (document.getElementById('section-renewals').classList.contains('active')) loadRenewals(); else switchTab('renewals');
}

/* alerts on this phone / computer (while the app is open) */
const deviceAlertsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
function updateDeviceNote() {
  const btn = document.getElementById('bell-device'), note = document.getElementById('bell-device-note');
  if (!deviceAlertsSupported()) { btn.hidden = true; note.textContent = 'This browser cannot show alerts. The bell still works while the app is open.'; return; }
  const p = Notification.permission;
  btn.hidden = p === 'granted';
  note.textContent = p === 'granted' ? '✓ Alerts are on for this device. They appear while the app is open or installed.' : p === 'denied' ? 'Alerts are blocked for this site. Allow notifications in the browser settings to turn them on.' : 'Get a pop-up alert on this device each time a reminder repeats.';
  if (p === 'denied') btn.hidden = true;
}
async function enableDeviceAlerts() {
  if (!deviceAlertsSupported()) return;
  try { await Notification.requestPermission(); } catch { /* ignore */ }
  updateDeviceNote();
  if (Notification.permission === 'granted') { showToast('Alerts are on for this device.'); deviceNotify('Renewal alerts are on', 'You will get a pop-up here each time a renewal reminder repeats.'); }
}
async function deviceNotify(title, body) {
  if (!deviceAlertsSupported() || Notification.permission !== 'granted') return;
  const opts = { body, icon: '/img/icon-192.png', badge: '/img/icon-192.png', tag: 'scc-renewals', renotify: true, data: { url: '/' } };
  try {
    const reg = navigator.serviceWorker && navigator.serviceWorker.getRegistration ? await navigator.serviceWorker.getRegistration() : null;
    if (reg && reg.showNotification) await reg.showNotification(title, opts); else new Notification(title, opts);        // (phones only allow the first way)
  } catch { /* an alert is a nicety */ }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Reminder settings — in the Permissions tab (Admin)
   ═══════════════════════════════════════════════════════════════════════════════ */
const RS = { built: false, limits: { start_days: [1, 365], hours: [1, 168], days: [1, 30] }, defaults: { enabled: true, start_days: 7, repeat_every: 1, repeat_unit: 'hours' }, saved: null };
function rsRead() {
  return { enabled: document.getElementById('rs-enabled').checked, start_days: Number(document.getElementById('rs-start').value), repeat_every: Number(document.getElementById('rs-every').value), repeat_unit: document.getElementById('rs-unit').value };
}
function rsText(s) {
  if (!s.enabled) return 'Reminders are switched off.';
  const every = s.repeat_every === 1 ? (s.repeat_unit === 'days' ? 'day' : 'hour') : `${s.repeat_every} ${s.repeat_unit}`;
  return `Reminders start ${plural(s.start_days, 'day')} before the renewal date and repeat every ${every} until the renewal is marked as renewed. Overdue renewals keep reminding.`;
}
function rsProblem(s) {
  if (!Number.isInteger(s.start_days) || s.start_days < RS.limits.start_days[0] || s.start_days > RS.limits.start_days[1]) return `Start reminding between ${RS.limits.start_days[0]} and ${RS.limits.start_days[1]} days before the renewal date.`;
  const [lo, hi] = RS.limits[s.repeat_unit];
  if (!Number.isInteger(s.repeat_every) || s.repeat_every < lo || s.repeat_every > hi) return `Repeat every ${lo} to ${hi} ${s.repeat_unit}.`;
  return null;
}
function rsFill(s) {
  document.getElementById('rs-enabled').checked = !!s.enabled; document.getElementById('rs-start').value = s.start_days;
  document.getElementById('rs-every').value = s.repeat_every; document.getElementById('rs-unit').value = s.repeat_unit; rsPreview();
}
function rsPreview() {
  const s = rsRead(), prob = rsProblem(s);
  document.getElementById('rs-onoff').textContent = s.enabled ? 'on' : 'off';
  document.getElementById('rs-every').max = RS.limits[s.repeat_unit][1];
  document.getElementById('rs-preview').textContent = prob && s.enabled ? prob : rsText(s);
  document.getElementById('rs-preview').classList.toggle('is-bad', !!prob && s.enabled);
  ['rs-start', 'rs-every', 'rs-unit'].forEach(id => { document.getElementById(id).disabled = !s.enabled; });
}
async function loadReminderSettings() {
  if (!document.getElementById('rs-card')) return;
  if (!RS.built) {
    RS.built = true;
    ['rs-enabled', 'rs-start', 'rs-every', 'rs-unit'].forEach(id => document.getElementById(id).addEventListener('input', rsPreview));
    document.getElementById('rs-save').addEventListener('click', () => saveReminderSettings(rsRead()));
    document.getElementById('rs-reset').addEventListener('click', () => { rsFill(RS.defaults); saveReminderSettings(RS.defaults); });
  }
  try {
    const r = await Renewals.settings();
    RS.limits = r.limits || RS.limits; RS.defaults = r.defaults || RS.defaults; RS.saved = r.settings;
    rsFill(r.settings);
    document.getElementById('rs-setup').hidden = !r.setup_required;
    document.getElementById('rs-by').textContent = r.updated_by_name ? `Last changed by ${r.updated_by_name}${r.updated_at ? ` on ${fmtDate(String(r.updated_at).slice(0, 10))}` : ''}.` : '';
  } catch (e) { document.getElementById('rs-error').textContent = e.message || 'The reminder settings could not be loaded.'; }
}
async function saveReminderSettings(s) {
  const err = document.getElementById('rs-error'); err.textContent = '';
  const prob = s.enabled ? rsProblem(s) : null; if (prob) { err.textContent = prob; return; }
  const btn = document.getElementById('rs-save'); btn.disabled = true;
  try {
    const r = await Renewals.saveSettings(s.enabled ? s : { enabled: false });
    RS.saved = r.settings; showToast(r.unchanged ? 'No changes were made.' : 'Reminder settings saved.');
    document.getElementById('rs-preview').textContent = r.text; loadReminderSettings(); refreshBell(true);
  } catch (e) { err.textContent = e.message || 'Could not save.'; }
  finally { btn.disabled = false; }
}



/* ═══════════════════════════════════════════════════════════════════════════════
   The shell: the breadcrumb in the top bar, and the person card in the sidebar
   ═══════════════════════════════════════════════════════════════════════════════ */
function setCrumb(name) {
  const page = document.getElementById('crumb-page'), sep = document.querySelector('#crumbs .crumb-sep');
  if (!page) return;
  page.textContent = name === 'home' ? '' : (TAB_LABELS[name] || '');
  if (sep) sep.hidden = name === 'home';
  const root = document.querySelector('#crumbs .crumb-root'); if (root) root.classList.toggle('is-here', name === 'home');
}
function fillSideUser(user) {
  const a = document.getElementById('side-avatar'); if (!a) return;
  a.textContent = (String(user.name || '?').trim()[0] || '?').toUpperCase();
  document.getElementById('side-name').textContent = user.name || '';
  document.getElementById('side-role').textContent = capitalize(user.role || '');
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Home — what matters today, for the modules this person may open
   ═══════════════════════════════════════════════════════════════════════════════ */
const HM = { built: false };
const hmGreeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'; };
const hmMonthStart = () => today().slice(0, 8) + '01';
const HM_ICON = {
  rec: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  ren: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  pay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
  arc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>',
};
function hmCard(icon, title, chips, tab) {
  return `<button type="button" class="hm-card" ${tab ? `data-hm-go="${tab}"` : ''}>
    <span class="hm-ic">${icon}</span>
    <span class="hm-body"><strong class="hm-title">${title}</strong>
      <span class="hm-chips">${chips.map(c => `<span class="hm-chip">${esc(c.label)} <b class="hm-n hm-n-${c.tone || 'plain'}">${esc(String(c.value))}</b></span>`).join('')}</span></span>
  </button>`;
}

function initHome() {
  const user = Auth.currentUser(), name = (user && user.name) || '';
  document.getElementById('hm-greet').textContent = `${hmGreeting()}, ${name}`;
  document.getElementById('hm-sub').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!HM.built) {
    HM.built = true;
    const from = document.getElementById('hm-from'), to = document.getElementById('hm-to');
    from.value = to.value = today();
    const reload = () => loadHome();
    from.addEventListener('change', reload); to.addEventListener('change', reload);
    document.getElementById('hm-today').addEventListener('click', () => { from.value = to.value = today(); reload(); });
    document.getElementById('hm-month').addEventListener('click', () => { from.value = hmMonthStart(); to.value = today(); reload(); });
    document.getElementById('section-home').addEventListener('click', ev => { const g = ev.target.closest('[data-hm-go]'); if (g) switchTab(g.dataset.hmGo); });
  }
  loadHome();
}

async function loadHome() {
  const from = document.getElementById('hm-from').value, to = document.getElementById('hm-to').value;
  const canRec = can('summary.view'), cards = document.getElementById('hm-cards');
  document.getElementById('hm-range').hidden = !canRec;
  const jobs = {
    rec: canRec && from && to && from <= to ? Entries.stats({ from, to }).then(r => r.data) : null,
    ren: can('renewals.view') ? Renewals.list({ status: 'active' }) : null,
    pay: can('payments.view') ? Payments.summary().then(r => r.data) : null,
    arc: can('archive.manage') ? Archive.list({}) : null,
  };
  const got = {};
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => { if (p) { try { got[k] = await p; } catch { got[k] = null; } } }));
  const out = [];
  if (got.rec) {
    const r = got.rec, span = from === to ? (from === today() ? 'today' : fmtDate(from)) : `${fmtDate(from)} – ${fmtDate(to)}`;
    out.push(hmCard(HM_ICON.rec, `${r.total_entries} ${r.total_entries === 1 ? 'Record' : 'Records'} <small>${esc(span)}</small>`, [{ label: 'Hours', value: r.total_hours }, { label: 'Diesel (L)', value: Number(r.total_diesel).toFixed(1) }, { label: 'Loads', value: r.total_loads }], can('records.view') ? 'records' : 'summary'));
  }
  if (got.ren && got.ren.summary) {
    const s = got.ren.summary, n = s.overdue + s.today + s.soon;
    out.push(hmCard(HM_ICON.ren, `${n} ${n === 1 ? 'Renewal needs' : 'Renewals need'} attention`, [{ label: 'Overdue', value: s.overdue, tone: s.overdue ? 'bad' : 'plain' }, { label: 'Due today', value: s.today, tone: s.today ? 'warn' : 'plain' }, { label: 'Due soon', value: s.soon, tone: s.soon ? 'warn' : 'plain' }, { label: 'Upcoming', value: s.upcoming }], 'renewals'));
  }
  if (got.pay && got.pay.overall) {
    const o = got.pay.overall;
    out.push(hmCard(HM_ICON.pay, `${inrS(o.balance)} <small>balance to pay</small>`, [{ label: 'Payable', value: inrS(o.payable) }, { label: 'Paid', value: inrS(o.paid), tone: 'good' }, { label: 'Company', value: inrS(got.pay.kinds.company.totals.balance) }, { label: 'Outside rental', value: inrS(got.pay.kinds.outside.totals.balance) }], 'payments'));
  }
  if (got.arc) out.push(hmCard(HM_ICON.arc, `${got.arc.total} ${got.arc.total === 1 ? 'item' : 'items'} in the Archive`, Object.entries(got.arc.counts || {}).slice(0, 4).map(([k, v]) => ({ label: (got.arc.types.find(t => t.key === k) || { label: k }).label, value: v })), 'archive'));
  cards.innerHTML = out.join('') || '<p class="hm-empty">Nothing to summarise here yet. Use the quick actions below.</p>';

  const sitesCard = document.getElementById('hm-sites-card');
  sitesCard.hidden = !got.rec;
  if (got.rec) {
    const r = got.rec, rows = r.sites || [];
    document.getElementById('hm-sites-sub').textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'site' : 'sites'} with records in this period.` : '';
    document.getElementById('hm-sites').innerHTML = rows.length
      ? rows.map(x => `<tr><td data-label="Site"><strong>${esc(x.site)}</strong></td><td class="r" data-label="Records">${x.entries}</td><td class="r" data-label="Hours">${esc(String(x.hours))}</td><td class="r" data-label="Diesel (L)">${esc(Number(x.diesel).toFixed(1))}</td><td class="r" data-label="Loads">${x.loads}</td></tr>`).join('')
        + `<tr class="pl-total"><td data-label="">Grand total</td><td class="r" data-label="Records">${r.total_entries}</td><td class="r" data-label="Hours">${esc(String(r.total_hours))}</td><td class="r" data-label="Diesel (L)">${esc(Number(r.total_diesel).toFixed(1))}</td><td class="r" data-label="Loads">${r.total_loads}</td></tr>`
      : '<tr class="empty-row"><td colspan="5">No records in this period.</td></tr>';
  }
  const acts = [['entry', 'Add a record', 'entry.add'], ['purchases', 'Add a purchase', 'purchases.add'], ['payments', 'Add payment lines', 'payments.add'], ['renewals', 'Add a renewal', 'renewals.add'], ['documents', 'Upload a document', 'documents.upload'], ['progress', 'See progress pictures', 'progress.view']].filter(a => can(a[2]) && canTab(a[0]));
  document.getElementById('hm-actions-card').hidden = !acts.length;
  if (!out.length) cards.innerHTML = acts.length ? '<p class="hm-empty">Nothing to summarise here yet. Use the quick actions below.</p>' : '<p class="hm-empty">Nothing is switched on for you yet. Ask the Admin to give you access to what you need.</p>';
  document.getElementById('hm-actions').innerHTML = acts.map(a => `<button type="button" class="btn btn-outline" data-hm-go="${a[0]}">${esc(a[1])}</button>`).join('');
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Archived (Admin) — everything that was deleted; restore it, or delete it permanently
   ═══════════════════════════════════════════════════════════════════════════════ */
const AR = { built: false, rows: [], total: 0, counts: {}, types: [], filter: { q: '', type: '', from: '', to: '' }, sel: new Set(), timer: null };
const arWhen = iso => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '');

function initArchive() {
  if (!AR.built) {
    AR.built = true;
    const root = document.getElementById('section-archive');
    root.addEventListener('input', ev => { const t = ev.target; if (t.matches('[data-arf]') && t.tagName !== 'SELECT') { AR.filter[t.dataset.arf] = t.value; clearTimeout(AR.timer); AR.timer = setTimeout(loadArchive, 280); } });
    root.addEventListener('change', ev => {
      const t = ev.target;
      if (t.matches('select[data-arf]')) { AR.filter[t.dataset.arf] = t.value; loadArchive(); }
      if (t.id === 'ar-all') { AR.rows.forEach(r => { if (t.checked) AR.sel.add(r.id); else AR.sel.delete(r.id); }); renderArchive(); }
      if (t.matches('[data-ar-sel]')) { if (t.checked) AR.sel.add(t.dataset.arSel); else AR.sel.delete(t.dataset.arSel); syncArBar(); }
    });
    root.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.id === 'ar-clear') { AR.filter = { q: '', type: '', from: '', to: '' }; syncArFilters(); return loadArchive(); }
      if (b.id === 'ar-purge-sel') return purgeArchive([...AR.sel]);
      if (b.dataset.arChip !== undefined) { AR.filter.type = b.dataset.arChip; syncArFilters(); return loadArchive(); }
      if (b.dataset.arRestore) return restoreArchived(b.dataset.arRestore);
      if (b.dataset.arPurge) return purgeArchive([b.dataset.arPurge]);
    });
  }
  loadArchive();
}
function syncArFilters() { document.querySelectorAll('#section-archive [data-arf]').forEach(el => { el.value = AR.filter[el.dataset.arf] || ''; }); }
async function loadArchive() {
  try {
    const f = AR.filter;
    const res = await Archive.list({ q: f.q.trim(), type: f.type, from: f.from, to: f.to });
    AR.rows = res.data || []; AR.total = res.total || 0; AR.counts = res.counts || {}; AR.types = res.types || [];
    const visible = new Set(AR.rows.map(r => r.id)); AR.sel = new Set([...AR.sel].filter(id => visible.has(id)));
    document.getElementById('ar-setup').hidden = !res.setup_required;
    const sel = document.querySelector('#section-archive select[data-arf="type"]');
    sel.innerHTML = '<option value="">Everything</option>' + AR.types.map(t => `<option value="${esc(t.key)}">${esc(t.label)}${AR.counts[t.key] ? ` (${AR.counts[t.key]})` : ''}</option>`).join('');
    syncArFilters(); renderArchive();
  } catch (e) { document.getElementById('ar-body').innerHTML = `<tr class="empty-row"><td colspan="8">${esc(e.message || 'The Archive could not be loaded.')}</td></tr>`; }
}
function renderArchive() {
  document.getElementById('ar-chips').innerHTML = AR.total
    ? `<button type="button" class="ar-chip${AR.filter.type ? '' : ' is-on'}" data-ar-chip="">Everything <b>${AR.total}</b></button>` + AR.types.filter(t => AR.counts[t.key]).map(t => `<button type="button" class="ar-chip${AR.filter.type === t.key ? ' is-on' : ''}" data-ar-chip="${esc(t.key)}">${esc(t.label)} <b>${AR.counts[t.key]}</b></button>`).join('') : '';
  document.getElementById('ar-body').innerHTML = AR.rows.length ? AR.rows.map(r => `
    <tr data-id="${esc(r.id)}">
      <td class="ar-chk"><input type="checkbox" data-ar-sel="${esc(r.id)}" ${AR.sel.has(r.id) ? 'checked' : ''} aria-label="Select ${esc(r.label)}"></td>
      <td data-label="Deleted">${esc(arWhen(r.deleted_at))}</td>
      <td data-label="Kind"><span class="ar-kind ar-kind-${esc(r.type)}">${esc(r.type_label)}</span></td>
      <td data-label="What"><strong>${esc(r.label)}</strong></td>
      <td data-label="Details" class="pl-desc-cell">${esc(r.detail) || '<span class="pl-none">—</span>'}${r.files ? `<small class="ar-files">${r.files} stored ${r.files === 1 ? 'file' : 'files'}</small>` : ''}</td>
      <td data-label="Deleted by">${esc(r.deleted_by_name) || '<span class="pl-none">—</span>'}</td>
      <td data-label="Reason" class="pl-desc-cell">${esc(r.reason) || '<span class="pl-none">—</span>'}</td>
      <td class="pl-act" data-label="Actions">${r.restorable ? `<button type="button" class="btn btn-outline btn-sm" data-ar-restore="${esc(r.id)}">Restore</button>` : '<small class="ar-note">Add again in Users</small>'}<button type="button" class="btn btn-danger btn-sm" data-ar-purge="${esc(r.id)}">Delete permanently</button></td>
    </tr>`).join('') : `<tr class="empty-row"><td colspan="8">${AR.total ? 'Nothing matches these filters.' : 'The Archive is empty. Anything that is deleted will appear here.'}</td></tr>`;
  document.getElementById('ar-count').textContent = AR.rows.length ? (AR.rows.length === AR.total ? plural(AR.total, 'item') : `Showing ${AR.rows.length} of ${plural(AR.total, 'item')}`) : '';
  syncArBar();
}
function syncArBar() {
  const n = AR.sel.size, all = document.getElementById('ar-all');
  const b = document.getElementById('ar-purge-sel'); b.disabled = n === 0; b.textContent = n ? `Delete ${n} selected permanently` : 'Delete selected permanently';
  all.checked = AR.rows.length > 0 && n === AR.rows.length; all.indeterminate = n > 0 && n < AR.rows.length;
}
async function restoreArchived(id) {
  const r = AR.rows.find(x => x.id === id); if (!r) return;
  try { await Archive.restore(id); showToast(`${r.type_label} restored: ${r.label}`); AR.sel.delete(id); loadArchive(); refreshBell(true); }
  catch (e) { showToast(e.message || 'Could not restore.', true); }
}
async function purgeArchive(ids) {
  if (!ids.length) return;
  const rows = ids.map(id => AR.rows.find(x => x.id === id)).filter(Boolean), one = rows.length === 1 ? rows[0] : null;
  const files = rows.reduce((a, r) => a + (r.files || 0), 0);
  const reason = await askReason({ title: one ? 'Delete this permanently?' : `Delete ${rows.length} items permanently?`,
    intro: `${one ? `<strong>${esc(one.type_label)}: ${esc(one.label)}</strong>. ` : ''}This <strong>cannot be undone</strong>: the copy is removed from the database${files ? ` and ${plural(files, 'stored file')} ${files === 1 ? 'is' : 'are'} removed from storage` : ''}. The reason is saved in the Activity Log.`,
    confirmLabel: 'Delete permanently', danger: true });
  if (!reason) return;
  try { const res = await Archive.purge(ids, reason); showToast(`Deleted permanently: ${plural(res.removed, 'item')}.`); ids.forEach(i => AR.sel.delete(i)); loadArchive(); }
  catch (e) { showToast(e.message || 'Could not delete.', true); }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   Mobile menu — on phones and small tablets the tab bar is replaced by a slide-in menu
   ═══════════════════════════════════════════════════════════════════════════════ */
function initMobileMenu(user) {
  const btn = document.getElementById('menu-btn'), menu = document.getElementById('mobile-menu');
  const overlay = document.getElementById('menu-overlay'), nav = document.getElementById('mm-nav');
  if (!btn || !menu) return;

  document.getElementById('mm-user').innerHTML = `${esc(user.name)}<small>${esc(capitalize(user.role))}</small>`;
  nav.innerHTML = '';
  visibleTabs().forEach(t => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'mm-item';
    item.dataset.tab = t;
    const icon = document.querySelector(`#tab-${t} svg`);
    item.innerHTML = `${icon ? icon.outerHTML : ''}<span>${esc(TAB_LABELS[t])}</span>`;
    item.addEventListener('click', () => { closeMobileMenu(false); switchTab(t); window.scrollTo(0, 0); });
    nav.appendChild(item);
  });

  btn.addEventListener('click', () => (menu.classList.contains('open') ? closeMobileMenu(true) : openMobileMenu()));
  overlay.addEventListener('click', () => closeMobileMenu(true));
  document.getElementById('mm-close').addEventListener('click', () => closeMobileMenu(true));
  document.addEventListener('keydown', ev => {
    if (!menu.classList.contains('open')) return;
    if (ev.key === 'Escape') { ev.preventDefault(); closeMobileMenu(true); return; }
    if (ev.key === 'Tab') {                      // keep keyboard focus inside the open menu
      const f = [...menu.querySelectorAll('button, a[href]')].filter(x => !x.hidden && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
  });
  window.matchMedia('(min-width: 961px)').addEventListener('change', e => { if (e.matches) closeMobileMenu(false); });
}

function openMobileMenu() {
  const btn = document.getElementById('menu-btn'), menu = document.getElementById('mobile-menu'), overlay = document.getElementById('menu-overlay');
  menu.hidden = false; overlay.hidden = false;
  requestAnimationFrame(() => { menu.classList.add('open'); overlay.classList.add('open'); });
  document.body.classList.add('menu-open');
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-label', 'Close menu');
  const active = menu.querySelector('.mm-item.active') || menu.querySelector('.mm-item');
  if (active) setTimeout(() => active.focus(), 60);
}

function closeMobileMenu(returnFocus) {
  const btn = document.getElementById('menu-btn'), menu = document.getElementById('mobile-menu'), overlay = document.getElementById('menu-overlay');
  if (!menu || menu.hidden) return;
  menu.classList.remove('open'); overlay.classList.remove('open');
  document.body.classList.remove('menu-open');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-label', 'Open menu');
  setTimeout(() => { if (!menu.classList.contains('open')) { menu.hidden = true; overlay.hidden = true; } }, 230);
  if (returnFocus) btn.focus();
}

/** The logo / name takes you to your home screen (the first screen your role has). */
function initBrandLink() {
  const a = document.getElementById('brand-link');
  if (!a) return;
  a.addEventListener('click', ev => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button === 1) return;      // let "open in new tab" work
    ev.preventDefault();
    const me = Auth.currentUser();
    const home = visibleTabs()[0] || 'entry';
    closeMobileMenu(false);
    switchTab(home);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Phone-friendly tables — every cell is given its column title, so on a phone each row reads as a card
   ═══════════════════════════════════════════════════════════════════════════════ */
const NO_LABEL_HEADS = new Set(['', 'edit', 'delete', 'history', 'download', 'open', 'actions']);   // cells that only hold buttons

function labelAllTables() {
  document.querySelectorAll('.table-wrap table:not(.log-table)').forEach(table => {
    if (!table.querySelector('tbody td:not([data-label])')) return;
    const heads = [...table.querySelectorAll('thead th')].map(th => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(tr => {
      if (tr.classList.contains('empty-row')) return;
      [...tr.children].forEach((td, i) => {
        if (td.hasAttribute('data-label')) return;
        const h = heads[i] || '';
        td.setAttribute('data-label', NO_LABEL_HEADS.has(h.toLowerCase()) ? '' : h);
      });
    });
  });
}

function initTableLabels() {
  let queued = false;
  const run = () => { queued = false; labelAllTables(); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.getElementById('main-content') || document.body, { childList: true, subtree: true });
  labelAllTables();
}


/* ═══════════════════════════════════════════════════════════════════════════════
   Connection notice + a safety net for anything unexpected
   ═══════════════════════════════════════════════════════════════════════════════ */
function initNetBanner() {
  const el = document.getElementById('net-banner');
  if (!el) return;
  let hideTimer = null;
  const offline = () => { clearTimeout(hideTimer); el.className = 'net-banner'; el.textContent = "You're offline. Entries can't be saved until you're back online."; el.hidden = false; };
  const online = () => {
    if (el.hidden) return;
    el.className = 'net-banner back'; el.textContent = "Back online.";
    hideTimer = setTimeout(() => { el.hidden = true; }, 2500);
  };
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  if (!navigator.onLine) offline();
}

// If something slips through un-handled, say so instead of failing silently.
window.addEventListener('unhandledrejection', ev => {
  console.error('Unhandled:', ev.reason);
  if (typeof showToast === 'function') showToast('Something went wrong. Please try again.', true);
});


/* ═══════════════════════════════════════════════════════════════════════════════
   PURCHASES — material that arrives at a site.   Net weight = Load weight − Empty weight (kg)
   Supervisors add · the Owner and Admin see everything · the Admin edits / deletes (with a reason)
   ═══════════════════════════════════════════════════════════════════════════════ */
const PU = { inited: false, att: null, uploading: false, saving: false, mine: [], list: [], editing: null, editAtt: undefined, editBusy: false, editUploading: false };

const puMilli = v => {                       // "24,850.5" → 24850500 (thousandths of a kg), or null when it is not a plain weight
  const t = String(v ?? '').trim().replace(/,/g, '');
  return /^\d+(\.\d{1,3})?$/.test(t) ? Math.round(parseFloat(t) * 1000) : null;
};
const puNum = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const puKg = n => `${puNum(n)} kg`;
const puTonnes = n => `${puNum(Number(n) / 1000)} t`;

function puNetCalc(loadV, emptyV) {
  const L = puMilli(loadV), E = puMilli(emptyV);
  if (String(loadV).trim() === '' || String(emptyV).trim() === '' || L === null || E === null) return { state: 'wait' };
  if (L <= E) return { state: 'bad', msg: 'The load weight must be more than the empty weight.' };
  return { state: 'ok', L, E, net: (L - E) / 1000 };
}

/** Works out the net weight as the person types (the server works it out again — this is only for show). */
function updatePuNet(prefix) {
  const c = puNetCalc(document.getElementById(prefix + '-load').value, document.getElementById(prefix + '-empty').value);
  const out = document.getElementById(prefix + '-net'), hint = document.getElementById(prefix + '-net-hint');
  out.value = c.state === 'ok' ? puNum(c.net) : '';
  out.classList.toggle('is-bad', c.state === 'bad');
  hint.className = 'form-hint pu-net-hint' + (c.state === 'bad' ? ' bad' : c.state === 'ok' ? ' ok' : '');
  hint.textContent = c.state === 'ok' ? `${puNum(c.L / 1000)} − ${puNum(c.E / 1000)} = ${puNum(c.net)} kg (${puNum(c.net / 1000)} tonnes)` : c.state === 'bad' ? c.msg : '';
}

const PU_VEHICLE_RE = /^[A-Za-z0-9][A-Za-z0-9 .,&()\/_-]{1,39}$/;
const tidy = v => String(v || '').replace(/\s+/g, ' ').trim();

function readPu(prefix) {
  const g = id => document.getElementById(prefix + '-' + id).value;
  return {
    purchase_date: g('date'), site: g('site'), supplier: tidy(g('supplier')), vehicle_no: tidy(g('vehicle')),
    item_name: tidy(g('item')), load_weight: String(g('load')).trim(), empty_weight: String(g('empty')).trim(),
  };
}

/** The same rules the server applies, so mistakes are caught before anything is sent. Returns { id, msg } or null. */
function checkPu(v) {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  if (!v.purchase_date) return { id: 'date', msg: 'Choose the date of the purchase.' };
  if (v.purchase_date > tomorrow) return { id: 'date', msg: 'The purchase date cannot be in the future.' };
  if (!v.site) return { id: 'site', msg: 'Choose the site.' };
  if (!v.supplier) return { id: 'supplier', msg: 'Enter the supplier.' };
  if (v.supplier.length > 120) return { id: 'supplier', msg: 'The supplier is too long (120 characters at most).' };
  if (!v.vehicle_no) return { id: 'vehicle', msg: 'Enter the vehicle number.' };
  if (v.vehicle_no.length > 40) return { id: 'vehicle', msg: 'The vehicle number is too long (40 characters at most).' };
  if (!PU_VEHICLE_RE.test(v.vehicle_no)) return { id: 'vehicle', msg: 'The vehicle number can only contain letters, numbers, spaces and - . / & ( ) , _' };
  if (!v.item_name) return { id: 'item', msg: 'Enter the item name.' };
  if (v.item_name.length > 120) return { id: 'item', msg: 'The item name is too long (120 characters at most).' };
  if (v.load_weight === '' || puMilli(v.load_weight) === null) return { id: 'load', msg: 'Enter the load weight in kg (numbers only, up to 3 decimals).' };
  if (v.empty_weight === '' || puMilli(v.empty_weight) === null) return { id: 'empty', msg: 'Enter the empty weight in kg (numbers only, up to 3 decimals).' };
  if (puMilli(v.load_weight) > 500000000 || puMilli(v.empty_weight) > 500000000) return { id: 'load', msg: 'A weight cannot be more than 5,00,000 kg.' };
  if (puMilli(v.load_weight) <= puMilli(v.empty_weight)) return { id: 'load', msg: 'The load weight must be more than the empty weight.' };
  return null;
}

function initPurchases() {
  const me = Auth.currentUser();
  if (!me) return;
  const canAdd = can('purchases.add');
  const canList = can('purchases.view');
  document.getElementById('pu-form-card').hidden = !canAdd;
  document.getElementById('pu-mine-card').hidden = !(canAdd && !canList);          // "recently saved by you" for people who cannot see the full list
  document.getElementById('pu-list-card').hidden = !canList;
  if (!PU.inited) {
    PU.inited = true;
    document.getElementById('pu-date').value = today();
    ['pu', 'pue'].forEach(p => ['load', 'empty'].forEach(k => document.getElementById(`${p}-${k}`).addEventListener('input', () => updatePuNet(p))));
  }
  if (canAdd) loadPuSuggestions();
  if (canAdd && !canList) loadPuMine();
  if (canList) loadPuList();
}

async function loadPuSuggestions() {
  try {
    const r = await Purchases.suggestions();
    const fill = (id, list) => { document.getElementById(id).innerHTML = (list || []).map(v => `<option value="${esc(v)}"></option>`).join(''); };
    fill('pu-suppliers', r.suppliers); fill('pu-items', r.items); fill('pu-vehicles', r.vehicles);
  } catch { /* suggestions are a convenience — typing still works */ }
}

/* ── The attached file ──────────────────────────────────────────────────────── */
function puChip(att) {
  return `${fmtBadge(att.format)} <span class="pu-file-name">${esc(att.filename)}</span> <span class="doc-sub">${esc(humanSize(att.size))}</span>`;
}

async function sendPuFile(file, ui) {
  ui.progress.hidden = false; ui.bar.style.width = '0%'; ui.text.textContent = 'Uploading…';
  try {
    const r = await Purchases.uploadAttachment(file, f => {
      ui.bar.style.width = `${Math.round(f * 100)}%`;
      ui.text.textContent = f >= 1 ? 'Saving the file…' : `Uploading… ${Math.round(f * 100)}%`;
    });
    return r.attachment;
  } finally {
    ui.progress.hidden = true;
  }
}
const puUi = p => ({ progress: document.getElementById(p + '-progress'), bar: document.getElementById(p + '-progress-bar'), text: document.getElementById(p + '-progress-text') });

async function onPuFileChosen() {
  const input = document.getElementById('pu-file'), file = input.files[0];
  const err = document.getElementById('pu-error');
  if (!file) return;
  err.textContent = '';
  dropPuFile();                                           // a new choice replaces the old one
  PU.uploading = true;
  try {
    PU.att = await sendPuFile(file, puUi('pu'));
    const info = document.getElementById('pu-file-info');
    info.innerHTML = `${puChip(PU.att)} <button type="button" class="link-btn" onclick="removePuFile()">Remove</button>`;
    info.hidden = false;
  } catch (e) {
    err.textContent = e.message || 'The file could not be attached.';
    input.value = '';
  } finally {
    PU.uploading = false;
  }
}

/** Forget the attached file and delete it from storage (it was never saved with a purchase). */
function dropPuFile() {
  if (PU.att) Purchases.removeAttachment(PU.att.path).catch(() => {});
  PU.att = null;
  document.getElementById('pu-file-info').hidden = true;
}
function removePuFile() { dropPuFile(); document.getElementById('pu-file').value = ''; }

function resetPuForm(saved = false) {
  if (saved) { PU.att = null; document.getElementById('pu-file-info').hidden = true; } else dropPuFile();
  const site = document.getElementById('pu-site').value;
  document.getElementById('pu-file').value = '';
  ['pu-supplier', 'pu-vehicle', 'pu-item', 'pu-load', 'pu-empty'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pu-date').value = today();
  document.getElementById('pu-site').value = saved ? site : '';          // after a save, the site is kept for the next purchase
  document.getElementById('pu-error').textContent = '';
  updatePuNet('pu');
}

async function savePurchase() {
  if (PU.saving) return;
  const err = document.getElementById('pu-error');
  err.textContent = '';
  if (PU.uploading) { err.textContent = 'Please wait — the file is still uploading.'; return; }
  const v = readPu('pu');
  const problem = checkPu(v);
  if (problem) { err.textContent = problem.msg; document.getElementById('pu-' + problem.id).focus(); return; }
  const body = { ...v };
  if (PU.att) body.attachment = { path: PU.att.path, filename: PU.att.filename, size: PU.att.size };

  const btn = document.getElementById('pu-save');
  PU.saving = true; btn.disabled = true;
  try {
    const r = await Purchases.create(body);
    showToast(`Purchase saved — net weight ${puKg(r.data.net_weight)}.`);
    resetPuForm(true);
    loadPuSuggestions();
    if (can('purchases.view')) loadPuList(); else loadPuMine();
  } catch (e) {
    err.textContent = e.message || 'Could not save the purchase.';        // the typed values and the attached file stay, so it can be tried again
  } finally {
    PU.saving = false; btn.disabled = false;
  }
}

/* ── Lists ──────────────────────────────────────────────────────────────────── */
function puFileCell(r) {
  if (!r.has_file) return '<span class="doc-sub">—</span>';
  const view = r.file_viewable ? `<button type="button" class="btn btn-outline btn-sm" onclick="viewPurchaseFile('${esc(r.id)}')" aria-label="View the file of ${esc(r.supplier)}">View</button>` : '';
  return `<div class="pu-file"><span class="pu-file-name">${esc(r.file_name || 'file')}</span><div class="open-btns">${view}<button type="button" class="btn btn-green btn-sm" onclick="downloadPurchaseFile('${esc(r.id)}')" aria-label="Download the file of ${esc(r.supplier)}">Download</button></div></div>`;
}

function puRowHtml(r, full) {
  return `
    <td>${esc(fmtDate(r.purchase_date))}</td>
    <td>${esc(r.site)}</td>
    <td><strong>${esc(r.supplier)}</strong></td>
    <td>${esc(r.vehicle_no)}</td>
    <td>${esc(r.item_name)}</td>
    ${full ? `<td class="num">${esc(puNum(r.load_weight))}</td><td class="num">${esc(puNum(r.empty_weight))}</td>` : ''}
    <td class="num"><strong>${esc(puNum(r.net_weight))}</strong></td>
    <td>${puFileCell(r)}</td>
    ${full ? `<td class="log-time">${esc(r.created_by_name || '')}<br>${esc(fmtDateTime(r.created_at))}</td>
    ${can('purchases.edit') ? `<td><div class="open-btns"><button type="button" class="btn btn-outline btn-sm" onclick="openPuEdit('${esc(r.id)}')" aria-label="Edit the purchase from ${esc(r.supplier)}">Edit</button><button type="button" class="btn btn-danger btn-sm" onclick="deletePurchase('${esc(r.id)}')" aria-label="Delete the purchase from ${esc(r.supplier)}">${ICON_TRASH}</button></div></td>` : ''}` : ''}`;
}

async function loadPuMine() {
  try { PU.mine = (await Purchases.mine()).data || []; } catch (e) { showToast('' + (e.message || 'Could not load your purchases.'), true); return; }
  const body = document.getElementById('pu-mine-body');
  document.getElementById('pu-mine-count').textContent = PU.mine.length ? `${PU.mine.length} saved` : '';
  body.innerHTML = '';
  if (!PU.mine.length) { body.innerHTML = '<tr class="empty-row"><td colspan="7">Nothing saved by you yet.</td></tr>'; return; }
  PU.mine.forEach(r => { const tr = document.createElement('tr'); tr.innerHTML = puRowHtml(r, false); body.appendChild(tr); });
}

let puListTimer = null;
function loadPuListDebounced() { clearTimeout(puListTimer); puListTimer = setTimeout(loadPuList, 300); }
function clearPuFilters() {
  ['pu-filter-from', 'pu-filter-to', 'pu-filter-site', 'pu-filter-q'].forEach(id => { document.getElementById(id).value = ''; });
  loadPuList();
}

let puListSeq = 0;
async function loadPuList() {
  const from = document.getElementById('pu-filter-from').value, to = document.getElementById('pu-filter-to').value;
  if (from && to && from > to) { showToast('The "from" date cannot be after the "to" date.', true); return; }
  const seq = ++puListSeq;
  let r;
  try { r = await Purchases.list({ from, to, site: document.getElementById('pu-filter-site').value, q: document.getElementById('pu-filter-q').value.trim() }); }
  catch (e) { if (seq === puListSeq) showToast('' + (e.message || 'Could not load the purchases.'), true); return; }
  if (seq !== puListSeq) return;                         // a newer search is already on its way
  PU.list = r.data || [];
  const body = document.getElementById('pu-body');
  document.getElementById('pu-count').textContent = r.total_count ? `${r.total_count} purchase${r.total_count === 1 ? '' : 's'}` : '';
  body.innerHTML = '';
  const filtered = from || to || document.getElementById('pu-filter-site').value || document.getElementById('pu-filter-q').value.trim();
  if (!PU.list.length) body.innerHTML = `<tr class="empty-row"><td colspan="${10 + (can('purchases.edit') ? 1 : 0)}">${filtered ? 'No purchases match these filters.' : 'No purchases yet.'}</td></tr>`;
  PU.list.forEach(x => { const tr = document.createElement('tr'); tr.innerHTML = puRowHtml(x, true); body.appendChild(tr); });
  document.getElementById('pu-footer').innerHTML = r.total_count
    ? `<strong>Net total: ${esc(puKg(r.net_total))}</strong> (${esc(puTonnes(r.net_total))}) across ${r.total_count} purchase${r.total_count === 1 ? '' : 's'}${r.truncated ? ` — showing the newest ${PU.list.length}; narrow the dates to see the rest.` : ''}`
    : '';
}

/* ── Opening the attached file ──────────────────────────────────────────────── */
function viewPurchaseFile(id) { return openInNewTab(() => Purchases.fileLink(id, 'view')); }

async function downloadPurchaseFile(id) {
  try {
    const r = await Purchases.fileLink(id, 'download');
    const a = document.createElement('a');
    a.href = r.url; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    showToast('Download started.');
  } catch (e) {
    showToast('' + (e.message || 'Could not start the download.'), true);
  }
}

/* ── Admin: edit ────────────────────────────────────────────────────────────── */
function renderPueFile() {
  const row = PU.editing, cur = document.getElementById('pue-file-current'), btn = document.getElementById('pue-remove-file');
  if (PU.editAtt) {                       // a new file waiting to replace the old one
    cur.innerHTML = `New file (replaces the old one when you save): ${puChip(PU.editAtt)}`; btn.textContent = 'Cancel the new file'; btn.hidden = false;
  } else if (PU.editAtt === null) {        // the old file is to be removed
    cur.textContent = 'The file will be removed when you save.'; btn.textContent = 'Keep the file'; btn.hidden = false;
  } else if (row && row.has_file) {
    cur.innerHTML = `Current file: ${fmtBadge(row.file_format || 'File')} <span class="pu-file-name">${esc(row.file_name || 'file')}</span>`; btn.textContent = 'Remove the file'; btn.hidden = false;
  } else {
    cur.textContent = 'No file attached.'; btn.hidden = true;
  }
}

function openPuEdit(id) {
  const row = PU.list.find(r => String(r.id) === String(id));
  if (!row) return;
  PU.editing = row; PU.editAtt = undefined;
  const set = (k, v) => { document.getElementById('pue-' + k).value = v; };
  set('date', row.purchase_date); setSelectValue('pue-site', row.site);
  set('supplier', row.supplier); set('vehicle', row.vehicle_no); set('item', row.item_name);
  set('load', row.load_weight); set('empty', row.empty_weight);
  document.getElementById('pue-file').value = '';
  document.getElementById('pue-error').textContent = '';
  updatePuNet('pue'); renderPueFile();
  document.getElementById('pu-edit-overlay').classList.add('open');
  setTimeout(() => document.getElementById('pue-supplier').focus(), 50);
}

function closePuEdit() {
  if (PU.editAtt) Purchases.removeAttachment(PU.editAtt.path).catch(() => {});      // a replacement that was never saved
  PU.editAtt = undefined; PU.editing = null;
  document.getElementById('pu-edit-overlay').classList.remove('open');
}

async function onPueFileChosen() {
  const input = document.getElementById('pue-file'), file = input.files[0];
  const err = document.getElementById('pue-error');
  if (!file) return;
  err.textContent = '';
  if (PU.editAtt) { Purchases.removeAttachment(PU.editAtt.path).catch(() => {}); PU.editAtt = undefined; }
  PU.editUploading = true;
  try { PU.editAtt = await sendPuFile(file, puUi('pue')); }
  catch (e) { err.textContent = e.message || 'The file could not be attached.'; }
  finally { PU.editUploading = false; input.value = ''; renderPueFile(); }
}

function removePueFile() {
  if (PU.editAtt) { Purchases.removeAttachment(PU.editAtt.path).catch(() => {}); PU.editAtt = undefined; }
  else if (PU.editAtt === null) PU.editAtt = undefined;                 // "Keep the file"
  else PU.editAtt = null;                                              // "Remove the file"
  renderPueFile();
}

async function savePuEdit() {
  const row = PU.editing;
  if (!row || PU.editBusy) return;
  const err = document.getElementById('pue-error');
  err.textContent = '';
  if (PU.editUploading) { err.textContent = 'Please wait — the file is still uploading.'; return; }
  const v = readPu('pue');
  const problem = checkPu(v);
  if (problem) { err.textContent = problem.msg; document.getElementById('pue-' + problem.id).focus(); return; }

  const net = (puMilli(v.load_weight) - puMilli(v.empty_weight)) / 1000, load = puMilli(v.load_weight) / 1000, empty = puMilli(v.empty_weight) / 1000;
  const changes = [];
  if (v.purchase_date !== row.purchase_date) changes.push({ field: 'Date', from: fmtDate(row.purchase_date), to: fmtDate(v.purchase_date) });
  if (v.site !== row.site)             changes.push({ field: 'Site', from: row.site, to: v.site });
  if (v.supplier !== row.supplier)     changes.push({ field: 'Supplier', from: row.supplier, to: v.supplier });
  if (v.vehicle_no !== row.vehicle_no) changes.push({ field: 'Vehicle', from: row.vehicle_no, to: v.vehicle_no });
  if (v.item_name !== row.item_name)   changes.push({ field: 'Item', from: row.item_name, to: v.item_name });
  if (load !== row.load_weight)        changes.push({ field: 'Load weight', from: puKg(row.load_weight), to: puKg(load) });
  if (empty !== row.empty_weight)      changes.push({ field: 'Empty weight', from: puKg(row.empty_weight), to: puKg(empty) });
  if (net !== row.net_weight)          changes.push({ field: 'Net weight', from: puKg(row.net_weight), to: puKg(net) });
  if (PU.editAtt)            changes.push({ field: 'Attachment', from: row.file_name || null, to: PU.editAtt.filename });
  else if (PU.editAtt === null) changes.push({ field: 'Attachment', from: row.file_name || null, to: null });
  if (!changes.length) { showToast('No changes were made.'); closePuEdit(); return; }

  const reason = await askReason({ title: 'Reason for Changes', intro: 'Please explain why this purchase is being changed. It is saved in the Activity Log.', confirmLabel: 'Confirm & Save', changes });
  if (!reason) return;
  const body = { ...v, reason };
  if (PU.editAtt) body.attachment = { path: PU.editAtt.path, filename: PU.editAtt.filename, size: PU.editAtt.size };
  else if (PU.editAtt === null) body.remove_attachment = true;

  const btn = document.getElementById('pue-save');
  PU.editBusy = true; btn.disabled = true;
  try {
    await Purchases.update(row.id, body);
    PU.editAtt = undefined;                                              // the new file now belongs to the purchase
    closePuEdit();
    showToast('Purchase updated.');
    loadPuList();
  } catch (e) {
    err.textContent = e.message || 'Could not save the changes.';
  } finally {
    PU.editBusy = false; btn.disabled = false;
  }
}

async function deletePurchase(id) {
  const row = PU.list.find(r => String(r.id) === String(id));
  if (!row) return;
  const reason = await askReason({
    title: 'Delete this purchase?',
    intro: `<strong>${esc(row.supplier)}</strong> · ${esc(row.item_name)} · ${esc(puKg(row.net_weight))} · ${esc(fmtDate(row.purchase_date))}${row.has_file ? '<br>The attached file will be deleted too.' : ''}<br>Please explain why it is being deleted. This is saved in the Activity Log.`,
    confirmLabel: 'Delete purchase', danger: true,
  });
  if (!reason) return;
  try { await Purchases.remove(row.id, reason); showToast('Purchase deleted.'); loadPuList(); }
  catch (e) { showToast('' + (e.message || 'Delete failed.'), true); }
}


/* ═══════════════════════════════════════════════════════════════════════════════
   PERMISSIONS (Admin) — choose what each person can see and do
   ═══════════════════════════════════════════════════════════════════════════════ */
const PERM = { data: null, id: null, wanted: new Set(), busy: false };

async function initPermissions() { await loadPermissions(); }

async function loadPermissions() {
  try { PERM.data = await Permissions.get(); }
  catch (e) { showToast('' + (e.message || 'Could not load the permissions.'), true); return; }
  document.getElementById('perm-setup').hidden = PERM.data.column_ready !== false;
  renderPermPeople();
  const keep = PERM.id && permPerson(PERM.id);
  if (keep) selectPermPerson(PERM.id); else { PERM.id = null; document.getElementById('perm-editor').innerHTML = '<p class="perm-empty">Choose a person on the left to see and change what they can do.</p>'; }
  loadReminderSettings();
}

const permPerson = id => (PERM.data ? PERM.data.users : []).find(u => String(u.id) === String(id));
const permCatalog = key => PERM.data.catalog.find(c => c.key === key);
const permDefaults = role => PERM.data.role_defaults[role] || [];

function renderPermPeople() {
  const box = document.getElementById('perm-people');
  box.innerHTML = PERM.data.users.map(u => {
    const tags = [
      u.active ? '' : '<span class="perm-tag perm-tag-gray">Inactive</span>',
      u.role === 'admin' ? '<span class="perm-tag perm-tag-gray">Everything</span>' : '',
      u.extra && u.extra.length ? `<span class="perm-tag perm-tag-extra">+${u.extra.length} extra</span>` : '',
      u.removed && u.removed.length ? `<span class="perm-tag perm-tag-removed">−${u.removed.length} removed</span>` : '',
    ].join('');
    return `<button type="button" class="perm-person${String(u.id) === String(PERM.id) ? ' active' : ''}" role="option" aria-selected="${String(u.id) === String(PERM.id)}" data-id="${esc(u.id)}" onclick="selectPermPerson('${esc(u.id)}')">
      <span class="perm-person-name">${esc(u.name)}</span>
      <span class="perm-person-meta"><span class="pill ${ROLE_PILL[u.role] || 'pill-gray'}">${esc(capitalize(u.role))}</span>${tags}</span>
    </button>`;
  }).join('') || '<p class="perm-empty">No people yet.</p>';
}

function selectPermPerson(id) {
  const u = permPerson(id);
  if (!u) return;
  PERM.id = u.id;
  PERM.wanted = new Set(u.effective);
  renderPermPeople();
  renderPermEditor();
}

/** What the person would see if the choices on screen were saved. */
const permTabsPreview = () => TAB_ORDER.filter(t => TAB_PERMS[t].some(k => PERM.wanted.has(k))).map(t => TAB_LABELS[t]);

function permChanges() {
  const u = permPerson(PERM.id), now = new Set(u.effective), out = [];
  PERM.data.catalog.forEach(c => {
    if (now.has(c.key) !== PERM.wanted.has(c.key)) out.push({ field: `${c.group} › ${c.label}`, from: now.has(c.key) ? 'On' : 'Off', to: PERM.wanted.has(c.key) ? 'On' : 'Off' });
  });
  return out;
}

function renderPermEditor() {
  const u = permPerson(PERM.id), box = document.getElementById('perm-editor');
  if (!u) return;
  if (u.role === 'admin') {
    box.innerHTML = `<h3 class="perm-editor-title">${esc(u.name)} <span class="pill ${ROLE_PILL.admin}">Admin</span></h3>
      <p class="perm-empty">An Admin always has every permission, so there is nothing to switch on or off here.</p>`;
    return;
  }
  const defaults = new Set(permDefaults(u.role));
  const groups = PERM.data.groups.map(g => {
    const rows = PERM.data.catalog.filter(c => c.group === g).map(c => {
      const on = PERM.wanted.has(c.key);
      const locked = c.admin_only;
      const tag = locked ? '<span class="perm-tag perm-tag-gray">Admins only</span>'
        : on && !defaults.has(c.key) ? '<span class="perm-tag perm-tag-extra">Extra</span>'
        : !on && defaults.has(c.key) ? '<span class="perm-tag perm-tag-removed">Removed</span>' : '';
      return `<label class="perm-row${locked ? ' locked' : ''}">
        <input type="checkbox" data-key="${esc(c.key)}" ${on ? 'checked' : ''} ${locked ? 'disabled' : ''} onchange="onPermToggle(this)">
        <span class="perm-text"><strong>${esc(c.label)}</strong><small>${esc(c.desc)}${c.requires ? ` Needs “${esc(permCatalog(c.requires).label)}”.` : ''}</small></span>
        ${tag}
      </label>`;
    }).join('');
    return `<fieldset class="perm-group"><legend>${esc(g)}</legend>${rows}</fieldset>`;
  }).join('');
  const changes = permChanges();
  box.innerHTML = `
    <div class="perm-editor-head">
      <h3 class="perm-editor-title">${esc(u.name)} <span class="pill ${ROLE_PILL[u.role] || 'pill-gray'}">${esc(capitalize(u.role))}</span>${u.active ? '' : ' <span class="perm-tag perm-tag-gray">Inactive</span>'}</h3>
      <p class="perm-preview" id="perm-preview"></p>
    </div>
    ${groups}
    <div class="form-error" id="perm-error" role="alert"></div>
    <div class="btn-group perm-actions">
      <button type="button" class="btn btn-primary" id="perm-save" onclick="savePermissions()" ${changes.length ? '' : 'disabled'}>Save changes</button>
      <button type="button" class="btn btn-outline" id="perm-discard" onclick="selectPermPerson('${esc(u.id)}')" ${changes.length ? '' : 'disabled'}>Discard</button>
      <button type="button" class="btn btn-outline" id="perm-reset" onclick="resetPermissions()">Back to ${esc(capitalize(u.role))} defaults</button>
    </div>`;
  updatePermPreview();
}

function updatePermPreview() {
  const el = document.getElementById('perm-preview');
  if (!el) return;
  const tabs = permTabsPreview();
  el.innerHTML = tabs.length ? `They will see these tabs: <strong>${esc(tabs.join(' · '))}</strong>` : '<strong>They will see no tabs at all</strong> — they would just be told to ask an Admin.';
}

/** Ticking a feature also ticks what it needs; unticking one also unticks what needs it. */
function onPermToggle(input) {
  const key = input.dataset.key, on = input.checked, notes = [];
  if (on) {
    let req = permCatalog(key).requires;
    while (req && !PERM.wanted.has(req)) { PERM.wanted.add(req); notes.push(permCatalog(req).label); req = permCatalog(req).requires; }
    PERM.wanted.add(key);
  } else {
    const drop = k => PERM.data.catalog.filter(c => c.requires === k).forEach(c => { if (PERM.wanted.delete(c.key)) { notes.push(c.label); drop(c.key); } });
    PERM.wanted.delete(key); drop(key);
  }
  const u = permPerson(PERM.id);
  renderPermEditor();
  const e = document.getElementById('perm-error');
  if (notes.length && e) e.textContent = on ? `Also switched on: ${notes.join(', ')} (needed for this).` : `Also switched off: ${notes.join(', ')} (they depend on it).`;
  const el = document.querySelector(`#perm-editor input[data-key="${key}"]`);
  if (el) el.focus();
}

async function savePermissions() {
  const u = permPerson(PERM.id);
  if (!u || PERM.busy) return;
  const changes = permChanges();
  if (!changes.length) { showToast('No changes were made.'); return; }
  const reason = await askReason({ title: 'Reason for Changes', intro: `Please explain why <strong>${esc(u.name)}</strong>'s permissions are being changed. It is saved in the Activity Log.`, confirmLabel: 'Confirm & Save', changes });
  if (!reason) return;
  await sendPermissions(u, () => Permissions.save(u.id, [...PERM.wanted], reason), `Permissions saved for ${u.name}.`);
}

async function resetPermissions() {
  const u = permPerson(PERM.id);
  if (!u || PERM.busy) return;
  const defaults = new Set(permDefaults(u.role)), now = new Set(u.effective), changes = [];
  PERM.data.catalog.forEach(c => { if (defaults.has(c.key) !== now.has(c.key)) changes.push({ field: `${c.group} › ${c.label}`, from: now.has(c.key) ? 'On' : 'Off', to: defaults.has(c.key) ? 'On' : 'Off' }); });
  if (!changes.length) { showToast(`${u.name} already has exactly the ${capitalize(u.role)} defaults.`); return; }
  const reason = await askReason({ title: `Back to ${capitalize(u.role)} defaults`, intro: `Please explain why <strong>${esc(u.name)}</strong> is being put back to the ${esc(capitalize(u.role))} defaults. It is saved in the Activity Log.`, confirmLabel: 'Confirm & Reset', changes });
  if (!reason) return;
  await sendPermissions(u, () => Permissions.reset(u.id, reason), `${u.name} is back to the ${capitalize(u.role)} defaults.`);
}

async function sendPermissions(u, call, okMessage) {
  PERM.busy = true;
  const err = document.getElementById('perm-error');
  try {
    await call();
    showToast(okMessage);
    await loadPermissions();
  } catch (e) {
    if (err) err.textContent = e.message || 'Could not save the permissions.';
    else showToast('' + (e.message || 'Could not save the permissions.'), true);
  } finally {
    PERM.busy = false;
  }
}
