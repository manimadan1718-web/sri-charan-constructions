/* ═══════════════════════════════════════════════════════════════════════════════
   Data Entry → "+ Add Entry": any number of vehicle entries, saved together with one Save.
   The Date, Site and Category stay as they are; "+ Add Entry" puts the vehicle that is on the form into the list below
   and clears the vehicle fields for the next one. "Save Entry" then saves the whole list (plus the vehicle still on the form).
   Loaded after app.js. It REPLACES app.js's single-entry saveEntry (this later definition is the one the Save button calls);
   it reuses app.js's helpers (getVehicleValue, photoPath, pgPayload, ensureDieselStock, askConfirm, Entries …).
   ═══════════════════════════════════════════════════════════════════════════════ */
const EQ = { items: [] };          // [{ payload }] — entries waiting for the one Save
const EQ_MAX = 40;
const eqVal = id => document.getElementById(id).value;

/** Checks the form and returns the entry to save, or null (with a message shown). */
async function eqReadForm() {
  const date = eqVal('f-date'), vehicle_no = getVehicleValue('f');
  if (!date || !vehicle_no) { showToast('Date and Vehicle No. are required.', true); return null; }
  const siteEl = document.getElementById('f-site');
  if (!siteEl.value.trim()) {
    siteEl.setAttribute('aria-invalid', 'true'); siteEl.focus();
    siteEl.addEventListener('change', () => siteEl.removeAttribute('aria-invalid'), { once: true });
    showToast('Select the site.', true); return null;
  }
  if (photosBusy('f')) { showToast('Please wait — the photo is still uploading.', true); return null; }
  if (pgBusy()) { showToast('Please wait — a progress photo is still uploading.', true); return null; }
  if ((parseFloat(eqVal('f-diesel')) || 0) > 0 && !(await ensureDieselStock(siteEl.value.trim(), date))) return null;     // diesel is taken from the site's stock: add it first
  return {
    date, vehicle_no,
    start_photo: photoPath('f-start'), close_photo: photoPath('f-close'), diesel_photo: photoPath('f-diesel'),
    site: siteEl.value.trim(), category: eqVal('f-category'),
    start_reading: eqVal('f-start').trim(), close_reading: eqVal('f-close').trim(), working_hours: eqVal('f-hours').trim(),
    diesel: parseFloat(eqVal('f-diesel')) || 0, loads: parseInt(eqVal('f-loads')) || 0,
    operator: getOperatorValue('f'), remarks: eqVal('f-remarks').trim(),
    progress_photos: pgPayload(),
  };
}

/** Clears only what belongs to one vehicle; Date, Site and Category stay for the next one. */
function eqClearVehicle() {
  const hint = document.getElementById('f-diesel-stock'); if (hint) hint.hidden = true;
  ['f-vehicle', 'f-vehicle-text', 'f-start', 'f-close', 'f-hours', 'f-diesel', 'f-loads', 'f-operator', 'f-operator-text', 'f-remarks'].forEach(id => { document.getElementById(id).value = ''; });
  toggleCategoryFields('f');
  resetCalcHint();
  releasePhotos('f', false);       // the photos now belong to the listed entry — keep them
  pgReset(true);                   // …and so do the progress pictures
}

