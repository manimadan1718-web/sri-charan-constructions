const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { fetchAll } = require('../utils/db');
const docs = require('../utils/documents');

router.use(requireAuth);

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

// Uploads use memory and storage, so they get a tighter limit on top of the site-wide one.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: parseInt(process.env.DOC_UPLOAD_LIMIT, 10) || 30, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.' },
});
// The file arrives as the raw request body (any type); its details come in the web address.
const rawFile = express.raw({ type: () => true, limit: docs.MAX_BYTES });

/** What the browser may see of a document — never the storage path or the file fingerprint. */
const publicDoc = d => ({
  id: d.id, name: d.name, category: d.category, original_filename: d.original_filename, ext: d.ext,
  format: docs.formatLabel(d.ext), size_bytes: d.size_bytes, site: d.site, notes: d.notes,
  uploaded_by_name: d.uploaded_by_name, created_at: d.created_at, updated_at: d.updated_at, updated_by_name: d.updated_by_name,
});

function sendError(res, err, where) {
  if (docs.isMissingDocuments(err)) return res.status(503).json({ error: docs.DOCUMENTS_SETUP_MESSAGE, setup_required: true });
  return serverError(res, err, where);
}

const META = () => ({ categories: docs.CATEGORIES, max_mb: docs.MAX_MB, blocked: [...docs.BLOCKED_EXT].sort() });

// ── GET /api/documents  (Owner + Admin) ──────────────────────────────────────
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const category = typeof req.query.category === 'string' ? req.query.category : '';
    if (category && !docs.CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown document type.' });
    const term = typeof req.query.q === 'string' ? req.query.q.replace(/[,()%*\\"]/g, ' ').trim().slice(0, 60) : '';

    const { data, error } = await fetchAll(() => {
      let q = supabase.from('documents').select('*').order('created_at', { ascending: false }).order('id', { ascending: false });
      if (category) q = q.eq('category', category);
      if (term) q = q.or(`name.ilike.%${term}%,original_filename.ilike.%${term}%,notes.ilike.%${term}%,site.ilike.%${term}%`);
      return q;
    }, 5000);
    if (error) throw error;
    res.json({ success: true, data: data.map(publicDoc), meta: META() });
  } catch (err) {
    sendError(res, err, 'GET /documents');
  }
});

