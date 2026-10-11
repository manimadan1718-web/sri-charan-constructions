/**
 * Supabase returns at most 1,000 rows per request. Anything that must see EVERY row (the Records list,
 * the Summary totals, exports) has to read page after page, or it silently stops counting at 1,000.
 */
const PAGE = 1000;

/**
 * makeQuery() must return a NEW query each time, with a stable order (so pages don't overlap).
 * Returns { data, error } like a normal query. Stops at `max` rows.
 */
async function fetchAll(makeQuery, max = 20000) {
  const out = [];
  for (let offset = 0; offset < max; offset += PAGE) {
    // eslint-disable-next-line no-await-in-loop
    const { data, error } = await makeQuery().range(offset, Math.min(offset + PAGE, max) - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return { data: out, error: null };
}

module.exports = { fetchAll, PAGE };
