/**
 * Loads breakup: an entry's total Loads can be split into lines. Each line has
 *   Name (the unloading point), Material, Location, Loads, Rate  — and  Amount = Loads x Rate (always worked out, never typed).
 * The lines are optional, but when they are present they must add up to exactly the entry's Loads.
 * Lines keep the order they were typed in (the Sl No is just the position in that order).
 */
const MAX_POINTS = 30;
const MAX_RATE = 10000000;

const cleanText = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const cleanName = cleanText;                     // (older name, kept)
const round2 = n => Math.round(n * 100) / 100;
const amountOf = p => round2((Number(p && p.loads) || 0) * (Number(p && p.rate) || 0));

const isBlank = v => v === '' || v === null || v === undefined;

/**
 * raw === undefined ? the page did not send any lines ("leave them as they are")
 * raw === null / [] ? "no breakup"
 * Returns { points } (cleaned, in the order given) or { error }.
 */
function parsePoints(raw, totalLoads) {
  if (raw === undefined) return { points: undefined };
  if (raw === null) return { points: [] };
  if (!Array.isArray(raw)) return { error: 'The unloading points are not valid.' };
  if (raw.length > MAX_POINTS) return { error: `At most ${MAX_POINTS} unloading points per entry.` };

  const points = [];
  for (const r of raw) {
    const name = cleanText(r && r.point_name), material = cleanText(r && r.material), location = cleanText(r && r.location);
    const rawLoads = r && r.loads, rawRate = r && r.rate;
    const rateBlank = isBlank(rawRate) || Number(rawRate) === 0;
    if (!name && !material && !location && isBlank(rawLoads) && rateBlank) continue;          // a completely blank line is ignored
    if (!name) return { error: 'Each unloading point needs a name.' };
    if (name.length > 80) return { error: 'An unloading point name is too long (80 characters at most).' };
    if (material.length > 80) return { error: `The material for "${name}" is too long (80 characters at most).` };
    if (location.length > 120) return { error: `The location for "${name}" is too long (120 characters at most).` };
    const loads = Number(rawLoads);
    if (isBlank(rawLoads) || !Number.isInteger(loads) || loads < 1 || loads > 100000000) {
      return { error: `Loads for "${name}" must be a whole number of 1 or more.` };
    }
    let rate = 0;
    if (!isBlank(rawRate)) {
      rate = Number(rawRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) return { error: `The rate for "${name}" must be a number of 0 or more.` };
      rate = round2(rate);
    }
    points.push({ point_name: name, material, location, loads, rate, position: points.length + 1 });     // position = the order typed (Sl No)
  }

  const sum = points.reduce((a, p) => a + p.loads, 0);
  if (points.length && sum !== totalLoads) {
    return { error: `The unloading points add up to ${sum} load${sum === 1 ? '' : 's'}, but Loads is ${totalLoads}. They must match.` };
  }
  return { points };
}

/** Lines in the order they were typed (older lines without an order are sorted by name). */
const sortPoints = points => [...(points || [])].sort((a, b) =>
  ((a.position || 0) - (b.position || 0)) || String(a.point_name).toLowerCase().localeCompare(String(b.point_name).toLowerCase()));

/** A line for the screen / a report: the stored fields plus the worked-out Amount. */
const withAmounts = points => sortPoints(points).map((p, i) => ({
  sl: i + 1, position: p.position || 0, point_name: p.point_name, material: p.material || '', location: p.location || '', loads: p.loads, rate: Number(p.rate) || 0, amount: amountOf(p),
}));

const money = n => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Yard A / Sand @ Hindupur: 5 x 300.00  ·  Yard B: 7" — the same text however the lines happen to be ordered (null when there are none). */
function pointsText(points) {
  if (!Array.isArray(points) || !points.length) return null;
  return [...points]
    .sort((a, b) => String(a.point_name).toLowerCase().localeCompare(String(b.point_name).toLowerCase())
      || String(a.material || '').localeCompare(String(b.material || '')) || String(a.location || '').localeCompare(String(b.location || '')))
    .map(p => `${p.point_name}${p.material ? ` / ${p.material}` : ''}${p.location ? ` @ ${p.location}` : ''}: ${p.loads}${Number(p.rate) > 0 ? ` x ${money(p.rate)}` : ''}`)
    .join(' · ');
}

/** True when a database error only means the "load_points" table has not been created yet. */
const isMissingLoadPoints = err =>
  !!err && /load_points/i.test(String(err.message || '')) &&
  (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));

/** True when the error only means the new breakup columns (material, location, rate, position) have not been added yet. */
const isMissingDetailColumns = err =>
  !!err && /(material|location|rate|position)/i.test(String(err.message || '')) && /(column|schema cache)/i.test(String(err.message || ''));

const LOAD_POINTS_SETUP_MESSAGE =
  'Unloading points need a one-time database update. Run run-in-supabase-3-new-features.sql in Supabase > SQL Editor, then try again.';
const LOAD_POINT_DETAILS_SETUP_MESSAGE =
  'Material, location and rate need a one-time database update. Run run-in-supabase-6-breakup-and-progress.sql in Supabase > SQL Editor, then try again.';

const hasDetails = p => !!(p.material || p.location || Number(p.rate) > 0);

/**
 * Saves an entry's lines. With the one-time database update in place every field is stored.
 * Without it, lines that only have a name and loads still save (as before); lines that use material / location / rate
 * are refused with a clear message rather than silently losing what was typed.
 */
async function savePoints(supabase, entryId, points) {
  if (!points || !points.length) return;
  const full = points.map((p, i) => ({ entry_id: entryId, point_name: p.point_name, loads: p.loads, material: p.material || '', location: p.location || '', rate: Number(p.rate) || 0, position: i + 1 }));
  let { error } = await supabase.from('load_points').insert(full);
  if (error && isMissingDetailColumns(error)) {
    if (points.some(hasDetails)) { const e = new Error(LOAD_POINT_DETAILS_SETUP_MESSAGE); e.code = 'LP_DETAILS_SETUP'; throw e; }
    ({ error } = await supabase.from('load_points').insert(points.map(p => ({ entry_id: entryId, point_name: p.point_name, loads: p.loads }))));
  }
  if (error) throw error;
}

module.exports = {
  MAX_POINTS, MAX_RATE, cleanName, cleanText, amountOf, parsePoints, sortPoints, withAmounts, pointsText, money,
  isMissingLoadPoints, isMissingDetailColumns, LOAD_POINTS_SETUP_MESSAGE, LOAD_POINT_DETAILS_SETUP_MESSAGE, savePoints,
};
