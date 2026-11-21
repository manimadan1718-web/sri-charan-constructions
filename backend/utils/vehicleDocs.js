/**
 * Vehicle documents: for every vehicle, the due date of its Insurance, Permit, Tax, FC and PUCC, and its registration date.
 * Each document is a normal renewal (type, date, status) that is linked to the vehicle (vehicle_id) and says which document it is (doc_kind),
 * so the reminder bell, "mark renewed" and the activity log all keep working. Needs run-in-supabase-18-vehicle-documents.sql.
 */
const supabase = require('../config/supabase');
const { fetchAll } = require('./db');
const R = require('./renewals');

const KINDS = [
  { key: 'insurance', label: 'Insurance',                 type: 'Vehicle Insurance' },
  { key: 'permit',    label: 'Permit',                    type: 'Permit' },
  { key: 'tax',       label: 'Tax',                       type: 'Road Tax' },
  { key: 'fc',        label: 'FC (Fitness Certificate)',  type: 'Fitness Certificate (FC)' },
  { key: 'pucc',      label: 'PUCC',                      type: 'Pollution Certificate (PUC)' },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.key, k]));
const SETUP_MESSAGE = 'Vehicle documents need a one-time database update. Run run-in-supabase-18-vehicle-documents.sql in Supabase > SQL Editor, then try again.';
const isSetup = err => !!err && /doc_kind|vehicle_id|registration_date/i.test(String(err.message || ''));

/** The row that stands for one vehicle + document: the not-yet-renewed one, else the latest renewed one. */
function pickRow(rows) {
  const live = rows.filter(r => r.status === 'active').sort((a, b) => String(a.renewal_date).localeCompare(String(b.renewal_date)));
  if (live.length) return live[0];
  return rows.slice().sort((a, b) => String(b.renewal_date).localeCompare(String(a.renewal_date)))[0] || null;
}
const cellOf = (r, today, startDays) => (r ? {
  renewal_id: r.id, date: String(r.renewal_date).slice(0, 10), status: r.status,
  state: R.stateOf(r, today, startDays), days_left: R.daysLeft(r.renewal_date, today),
} : null);

async function load() {
  const { settings } = await R.getSettings(), today = R.todayIST();
  const v = await fetchAll(() => supabase.from('vehicles').select('*').order('vehicle_no', { ascending: true }).order('id', { ascending: true }), 5000);
  if (v.error) throw v.error;
  const vehicles = (v.data || []).filter(x => x.active !== false);
  let rows = [], setup_required = false;
  const r = await fetchAll(() => supabase.from('renewals').select('*').not('doc_kind', 'is', null).order('renewal_date', { ascending: true }).order('id', { ascending: true }), 20000);
  if (r.error) { if (isSetup(r.error) || R.isMissingRenewals(r.error)) setup_required = true; else throw r.error; } else rows = r.data || [];
  const by = new Map();
  rows.forEach(x => { const k = `${x.vehicle_id}|${x.doc_kind}`; if (!by.has(k)) by.set(k, []); by.get(k).push(x); });
  const summary = { overdue: 0, today: 0, soon: 0, ok: 0, missing: 0 };
  const data = vehicles.map(x => {
    const docs = {};
    KINDS.forEach(k => {
      const c = cellOf(pickRow(by.get(`${x.id}|${k.key}`) || []), today, settings.start_days);
      docs[k.key] = c;
      if (!c) summary.missing++; else if (c.state === 'overdue') summary.overdue++; else if (c.state === 'today') summary.today++; else if (c.state === 'soon') summary.soon++; else summary.ok++;
    });
    return { id: x.id, vehicle_no: x.vehicle_no, type: x.type || '', registration_date: x.registration_date ? String(x.registration_date).slice(0, 10) : null, docs };
  });
  return { data, summary, kinds: KINDS.map(({ key, label }) => ({ key, label })), setup_required, today, start_days: settings.start_days };
}

/** The Excel / PDF version. */
async function report() {
  const d = await load(), dmy = R.dmy;
  const text = c => (!c ? '' : `${dmy(c.date)}${c.state === 'overdue' ? ' (overdue)' : c.state === 'today' ? ' (due today)' : c.state === 'soon' ? ' (due soon)' : ''}`);
  const columns = [
    { key: 'n', header: 'Sl No', width: 7, weight: 5, align: 'right' },
    { key: 'veh', header: 'Vehicle No', width: 20, weight: 16, bold: true },
    ...KINDS.map(k => ({ key: k.key, header: k.label, width: 22, weight: 14 })),
    { key: 'reg', header: 'Registration date', width: 18, weight: 12 },
  ];
  const rows = d.data.map((v, i) => {
    const row = { n: i + 1, veh: v.vehicle_no, reg: v.registration_date ? dmy(v.registration_date) : '' };
    let bad = false;
    KINDS.forEach(k => { row[k.key] = text(v.docs[k.key]); if (v.docs[k.key] && v.docs[k.key].state === 'overdue') bad = true; });
    if (bad) row._tone = 'danger';
    return row;
  });
  return { title: 'Vehicle Documents', sheet: 'Vehicle documents', columns, rows,
    subtitle: `As on ${dmy(d.today)} · ${d.summary.overdue} overdue · ${d.summary.today + d.summary.soon} due soon · ${d.summary.missing} dates not entered` };
}

module.exports = { KINDS, KIND, SETUP_MESSAGE, isSetup, load, report };
