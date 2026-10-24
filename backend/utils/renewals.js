/**
 * Renewals (insurance, permits, licences, subscriptions …) and their reminders.
 *
 *  • A renewal has a TYPE, a RENEWAL DATE, a description, an amount, who paid, and any number of documents.
 *  • While it is not marked renewed, the Owner and Admin (everyone who may "see renewals") get REMINDERS:
 *      – they START a set number of days before the renewal date (default 7 = one week),
 *      – and REPEAT every N hours or N days (default every 1 hour), until it is marked renewed.
 *      – once the date has passed they keep going, as "overdue".
 *    The Admin changes those settings in the Permissions tab.
 *  • A reminder is ONE row per renewal per person. Each time the interval passes it is "sent" again: the row is refreshed and
 *    shows as unread again — so the bell never fills up with hundreds of copies.
 *  • The check runs on the server every minute, AND whenever someone opens the app (so a server that was asleep catches up at once).
 * Dates are in Indian time (IST), the way the people using the app think of "today".
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');
const perms = require('./permissions');

const TYPE_SUGGESTIONS = [
  'Vehicle Insurance', 'Fitness Certificate (FC)', 'Road Tax', 'Permit', 'Pollution Certificate (PUC)', 'Driving Licence',
  'Machine / Equipment Insurance', 'Equipment AMC / Service', 'Site Licence / Approval', 'Software Subscription',
  'Internet / Phone Plan', 'Rent / Lease', 'Other',
];
const MAX_AMOUNT = 9999999999.99;
const MAX_FILES = 10;
const DAY = 86400000, HOUR = 3600000, IST = 5.5 * HOUR;

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const keyOf = v => clean(v, 120).toLowerCase();
const round2 = n => Math.round((Number(n) || 0) * 100 + 1e-9) / 100;
const money = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ── dates ─────────────────────────────────────────────────────────────────────────────── */
const todayIST = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);
const validDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const dayNumber = s => Math.round(Date.parse(s + 'T00:00:00Z') / DAY);
const daysLeft = (dateStr, today) => dayNumber(String(dateStr).slice(0, 10)) - dayNumber(today);
const dmy = d => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '');
const addDays = (dateStr, n) => new Date(Date.parse(dateStr + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

/* ── one renewal ───────────────────────────────────────────────────────────────────────── */
/** Body → { fields } or { error }. */
function parseRenewal(b) {
  b = b || {};
  const renewal_type = clean(b.renewal_type, 80);
  if (!renewal_type) return { error: 'Choose or type the type of renewal (for example Vehicle Insurance).' };
  const date = String(b.renewal_date == null ? '' : b.renewal_date).trim();
  if (!date) return { error: 'Choose the renewal date.' };
  if (!validDay(date) || date < '2000-01-01' || date > '2100-12-31') return { error: 'The renewal date is not a valid date.' };
  let amount = 0;
  if (b.amount !== undefined && b.amount !== null && String(b.amount).trim() !== '') {
    const n = Number(String(b.amount).replace(/,/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return { error: 'The amount must be a number of 0 or more.' };
    amount = round2(n);
  }
  return { fields: { renewal_type, renewal_date: date, description: clean(b.description, 500), amount, paid_by: clean(b.paid_by, 120) } };
}

/** 'renewed' · 'overdue' · 'today' · 'soon' (inside the reminder window) · 'upcoming' (further away). */
function stateOf(r, today, startDays) {
  if (r.status === 'renewed') return 'renewed';
  const d = daysLeft(r.renewal_date, today);
  return d < 0 ? 'overdue' : d === 0 ? 'today' : d <= startDays ? 'soon' : 'upcoming';
}

/** "Overdue by 3 days" · "Due today" · "Due in 5 days (30/10/2026)" … */
function whenText(state, d, date) {
  const n = Math.abs(d), s = n === 1 ? '' : 's';
  if (state === 'overdue') return `Overdue by ${n} day${s} (was due ${dmy(date)})`;
  if (state === 'today') return `Due TODAY (${dmy(date)})`;
  return `Due in ${n} day${s} (${dmy(date)})`;
}
function alertText(r, today) {
  const d = daysLeft(r.renewal_date, today), state = d < 0 ? 'overdue' : d === 0 ? 'today' : 'soon';
  const bits = [whenText(state, d, r.renewal_date)];
  if (Number(r.amount) > 0) bits.push(`₹${money(r.amount)}`);
  if (r.paid_by) bits.push(`paid by ${r.paid_by}`);
  return { state, days_left: d, title: r.renewal_type, body: bits.join(' · ') };
}

/* ── reminder settings (chosen by the Admin) ───────────────────────────────────────────── */
const DEFAULT_SETTINGS = { enabled: true, start_days: 7, repeat_every: 1, repeat_unit: 'hours' };
const LIMITS = { start_days: [1, 365], hours: [1, 168], days: [1, 30] };

/** Body → { settings } or { error }. Missing parts keep the default. */
function parseSettings(b, base = DEFAULT_SETTINGS) {
  b = b || {};
  const s = { ...base };
  if (b.enabled !== undefined) { if (typeof b.enabled !== 'boolean') return { error: 'Reminders must be switched on or off.' }; s.enabled = b.enabled; }
  const int = v => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN);
  if (b.start_days !== undefined) {
    const n = int(b.start_days);
    if (!Number.isInteger(n) || n < LIMITS.start_days[0] || n > LIMITS.start_days[1]) return { error: `Start reminding between ${LIMITS.start_days[0]} and ${LIMITS.start_days[1]} days before the renewal date.` };
    s.start_days = n;
  }
  if (b.repeat_unit !== undefined) { if (!['hours', 'days'].includes(b.repeat_unit)) return { error: 'Repeat every N hours or N days.' }; s.repeat_unit = b.repeat_unit; }
  if (b.repeat_every !== undefined) { const n = int(b.repeat_every); if (!Number.isInteger(n) || n < 1) return { error: 'Repeat after a whole number of hours or days: 1 or more.' }; s.repeat_every = n; }
  const [lo, hi] = LIMITS[s.repeat_unit];
  if (s.repeat_every < lo || s.repeat_every > hi) return { error: `Repeat every ${lo} to ${hi} ${s.repeat_unit}.` };
  return { settings: s };
}
const intervalMs = s => s.repeat_every * (s.repeat_unit === 'days' ? DAY : HOUR);
const unitText = s => (s.repeat_every === 1 ? (s.repeat_unit === 'days' ? 'day' : 'hour') : `${s.repeat_every} ${s.repeat_unit}`);
function settingsText(s) {
  if (!s.enabled) return 'Reminders are switched off.';
  return `Reminders start ${s.start_days} day${s.start_days === 1 ? '' : 's'} before the renewal date and repeat every ${unitText(s)} until the renewal is marked as renewed. Overdue renewals keep reminding.`;
}

const isMissing = (err, table) => !!err && new RegExp(table, 'i').test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));
const isMissingRenewals = err => isMissing(err, 'renewal') || isMissing(err, 'app_settings');
const RENEWALS_SETUP_MESSAGE = 'Renewals need a one-time database update. Run run-in-supabase-9-renewals.sql in Supabase > SQL Editor, then try again.';

async function getSettings() {
  try {
    const { data, error } = await supabase.from('app_settings').select('*').eq('key', 'renewal_reminders').maybeSingle();
    if (error) throw error;
    return { settings: data && data.value ? parseSettings(data.value).settings || DEFAULT_SETTINGS : DEFAULT_SETTINGS, updated_by_name: data && data.updated_by_name, updated_at: data && data.updated_at };
  } catch (err) {
    if (isMissing(err, 'app_settings')) return { settings: DEFAULT_SETTINGS, setup_required: true };
    throw err;
  }
}
async function saveSettings(settings, user) {
  const row = { key: 'renewal_reminders', value: settings, updated_at: new Date().toISOString(), updated_by_name: user && user.name };
  const { data: have, error: gErr } = await supabase.from('app_settings').select('key').eq('key', 'renewal_reminders').maybeSingle();
  if (gErr) throw gErr;
  const { error } = have ? await supabase.from('app_settings').update(row).eq('key', 'renewal_reminders') : await supabase.from('app_settings').insert(row);
  if (error) throw error;
}

/* ── the reminder engine ───────────────────────────────────────────────────────────────── */
/** People who get reminders: active users who may see renewals. */
async function recipients() {
  const { data, error } = await supabase.from('users').select('id, name, role, active, permissions');
  if (error) throw error;
  return (data || []).filter(u => u.active !== false && perms.effectivePermissions(u.role, u.permissions).includes('renewals.view')).map(u => ({ id: String(u.id), name: u.name }));
}

/** Active renewals that are inside the reminder window (or overdue). */
async function inWindow(settings, now) {
  const limit = addDays(todayIST(now), settings.start_days);
  const { data, error } = await fetchAll(() => supabase.from('renewals').select('*').eq('status', 'active').lte('renewal_date', limit).order('renewal_date', { ascending: true }).order('id', { ascending: true }), 5000);
  if (error) throw error;
  return data;
}
async function alertsFor(ids, userIds) {
  let rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const r = await supabase.from('renewal_alerts').select('*').in('renewal_id', ids.slice(i, i + 100));
    if (r.error) throw r.error;
    rows = rows.concat((r.data || []).filter(a => !userIds || userIds.includes(String(a.user_id))));
  }
  return rows;
}

