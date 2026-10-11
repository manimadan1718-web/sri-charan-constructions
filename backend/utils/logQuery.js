/**
 * Shared Activity-Log query helpers (used by the Logs screen, bulk delete and the Excel / PDF export),
 * so "what matches these filters" always means exactly the same thing everywhere.
 */
const supabase = require('../config/supabase');

const CATEGORIES = ['auth', 'entry', 'summary', 'inventory', 'user', 'system', 'document', 'payment'];
const PROTECTED_ACTION = 'logs_deleted';     // the record that says "someone cleaned the log" can never be deleted
const REPORT_TZ = process.env.REPORT_TZ || 'Asia/Kolkata';

function userError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.userMessage = message;
  return err;
}

const isoOrNull = v => {
  if (typeof v !== 'string' || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Cleans the filters sent by the browser. Throws a 400-style error for an unknown category. */
function normalizeFilters(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  if (f.category) {
    if (!CATEGORIES.includes(f.category)) throw userError(400, 'Unknown category.');
    out.category = f.category;
  }
  const from = isoOrNull(f.from), to = isoOrNull(f.to);
  if (from) out.from = from;
  if (to) out.to = to;
  // free-text search over who / what / why (characters that have a special meaning in a filter are removed)
  const term = typeof f.q === 'string' ? f.q.replace(/[,()%*\\"]/g, ' ').trim().slice(0, 60) : '';
  if (term) out.q = term;
  return out;
}

function applyLogFilters(query, filters) {
  let q = query;
  if (filters.category) q = q.eq('category', filters.category);
  if (filters.from) q = q.gte('created_at', filters.from);
  if (filters.to) q = q.lte('created_at', filters.to);
  if (filters.q) q = q.or(`user_name.ilike.%${filters.q}%,entity_label.ilike.%${filters.q}%,reason.ilike.%${filters.q}%`);
  return q;
}

const PAGE = 1000;

/** Every log row matching the filters (newest first), fetched page by page. Stops at `max`. */
async function collectLogs(filters, max = 20000) {
  const out = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await applyLogFilters(
      supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }),
      filters,
    ).range(offset, Math.min(offset + PAGE, max) - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** How many rows match (cheap — no rows are transferred). */
async function countLogs(filters) {
  const { count, error } = await applyLogFilters(supabase.from('activity_logs').select('id', { count: 'exact' }), filters).range(0, 0);
  if (error) throw error;
  return count || 0;
}

/** Rows (id, action, category, created_at) that may be deleted — never the protected record. */
async function collectDeletable(filters) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await applyLogFilters(
      supabase.from('activity_logs').select('id, action, category, created_at').neq('action', PROTECTED_ACTION).order('created_at', { ascending: true }).order('id', { ascending: true }),
      filters,
    ).range(offset, offset + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

const fmtIstDate = iso => new Date(iso).toLocaleDateString('en-GB', { timeZone: REPORT_TZ, day: '2-digit', month: '2-digit', year: 'numeric' });

module.exports = {
  CATEGORIES, PROTECTED_ACTION, userError, isoOrNull,
  normalizeFilters, applyLogFilters, collectLogs, countLogs, collectDeletable, fmtIstDate,
};
