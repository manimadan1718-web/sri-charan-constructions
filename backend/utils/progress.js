/**
 * Site Working Progress images: pictures of the work in progress, attached to the entry they were taken for.
 *   • People with "Add site working progress images" attach them in Data Entry (they do not see them afterwards).
 *   • People with "See site working progress images" (Owner, Admin) see them in the Progress tab and in reports.
 * The pictures live in the same private photo storage as the reading photos (folder "progress/"). The database only keeps
 * the path, a caption and who added it. A picture is never deleted from storage by the app (deleting one only removes it from view).
 */
const photos = require('./photos');
const { cleanText } = require('./loadPoints');

const MAX_PER_ENTRY = 12;
const MAX_CAPTION = 200;

/**
 * raw = [{ path: 'pending/…', caption?: '…' }, …]  (undefined / null / [] = none)
 * Returns { items: [{ from, to, caption }] } or { error }.
 */
function parseProgress(raw) {
  if (raw === undefined || raw === null) return { items: [] };
  if (!Array.isArray(raw)) return { error: 'The progress images are not valid.' };
  if (raw.length > MAX_PER_ENTRY) return { error: `At most ${MAX_PER_ENTRY} progress images per entry.` };
  const items = [], seen = new Set();
  for (const r of raw) {
    const from = r && r.path;
    if (!photos.isPendingPath(from)) return { error: 'One of the progress images is not valid. Please add it again.' };
    if (seen.has(from)) return { error: 'The same progress image cannot be used twice.' };
    seen.add(from);
    const caption = cleanText(r.caption);
    if (caption.length > MAX_CAPTION) return { error: `A progress image caption is too long (${MAX_CAPTION} characters at most).` };
    items.push({ from, to: photos.toProgressPath(from), caption });
  }
  return { items };
}

/** True when a database error only means the progress_photos table has not been created yet. */
const isMissingProgress = err =>
  !!err && /progress_photos/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

const PROGRESS_SETUP_MESSAGE =
  'Site working progress images need a one-time database update. Run run-in-supabase-6-breakup-and-progress.sql in Supabase > SQL Editor, then try again.';

module.exports = { MAX_PER_ENTRY, MAX_CAPTION, parseProgress, isMissingProgress, PROGRESS_SETUP_MESSAGE };
