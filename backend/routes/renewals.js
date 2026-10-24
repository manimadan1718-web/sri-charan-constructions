/**
 * Renewals — insurance, permits, licences, subscriptions … with their documents and reminders.
 *   GET    /api/renewals                         every renewal, soonest first, with documents, state and summary       (renewals.view)
 *   POST   /api/renewals                         add one                                                               (renewals.add)
 *   PUT    /api/renewals/:id                     change one — needs a written reason                                   (renewals.edit)
 *   DELETE /api/renewals/:id                     remove one — needs a written reason                                   (renewals.edit)
 *   POST   /api/renewals/:id/renew               mark it renewed (optionally start the next cycle: { next_date })      (renewals.add)
 *   POST   /api/renewals/:id/reopen              undo "renewed" — needs a written reason                               (renewals.edit)
 *   POST   /api/renewals/:id/files?filename=     attach a document (the raw file is the body)                          (renewals.add)
 *   GET    /api/renewals/files/:fid/view-link    a 2-minute link that SHOWS a PDF / picture                            (renewals.view)
 *   GET    /api/renewals/files/:fid/url          a 10-minute DOWNLOAD link                                             (renewals.view)
 *   DELETE /api/renewals/files/:fid              take a document off a renewal — needs a reason                        (renewals.edit)
 *   GET/PUT /api/renewals/settings               the reminder settings (start N days before, repeat every N hours / days)   (permissions.manage)
 * The document files themselves stay in private storage (nothing in the app deletes a stored file).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const archive = require('../utils/archive');
const { fetchAll } = require('../utils/db');
const docs = require('../utils/documents');
const fileView = require('../utils/fileView');
const R = require('../utils/renewals');

router.use(requireAuth);

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: parseInt(process.env.DOC_UPLOAD_LIMIT, 10) || 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.' },
});
const rawFile = express.raw({ type: () => true, limit: docs.MAX_BYTES });

const publicFile = f => ({ id: f.id, original_filename: f.original_filename, ext: f.ext, format: docs.formatLabel(f.ext), viewable: fileView.isViewable(f.ext), size_bytes: Number(f.size_bytes) || 0, uploaded_by_name: f.uploaded_by_name, created_at: f.created_at });
function publicRenewal(r, files, today, startDays) {
  const d = R.daysLeft(r.renewal_date, today);
  return {
    id: r.id, renewal_type: r.renewal_type, description: r.description || '', amount: Number(r.amount) || 0, renewal_date: String(r.renewal_date).slice(0, 10), paid_by: r.paid_by || '',
    status: r.status, renewed_on: r.renewed_on ? String(r.renewed_on).slice(0, 10) : null, renewed_by_name: r.renewed_by_name || null,
    days_left: d, state: R.stateOf(r, today, startDays), files: (files || []).map(publicFile),
    created_by_name: r.created_by_name, created_at: r.created_at, updated_at: r.updated_at, updated_by_name: r.updated_by_name,
  };
}
function sendError(res, err, where) {
  if (R.isMissingRenewals(err)) return res.status(503).json({ error: R.RENEWALS_SETUP_MESSAGE, setup_required: true });
  return serverError(res, err, where);
}
const label = r => `${r.renewal_type} — ${R.dmy(String(r.renewal_date).slice(0, 10))}`;
const filesOf = async ids => {
  let rows = [];
  for (let i = 0; i < ids.length; i += 100) {
    // eslint-disable-next-line no-await-in-loop
    const r = await supabase.from('renewal_files').select('*').in('renewal_id', ids.slice(i, i + 100)).order('created_at', { ascending: true });
    if (r.error) throw r.error;
    rows = rows.concat(r.data || []);
  }
  return rows;
};
const catchUp = () => R.runReminders().catch(e => console.warn('Renewal reminders:', e.message));     // a new / changed renewal may already be inside its window

/* ── the reminder settings (Permissions tab) ─────────────────────────────────────────────── */
router.get('/settings', requirePerm('permissions.manage'), async (req, res) => {
  try {
    const s = await R.getSettings();
    res.json({ success: true, settings: s.settings, text: R.settingsText(s.settings), limits: R.LIMITS, defaults: R.DEFAULT_SETTINGS, updated_by_name: s.updated_by_name || null, updated_at: s.updated_at || null, setup_required: !!s.setup_required });
  } catch (err) { sendError(res, err, 'GET /renewals/settings'); }
});
router.put('/settings', requirePerm('permissions.manage'), async (req, res) => {
  try {
    const cur = await R.getSettings();
    if (cur.setup_required) return res.status(503).json({ error: R.RENEWALS_SETUP_MESSAGE, setup_required: true });
    const p = R.parseSettings(req.body, cur.settings);
    if (p.error) return res.status(400).json({ error: p.error });
    const a = cur.settings, b = p.settings, changes = [];
    if (a.enabled !== b.enabled) changes.push({ field: 'Reminders', from: a.enabled ? 'On' : 'Off', to: b.enabled ? 'On' : 'Off' });
    if (a.start_days !== b.start_days) changes.push({ field: 'Start reminding', from: `${a.start_days} days before`, to: `${b.start_days} days before` });
    if (a.repeat_every !== b.repeat_every || a.repeat_unit !== b.repeat_unit) changes.push({ field: 'Repeat every', from: `${a.repeat_every} ${a.repeat_unit}`, to: `${b.repeat_every} ${b.repeat_unit}` });
    if (!changes.length) return res.json({ success: true, unchanged: true, settings: b, text: R.settingsText(b) });
    await R.saveSettings(b, req.user);
    await logActivity(req, { category: 'renewal', action: 'reminder_settings_changed', entityType: 'setting', entityLabel: 'Renewal reminders', changes });
    res.json({ success: true, settings: b, text: R.settingsText(b) });
  } catch (err) { sendError(res, err, 'PUT /renewals/settings'); }
});

