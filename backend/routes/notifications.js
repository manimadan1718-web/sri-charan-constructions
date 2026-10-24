/**
 * The reminder bell.
 *   GET  /api/notifications        the renewal reminders for THIS person (after bringing them up to date), with the unread count   (renewals.view)
 *   POST /api/notifications/read   { renewal_id? } mark one (or, with no renewal_id, all) as read — the next repeat makes it unread again   (renewals.view)
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerm } = require('../middleware/auth');
const { serverError } = require('../utils/http');
const R = require('../utils/renewals');

router.use(requireAuth);
const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

router.get('/', requirePerm('renewals.view'), async (req, res) => {
  try {
    await R.runReminders({ only: [req.user] });                  // a server that was asleep catches up the moment somebody opens the app
    res.json({ success: true, ...(await R.listFor(req.user)) });
  } catch (err) { serverError(res, err, 'GET /notifications'); }
});

router.post('/read', requirePerm('renewals.view'), async (req, res) => {
  try {
    const id = req.body && req.body.renewal_id;
    if (id !== undefined && id !== null && !ID_RE.test(String(id))) return res.status(400).json({ error: 'That is not a valid renewal.' });
    await R.markRead(req.user, id || null);
    res.json({ success: true, ...(await R.listFor(req.user)) });
  } catch (err) { serverError(res, err, 'POST /notifications/read'); }
});

module.exports = router;
