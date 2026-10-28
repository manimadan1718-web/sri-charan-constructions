/**
 * GET /api/diesel   — the Diesel Expenses register (Summary → Diesel Expenses). Owner + Admin (whoever may see the Summary).
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   a period (either may be left out)
 *   &site=A&site=B                   one or several sites ("__none__" = entries with no site)
 *   &proof=with | without | all      with proof (the default), still needing a photo, or both
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerm } = require('../middleware/auth');
const { serverError } = require('../utils/http');
const { dieselRegister, many, PROOF_MODES } = require('../utils/dieselRegister');
const { summaryRange } = require('./entries');

router.use(requireAuth);

router.get('/', requirePerm('summary.view'), async (req, res) => {
  try {
    const range = summaryRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    const proof = typeof req.query.proof === 'string' ? req.query.proof : 'with';
    if (!PROOF_MODES.includes(proof)) return res.status(400).json({ error: 'proof must be "with", "without" or "all".' });
    res.json({ success: true, data: await dieselRegister({ from: range.from, to: range.to, sites: many(req.query.site), proof }) });
  } catch (err) {
    return serverError(res, err, 'GET /diesel');
  }
});

module.exports = router;