/* ── documents ───────────────────────────────────────────────────────────────────────────── */
async function fileAndRenewal(req, res) {
  if (!ID_RE.test(req.params.fid)) { res.status(404).json({ error: 'Document not found.' }); return null; }
  const { data: f, error } = await supabase.from('renewal_files').select('*').eq('id', req.params.fid).maybeSingle();
  if (error) throw error;
  if (!f) { res.status(404).json({ error: 'Document not found.' }); return null; }
  const { data: r } = await supabase.from('renewals').select('*').eq('id', f.renewal_id).maybeSingle();
  return { f, r: r || {} };
}
router.get('/files/:fid/view-link', requirePerm('renewals.view'), async (req, res) => {
  try {
    const x = await fileAndRenewal(req, res); if (!x) return;
    if (!fileView.isViewable(x.f.ext)) return res.status(415).json({ error: `${docs.formatLabel(x.f.ext)} files cannot be previewed here. Use Download instead.` });
    if (!(await docs.downloadUrl(x.f.storage_path, 'x'))) return res.status(404).json({ error: 'The file could not be found.' });
    await logActivity(req, { category: 'renewal', action: 'renewal_file_viewed', entityType: 'renewal', entityId: x.f.renewal_id, entityLabel: `${x.f.original_filename} — ${x.r.renewal_type || ''}` });
    res.json({ success: true, url: fileView.makeLink(x.f.storage_path, x.f.original_filename, x.f.ext, req.user.id), expires_in: fileView.VIEW_SECONDS });
  } catch (err) { sendError(res, err, 'GET /renewals/files/:fid/view-link'); }
});
router.get('/files/:fid/url', requirePerm('renewals.view'), async (req, res) => {
  try {
    const x = await fileAndRenewal(req, res); if (!x) return;
    const url = await docs.downloadUrl(x.f.storage_path, x.f.original_filename);
    if (!url) return res.status(404).json({ error: 'The file could not be found.' });
    await logActivity(req, { category: 'renewal', action: 'renewal_file_downloaded', entityType: 'renewal', entityId: x.f.renewal_id, entityLabel: `${x.f.original_filename} — ${x.r.renewal_type || ''}` });
    res.json({ success: true, url, filename: x.f.original_filename, expires_in: 600 });
  } catch (err) { sendError(res, err, 'GET /renewals/files/:fid/url'); }
});
router.delete('/files/:fid', requirePerm('renewals.edit'), async (req, res) => {
  try {
    const rErr = reasonError(req.body && req.body.reason, 'remove a document'); if (rErr) return res.status(400).json({ error: rErr });
    const x = await fileAndRenewal(req, res); if (!x) return;
    await archive.keep(req, { type: 'renewal_file', id: x.f.id, label: `${x.f.original_filename} — ${x.r.renewal_type || ''}`, detail: x.f.original_filename, row: x.f, reason: cleanReason(req.body.reason), files: [{ bucket: docs.BUCKET, path: x.f.storage_path }] });
    const { error } = await supabase.from('renewal_files').delete().eq('id', x.f.id);
    if (error) throw error;
    await logActivity(req, { category: 'renewal', action: 'renewal_file_deleted', entityType: 'renewal', entityId: x.f.renewal_id, entityLabel: `${x.r.renewal_type || ''} — ${x.f.original_filename}`, reason: cleanReason(req.body.reason), changes: [{ field: 'Document', from: x.f.original_filename, to: null }] });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'DELETE /renewals/files/:fid'); }
});

