/**
 * The Archived tab (Admin only).
 *   GET    /api/archive?type=&q=&from=&to=     everything that was deleted, newest first (the copies themselves stay on the server)
 *   POST   /api/archive/:id/restore            put one back exactly as it was
 *   POST   /api/archive/purge  { ids, reason } delete one or more PERMANENTLY — the copy leaves the database and its files leave storage
 */
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { fetchAll } = require('../utils/db');
const archive = require('../utils/archive');

router.use(requireAuth);
router.use(requirePerm('archive.manage'));

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const USER_PREFIX = 'user:';
const dayOf = d => (d ? String(d).slice(0, 10) : '');

function sendError(res, err, where) {
  if (archive.isMissingArchive(err)) return res.status(503).json({ error: archive.SETUP_MESSAGE, setup_required: true });
  if (err && err.userMessage) return res.status(err.status || 400).json({ error: err.userMessage });
  return serverError(res, err, where);
}
const publicItem = a => ({
  id: a.id, type: a.entity_type, type_label: (archive.TYPES[a.entity_type] || {}).label || a.entity_type, label: a.label, detail: a.detail || '', reason: a.reason || '',
  deleted_by_name: a.deleted_by_name || '', deleted_at: a.deleted_at, files: Array.isArray(a.files) ? a.files.length : 0, restorable: a.entity_type !== 'user',
});

router.get('/', async (req, res) => {
  try {
    const q = req.query;
    for (const k of ['from', 'to']) if (q[k] && !/^\d{4}-\d{2}-\d{2}$/.test(String(q[k]))) return res.status(400).json({ error: 'The dates must be valid.' });
    if (q.type && q.type !== 'all' && !archive.TYPES[q.type]) return res.status(400).json({ error: 'That is not a kind of archived item.' });
    let items = [], setup = false;
    const a = await fetchAll(() => supabase.from('archive_items').select('id, entity_type, label, detail, reason, deleted_by_name, deleted_at, files').order('deleted_at', { ascending: false }).order('id', { ascending: false }), 10000);
    if (a.error) { if (archive.isMissingArchive(a.error)) setup = true; else throw a.error; } else items = a.data.map(publicItem);
    const u = await supabase.from('users').select('id, name, role, deleted_at, deleted_by_name');
    if (!u.error) items = items.concat((u.data || []).filter(x => x.deleted_at).map(x => ({ id: USER_PREFIX + x.id, type: 'user', type_label: 'User', label: x.name, detail: `Role: ${x.role}`, reason: '', deleted_by_name: x.deleted_by_name || '', deleted_at: x.deleted_at, files: 0, restorable: false })));
    items.sort((x, y) => String(y.deleted_at).localeCompare(String(x.deleted_at)));
    const counts = {}; items.forEach(i => { counts[i.type] = (counts[i.type] || 0) + 1; });
    const term = archiveClean(q.q).toLowerCase();
    const shown = items.filter(i => (!q.type || q.type === 'all' || i.type === q.type) && (!q.from || dayOf(i.deleted_at) >= q.from) && (!q.to || dayOf(i.deleted_at) <= q.to)
      && (!term || `${i.label} ${i.detail} ${i.reason} ${i.deleted_by_name} ${i.type_label}`.toLowerCase().includes(term)));
    res.json({ success: true, data: shown, total: items.length, counts, types: Object.entries(archive.TYPES).map(([k, v]) => ({ key: k, label: v.label })), setup_required: setup });
  } catch (err) { sendError(res, err, 'GET /archive'); }
});
const archiveClean = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120);

router.post('/:id/restore', async (req, res) => {
  try {
    if (req.params.id.startsWith(USER_PREFIX)) return res.status(409).json({ error: 'A deleted user cannot be restored (their PIN was destroyed). Add the person again in Users.' });
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'That archived item was not found.' });
    const { data: item, error } = await supabase.from('archive_items').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!item) return res.status(404).json({ error: 'That archived item was not found.' });
    await archive.restore(item);
    const { error: dErr } = await supabase.from('archive_items').delete().eq('id', item.id);
    if (dErr) throw dErr;
    await logActivity(req, { category: 'archive', action: 'archive_restored', entityType: 'archive', entityId: item.id, entityLabel: `${(archive.TYPES[item.entity_type] || {}).label || item.entity_type}: ${item.label}`, changes: [{ field: 'Status', from: 'Archived', to: 'Restored' }] });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'POST /archive/:id/restore'); }
});

router.post('/purge', async (req, res) => {
  try {
    const b = req.body || {};
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(String))] : [];
    if (!ids.length) return res.status(400).json({ error: 'Choose what to delete permanently.' });
    if (ids.length > 200) return res.status(400).json({ error: 'At most 200 items at a time.' });
    if (ids.some(i => !(ID_RE.test(i) || (i.startsWith(USER_PREFIX) && ID_RE.test(i.slice(USER_PREFIX.length)))))) return res.status(400).json({ error: 'That is not a valid archived item.' });
    const rErr = reasonError(b.reason, 'delete permanently'); if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(b.reason);
    let removed = 0, files = 0; const labels = [];
    for (const id of ids) {
      if (id.startsWith(USER_PREFIX)) {
        const uid = id.slice(USER_PREFIX.length);
        // eslint-disable-next-line no-await-in-loop
        const { data: u } = await supabase.from('users').select('id, name, deleted_at').eq('id', uid).maybeSingle();
        if (!u || !u.deleted_at) continue;                                           // only people who were already deleted
        // eslint-disable-next-line no-await-in-loop
        const { error } = await supabase.from('users').delete().eq('id', uid);
        if (error) throw error;
        removed++; labels.push(`User: ${u.name}`); continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const { data: item, error: gErr } = await supabase.from('archive_items').select('*').eq('id', id).maybeSingle();
      if (gErr) throw gErr;
      if (!item) continue;
      // eslint-disable-next-line no-await-in-loop
      files += await archive.removeFiles(item.files);
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.from('archive_items').delete().eq('id', id);
      if (error) throw error;
      removed++; labels.push(`${(archive.TYPES[item.entity_type] || {}).label || item.entity_type}: ${item.label}`);
    }
    if (!removed) return res.status(404).json({ error: 'Those items were not found. They may already be deleted.' });
    await logActivity(req, { category: 'archive', action: 'archive_purged', entityType: 'archive', entityLabel: `${removed} item${removed === 1 ? '' : 's'} deleted permanently`, reason,
      changes: labels.slice(0, 25).map(l => ({ field: 'Deleted permanently', from: l, to: null })) });
    res.json({ success: true, removed, files_removed: files });
  } catch (err) { sendError(res, err, 'POST /archive/purge'); }
});

module.exports = router;
