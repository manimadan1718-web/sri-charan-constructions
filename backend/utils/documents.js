/**
 * Documents (work orders, tax invoices, …). Files live in a PRIVATE bucket and are only ever handed out
 * as short-lived DOWNLOAD links — they are never shown inside the app's own pages.
 *
 * "All formats" is allowed, except file types that can run programs on a computer (they can carry
 * malware, and a company document store is exactly where staff will double-click files).
 */
const crypto = require('crypto');
const supabase = require('../config/supabase');

const BUCKET = process.env.DOC_BUCKET || 'documents';
const MAX_MB = parseInt(process.env.DOC_MAX_MB, 10) || 25;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const SIGNED_URL_SECONDS = 10 * 60;

const CATEGORIES = [
  'Work Order', 'Tax Invoice', 'Quotation', 'Agreement / Contract', 'Purchase Order',
  'Receipt / Payment Proof', 'Drawing / Plan', 'Certificate / Licence', 'Other',
];

// Programs and scripts: refused. (Checked on the LAST extension, so "invoice.pdf.exe" is caught.)
const BLOCKED_EXT = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'gadget', 'cpl', 'dll', 'sys', 'drv', 'ocx',
  'js', 'mjs', 'jse', 'vbs', 'vbe', 'wsf', 'wsh', 'ws', 'ps1', 'psm1', 'psd1', 'sh', 'bash', 'zsh', 'csh',
  'jar', 'jnlp', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'bin', 'run', 'lnk', 'reg', 'hta', 'inf', 'scf',
  'url', 'vb', 'msc', 'iso', 'img', 'appx', 'msix', 'xll', 'dotm', 'docm', 'xlsm', 'pptm', 'xlam', 'ppam',
]);

const FORMATS = {
  pdf: 'PDF', doc: 'Word', docx: 'Word', rtf: 'Word', odt: 'Word',
  xls: 'Excel', xlsx: 'Excel', csv: 'CSV', ods: 'Excel',
  ppt: 'PowerPoint', pptx: 'PowerPoint', odp: 'PowerPoint',
  jpg: 'Image', jpeg: 'Image', png: 'Image', gif: 'Image', webp: 'Image', bmp: 'Image', tif: 'Image', tiff: 'Image', heic: 'Image', svg: 'Image',
  dwg: 'CAD', dxf: 'CAD', zip: 'Archive', rar: 'Archive', '7z': 'Archive', txt: 'Text', md: 'Text', xml: 'XML', json: 'JSON',
};
const formatLabel = ext => (ext ? (FORMATS[ext] || ext.toUpperCase()) : 'File');

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** A file name that is safe to show and to hand back as a download name (no folders, no control characters). */
function safeFilename(v) {
  const base = clean(v, 200).replace(/[\\/:*?"<>|]+/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').trim();
  return base || 'file';
}

/** The extension in lower case ('' when there is none or it looks odd). */
function extensionOf(filename) {
  const m = /\.([A-Za-z0-9]{1,10})$/.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function newPath(ext) {
  const d = new Date();
  return `docs/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}${ext ? '.' + ext : ''}`;
}
const PATH_RE = /^docs\/\d{4}\/\d{2}\/[0-9a-f-]{36}(?:\.[a-z0-9]{1,10})?$/;
const isValidPath = p => typeof p === 'string' && p.length < 120 && PATH_RE.test(p);

const isMissingBucket = err => !!err && /bucket not found/i.test(String(err.message || ''));

async function ensureBucket() {
  try {
    const { data } = await supabase.storage.getBucket(BUCKET);
    if (data) return true;
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (error && !/already exists|duplicate/i.test(String(error.message || ''))) throw error;
    return true;
  } catch (err) {
    console.warn(`⚠️   Documents bucket "${BUCKET}" is missing and could not be created automatically: ${err.message}`);
    return false;
  }
}

async function store(path, buffer) {
  const send = () => supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/octet-stream', cacheControl: '3600', upsert: false });
  let { error } = await send();
  if (error && isMissingBucket(error) && await ensureBucket()) ({ error } = await send());
  if (error) throw error;
}

async function removeObject(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

/** A link that DOWNLOADS the file under its original name (never displays it in the browser). */
async function downloadUrl(path, filename) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS, { download: filename });
  if (error || !data || !data.signedUrl) return null;
  return data.signedUrl;
}

const isMissingDocuments = err =>
  !!err && /documents/i.test(String(err.message || '')) &&
  (/(schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST205', '42P01'].includes(err.code));
const DOCUMENTS_SETUP_MESSAGE =
  'Documents need a one-time database update. Run run-in-supabase-3-new-features.sql in Supabase → SQL Editor, then try again.';

const humanSize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`);

module.exports = {
  BUCKET, MAX_MB, MAX_BYTES, CATEGORIES, BLOCKED_EXT,
  clean, safeFilename, extensionOf, formatLabel, sha256, newPath, isValidPath,
  ensureBucket, store, removeObject, downloadUrl, isMissingDocuments, DOCUMENTS_SETUP_MESSAGE, humanSize,
};