/* ── the list ────────────────────────────────────────────────────────────────────────────── */
router.get('/', requirePerm('renewals.view'), async (req, res) => {
  try {
    const q = req.query, status = q.status === undefined || q.status === '' ? 'all' : q.status;
    if (!['all', 'active', 'renewed'].includes(status)) return res.status(400).json({ error: 'status must be all, active or renewed.' });
    for (const k of ['from', 'to']) if (q[k] && !R.validDay(String(q[k]))) return res.status(400).json({ error: `${k === 'from' ? 'The "from" date' : 'The "to" date'} must be a valid date.` });
    if (q.from && q.to && q.from > q.to) return res.status(400).json({ error: 'The "from" date cannot be after the "to" date.' });
    const { settings, setup_required } = await R.getSettings(), today = R.todayIST();
    const { data, error } = await fetchAll(() => supabase.from('renewals').select('*').order('renewal_date', { ascending: true }).order('id', { ascending: true }), 5000);
    if (error) throw error;
    const files = await filesOf(data.map(r => r.id));
    const by = new Map(); files.forEach(f => { if (!by.has(String(f.renewal_id))) by.set(String(f.renewal_id), []); by.get(String(f.renewal_id)).push(f); });
    const all = data.map(r => publicRenewal(r, by.get(String(r.id)), today, settings.start_days));

    const term = R.clean(q.q, 120).toLowerCase(), type = R.keyOf(q.type);
    let items = all.filter(r => (status === 'all' || (status === 'renewed' ? r.status === 'renewed' : r.status === 'active'))
      && (!type || R.keyOf(r.renewal_type) === type) && (!q.from || r.renewal_date >= q.from) && (!q.to || r.renewal_date <= q.to)
      && (!term || `${r.renewal_type} ${r.description} ${r.paid_by}`.toLowerCase().includes(term)));
    const order = { overdue: 0, today: 1, soon: 2, upcoming: 3, renewed: 4 };
    items = items.sort((a, b) => (order[a.state] - order[b.state]) || (a.state === 'renewed' ? String(b.renewed_on).localeCompare(String(a.renewed_on)) : a.renewal_date.localeCompare(b.renewal_date)));

    const count = s => all.filter(r => r.state === s).length, live = all.filter(r => r.status === 'active');
    const types = [...new Set([...R.TYPE_SUGGESTIONS, ...all.map(r => r.renewal_type)])];
    res.json({
      success: true, data: items, total: all.length, setup_required: !!setup_required,
      summary: { overdue: count('overdue'), today: count('today'), soon: count('soon'), upcoming: count('upcoming'), renewed: count('renewed'),
        active_amount: R.round2(live.reduce((a, r) => a + r.amount, 0)), needs_attention_amount: R.round2(live.filter(r => ['overdue', 'today', 'soon'].includes(r.state)).reduce((a, r) => a + r.amount, 0)) },
      meta: { types, max_files: R.MAX_FILES, max_mb: docs.MAX_MB, settings_text: R.settingsText(settings), today },
    });
  } catch (err) {
    if (R.isMissingRenewals(err)) return res.json({ success: true, data: [], total: 0, setup_required: true, summary: { overdue: 0, today: 0, soon: 0, upcoming: 0, renewed: 0, active_amount: 0, needs_attention_amount: 0 }, meta: { types: R.TYPE_SUGGESTIONS, max_files: R.MAX_FILES, max_mb: docs.MAX_MB, settings_text: R.settingsText(R.DEFAULT_SETTINGS), today: R.todayIST() } });
    sendError(res, err, 'GET /renewals');
  }
});

