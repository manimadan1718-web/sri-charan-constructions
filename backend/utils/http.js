/**
 * One place for "something went wrong on the server".
 *
 * The real reason (which can contain table names, column names, SQL fragments…) goes to the
 * server log only. The browser gets a short, generic message — it must never see database internals.
 */
function serverError(res, err, where, status = 500) {
  console.error(`${where}:`, err && err.message ? err.message : err);
  return res.status(status).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { serverError };
