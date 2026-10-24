/**
 * POST /api/backup/full   (Admin only)   — everything in the database as one Excel file. See utils/backup.js.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { writeBackup } = require('../utils/backup');

router.use(requireAuth);

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: parseInt(process.env.BACKUP_LIMIT, 10) || 6, standardHeaders: true, legacyHeaders: false,
  message: { error: 'A full backup is a big job. Please wait a few minutes before making another.' },
});

router.post('/full', requirePerm('backup.download'), limiter, async (req, res) => {
  try {
    const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="SCC-full-backup-${day}.xlsx"`);
    res.setHeader('Cache-Control', 'no-store');
    const appUrl = `${req.protocol}://${req.get('host')}`;
    const sum = await writeBackup(res, { user: req.user, appUrl });
    await logActivity(req, { category: 'backup', action: 'backup_downloaded', entityType: 'backup', entityLabel: `Full backup — ${sum.sheets} sheets, ${sum.rows} rows`, changes: null });
  } catch (err) {
    if (!res.headersSent) return serverError(res, err, 'POST /backup/full');
    console.error('POST /backup/full (while sending):', err && err.message);       // the download was already under way: end it
    res.destroy(err);
  }
});

module.exports = router;
