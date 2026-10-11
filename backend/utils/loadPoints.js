/**
 * Loads breakup: an entry's total Loads can be split by UNLOADING POINT
 * (e.g. "Yard A: 5 loads, Yard B: 7 loads"). The lines are optional, but when they are
 * present they must add up to exactly the entry's Loads.
 */
const MAX_POINTS = 30;

const cleanName = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * raw === undefined → the page did not send any lines ("leave them as they are")
 * raw === null / [] → "no breakup"
 * Returns { points } (cleaned, de-spaced) or { error }.
 */
function parsePoints(raw, totalLoads) {
  if (raw === undefined) return { points: undefined };
  if (raw === null) return { points: [] };
  if (!Array.isArray(raw)) return { error: 'The unloading points are not valid.' };
  if (raw.length > MAX_POINTS) return { error: `At most ${MAX_POINTS} unloading points per entry.` };

  const points = [];
  const seen = new Set();
  for (const r of raw) {
    const name = cleanName(r && r.point_name);
    const rawLoads = r && r.loads;
    if (!name && (rawLoads === '' || rawLoads === null || rawLoads === undefined)) continue;   // a blank line is ignored
    if (!name) return { error: 'Each unloading point needs a name.' };
    if (name.length > 80) return { error: 'An unloading point name is too long (80 characters at most).' };
    const loads = Number(rawLoads);
    if (rawLoads === '' || rawLoads === null || !Number.isInteger(loads) || loads < 1 || loads > 100000000) {
      return { error: `Loads for "${name}" must be a whole number of 1 or more.` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return { error: `"${name}" is listed twice. Combine them into one line.` };
    seen.add(key);
    points.push({ point_name: name, loads });
  }

  const sum = points.reduce((a, p) => a + p.loads, 0);
  if (points.length && sum !== totalLoads) {
    return { error: `The unloading points add up to ${sum} load${sum === 1 ? '' : 's'}, but Loads is ${totalLoads}. They must match.` };
  }
  return { points };
}

/** "Yard A: 5 · Yard B: 7" — the same text however the lines happen to be ordered (null when there are none). */
function pointsText(points) {
  if (!Array.isArray(points) || !points.length) return null;
  return [...points]
    .sort((a, b) => String(a.point_name).toLowerCase().localeCompare(String(b.point_name).toLowerCase()))
    .map(p => `${p.point_name}: ${p.loads}`).join(' · ');
}

/** True when a database error only means the "load_points" table has not been created yet. */
const isMissingLoadPoints = err =>
  !!err && /load_points/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

const LOAD_POINTS_SETUP_MESSAGE =
  'Unloading points need a one-time database update. Run run-in-supabase-3-new-features.sql in Supabase → SQL Editor, then try again.';

module.exports = { MAX_POINTS, cleanName, parsePoints, pointsText, isMissingLoadPoints, LOAD_POINTS_SETUP_MESSAGE };
