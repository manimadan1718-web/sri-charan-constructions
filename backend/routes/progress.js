/**
 * Site Working Progress images — viewing and removing (adding happens in Data Entry, together with the entry).
 *   GET    /api/progress?from&to&site   the pictures of a period/site, newest first, each with a short-lived link  (progress.view)
 *   DELETE /api/progress/:id            take a picture out of view — needs a written reason                        (progress.delete)
 * The picture file itself stays in the private storage (nothing in the app deletes saved pictures).
 */
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { fetchAll } = require('../utils/db');
const photos = require('../utils/photos');
const progress = require('../utils/progress');
const { NO_SITE_PARAM } = require('../utils/summary');

router.use(requireAuth);

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDay = s => DAY_RE.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const DEFAULT_DAYS = 31, DEFAULT_LIMIT = 120, MAX_LIMIT = 300;
const dayText = d => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '');

router.get('/', requirePerm('progress.view'), async (req, res) => {
  try {
    let { from, to, site } = req.query;
    from = typeof from === 'string' ? from.trim() : ''; to = typeof to === 'string' ? to.trim() : '';
    site = typeof site === 'string' ? site.trim().slice(0, 100) : '';
    if (from && !validDay(from)) return res.status(400).json({ error: 'from must be a date in YYYY-MM-DD format.' });
    if (to && !validDay(to)) return res.status(400).json({ error: 'to must be a date in YYYY-MM-DD format.' });
    if (from && to && from > to) return res.status(400).json({ error: 'The "from" date cannot be after the "to" date.' });
    if (!from && !to) { const d = new Date(); d.setUTCDate(d.getUTCDate() - DEFAULT_DAYS); from = d.toISOString().slice(0, 10); }   // by default: the last month
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || DEFAULT_LIMIT));

    const { data: entries, error: eErr } = await fetchAll(() => {
      let q = supabase.from('entries').select('id, date, site, vehicle_no').order('date', { ascending: false }).order('id', { ascending: true });
      if (from) q = q.gte('date', from);
      if (to)   q = q.lte('date', to);
      if (site) q = site === NO_SITE_PARAM ? q.eq('site', '') : q.eq('site', site);
      return q;
    });
    if (eErr) throw eErr;
    const byId = new Map((entries || []).map(e => [String(e.id), e]));
    const ids = [...byId.keys()];

    let rows = [];
    for (let i = 0; i < ids.length; i += 100) {
      // eslint-disable-next-line no-await-in-loop
      const r = await supabase.from('progress_photos').select('*').in('entry_id', ids.slice(i, i + 100));
      if (r.error) { if (progress.isMissingProgress(r.error)) return res.json({ success: true, data: [], total: 0, more: false, setup_required: true }); throw r.error; }
      rows = rows.concat(r.data || []);
    }
    const items = rows.map(p => { const e = byId.get(String(p.entry_id)) || {}; return { id: p.id, entry_id: p.entry_id, date: e.date, site: e.site || '', vehicle_no: e.vehicle_no || '', caption: p.caption || '', uploaded_by_name: p.uploaded_by_name || '', created_at: p.created_at, _path: p.storage_path }; })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)) || String(a.id).localeCompare(String(b.id)));
    const shown = items.slice(0, limit);

    let next = 0;                                           // short-lived links, a few at a time
    await Promise.all(Array.from({ length: Math.min(8, shown.length) }, async () => {
      for (;;) {
        const i = next++; if (i >= shown.length) return;
        // eslint-disable-next-line no-await-in-loop
        shown[i].url = photos.isProgressPath(shown[i]._path) ? await photos.signedUrl(shown[i]._path).catch(() => null) : null;
      }
    }));
    shown.forEach(x => delete x._path);
    res.json({ success: true, data: shown, total: items.length, more: items.length > shown.length, range: { from: from || null, to: to || null } });
  } catch (err) {
    serverError(res, err, 'GET /progress');
  }
});

router.delete('/:id', requirePerm('progress.delete'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'That is not a valid progress image.' });
    const rErr = reasonError(req.body && req.body.reason, 'delete a progress image');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: row, error: gErr } = await supabase.from('progress_photos').select('*').eq('id', id).maybeSingle();
    if (gErr) throw gErr;
    if (!row) return res.status(404).json({ error: 'That progress image could not be found.' });
    const { data: entry } = await supabase.from('entries').select('date, site, vehicle_no').eq('id', row.entry_id).maybeSingle();

    const { error: dErr } = await supabase.from('progress_photos').delete().eq('id', id);
    if (dErr) throw dErr;
    await logActivity(req, {
      category: 'entry', action: 'progress_deleted', entityType: 'progress', entityId: id,
      entityLabel: `${entry ? `${dayText(entry.date)} · ${entry.site || '(no site)'} · ${entry.vehicle_no}` : 'progress image'}`, reason,
      changes: row.caption ? [{ field: 'Caption', from: row.caption, to: null }] : null,
    });
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'DELETE /progress/:id');
  }
});

module.exports = router;
