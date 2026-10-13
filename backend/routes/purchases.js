const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError, fmtDateDMY } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { fetchAll } = require('../utils/db');
const docs = require('../utils/documents');
const fileView = require('../utils/fileView');
const pur = require('../utils/purchases');

router.use(requireAuth);

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const isUniqueViolation = err => !!err && (err.code === '23505' || /duplicate key/i.test(String(err.message || '')));

// An attachment is uploaded first (it can be big), then the purchase is saved with a reference to it.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: parseInt(process.env.DOC_UPLOAD_LIMIT, 10) || 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.' },
});
const rawFile = express.raw({ type: () => true, limit: docs.MAX_BYTES });

/** What the browser may see of a purchase — never the storage path. */
const publicRow = p => ({
  id: p.id, purchase_date: p.purchase_date, site: p.site, supplier: p.supplier, vehicle_no: p.vehicle_no, item_name: p.item_name,
  load_weight: Number(p.load_weight), empty_weight: Number(p.empty_weight), net_weight: Number(p.net_weight),
  has_file: !!p.attachment_path, file_name: p.attachment_name || null,
  file_size: p.attachment_size == null ? null : Number(p.attachment_size),
  file_format: p.attachment_ext ? docs.formatLabel(p.attachment_ext) : null,
  file_viewable: p.attachment_ext ? fileView.isViewable(p.attachment_ext) : false,
  created_by_name: p.created_by_name, created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name,
});

function sendError(res, err, where) {
  if (pur.isMissingPurchases(err)) return res.status(503).json({ error: pur.PURCHASES_SETUP_MESSAGE, setup_required: true });
  return serverError(res, err, where);
}

const termOf = v => (typeof v === 'string' ? v.replace(/[,()%*\\"]/g, ' ').trim().slice(0, 60) : '');

// ── GET /api/purchases?from=&to=&site=&q=&limit=   (Owner + Admin) ────────────
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { from, to } = req.query;
    if (from && !pur.validDate(from)) return res.status(400).json({ error: 'The "from" date is not valid.' });
    if (to && !pur.validDate(to)) return res.status(400).json({ error: 'The "to" date is not valid.' });
    if (from && to && from > to) return res.status(400).json({ error: 'The "from" date cannot be after the "to" date.' });
    const site = docs.clean(req.query.site, 100);
    const term = termOf(req.query.q);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);

    const { data, error } = await fetchAll(() => {
      let q = supabase.from('purchases').select('*')
        .order('purchase_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
      if (from) q = q.gte('purchase_date', from);
      if (to) q = q.lte('purchase_date', to);
      if (site) q = q.eq('site', site);
      if (term) q = q.or(`supplier.ilike.%${term}%,item_name.ilike.%${term}%,vehicle_no.ilike.%${term}%`);
      return q;
    }, 20000);
    if (error) throw error;
    const milli = data.reduce((a, r) => a + (pur.toMilli(r.net_weight) || 0), 0);
    res.json({
      success: true, data: data.slice(0, limit).map(publicRow),
      total_count: data.length, truncated: data.length > limit, net_total: pur.fromMilli(milli),
    });
  } catch (err) {
    sendError(res, err, 'GET /purchases');
  }
});

// ── GET /api/purchases/mine  (Supervisor + Admin) — what THIS person saved recently ──
router.get('/mine', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('purchases').select('*').eq('created_by_id', String(req.user.id))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 49);
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(publicRow) });
  } catch (err) {
    if (pur.isMissingPurchases(err)) return res.json({ success: true, data: [] });
    serverError(res, err, 'GET /purchases/mine');
  }
});

