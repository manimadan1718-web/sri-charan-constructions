/**
 * "View" for stored files (documents and purchase attachments).
 *
 * Files sit in a PRIVATE bucket, so a browser can never open them directly. Instead the signed-in person asks the
 * server for a VIEW LINK. The link is good for two minutes, for ONE file, and only for kinds of file a browser can
 * safely show on its own (PDF, pictures, plain text). Opening it makes the server fetch the file and send it back
 * with the right content type — which is also what makes a PDF open instead of downloading.
 *
 * Everything else (Word, Excel, drawings, zips …) stays download-only.
 */
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');
const docs = require('./documents');

const VIEW_SECONDS = 120;
const MAX_AT_ONCE = 4;          // each view holds one file in memory for a moment

const TYPES = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  txt: 'text/plain; charset=utf-8', csv: 'text/plain; charset=utf-8',
};
const isViewable = ext => Object.prototype.hasOwnProperty.call(TYPES, String(ext || '').toLowerCase());

const secret = () => process.env.JWT_SECRET;

/** A link like /api/files/view?t=… for one stored file. */
function makeLink(path, filename, ext, userId) {
  const t = jwt.sign({ typ: 'file-view', p: path, n: String(filename || 'file').slice(0, 200), e: ext, u: String(userId) }, secret(), { algorithm: 'HS256', expiresIn: VIEW_SECONDS });
  return `/api/files/view?t=${encodeURIComponent(t)}`;
}

/** The details inside a link, or null when it is forged, expired or not a view link. */
function readLink(token) {
  try {
    const d = jwt.verify(String(token || ''), secret(), { algorithms: ['HS256'] });
    if (!d || d.typ !== 'file-view' || !d.p) return null;
    if (!(docs.isValidPath(d.p) || docs.isValidPurchasePath(d.p) || docs.isValidRenewalPath(d.p))) return null;
    if (!isViewable(d.e)) return null;
    return d;
  } catch { return null; }
}

let inFlight = 0;

/** Fetches the file and sends it to the browser to be shown (not downloaded). */
async function sendInline(res, d) {
  if (inFlight >= MAX_AT_ONCE) return res.status(503).type('text/plain').send('The server is busy. Please try again in a moment.');
  inFlight++;
  try {
    const { data, error } = await supabase.storage.from(docs.BUCKET).download(d.p);
    if (error || !data) return res.status(404).type('text/plain').send('The file could not be found.');
    const buf = Buffer.from(await data.arrayBuffer());
    const type = TYPES[String(d.e).toLowerCase()];
    const name = docs.safeFilename(d.n);
    res.status(200);
    res.set({
      'Content-Type': type,
      'Content-Length': String(buf.length),
      'Content-Disposition': `inline; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    // The browser's built-in PDF viewer does not work under a locked-down policy; pictures and text can be locked down fully.
    if (type === 'application/pdf') res.removeHeader('Content-Security-Policy');
    else res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.end(buf);
  } catch (err) {
    console.error('file view failed:', err.message);
    if (!res.headersSent) res.status(500).type('text/plain').send('The file could not be shown. Please try again.');
  } finally {
    inFlight--;
  }
}

module.exports = { VIEW_SECONDS, TYPES, isViewable, makeLink, readLink, sendInline };