async function addEntryToList() {
  if (EQ.items.length >= EQ_MAX) { showToast(`You can list up to ${EQ_MAX} entries at a time. Save these first.`, true); return; }
  const p = await eqReadForm(); if (!p) return;
  if (EQ.items.some(x => x.payload.date === p.date && x.payload.site === p.site && x.payload.vehicle_no.toLowerCase() === p.vehicle_no.toLowerCase())) {
    const again = await askConfirm({ title: 'Add this vehicle again?', message: `${p.vehicle_no} is already in the list for ${fmtDate(p.date)} at ${p.site}.`, yesLabel: 'Add again', noLabel: 'No' });
    if (!again) return;
  }
  EQ.items.push({ payload: p });
  eqClearVehicle(); eqRender();
  showToast(`Added (${EQ.items.length}). Fill the next vehicle, or press Save to save all.`);
  const v = document.getElementById('f-vehicle'); if (v && v.scrollIntoView) v.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function eqRemove(i) {
  const x = EQ.items[i]; if (!x) return;
  [x.payload.start_photo, x.payload.close_photo, x.payload.diesel_photo].filter(Boolean).forEach(discardPendingPhoto);        // photos that were never saved are thrown away
  (x.payload.progress_photos || []).forEach(pp => { if (pp.path) Uploads.discardProgress(pp.path).catch(() => {}); });
  EQ.items.splice(i, 1); eqRender();
}

function eqRender() {
  const card = document.getElementById('eq-card'), list = document.getElementById('eq-list'), btn = document.getElementById('save-entry-btn');
  if (!card) return;
  const n = EQ.items.length, formHas = !!getVehicleValue('f');
  card.hidden = !n;
  if (btn) btn.textContent = n + (formHas ? 1 : 0) > 1 ? `Save ${n + (formHas ? 1 : 0)} Entries` : 'Save Entry';
  if (!n) { list.innerHTML = ''; return; }
  const d = EQ.items.reduce((a, x) => a + x.payload.diesel, 0), l = EQ.items.reduce((a, x) => a + x.payload.loads, 0);
  document.getElementById('eq-title').textContent = `Entries ready to save (${n})`;
  document.getElementById('eq-sum').textContent = `Diesel ${num2(d)} L · Loads ${l}`;
  list.innerHTML = EQ.items.map((x, i) => {
    const p = x.payload, bits = [fmtDate(p.date), p.site, p.start_reading && p.close_reading ? `${p.start_reading} → ${p.close_reading}` : '', p.working_hours && `${p.working_hours} hrs`, p.diesel ? `${num2(p.diesel)} L diesel` : '', p.loads ? `${p.loads} loads` : '', p.operator].filter(Boolean).map(esc).join(' · ');
    return `<li class="eq-item"><span class="eq-n">${i + 1}</span><div class="eq-body"><strong>${esc(p.vehicle_no)}</strong><span>${bits}</span></div><button type="button" class="btn btn-outline btn-sm" onclick="eqRemove(${i})" aria-label="Remove ${esc(p.vehicle_no)} from the list">Remove</button></li>`;
  }).join('');
}

/** The Save button: saves everything in the list, plus the vehicle still on the form (if there is one). */
async function saveEntry() {
  let current = null;
  if (getVehicleValue('f') || !EQ.items.length) { current = await eqReadForm(); if (!current) return; }
  const all = [...EQ.items.map(x => x.payload), ...(current ? [current] : [])];
  const message = all.length === 1 ? `${fmtDate(current.date)} · ${current.site} · ${current.vehicle_no}`
    : `${all.length} entries: ${all.slice(0, 6).map(p => p.vehicle_no).join(', ')}${all.length > 6 ? ` and ${all.length - 6} more` : ''}`;
  const sure = await askConfirm({ title: all.length === 1 ? 'Save this entry?' : `Save these ${all.length} entries?`, message });
  if (!sure) return;                                     // "No": nothing is saved, and everything typed stays as it is

  let saved = 0, lastOk = null;
  for (const p of all) {
    try {
      await Entries.create(p); saved++; lastOk = p;
      if (p !== current) EQ.items.shift();               // (the list is saved in order, so the first one is the one just saved)
    } catch (e) {
      eqRender();
      showToast(`${saved ? `${saved} saved. ` : ''}${p.vehicle_no} was not saved: ${e.message || 'Save failed.'} The rest are still here.`, true);
      if (saved && lastOk) pickDayBreakup(lastOk.date, lastOk.site);
      return;
    }
  }
  showToast(saved === 1 ? 'Entry saved successfully!' : `${saved} entries saved successfully!`);
  pickDayBreakup(lastOk.date, lastOk.site);              // the daily breakup card jumps to the last saved day and site
  [...new Set(all.filter(p => p.diesel > 0).map(p => `${p.site}|${p.date}`))].forEach(k => { const [s, dt] = k.split('|'); warnIfStockLow(s, dt); });
  if (current) releasePhotos('f', false);                // the photos now belong to the entry — keep them
  pgReset(true);
  clearForm(); eqRender();
  loadUnloadPoints();                                    // a new point name may have been used
}

// the button text follows what is on the form, and a list that is not saved yet is not lost by accident
document.addEventListener('input', ev => { if (ev.target && /^f-(vehicle|vehicle-text)$/.test(ev.target.id)) eqRender(); });
document.addEventListener('change', ev => { if (ev.target && /^f-(vehicle|vehicle-text)$/.test(ev.target.id)) eqRender(); });
window.addEventListener('beforeunload', ev => { if (EQ.items.length) { ev.preventDefault(); ev.returnValue = ''; } });