// ── GET /api/purchases/suggestions  (Supervisor + Admin) — suppliers, items and vehicles used before ──
router.get('/suggestions', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('purchases').select('supplier, item_name, vehicle_no, created_at')
      .order('created_at', { ascending: false }).range(0, 1999);
    if (error) throw error;
    const pick = key => {
      const seen = new Set(), out = [];
      for (const r of data || []) {
        const v = r[key]; const k = String(v).toLowerCase();
        if (v && !seen.has(k)) { seen.add(k); out.push(v); }
        if (out.length >= 200) break;
      }
      return out.sort((a, b) => a.localeCompare(b));
    };
    res.json({ success: true, suppliers: pick('supplier'), items: pick('item_name'), vehicles: pick('vehicle_no') });
  } catch (err) {
    if (pur.isMissingPurchases(err)) return res.json({ success: true, suppliers: [], items: [], vehicles: [] });
    serverError(res, err, 'GET /purchases/suggestions');
  }
});

// ── POST /api/purchases/attachment?filename=   (Supervisor + Admin) ──────────
// Body = the raw file bytes. The file is stored privately and a reference is returned; the purchase is saved afterwards.
router.post('/attachment', requireRole('supervisor', 'admin'), uploadLimiter, rawFile, async (req, res) => {
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Choose a file to attach.' });
    const filename = docs.safeFilename(req.query.filename);
    const ext = docs.extensionOf(filename);
    if (docs.BLOCKED_EXT.has(ext)) {
      return res.status(400).json({ error: `".${ext}" files cannot be attached because they can run programs on a computer. Use a PDF, picture, Word or Excel file.` });
    }
    const path = docs.newPurchasePath(req.user.id, ext);
    await docs.store(path, buf);
    res.status(201).json({
      success: true,
      attachment: { path, filename, size: buf.length, ext, format: docs.formatLabel(ext), viewable: fileView.isViewable(ext) },
    });
  } catch (err) {
    serverError(res, err, 'POST /purchases/attachment');
  }
});

// ── DELETE /api/purchases/attachment  { path }  (Supervisor + Admin) — drop a file that was attached but never saved ──
router.delete('/attachment', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const path = req.body && req.body.path;
    if (!docs.isValidPurchasePath(path) || docs.purchasePathOwner(path) !== docs.safeUid(req.user.id)) {
      return res.status(403).json({ error: 'You can only remove files you attached yourself.' });
    }
    const { data: used, error } = await supabase.from('purchases').select('id').eq('attachment_path', path).limit(1);
    if (error && !pur.isMissingPurchases(error)) throw error;
    if (used && used.length) return res.status(409).json({ error: 'That file belongs to a saved purchase.' });
    await docs.removeObject(path).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, 'DELETE /purchases/attachment');
  }
});

/** Checks an attachment reference sent with a purchase. { error } | { value } | { value: null } when none was sent. */
async function checkAttachment(att, req) {
  if (att == null) return { value: null };
  if (typeof att !== 'object' || !docs.isValidPurchasePath(att.path)) return { error: 'The attached file is not valid. Attach it again.' };
  if (docs.purchasePathOwner(att.path) !== docs.safeUid(req.user.id)) return { error: 'You can only save files you attached yourself.' };
  if (!(await docs.downloadUrl(att.path, 'x'))) return { error: 'The attached file was not found. Please attach it again.' };
  const ext = (/\.([a-z0-9]{1,10})$/.exec(att.path) || [])[1] || '';
  const size = Number.isInteger(att.size) && att.size >= 0 && att.size <= docs.MAX_BYTES ? att.size : null;
  return { value: { path: att.path, name: docs.safeFilename(att.filename), ext, size } };
}

const descr = r => `${r.supplier} · ${r.item_name} · ${pur.kg(r.net_weight)}`;

