/**
 * API helper — all fetch calls go through here.
 * Token + logged-in user are stored in sessionStorage after login.
 */

const API_BASE = '/api';

/** A one-time note for the next page (shown on the login screen after signing out or when a session ends). */
function flash(message) {
  try { sessionStorage.setItem('scc_flash', message); } catch { /* storage unavailable — the redirect alone still works */ }
}

function getToken() {
  return sessionStorage.getItem('scc_token');
}

function setToken(t) {
  sessionStorage.setItem('scc_token', t);
}

function clearToken() {
  sessionStorage.removeItem('scc_token');
}

function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem('scc_user') || 'null');
  } catch {
    return null;
  }
}

function setUser(u) {
  sessionStorage.setItem('scc_user', JSON.stringify(u));
}

function clearUser() {
  sessionStorage.removeItem('scc_user');
}

async function apiFetch(path, options = {}) {
  const token = getToken();

  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }

  // A downloaded file (report) is returned as it is — reading it as JSON would destroy it.
  if (options.asBlob && res.ok) return res.blob();

  // Not every error response is JSON (proxies, crashes...), so never let a
  // parse failure hide the real status.
  let data = null;
  try { data = await res.json(); } catch { /* leave null */ }

  // An expired/invalid session sends the user back to the login page.
  // The login request itself is excluded: a wrong PIN also returns 401, and
  // redirecting there would reload the page and swallow the error message.
  if (res.status === 401 && path !== '/auth/login') {
    clearToken();
    clearUser();
    flash('Your session has ended. Please sign in again.');
    window.location.href = '/login.html';
    throw new Error((data && data.error) || 'Session expired. Please log in again.');
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status}).`);
    err.status = res.status;
    err.data = data;            // lets callers look at e.g. data.setup_required
    throw err;
  }
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
const Auth = {
  async login(pin) {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  },
  async verify() {
    try {
      const data = await apiFetch('/auth/verify');
      if (data && data.user) setUser(data.user);
      return true;
    } catch {
      return false;
    }
  },
  currentUser() {
    return getUser();
  },
  async logout() {
    // Tell the server first so the sign-out is recorded in the activity log.
    // Never let this block leaving: give up after 1.5 s.
    const token = getToken();
    if (token) {
      try {
        await Promise.race([
          fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true }),
          new Promise(resolve => setTimeout(resolve, 1500)),
        ]);
      } catch { /* offline etc. — just sign out locally */ }
    }
    clearToken();
    clearUser();
    flash('You have been signed out.');
    window.location.href = '/login.html';
  },
};

// ── Entries ──────────────────────────────────────────────────────────────────
const Entries = {
  // Every vehicle number used in an entry (including ones typed in by hand), for the Records filter.
  vehicleNumbers() {
    return apiFetch('/entries/vehicle-numbers');
  },
  getAll(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return apiFetch(`/entries${params ? '?' + params : ''}`);
  },
  create(payload) {
    return apiFetch('/entries', { method: 'POST', body: JSON.stringify(payload) });
  },
  update(id, payload) {
    return apiFetch(`/entries/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  // Deleting needs a written reason (10+ characters) — it goes into the activity log.
  delete(id, reason) {
    return apiFetch(`/entries/${id}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  },
  stats(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return apiFetch(`/entries/summary-stats${params ? '?' + params : ''}`);
  },
  // Names of unloading points used before (for the type-ahead list). Supervisor + Admin.
  unloadPoints() {
    return apiFetch('/entries/unload-points');
  },
};

// ── Users (Admin only) ──────────────────────────────────────────────────────
const Users = {
  getAll() {
    return apiFetch('/users');
  },
  create(payload) {
    return apiFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
  },
  update(id, payload) {
    return apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  delete(id) {
    return apiFetch(`/users/${id}`, { method: 'DELETE' });
  },
};

// ── Inventory (Vehicles + Operators) ─────────────────────────────────────────
const Inventory = {
  getVehicles() {
    return apiFetch('/inventory/vehicles');
  },
  addVehicle(payload) {
    return apiFetch('/inventory/vehicles', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateVehicle(id, payload) {
    return apiFetch(`/inventory/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteVehicle(id) {
    return apiFetch(`/inventory/vehicles/${id}`, { method: 'DELETE' });
  },
  getOperators() {
    return apiFetch('/inventory/operators');
  },
  addOperator(payload) {
    return apiFetch('/inventory/operators', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateOperator(id, payload) {
    return apiFetch(`/inventory/operators/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteOperator(id) {
    return apiFetch(`/inventory/operators/${id}`, { method: 'DELETE' });
  },
  getSites() {
    return apiFetch('/inventory/sites');
  },
  addSite(payload) {
    return apiFetch('/inventory/sites', { method: 'POST', body: JSON.stringify(payload) });
  },
  updateSite(id, payload) {
    return apiFetch(`/inventory/sites/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  deleteSite(id) {
    return apiFetch(`/inventory/sites/${id}`, { method: 'DELETE' });
  },
};

// ── Activity logs (Owner + Admin can read; only Admin can delete) ────────────────────────────────
const Logs = {
  list(params = {}) {
    const clean = Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null);
    const q = new URLSearchParams(clean).toString();
    return apiFetch(`/logs${q ? '?' + q : ''}`);
  },
  forEntry(id) {
    return apiFetch(`/logs/entry/${encodeURIComponent(id)}`);
  },
  entryCounts(ids) {
    return apiFetch('/logs/entry-counts', { method: 'POST', body: JSON.stringify({ ids }) });
  },
  // Admin only. body = { ids: [...] }  or  { filters: {...}, confirm: 'DELETE' }  (several rows need confirm: 'DELETE')
  remove(body) {
    return apiFetch('/logs', { method: 'DELETE', body: JSON.stringify(body) });
  },
};

// ── Photo proof for the Starting / Closing reading ─────────────────────────────
const Uploads = {
  // Sends the (already shrunk) photo as raw bytes. Returns { path } — a "pending" photo that is
  // attached for good when the entry is saved.
  reading(blob) {
    return apiFetch('/uploads/reading', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
  },
  // A link that opens a saved photo for 10 minutes (Owner / Admin).
  signedUrl(path) {
    return apiFetch(`/uploads/reading/url?path=${encodeURIComponent(path)}`);
  },
  // Throws away a photo that was uploaded but never saved with an entry.
  discard(path) {
    return apiFetch('/uploads/reading', { method: 'DELETE', body: JSON.stringify({ path }) });
  },
  // Site Working Progress pictures: the same, for people who may add them.
  progress(blob) {
    return apiFetch('/uploads/progress', { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg' }, body: blob });
  },
  discardProgress(path) {
    return apiFetch('/uploads/progress', { method: 'DELETE', body: JSON.stringify({ path }) });
  },
};

// ── Site Working Progress pictures (Owner / Admin) ───────────────────────────────
const Progress = {
  list(params = {}) {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    return apiFetch('/progress' + (q ? '?' + q : ''));
  },
  remove(id, reason) {
    return apiFetch(`/progress/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  },
};

// ── Reports (Excel / PDF / CSV) ───────────────────────────────────────────────
const Reports = {
  // ids = the records currently on screen, in order. Resolves with the file (a Blob).
  entries(body) {
    return apiFetch('/reports/entries', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
  // { type: 'vehicles' | 'sites' | 'operators', format: 'xlsx' | 'pdf' }   (Admin)
  inventory(body) {
    return apiFetch('/reports/inventory', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
  // { format }   (Admin) — includes deleted users
  users(body) {
    return apiFetch('/reports/users', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
  // { format, ids: [...] }  or  { format, filters: { category, q, from, to } }   (Owner + Admin)
  logs(body) {
    return apiFetch('/reports/logs', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
  // { format, from?, to? }   (Owner + Admin) — the Summary screen
  summary(body) {
    return apiFetch('/reports/summary', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
  // { format: 'xlsx' | 'pdf', kind: 'company' | 'outside' | 'all' }   (Owner + Admin) ? the Payments ledgers and the cumulative report
  payments(body) {
    return apiFetch('/reports/payments', { method: 'POST', body: JSON.stringify(body), asBlob: true });
  },
};

// ── Renewals (Owner + Admin) and their reminders ────────────────────────────────
const rnQuery = o => { const q = Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return q ? '?' + q : ''; };
const Renewals = {
  list(params = {}) { return apiFetch('/renewals' + rnQuery(params)); },
  add(body) { return apiFetch('/renewals', { method: 'POST', body: JSON.stringify(body) }); },
  update(id, body) { return apiFetch(`/renewals/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }); },
  remove(id, reason) { return apiFetch(`/renewals/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }); },
  renew(id, body) { return apiFetch(`/renewals/${encodeURIComponent(id)}/renew`, { method: 'POST', body: JSON.stringify(body || {}) }); },
  reopen(id, reason) { return apiFetch(`/renewals/${encodeURIComponent(id)}/reopen`, { method: 'POST', body: JSON.stringify({ reason }) }); },
  // The file is sent as the raw request body; its name goes in the address.
  uploadFile(id, file) { return apiFetch(`/renewals/${encodeURIComponent(id)}/files?filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); },
  viewLink(fid) { return apiFetch(`/renewals/files/${encodeURIComponent(fid)}/view-link`); },
  fileUrl(fid) { return apiFetch(`/renewals/files/${encodeURIComponent(fid)}/url`); },
  removeFile(fid, reason) { return apiFetch(`/renewals/files/${encodeURIComponent(fid)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }); },
  settings() { return apiFetch('/renewals/settings'); },                                                     // Admin (Permissions tab)
  saveSettings(body) { return apiFetch('/renewals/settings', { method: 'PUT', body: JSON.stringify(body) }); },
};
const Notifications = {
  list() { return apiFetch('/notifications'); },                                                             // the bell
  read(renewalId) { return apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify(renewalId ? { renewal_id: renewalId } : {}) }); },
};

// ── Documents (Owner + Admin) ─────────────────────────────────────────────────
const Documents = {
  list(params = {}) {
    const clean = Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null);
    const q = new URLSearchParams(clean).toString();
    return apiFetch(`/documents${q ? '?' + q : ''}`);
  },
  // Sends the file as the raw request body (details in the address). XMLHttpRequest is used instead of fetch
  // only because it can report upload progress. Resolves with the saved document.
  upload(file, meta, onProgress) {
    return new Promise((resolve, reject) => {
      const qs = new URLSearchParams({ ...meta, filename: file.name }).toString();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/documents?${qs}`);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = ev => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total); };
      xhr.onerror = () => reject(new Error('Cannot reach the server. Check your connection and try again.'));
      xhr.onabort = () => reject(new Error('The upload was cancelled.'));
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status === 401) { clearToken(); clearUser(); flash('Your session has ended. Please sign in again.'); window.location.href = '/login.html'; return reject(new Error('Session expired. Please log in again.')); }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const err = new Error((data && data.error) || `Upload failed (${xhr.status}).`);
        err.status = xhr.status; err.data = data;
        reject(err);
      };
      xhr.send(file);
    });
  },
  update(id, payload) {
    return apiFetch(`/documents/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  // A link that DOWNLOADS the file (valid for 10 minutes).
  url(id) {
    return apiFetch(`/documents/${encodeURIComponent(id)}/url`);
  },
  // A link that SHOWS the file (PDF, pictures, text) in a new tab (valid for 2 minutes).
  viewLink(id) {
    return apiFetch(`/documents/${encodeURIComponent(id)}/view-link`);
  },
  // The same kind of link, for the print view (recorded in the Activity Log as a print).
  printLink(id) {
    return apiFetch(`/documents/${encodeURIComponent(id)}/view-link?purpose=print`);
  },
  remove(id) {
    return apiFetch(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

// ── Payments (Supervisor adds · Owner + Admin see · Admin edits) ───────────────
const Payments = {
  // params = { from, to, name, paid_by, status, q } — all optional (empty ones are left out)
  list(kind, params = {}) { return apiFetch('/payments' + payQuery({ ...(kind ? { kind } : {}), ...params })); },       // saved lines of a kind (Owner / Admin)
  summary(params = {}) { return apiFetch('/payments/summary' + payQuery(params)); },                                    // the cumulative picture (Owner / Admin)
  mine() { return apiFetch('/payments/mine'); },                                                                        // what THIS person saved recently
  names(kind) { return apiFetch(`/payments/names${kind ? '?kind=' + encodeURIComponent(kind) : ''}`); },                // names and "paid by" used before (type-ahead)
  // { kind: 'company' | 'outside', items: [{ pay_date, party_name, item, description, payable, paid, paid_by }] } — all lines saved together, or none
  create(payload) { return apiFetch('/payments', { method: 'POST', body: JSON.stringify(payload) }); },
  update(id, payload) { return apiFetch(`/payments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }); },
  remove(id, reason) { return apiFetch(`/payments/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }); },
};
const payQuery = o => { const q = Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&'); return q ? '?' + q : ''; };

// ── Purchases (Supervisor adds · Owner + Admin see · Admin edits) ──────────────
const Purchases = {
  list(params = {}) {
    const clean = Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null);
    const q = new URLSearchParams(clean).toString();
    return apiFetch(`/purchases${q ? '?' + q : ''}`);
  },
  mine() {
    return apiFetch('/purchases/mine');
  },
  suggestions() {
    return apiFetch('/purchases/suggestions');
  },
  // The file is sent first (as the raw request body; XMLHttpRequest only because it can report progress).
  // Resolves with { attachment: { path, filename, size, ext, format, viewable } }.
  uploadAttachment(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/purchases/attachment?filename=${encodeURIComponent(file.name)}`);
      const token = getToken();
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = ev => { if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total); };
      xhr.onerror = () => reject(new Error('Cannot reach the server. Check your connection and try again.'));
      xhr.onabort = () => reject(new Error('The upload was cancelled.'));
      xhr.onload = () => {
        let data = null;
        try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
        if (xhr.status === 401) { clearToken(); clearUser(); flash('Your session has ended. Please sign in again.'); window.location.href = '/login.html'; return reject(new Error('Session expired. Please log in again.')); }
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        const err = new Error((data && data.error) || `Upload failed (${xhr.status}).`);
        err.status = xhr.status; err.data = data;
        reject(err);
      };
      xhr.send(file);
    });
  },
  // Throw away a file that was attached but never saved with a purchase.
  removeAttachment(path) {
    return apiFetch('/purchases/attachment', { method: 'DELETE', body: JSON.stringify({ path }) });
  },
  create(payload) {
    return apiFetch('/purchases', { method: 'POST', body: JSON.stringify(payload) });
  },
  update(id, payload) {
    return apiFetch(`/purchases/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  },
  remove(id, reason) {
    return apiFetch(`/purchases/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  },
  // mode: 'view' (a 2-minute link that shows the file in a new tab) or 'download'
  fileLink(id, mode = 'view') {
    return apiFetch(`/purchases/${encodeURIComponent(id)}/file-link?mode=${mode === 'download' ? 'download' : 'view'}`);
  },
};

// ── Permissions (Admin) ────────────────────────────────────────────────────────
const Permissions = {
  get() {
    return apiFetch('/permissions');
  },
  // permissions: EVERY permission the person should have after the change; reason: why (10+ characters)
  save(id, permissions, reason) {
    return apiFetch(`/permissions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ permissions, reason }) });
  },
  reset(id, reason) {
    return apiFetch(`/permissions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ reset: true, reason }) });
  },
};
