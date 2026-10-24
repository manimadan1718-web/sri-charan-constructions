/**
 * One place for "something went wrong on the server".
 *
 * The real reason (which can contain table names, column names, SQL fragments…) goes to the
 * server log only. The browser gets a short, generic message — it must never see database internals.
 */
function serverError(res, err, where, status = 500) {
  if (err && err.userMessage) return res.status(err.status || status).json({ error: err.userMessage, ...(err.setupRequired ? { setup_required: true } : {}) });   // an error whose message is meant for people
  console.error(`${where}:`, err && err.message ? err.message : err);
  return res.status(status).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = { serverError };