// ── POST /api/documents?name=&category=&filename=&site=&notes=   (Owner + Admin) ─────
// Body = the raw file bytes.
router.post('/', requireRole('owner', 'admin'), uploadLimiter, rawFile, async (req, res) => {
  let path = null;
  try {
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Choose a file to upload.' });

    const name = docs.clean(req.query.name, 120);
    if (!name) return res.status(400).json({ error: 'Give the document a name.' });
    const category = docs.clean(req.query.category, 40);
    if (!docs.CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose the type of document (for example Work Order or Tax Invoice).' });
    const filename = docs.safeFilename(req.query.filename);
    const ext = docs.extensionOf(filename);
    if (docs.BLOCKED_EXT.has(ext)) {
      return res.status(400).json({ error: `".${ext}" files cannot be stored here because they can run programs on a computer. Use a document format such as PDF, Word or Excel.` });
    }
    const site = docs.clean(req.query.site, 80) || null;
    const notes = docs.clean(req.query.notes, 500) || null;

    // The exact same file twice is almost always a mistake.
    const hash = docs.sha256(buf);
    const { data: dup, error: dupErr } = await supabase.from('documents').select('id, name').eq('sha256', hash).limit(1);
    if (dupErr) throw dupErr;
    if (dup && dup.length) return res.status(409).json({ error: `This exact file is already stored as "${dup[0].name}".` });

    path = docs.newPath(ext);
    await docs.store(path, buf);
    const { data, error } = await supabase.from('documents')
      .insert({ name, category, original_filename: filename, ext, size_bytes: buf.length, storage_path: path, sha256: hash, site, notes, uploaded_by_name: req.user.name })
      .select('*').single();
    if (error) throw error;

    await logActivity(req, {
      category: 'document', action: 'document_uploaded', entityType: 'document', entityId: data.id,
      entityLabel: `${name} · ${category} · ${docs.formatLabel(ext)} · ${docs.humanSize(buf.length)}`,
      changes: [
        { field: 'File', from: null, to: filename },
        ...(site ? [{ field: 'Site', from: null, to: site }] : []),
      ],
    });
    res.status(201).json({ success: true, data: publicDoc(data) });
  } catch (err) {
    if (path) await docs.removeObject(path).catch(() => {});         // never leave a file nobody can see
    sendError(res, err, 'POST /documents');
  }
});

// ── PUT /api/documents/:id  (Owner + Admin) — rename / retype / change site or notes ──
router.put('/:id', requireRole('owner', 'admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Document not found.' });
    const b = req.body || {};
    const name = docs.clean(b.name, 120);
    if (!name) return res.status(400).json({ error: 'The document needs a name.' });
    const category = docs.clean(b.category, 40);
    if (!docs.CATEGORIES.includes(category)) return res.status(400).json({ error: 'Choose the type of document.' });
    const site = docs.clean(b.site, 80) || null;
    const notes = docs.clean(b.notes, 500) || null;

    const { data: before, error: getErr } = await supabase.from('documents').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!before) return res.status(404).json({ error: 'Document not found.' });

    const changes = [];
    if (name !== before.name)             changes.push({ field: 'Name', from: before.name, to: name });
    if (category !== before.category)     changes.push({ field: 'Type', from: before.category, to: category });
    if ((site || null) !== (before.site || null))   changes.push({ field: 'Site', from: before.site || null, to: site });
    if ((notes || null) !== (before.notes || null)) changes.push({ field: 'Notes', from: before.notes || null, to: notes });
    if (!changes.length) return res.json({ success: true, unchanged: true, data: publicDoc(before) });

    const { data, error } = await supabase.from('documents')
      .update({ name, category, site, notes, updated_at: new Date().toISOString(), updated_by_name: req.user.name })
      .eq('id', req.params.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Document not found.' });

    await logActivity(req, { category: 'document', action: 'document_updated', entityType: 'document', entityId: data.id, entityLabel: name, changes });
    res.json({ success: true, data: publicDoc(data) });
  } catch (err) {
    sendError(res, err, 'PUT /documents/:id');
  }
});

// ── GET /api/documents/:id/url  (Owner + Admin) — a 10-minute DOWNLOAD link ──────────
router.get('/:id/url', requireRole('owner', 'admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Document not found.' });
    const { data: d, error } = await supabase.from('documents').select('*').eq('id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!d) return res.status(404).json({ error: 'Document not found.' });
    const url = await docs.downloadUrl(d.storage_path, d.original_filename || d.name);
    if (!url) return res.status(404).json({ error: 'The file could not be found.' });
    await logActivity(req, { category: 'document', action: 'document_downloaded', entityType: 'document', entityId: d.id, entityLabel: d.name });
    res.json({ success: true, url, filename: d.original_filename || d.name, expires_in: 600 });
  } catch (err) {
    sendError(res, err, 'GET /documents/:id/url');
  }
});

// ── DELETE /api/documents/:id  (Admin only) ───────────────────────────────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Document not found.' });
    const { data: d, error: getErr } = await supabase.from('documents').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!d) return res.status(404).json({ error: 'Document not found.' });

    const { error } = await supabase.from('documents').delete().eq('id', req.params.id);
    if (error) throw error;
    await docs.removeObject(d.storage_path).catch(e => console.warn('document file could not be removed:', e.message));   // a leftover file is harmless

    await logActivity(req, {
      category: 'document', action: 'document_deleted', entityType: 'document', entityId: d.id,
      entityLabel: `${d.name} · ${d.category} · ${docs.formatLabel(d.ext)} · ${docs.humanSize(d.size_bytes)}`,
      changes: [{ field: 'File', from: d.original_filename, to: null }],
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'DELETE /documents/:id');
  }
});

module.exports = router;
