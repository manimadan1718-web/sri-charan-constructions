const express = require('express');
const router = express.Router();
const fileView = require('../utils/fileView');

// GET /api/files/view?t=…  — no sign-in header is possible when a link opens in a new tab, so the short-lived,
// single-file token inside the link is what authorises it (it is only ever handed to a signed-in, allowed person).
router.get('/view', async (req, res) => {
  const d = fileView.readLink(req.query.t);
  if (!d) return res.status(401).type('text/plain').send('This link has expired. Go back to the app and press View again.');
  await fileView.sendInline(res, d);
});

module.exports = router;
