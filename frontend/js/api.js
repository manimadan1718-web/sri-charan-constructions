/**
 * API helper — all fetch calls go through here.
 * Token + logged-in user are stored in sessionStorage after login.
 */

const API_BASE = '/api';

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
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 401) {
    clearToken();
    clearUser();
    window.location.href = '/login.html';
    return;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
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
  logout() {
    clearToken();
    clearUser();
    window.location.href = '/login.html';
  },
};

// ── Entries ──────────────────────────────────────────────────────────────────
const Entries = {
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
  delete(id) {
    return apiFetch(`/entries/${id}`, { method: 'DELETE' });
  },
  stats(filters = {}) {
    const params = new URLSearchParams(filters).toString();
    return apiFetch(`/entries/summary-stats${params ? '?' + params : ''}`);
  },
};

// ── Summaries ─────────────────────────────────────────────────────────────────
const Summaries = {
  getAll() {
    return apiFetch('/summaries');
  },
  create(payload) {
    return apiFetch('/summaries', { method: 'POST', body: JSON.stringify(payload) });
  },
  delete(id) {
    return apiFetch(`/summaries/${id}`, { method: 'DELETE' });
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
};