// ── POST /api/purchases  (Supervisor + Admin) ─────────────────────────────────
router.post('/', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const parsed = pur.parsePurchase(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const a = await checkAttachment(req.body.attachment, req);
    if (a.error) return res.status(400).json({ error: a.error });
    const v = parsed.value;

    if (a.value) {
      const { data: taken, error: tErr } = await supabase.from('purchases').select('id').eq('attachment_path', a.value.path).limit(1);
      if (tErr) throw tErr;
      if (taken && taken.length) return res.status(409).json({ error: 'That file is already attached to another purchase.' });
    }
    const row = {
      ...v,
      attachment_path: a.value ? a.value.path : null, attachment_name: a.value ? a.value.name : null,
      attachment_size: a.value ? a.value.size : null, attachment_ext: a.value ? a.value.ext : null,
      created_by_id: String(req.user.id), created_by_name: req.user.name,
    };
    const { data, error } = await supabase.from('purchases').insert(row).select('*').single();
    if (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: 'That file is already attached to another purchase.' });
      throw error;                      // the uploaded file stays, so saving can simply be tried again
    }
    await logActivity(req, {
      category: 'purchase', action: 'purchase_created', entityType: 'purchase', entityId: data.id,
      entityLabel: `${descr(data)} · ${data.site}`,
      changes: [
        { field: 'Date', from: null, to: fmtDateDMY(v.purchase_date) }, { field: 'Site', from: null, to: v.site },
        { field: 'Supplier', from: null, to: v.supplier }, { field: 'Vehicle', from: null, to: v.vehicle_no },
        { field: 'Item', from: null, to: v.item_name },
        { field: 'Load weight', from: null, to: pur.kg(v.load_weight) }, { field: 'Empty weight', from: null, to: pur.kg(v.empty_weight) },
        { field: 'Net weight', from: null, to: pur.kg(v.net_weight) },
        ...(a.value ? [{ field: 'Attachment', from: null, to: a.value.name }] : []),
      ],
    });
    res.status(201).json({ success: true, data: publicRow(data) });
  } catch (err) {
    sendError(res, err, 'POST /purchases');
  }
});

// ── PUT /api/purchases/:id  (Admin only; a written reason is needed) ──────────
// Body: the fields, plus optionally  attachment: { path, filename, size }  to replace the file, or  remove_attachment: true.
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Purchase not found.' });
    const { data: before, error: getErr } = await supabase.from('purchases').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!before) return res.status(404).json({ error: 'Purchase not found.' });

    const parsed = pur.parsePurchase(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const v = parsed.value;
    const a = await checkAttachment(req.body.attachment, req);
    if (a.error) return res.status(400).json({ error: a.error });

    const changes = [];
    if (v.purchase_date !== before.purchase_date) changes.push({ field: 'Date', from: fmtDateDMY(before.purchase_date), to: fmtDateDMY(v.purchase_date) });
    if (v.site !== before.site) changes.push({ field: 'Site', from: before.site, to: v.site });
    if (v.supplier !== before.supplier) changes.push({ field: 'Supplier', from: before.supplier, to: v.supplier });
    if (v.vehicle_no !== before.vehicle_no) changes.push({ field: 'Vehicle', from: before.vehicle_no, to: v.vehicle_no });
    if (v.item_name !== before.item_name) changes.push({ field: 'Item', from: before.item_name, to: v.item_name });
    if (v.load_weight !== Number(before.load_weight)) changes.push({ field: 'Load weight', from: pur.kg(before.load_weight), to: pur.kg(v.load_weight) });
    if (v.empty_weight !== Number(before.empty_weight)) changes.push({ field: 'Empty weight', from: pur.kg(before.empty_weight), to: pur.kg(v.empty_weight) });
    if (v.net_weight !== Number(before.net_weight)) changes.push({ field: 'Net weight', from: pur.kg(before.net_weight), to: pur.kg(v.net_weight) });

    const patch = { ...v };
    const oldPath = before.attachment_path;
    if (a.value) {
      patch.attachment_path = a.value.path; patch.attachment_name = a.value.name; patch.attachment_size = a.value.size; patch.attachment_ext = a.value.ext;
      changes.push({ field: 'Attachment', from: before.attachment_name || null, to: a.value.name });
    } else if (req.body.remove_attachment === true && oldPath) {
      patch.attachment_path = null; patch.attachment_name = null; patch.attachment_size = null; patch.attachment_ext = null;
      changes.push({ field: 'Attachment', from: before.attachment_name || null, to: null });
    }
    if (!changes.length) return res.json({ success: true, unchanged: true, data: publicRow(before) });

    const rErr = reasonError(req.body.reason, 'change a purchase');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data, error } = await supabase.from('purchases')
      .update({ ...patch, updated_at: new Date().toISOString(), updated_by_name: req.user.name })
      .eq('id', req.params.id).select('*').maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: 'That file is already attached to another purchase.' });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Purchase not found.' });
    if (oldPath && oldPath !== data.attachment_path) await docs.removeObject(oldPath).catch(() => {});   // the replaced / removed file

    await logActivity(req, {
      category: 'purchase', action: 'purchase_updated', entityType: 'purchase', entityId: data.id,
      entityLabel: `${descr(data)} · ${data.site}`, reason, changes,
    });
    res.json({ success: true, data: publicRow(data) });
  } catch (err) {
    sendError(res, err, 'PUT /purchases/:id');
  }
});