/* ── add / change / remove ───────────────────────────────────────────────────────────────── */
router.post('/', requirePerm('renewals.add'), async (req, res) => {
  try {
    const p = R.parseRenewal(req.body); if (p.error) return res.status(400).json({ error: p.error });
    const { data, error } = await supabase.from('renewals').insert({ ...p.fields, status: 'active', created_by_id: String(req.user.id), created_by_name: req.user.name }).select('*').single();
    if (error) throw error;
    await logActivity(req, { category: 'renewal', action: 'renewal_added', entityType: 'renewal', entityId: data.id, entityLabel: label(data),
      changes: [{ field: 'Type', from: null, to: p.fields.renewal_type }, { field: 'Renewal date', from: null, to: R.dmy(p.fields.renewal_date) }, ...(p.fields.amount ? [{ field: 'Amount', from: null, to: R.money(p.fields.amount) }] : []), ...(p.fields.paid_by ? [{ field: 'Paid by', from: null, to: p.fields.paid_by }] : [])] });
    await catchUp();
    const { settings } = await R.getSettings();
    res.status(201).json({ success: true, data: publicRenewal(data, [], R.todayIST(), settings.start_days) });
  } catch (err) { sendError(res, err, 'POST /renewals'); }
});

router.put('/:id', requirePerm('renewals.edit'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Renewal not found.' });
    const { data: before, error: gErr } = await supabase.from('renewals').select('*').eq('id', req.params.id).maybeSingle();
    if (gErr) throw gErr;
    if (!before) return res.status(404).json({ error: 'Renewal not found.' });
    const p = R.parseRenewal(req.body); if (p.error) return res.status(400).json({ error: p.error });
    const n = p.fields, was = String(before.renewal_date).slice(0, 10), changes = [];
    if (n.renewal_type !== before.renewal_type) changes.push({ field: 'Type', from: before.renewal_type, to: n.renewal_type });
    if (n.renewal_date !== was) changes.push({ field: 'Renewal date', from: R.dmy(was), to: R.dmy(n.renewal_date) });
    if (n.description !== (before.description || '')) changes.push({ field: 'Description', from: before.description || null, to: n.description || null });
    if (n.amount !== Number(before.amount)) changes.push({ field: 'Amount', from: R.money(before.amount), to: R.money(n.amount) });
    if (n.paid_by !== (before.paid_by || '')) changes.push({ field: 'Paid by', from: before.paid_by || null, to: n.paid_by || null });
    const { settings } = await R.getSettings();
    if (!changes.length) return res.json({ success: true, unchanged: true, data: publicRenewal(before, [], R.todayIST(), settings.start_days) });
    const rErr = reasonError(req.body.reason, 'change a renewal'); if (rErr) return res.status(400).json({ error: rErr });
    const { data, error } = await supabase.from('renewals').update({ ...n, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Renewal not found.' });
    if (n.renewal_date !== was) await R.resetAlerts(data.id);                      // a new date: its reminders start afresh
    await logActivity(req, { category: 'renewal', action: 'renewal_updated', entityType: 'renewal', entityId: data.id, entityLabel: label(data), reason: cleanReason(req.body.reason), changes });
    await catchUp();
    const f = await filesOf([data.id]);
    res.json({ success: true, data: publicRenewal(data, f, R.todayIST(), settings.start_days) });
  } catch (err) { sendError(res, err, 'PUT /renewals/:id'); }
});

router.delete('/:id', requirePerm('renewals.edit'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Renewal not found.' });
    const rErr = reasonError(req.body && req.body.reason, 'delete a renewal'); if (rErr) return res.status(400).json({ error: rErr });
    const { data: r, error: gErr } = await supabase.from('renewals').select('*').eq('id', req.params.id).maybeSingle();
    if (gErr) throw gErr;
    if (!r) return res.status(404).json({ error: 'Renewal not found.' });
    const f = await filesOf([r.id]);
    await archive.keep(req, { type: 'renewal', id: r.id, label: label(r), detail: `${R.money(r.amount)}${f.length ? ` · ${f.length} document${f.length === 1 ? '' : 's'}` : ''}`, row: r, related: { renewal_files: f }, reason: cleanReason(req.body.reason), files: f.map(x => ({ bucket: docs.BUCKET, path: x.storage_path })) });
    await supabase.from('renewal_files').delete().eq('renewal_id', r.id);          // (the database also cascades; this does not depend on it)
    await supabase.from('renewal_alerts').delete().eq('renewal_id', r.id);
    const { error } = await supabase.from('renewals').delete().eq('id', r.id);
    if (error) throw error;
    await logActivity(req, { category: 'renewal', action: 'renewal_deleted', entityType: 'renewal', entityId: r.id, entityLabel: label(r), reason: cleanReason(req.body.reason),
      changes: [{ field: 'Amount', from: R.money(r.amount), to: null }, ...(f.length ? [{ field: 'Documents', from: `${f.length} file${f.length === 1 ? '' : 's'}`, to: null }] : [])] });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'DELETE /renewals/:id'); }
});

