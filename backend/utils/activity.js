/**
 * Activity / audit log helpers.
 *
 * Every important action (login, entry create/edit/delete, inventory, users …)
 * is written to the `activity_logs` table. Logging is best-effort: if the table
 * is missing or the insert fails, the user's action still succeeds and the
 * problem is printed to the server console.
 *
 * NEVER put PINs (typed or stored) into a log row.
 */
const supabase = require('../config/supabase');

/* ── Writing a log row ─────────────────────────────────────────────────────── */
function clientIp(req) {
  const raw = req.ip || (req.socket && req.socket.remoteAddress) || '';
  return String(raw).replace(/^::ffff:/, '').slice(0, 64) || null;
}

async function logActivity(req, {
  category, action, entityType = null, entityId = null, entityLabel = null,
  reason = null, changes = null, user = null,
}) {
  try {
    const u = user || req.user || {};
    const row = {
      user_id:      u.id ? String(u.id) : null,
      user_name:    u.name || null,
      user_role:    u.role || null,
      category,
      action,
      entity_type:  entityType,
      entity_id:    entityId ? String(entityId) : null,
      entity_label: entityLabel ? String(entityLabel).slice(0, 200) : null,
      reason:       reason ? String(reason).slice(0, 500) : null,
      changes:      Array.isArray(changes) && changes.length ? changes : null,
      ip:           clientIp(req),
      user_agent:   String(req.headers['user-agent'] || '').slice(0, 300) || null,
    };
    const { error } = await supabase.from('activity_logs').insert(row);
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('activity log failed:', err.message);
    return false;
  }
}

/* ── Reason validation (edits & deletes must explain themselves) ───────────── */
const MIN_REASON = 10;
const MAX_REASON = 500;

function cleanReason(v) {
  return typeof v === 'string' ? v.trim() : '';
}
function reasonError(v, what = 'change an entry') {
  const r = cleanReason(v);
  if (r.length < MIN_REASON) return `A reason of at least ${MIN_REASON} characters is required to ${what}.`;
  if (r.length > MAX_REASON) return `The reason must be ${MAX_REASON} characters or fewer.`;
  return null;
}

/* ── Diff helpers ──────────────────────────────────────────────────────────── */
const norm = v => (v === null || v === undefined ? '' : String(v).trim());

function fmtDateDMY(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(norm(s));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : norm(s);
}

// [column, label, kind]
const ENTRY_FIELDS = [
  ['date',          'Date',         'date'],
  ['site',          'Site',         'text'],
  ['category',      'Category',     'cat'],
  ['vehicle_no',    'Vehicle',      'text'],
  ['start_reading', 'Start',        'text'],
  ['close_reading', 'Close',        'text'],
  ['working_hours', 'Working Hrs',  'text'],
  ['diesel',        'Diesel (L)',   'num'],
  ['loads',         'Loads',        'num'],
  ['operator',      'Operator',     'text'],
  ['remarks',       'Remarks',      'text'],
];

function fmtValue(kind, v) {
  const s = norm(v);
  if (kind === 'cat')  return s === 'rental' ? 'Rental' : 'Own';
  if (s === '')        return null;
  if (kind === 'date') return fmtDateDMY(s);
  if (kind === 'num')  return Number.isFinite(Number(s)) ? String(Number(s)) : s;
  return s;
}

const breakupText = rows =>
  (rows || []).filter(r => norm(r.description) || norm(r.quantity))
    .map(r => `${norm(r.description)}: ${norm(r.quantity)}`).join(' | ') || null;

// Order-insensitive key, so re-ordering alone never counts as a change.
const breakupKey = rows =>
  (rows || []).filter(r => norm(r.description) || norm(r.quantity))
    .map(r => `${norm(r.description)}\u0001${norm(r.quantity)}`).sort().join('\u0002');

/** What changed between the saved entry (with breakup_rows) and the new values. */
function entryDiff(before, afterFields, afterRows) {
  const out = [];
  for (const [col, label, kind] of ENTRY_FIELDS) {
    const a = fmtValue(kind, before[col]);
    const b = fmtValue(kind, afterFields[col]);
    if (a !== b) out.push({ field: label, from: a, to: b });
  }
  if (breakupKey(before.breakup_rows) !== breakupKey(afterRows)) {
    out.push({ field: 'Work Breakup', from: breakupText(before.breakup_rows), to: breakupText(afterRows) });
  }
  return out;
}

/** Every filled-in field of an entry — used for "created" and "deleted" logs. */
function entrySnapshot(fields, rows, side) {
  const out = [];
  for (const [col, label, kind] of ENTRY_FIELDS) {
    const v = fmtValue(kind, fields[col]);
    if (v === null || (kind === 'num' && Number(v) === 0)) continue;
    out.push(side === 'from' ? { field: label, from: v, to: null } : { field: label, from: null, to: v });
  }
  const bt = breakupText(rows);
  if (bt) out.push(side === 'from' ? { field: 'Work Breakup', from: bt, to: null } : { field: 'Work Breakup', from: null, to: bt });
  return out;
}

const entryLabel = f => `${norm(f.vehicle_no)} · ${fmtDateDMY(f.date)}`;

/** Generic before/after diff for simple tables. fields = [[col, label, kind?]] */
function simpleDiff(before, after, fields) {
  const out = [];
  for (const [col, label, kind] of fields) {
    if (!(col in after)) continue;
    const f = v => (kind === 'bool' ? (v === false ? 'Inactive' : 'Active') : (norm(v) === '' ? null : norm(v)));
    const a = f(before[col]);
    const b = f(after[col]);
    if (a !== b) out.push({ field: label, from: a, to: b });
  }
  return out;
}
function simpleSnapshot(row, fields, side) {
  const out = [];
  for (const [col, label, kind] of fields) {
    if (kind === 'bool') continue;
    const v = norm(row[col]);
    if (v === '') continue;
    out.push(side === 'from' ? { field: label, from: v, to: null } : { field: label, from: null, to: v });
  }
  return out;
}

/* ── Table check (printed once at start-up) ────────────────────────────────── */
function isMissingTable(error) {
  const m = `${(error && error.code) || ''} ${(error && error.message) || ''}`;
  return /PGRST205|42P01|activity_logs/i.test(m) && /schema cache|does not exist|PGRST205|42P01|not find/i.test(m);
}
async function checkLogsTable() {
  try {
    const { error } = await supabase.from('activity_logs').select('id').limit(1);
    if (error) {
      console.warn('\n⚠️   Activity log table is missing or unreachable — logging is OFF.');
      console.warn('    Run  run-in-supabase-logs.sql  in Supabase → SQL Editor, then restart.\n');
    }
  } catch { /* ignore */ }
}

module.exports = {
  logActivity, cleanReason, reasonError, MIN_REASON, MAX_REASON,
  entryDiff, entrySnapshot, entryLabel, fmtDateDMY,
  simpleDiff, simpleSnapshot, isMissingTable, checkLogsTable, norm,
};