// ── DELETE /api/purchases/:id  (Admin only; needs a written reason) ───────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Purchase not found.' });
    const rErr = reasonError(req.body && req.body.reason, 'delete a purchase');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: p, error: getErr } = await supabase.from('purchases').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!p) return res.status(404).json({ error: 'Purchase not found.' });

    const { error } = await supabase.from('purchases').delete().eq('id', req.params.id);
    if (error) throw error;
    if (p.attachment_path) await docs.removeObject(p.attachment_path).catch(() => {});
    await logActivity(req, {
      category: 'purchase', action: 'purchase_deleted', entityType: 'purchase', entityId: p.id,
      entityLabel: `${descr(p)} · ${p.site}`, reason,
      changes: [
        { field: 'Supplier', from: p.supplier, to: null }, { field: 'Item', from: p.item_name, to: null },
        { field: 'Net weight', from: pur.kg(p.net_weight), to: null },
        ...(p.attachment_name ? [{ field: 'Attachment', from: p.attachment_name, to: null }] : []),
      ],
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'DELETE /purchases/:id');
  }
});

// ── GET /api/purchases/:id/file-link?mode=view|download ───────────────────────
// Owner + Admin: any purchase.  Supervisor: only purchases they saved themselves.
router.get('/:id/file-link', requireRole('owner', 'admin', 'supervisor'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Purchase not found.' });
    const mode = req.query.mode === 'download' ? 'download' : 'view';
    const { data: p, error } = await supabase.from('purchases').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!p) return res.status(404).json({ error: 'Purchase not found.' });
    if (req.user.role === 'supervisor' && String(p.created_by_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only open files from purchases you saved yourself.' });
    }
    if (!p.attachment_path) return res.status(404).json({ error: 'This purchase has no attached file.' });

    let url;
    if (mode === 'view') {
      if (!fileView.isViewable(p.attachment_ext)) return res.status(415).json({ error: `${docs.formatLabel(p.attachment_ext)} files cannot be previewed here. Use Download instead.` });
      if (!(await docs.downloadUrl(p.attachment_path, 'x'))) return res.status(404).json({ error: 'The file could not be found.' });
      url = fileView.makeLink(p.attachment_path, p.attachment_name || 'file', p.attachment_ext, req.user.id);
    } else {
      url = await docs.downloadUrl(p.attachment_path, p.attachment_name || 'file');
      if (!url) return res.status(404).json({ error: 'The file could not be found.' });
    }
    await logActivity(req, {
      category: 'purchase', action: mode === 'view' ? 'purchase_file_viewed' : 'purchase_file_downloaded', entityType: 'purchase', entityId: p.id,
      entityLabel: `${descr(p)} · ${p.attachment_name || ''}`,
    });
    res.json({ success: true, url, filename: p.attachment_name, mode, expires_in: mode === 'view' ? fileView.VIEW_SECONDS : 600 });
  } catch (err) {
    sendError(res, err, 'GET /purchases/:id/file-link');
  }
});

module.exports = router;
