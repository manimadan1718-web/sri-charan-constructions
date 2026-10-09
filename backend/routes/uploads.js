const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const photos = require('../utils/photos');

router.use(requireAuth);

// Photos are small (the browser shrinks them first) but storage is limited, so uploads get their
// own tighter limit on top of the site-wide one. Only the upload itself is limited — viewing is not.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many photo uploads. Please wait a few minutes and try again.' },
});

const rawImage = express.raw({ type: photos.MIME_TYPES, limit: photos.MAX_BYTES });

// ── POST /api/uploads/reading  (Supervisor + Admin) ──────────────────────────
// Body = the raw image bytes, Content-Type = image/jpeg | image/png | image/webp.
router.post('/reading', requireRole('supervisor', 'admin'), uploadLimiter, rawImage, async (req, res) => {
  try {
    const buf = req.body;
    const kind = photos.detectImage(buf);
    if (!kind) {
      return res.status(415).json({ error: 'Please attach a JPG, PNG or WebP photo.' });
    }
    // The photo waits in pending/ until the entry it belongs to is saved.
    const path = await photos.uploadPhoto(buf, kind);
    res.status(201).json({ success: true, path, size: buf.length });
  } catch (err) {
    console.error('POST /uploads/reading:', err.message);
    res.status(500).json({ error: 'The photo could not be saved. Please try again.' });
  }
});

// ── GET /api/uploads/reading/url?path=…  (Owner + Admin — people who can open Records) ──
// Returns a link that stops working after 10 minutes. Only photos attached to an entry can be opened.
router.get('/reading/url', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const { path } = req.query;
    if (!photos.isReadingPath(path)) return res.status(400).json({ error: 'That is not a valid photo.' });
    const url = await photos.signedUrl(path);
    if (!url) return res.status(404).json({ error: 'That photo could not be found.' });
    res.json({ success: true, url, expires_in: 600 });
  } catch (err) {
    console.error('GET /uploads/reading/url:', err.message);
    res.status(500).json({ error: 'The photo could not be opened. Please try again.' });
  }
});

// ── DELETE /api/uploads/reading  (Supervisor + Admin) ────────────────────────
// Throws away a photo that was uploaded but never saved with an entry (the person removed it or
// cleared the form). Only pending/ photos can be deleted here. A photo attached to an entry lives in
// readings/ — it is evidence, and nothing in the app can delete it (even if it was later replaced).
router.delete('/reading', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const path = req.body && req.body.path;
    if (!photos.isPendingPath(path)) return res.status(400).json({ error: 'That is not a photo that can be discarded.' });
    await photos.discardPending(path);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /uploads/reading:', err.message);
    res.json({ success: true });   // a leftover file is harmless; never block the person
  }
});

module.exports = router;
