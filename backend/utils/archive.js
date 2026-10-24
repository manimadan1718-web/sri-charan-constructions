/**
 * The Archive — nothing the app "deletes" disappears at once.
 *
 *  • Before a record is removed, a full COPY of it (and of the rows that belonged to it) is kept in `archive_items`, together with
 *    who deleted it, when, and why. Its uploaded files (photos, PDFs …) are NOT removed from storage at that moment.
 *  • The Admin sees them in the Archived tab and can RESTORE one (it comes back exactly as it was) or DELETE IT PERMANENTLY —
 *    which removes the copy from the database AND its files from storage, for good.
 *  • People who were deleted are different: their row stays in `users` (marked deleted, PIN destroyed). The Archived tab lists them too;
 *    deleting one permanently removes that row. (They cannot be restored: add the person again in Users.)
 *  • The Activity Log is not archived: it has its own clean-up tool and keeps a permanent record of every clean-up.
 */
const supabase = require('../config/supabase');
const photos = require('./photos');

const TYPES = {
  entry: { label: 'Record', table: 'entries' }, purchase: { label: 'Purchase', table: 'purchases' }, payment: { label: 'Payment line', table: 'payment_lines' },
  renewal: { label: 'Renewal', table: 'renewals' }, renewal_file: { label: 'Renewal document', table: 'renewal_files' }, document: { label: 'Document', table: 'documents' },
  progress: { label: 'Progress picture', table: 'progress_photos' }, vehicle: { label: 'Vehicle', table: 'vehicles' }, operator: { label: 'Operator', table: 'operators' },
  site: { label: 'Site', table: 'sites' }, user: { label: 'User', table: 'users' },
};
const SETUP_MESSAGE = 'The Archive needs a one-time database update. Run run-in-supabase-10-archive.sql in Supabase > SQL Editor, then try again.';
const isMissingArchive = err => !!err && /archive_items/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));
const setupError = () => Object.assign(new Error('archive_items missing'), { status: 503, userMessage: SETUP_MESSAGE, setupRequired: true });

/** Keeps a copy of what is about to be deleted. Throws (and so stops the delete) if the copy cannot be kept. */
async function keep(req, { type, id, label, detail = '', row, related = {}, files = [], reason = '' }) {
  const { error } = await supabase.from('archive_items').insert({
    entity_type: type, entity_id: String(id), label: String(label || type).slice(0, 200), detail: String(detail || '').slice(0, 300),
    snapshot: { row, related }, files: files.filter(f => f && f.path), reason: reason || '', deleted_by_id: String(req.user.id), deleted_by_name: req.user.name, deleted_at: new Date().toISOString(),
  });
  if (error) { if (isMissingArchive(error)) throw setupError(); throw error; }
}

/** A record, its unloading lines and its progress pictures — and every photo file that belongs to it. */
async function entrySnapshot(id) {
  const [e, lp, pg] = await Promise.all([
    supabase.from('entries').select('*').eq('id', id).maybeSingle(),
    supabase.from('load_points').select('*').eq('entry_id', id),
    supabase.from('progress_photos').select('*').eq('entry_id', id),
  ]);
  const row = (e && e.data) || null, lines = (lp && lp.data) || [], pics = (pg && pg.data) || [];
  const files = [];
  if (row) for (const col of photos.PHOTO_COLUMNS) if (row[col]) files.push({ bucket: photos.BUCKET, path: row[col] });
  pics.forEach(p => { if (p.storage_path) files.push({ bucket: photos.BUCKET, path: p.storage_path }); });
  return { row, related: { load_points: lines, progress_photos: pics }, files };
}

const conflict = (msg) => Object.assign(new Error(msg), { status: 409, userMessage: msg });
async function insertRows(table, rows) {
  if (!rows || !rows.length) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) { if (error.code === '23505' || /duplicate|already exists|unique/i.test(error.message || '')) throw conflict('Something with the same details already exists, so this cannot be restored. Rename or remove that one first.'); throw error; }
}
const exists = async (table, id) => { const { data } = await supabase.from(table).select('id').eq('id', id).maybeSingle(); return !!data; };

/** Puts an archived item back exactly as it was. */
async function restore(item) {
  const t = TYPES[item.entity_type], { row, related = {} } = item.snapshot || {};
  if (!t || !row || item.entity_type === 'user') throw conflict('This item cannot be restored. Add it again where it belongs.');
  if (item.entity_type === 'renewal_file' && !(await exists('renewals', row.renewal_id))) throw conflict('The renewal this document belonged to has been deleted. Restore the renewal first.');
  if (item.entity_type === 'progress' && !(await exists('entries', row.entry_id))) throw conflict('The record this picture belonged to has been deleted. Restore the record first.');
  if (await exists(t.table, row.id)) throw conflict('This is already back in the app.');
  await insertRows(t.table, [row]);
  try {
    if (item.entity_type === 'entry') { await insertRows('load_points', related.load_points); await insertRows('progress_photos', related.progress_photos); }
    if (item.entity_type === 'renewal') await insertRows('renewal_files', related.renewal_files);
  } catch (err) {
    await supabase.from(t.table).delete().eq('id', row.id);                       // never leave it half back
    throw err;
  }
}

/** Removes the stored files of an archived item (grouped by storage area). Returns how many were removed. */
async function removeFiles(files) {
  const by = new Map();
  (files || []).forEach(f => { if (f && f.path) { if (!by.has(f.bucket)) by.set(f.bucket, []); by.get(f.bucket).push(f.path); } });
  let n = 0;
  for (const [bucket, paths] of by) {
    // eslint-disable-next-line no-await-in-loop
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) console.warn('Archive: some files could not be removed:', error.message); else n += paths.length;
  }
  return n;
}

module.exports = { TYPES, SETUP_MESSAGE, isMissingArchive, setupError, keep, entrySnapshot, restore, removeFiles };