router.post('/:id/renew', requirePerm('renewals.add'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Renewal not found.' });
    const b = req.body || {};
    const { data: r, error: gErr } = await supabase.from('renewals').select('*').eq('id', req.params.id).maybeSingle();
    if (gErr) throw gErr;
    if (!r) return res.status(404).json({ error: 'Renewal not found.' });
    if (r.status === 'renewed') return res.status(409).json({ error: 'This renewal is already marked as renewed.' });
    const today = R.todayIST(), on = b.renewed_on ? String(b.renewed_on).trim() : today;
    if (!R.validDay(on) || on > R.addDays(today, 1) || on < '2000-01-01') return res.status(400).json({ error: 'The date it was renewed on is not valid.' });
    const was = String(r.renewal_date).slice(0, 10);
    let next = null;
    if (b.next_date !== undefined && b.next_date !== null && String(b.next_date).trim() !== '') {
      next = String(b.next_date).trim();
      if (!R.validDay(next) || next > '2100-12-31') return res.status(400).json({ error: 'The next renewal date is not a valid date.' });
      if (next <= was) return res.status(400).json({ error: 'The next renewal date must be after this renewal\'s date.' });
    }
    const { data, error } = await supabase.from('renewals').update({ status: 'renewed', renewed_on: on, renewed_by_name: req.user.name, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', r.id).select('*').maybeSingle();
    if (error) throw error;
    await R.resetAlerts(r.id);
    await logActivity(req, { category: 'renewal', action: 'renewal_renewed', entityType: 'renewal', entityId: r.id, entityLabel: label(r), changes: [{ field: 'Status', from: 'Active', to: `Renewed on ${R.dmy(on)}` }] });
    let created = null;
    if (next) {
      const ins = await supabase.from('renewals').insert({ renewal_type: r.renewal_type, description: r.description || '', amount: r.amount, paid_by: r.paid_by || '', renewal_date: next, status: 'active', created_by_id: String(req.user.id), created_by_name: req.user.name }).select('*').single();
      if (ins.error) throw ins.error;
      created = ins.data;
      await logActivity(req, { category: 'renewal', action: 'renewal_added', entityType: 'renewal', entityId: created.id, entityLabel: label(created), changes: [{ field: 'Next cycle of', from: null, to: label(r) }] });
      await catchUp();
    }
    const { settings } = await R.getSettings(), t = R.todayIST();
    res.json({ success: true, data: publicRenewal(data, await filesOf([data.id]), t, settings.start_days), next: created ? publicRenewal(created, [], t, settings.start_days) : null });
  } catch (err) { sendError(res, err, 'POST /renewals/:id/renew'); }
});

router.post('/:id/reopen', requirePerm('renewals.edit'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Renewal not found.' });
    const rErr = reasonError(req.body && req.body.reason, 'reopen a renewal'); if (rErr) return res.status(400).json({ error: rErr });
    const { data: r, error: gErr } = await supabase.from('renewals').select('*').eq('id', req.params.id).maybeSingle();
    if (gErr) throw gErr;
    if (!r) return res.status(404).json({ error: 'Renewal not found.' });
    if (r.status !== 'renewed') return res.status(409).json({ error: 'This renewal is not marked as renewed.' });
    const { data, error } = await supabase.from('renewals').update({ status: 'active', renewed_on: null, renewed_by_name: null, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', r.id).select('*').maybeSingle();
    if (error) throw error;
    await R.resetAlerts(r.id);
    await logActivity(req, { category: 'renewal', action: 'renewal_reopened', entityType: 'renewal', entityId: r.id, entityLabel: label(r), reason: cleanReason(req.body.reason), changes: [{ field: 'Status', from: 'Renewed', to: 'Active' }] });
    await catchUp();
    const { settings } = await R.getSettings();
    res.json({ success: true, data: publicRenewal(data, await filesOf([data.id]), R.todayIST(), settings.start_days) });
  } catch (err) { sendError(res, err, 'POST /renewals/:id/reopen'); }
});

router.post('/:id/files', requirePerm('renewals.add'), uploadLimiter, rawFile, async (req, res) => {
  let path = null;
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Renewal not found.' });
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Choose a file to upload.' });
    const { data: r, error: gErr } = await supabase.from('renewals').select('id, renewal_type, renewal_date').eq('id', req.params.id).maybeSingle();
    if (gErr) throw gErr;
    if (!r) return res.status(404).json({ error: 'Renewal not found.' });
    const filename = docs.safeFilename(req.query.filename), ext = docs.extensionOf(filename);
    if (docs.BLOCKED_EXT.has(ext)) return res.status(400).json({ error: `".${ext}" files cannot be stored here because they can run programs on a computer. Use a document format such as PDF, Word, Excel or a picture.` });
    const have = await filesOf([r.id]);
    if (have.length >= R.MAX_FILES) return res.status(400).json({ error: `At most ${R.MAX_FILES} documents per renewal.` });
    path = docs.newRenewalPath(ext);
    await docs.store(path, buf);
    const { data, error } = await supabase.from('renewal_files').insert({ renewal_id: r.id, storage_path: path, original_filename: filename, ext, size_bytes: buf.length, uploaded_by_name: req.user.name }).select('*').single();
    if (error) throw error;
    await logActivity(req, { category: 'renewal', action: 'renewal_file_added', entityType: 'renewal', entityId: r.id, entityLabel: `${label(r)} — ${filename}`, changes: [{ field: 'Document', from: null, to: `${filename} · ${docs.formatLabel(ext)} · ${docs.humanSize(buf.length)}` }] });
    res.status(201).json({ success: true, data: publicFile(data) });
  } catch (err) {
    if (path) await docs.removeObject(path).catch(() => {});                       // never leave a file nobody can see
    sendError(res, err, 'POST /renewals/:id/files');
  }
});

module.exports = router;
