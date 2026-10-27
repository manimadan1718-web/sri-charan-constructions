/**
 * The daily loads breakup (one set of lines per date and site, adding up to all that day's loads at that site).
 *   GET /api/breakups?date=YYYY-MM-DD&site=Name   \u2014 the day's loads, its vehicles, its saved lines and whether they match
 *   PUT /api/breakups   { date, site, points: [...], reason }   \u2014 saves (replaces) the day's lines
 * Anyone who enters data or views Records can read it; people who enter data can save it. Changing or clearing saved lines needs a reason.
 */
const express = require('express');
const router = express.Router();
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const lp = require('../utils/loadPoints');
const day = require('../utils/dayBreakup');

router.use(requireAuth);

const siteParam = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, 120);

router.get('/', requirePerm('entry.add', 'records.view'), async (req, res) => {
  try {
    const date = String(req.query.date || ''), site = siteParam(req.query.site);
    if (!day.isDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
    if (!site) return res.status(400).json({ error: 'Choose the site.' });
    res.json({ success: true, data: await day.getDay(date, site) });
  } catch (err) {
    return serverError(res, err, 'GET /breakups');
  }
});

router.put('/', requirePerm('entry.add'), async (req, res) => {
  try {
    const b = req.body || {};
    const date = String(b.date || ''), site = siteParam(b.site);
    if (!day.isDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
    if (!site) return res.status(400).json({ error: 'Choose the site.' });
    if (!Array.isArray(b.points)) return res.status(400).json({ error: 'The unloading points are not valid.' });

    // each line is checked by the same rules as before; the day's total is compared here, with a message about the DAY
    const typed = b.points.reduce((a, r) => a + (Number(r && r.loads) || 0), 0);
    const pp = lp.parsePoints(b.points, typed);
    if (pp.error) return res.status(400).json({ error: pp.error.replace('Each unloading point needs a name.', 'Each line needs a name.') });
    const points = pp.points || [];

    const before = await day.getDay(date, site);
    if (before.setup_required) return res.status(503).json({ error: day.SETUP_MESSAGE, setup_required: true });
    const sum = points.reduce((a, p) => a + p.loads, 0);
    if (points.length && before.total_loads === 0) {
      return res.status(400).json({ error: `No loads are recorded for ${day.dmy(date)} at ${site} yet. Save the vehicle entries first, then split the loads.` });
    }
    if (points.length && sum !== before.total_loads) {
      return res.status(400).json({ error: `The lines add up to ${sum} load${sum === 1 ? '' : 's'}, but ${day.dmy(date)} at ${site} has ${before.total_loads}. They must match.` });
    }

    const was = lp.pointsText(before.points), now = lp.pointsText(points);
    if (was === now) return res.json({ success: true, unchanged: true, data: before });          // nothing to save
    const existing = before.points.length > 0;
    let reason = null;
    if (existing) {
      reason = cleanReason(b.reason);
      const problem = reasonError(reason, points.length ? 'change the loads breakup' : 'clear the loads breakup');
      if (problem) return res.status(400).json({ error: problem, reason_required: true });
    }

    await day.replaceDay({ date, site, points, user: req.user });
    await logActivity(req, {
      category: 'entry', action: !existing ? 'breakup_saved' : points.length ? 'breakup_changed' : 'breakup_cleared',
      entityType: 'breakup', entityId: null, entityLabel: `Loads breakup \u00b7 ${day.dmy(date)} \u00b7 ${site}`, reason,
      changes: [{ field: 'Loads breakup', from: was, to: now }],
    });
    res.json({ success: true, data: await day.getDay(date, site) });
  } catch (err) {
    if (day.isMissingTable(err)) return res.status(503).json({ error: day.SETUP_MESSAGE, setup_required: true });
    return serverError(res, err, 'PUT /breakups');
  }
});

module.exports = router;