/**
 * "Sends" every reminder that is due: for each renewal in its window and each person, if it has never been sent, or the repeat interval
 * has passed since the last time, the person's reminder row is created / refreshed (and shows as unread again).
 * only = [{ id }] limits it to those people (used when somebody opens the app).
 */
async function runReminders({ now = Date.now(), only = null } = {}) {
  try {
    const { settings } = await getSettings();
    if (!settings.enabled) return { sent: 0, disabled: true };
    const people = only ? only.map(u => ({ id: String(u.id) })) : await recipients();
    if (!people.length) return { sent: 0 };
    const list = await inWindow(settings, now);
    if (!list.length) return { sent: 0 };
    const alerts = await alertsFor(list.map(r => r.id), people.map(p => p.id));
    const byKey = new Map(alerts.map(a => [`${a.renewal_id}|${a.user_id}`, a]));
    const today = todayIST(now), iso = new Date(now).toISOString(), every = intervalMs(settings);
    let sent = 0;
    for (const r of list) {
      const st = alertText(r, today).state;
      for (const p of people) {
        const have = byKey.get(`${r.id}|${p.id}`);
        if (have && Date.parse(have.last_sent_at) + every > now) continue;                 // not time yet
        // eslint-disable-next-line no-await-in-loop
        const { error } = have
          ? await supabase.from('renewal_alerts').update({ last_sent_at: iso, times: (Number(have.times) || 0) + 1, state: st }).eq('renewal_id', r.id).eq('user_id', p.id)
          : await supabase.from('renewal_alerts').insert({ renewal_id: r.id, user_id: p.id, state: st, last_sent_at: iso, times: 1 });
        if (error) throw error;
        sent++;
      }
    }
    return { sent };
  } catch (err) {
    if (isMissingRenewals(err)) return { sent: 0, setup_required: true };
    throw err;
  }
}

