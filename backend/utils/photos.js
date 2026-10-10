/**
 * Photo-proof helpers (Starting / Closing reading and Diesel photos).
 *
 * Photos live in a PRIVATE Supabase Storage bucket. The database only stores the
 * file's path (entries.start_photo / entries.close_photo). People never get a
 * permanent public link: the Records screen asks the server for a short-lived
 * signed link each time a photo is opened.
 *
 * Two folders keep evidence safe:
 *   pending/…   a photo that was uploaded but not saved with an entry yet.
 *               The ONLY place the app is allowed to delete from (person removed it / cleared the form).
 *   readings/…  a photo attached to an entry. When an entry is saved the server MOVES the
 *               photo here. Nothing in the app can delete from this folder — not even a photo
 *               that an admin later replaced or removed — so proof can never be erased.
 *
 * Other rules enforced here:
 *   • only real JPEG / PNG / WebP files are accepted (checked from the file's own
 *     first bytes — the browser's claimed type is never trusted)
 *   • the server picks the file name (random UUID) — a client can never choose
 *     or overwrite a path, and a path can never contain "../"
 */
const crypto = require('crypto');
const supabase = require('../config/supabase');

const BUCKET    = process.env.PHOTO_BUCKET || 'reading-photos';
const MAX_BYTES = 4 * 1024 * 1024;           // the browser shrinks photos to ~150 KB; this is only a safety cap
const SIGNED_URL_SECONDS = 10 * 60;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const PHOTO_COLUMNS = ['start_photo', 'close_photo', 'diesel_photo'];

// pending/2026/10/<uuid>.jpg  and  readings/2026/10/<uuid>.jpg — the ONLY shapes of path the app accepts
const TAIL = '\\/\\d{4}\\/\\d{2}\\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:jpg|png|webp)$';
const PENDING_RE  = new RegExp('^pending' + TAIL);
const READINGS_RE = new RegExp('^readings' + TAIL);

const isPendingPath = p => typeof p === 'string' && p.length < 120 && PENDING_RE.test(p);
const isReadingPath = p => typeof p === 'string' && p.length < 120 && READINGS_RE.test(p);
const toFinalPath   = p => p.replace(/^pending\//, 'readings/');
const toPendingPath = p => p.replace(/^readings\//, 'pending/');

/** Looks at the file's first bytes. Returns { ext, type } or null if it isn't a supported image. */
function detectImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null;
}

function newPendingPath(ext) {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `pending/${yyyy}/${mm}/${crypto.randomUUID()}.${ext}`;
}

const isMissingBucket = err => !!err && /bucket not found/i.test(String(err.message || ''));

/** Creates the private bucket if it doesn't exist yet. Safe to call any time. */
async function ensureBucket() {
  try {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (data) return true;
    const { error } = await supabase.storage.createBucket(BUCKET, {
      public: false,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: MIME_TYPES,
    });
    if (error && !/already exists|duplicate/i.test(String(error.message || ''))) throw error;
    return true;
  } catch (err) {
    console.warn(`⚠️   Photo bucket "${BUCKET}" is missing and could not be created automatically: ${err.message}`);
    console.warn('    Create it once in Supabase → Storage (private), or run run-in-supabase-photos.sql.');
    return false;
  }
}

/** Stores a validated image in pending/. Returns its path. Creates the bucket on the fly if it's missing. */
async function uploadPhoto(buffer, kind) {
  const path = newPendingPath(kind.ext);
  const send = () => supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: kind.type, cacheControl: '3600', upsert: false,
  });
  let { error } = await send();
  if (error && isMissingBucket(error)) {
    if (await ensureBucket()) ({ error } = await send());
  }
  if (error) throw error;
  return path;
}

async function photoExists(path) {
  if (!isPendingPath(path) && !isReadingPath(path)) return false;
  const cut = path.lastIndexOf('/');
  const dir = path.slice(0, cut);
  const name = path.slice(cut + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 100, search: name });
  if (error) throw error;
  return (data || []).some(f => f.name === name);
}

async function signedUrl(path, seconds = SIGNED_URL_SECONDS) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds);
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Moves photos from pending/ to readings/ once their entry has been saved.
 * pairs = [{ from: 'pending/…', to: 'readings/…' }]. If any move fails, the ones already
 * moved are put back (so the person can simply press Save again) and the error is thrown.
 */
async function promoteAll(pairs) {
  const done = [];
  try {
    for (const { from, to } of pairs) {
      // eslint-disable-next-line no-await-in-loop
      const { error } = await supabase.storage.from(BUCKET).move(from, to);
      if (error) throw error;
      done.push({ from, to });
    }
  } catch (err) {
    for (const { from, to } of done.reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await supabase.storage.from(BUCKET).move(to, from).catch(() => {});
    }
    throw err;
  }
}

/** Deletes an UNSAVED upload. Only ever called with pending/ paths — attached photos are never deleted. */
async function discardPending(path) {
  if (!isPendingPath(path)) throw new Error('only pending photos can be discarded');
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/** True when a database error is only because the photo columns haven't been added yet. */
const isMissingPhotoColumn = err =>
  !!err && /(start_photo|close_photo|diesel_photo)/i.test(String(err.message || '')) &&
  /(column|schema cache)/i.test(String(err.message || ''));

const PHOTO_SETUP_MESSAGE =
  'Photo proof needs a one-time database update. Run run-in-supabase-photos.sql in Supabase → SQL Editor, then try again.';

module.exports = {
  BUCKET, MAX_BYTES, MIME_TYPES, PHOTO_COLUMNS,
  isPendingPath, isReadingPath, toFinalPath, toPendingPath,
  detectImage, ensureBucket, uploadPhoto, photoExists, signedUrl,
  promoteAll, discardPending, isMissingPhotoColumn, PHOTO_SETUP_MESSAGE,
};