/** What the bell shows for one person (after runReminders has brought it up to date). */
async function listFor(user, now = Date.now()) {
  const { settings, setup_required } = await getSettings();
  const base = { settings, settings_text: settingsText(settings), items: [], unread: 0, setup_required: !!setup_required };
  if (!settings.enabled) return base;
  try {
    const list = await inWindow(settings, now);
    const alerts = await alertsFor(list.map(r => r.id), [String(user.id)]);
    const by = new Map(alerts.map(a => [String(a.renewal_id), a])), today = todayIST(now);
    const items = list.filter(r => by.has(String(r.id))).map(r => {
      const a = by.get(String(r.id)), t = alertText(r, today);
      const unread = !a.read_at || Date.parse(a.read_at) < Date.parse(a.last_sent_at);
      return { renewal_id: r.id, renewal_type: r.renewal_type, description: r.description || '', amount: Number(r.amount) || 0, paid_by: r.paid_by || '', renewal_date: String(r.renewal_date).slice(0, 10),
        days_left: t.days_left, state: t.state, title: t.title, body: t.body, unread, last_sent_at: a.last_sent_at, times: Number(a.times) || 1 };
    });
    return { ...base, items, unread: items.filter(i => i.unread).length };
  } catch (err) {
    if (isMissingRenewals(err)) return { ...base, setup_required: true };
    throw err;
  }
}

async function markRead(user, renewalId, now = Date.now()) {
  let q = supabase.from('renewal_alerts').update({ read_at: new Date(now).toISOString() }).eq('user_id', String(user.id));
  if (renewalId) q = q.eq('renewal_id', renewalId);
  const { error } = await q;
  if (error && !isMissingRenewals(error)) throw error;
}
/** After a renewal's date changes, it is renewed or reopened: start its reminders afresh. */
async function resetAlerts(renewalId) {
  const { error } = await supabase.from('renewal_alerts').delete().eq('renewal_id', renewalId);
  if (error && !isMissingRenewals(error)) throw error;
}

/* ── the clock: every minute on the server ─────────────────────────────────────────────── */
let timer = null;
function start(everyMs = (parseInt(process.env.REMINDER_TICK_SECONDS, 10) || 60) * 1000) {
  if (timer || process.env.REMINDERS_OFF === '1') return;
  timer = setInterval(() => runReminders().catch(e => console.warn('Renewal reminders:', e.message)), everyMs);
  if (timer.unref) timer.unref();
  runReminders().catch(e => console.warn('Renewal reminders:', e.message));
}
const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

module.exports = {
  TYPE_SUGGESTIONS, MAX_AMOUNT, MAX_FILES, DEFAULT_SETTINGS, LIMITS,
  clean, keyOf, round2, money, todayIST, validDay, daysLeft, dmy, addDays, parseRenewal, stateOf, whenText, alertText,
  parseSettings, intervalMs, unitText, settingsText, isMissingRenewals, RENEWALS_SETUP_MESSAGE,
  getSettings, saveSettings, recipients, inWindow, runReminders, listFor, markRead, resetAlerts, start, stop,
};
