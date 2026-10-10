const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const reports = require('../utils/reports');

router.use(requireAuth);

const FORMATS = {
  csv:  { label: 'CSV',   type: 'text/csv; charset=utf-8', ext: 'csv' },
  xlsx: { label: 'Excel', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  pdf:  { label: 'PDF',   type: 'application/pdf', ext: 'pdf' },
};
const ID_RE = /^[0-9A-Za-z_-]{8,64}$/;

// Building a report with photos takes memory and time. A small server should only do a couple at once.
const MAX_AT_ONCE = 2;
let active = 0;

// ── POST /api/reports/entries  (Owner + Admin) ───────────────────────────────
// Body: { format: 'csv' | 'xlsx' | 'pdf', ids: [entry ids, in the order shown on screen], filtersText?: '…' }
// The report contains exactly the records the person is looking at.
router.post('/entries', requireRole('owner', 'admin'), async (req, res) => {
  const body = req.body || {};
  const fmt = FORMATS[body.format];
  if (!fmt) return res.status(400).json({ error: 'Choose Excel, PDF or CSV.' });

  if (!Array.isArray(body.ids) || !body.ids.length) return res.status(400).json({ error: 'There are no records to export.' });
  if (body.ids.length > reports.MAX_ROWS) {
    return res.status(413).json({ error: `That is too many records for one report (${body.ids.length}). Narrow the filters — for example to one month — and try again.` });
  }
  if (!body.ids.every(id => typeof id === 'string' && ID_RE.test(id))) return res.status(400).json({ error: 'Some of the selected records are not valid. Please reload the page and try again.' });
  const ids = [...new Set(body.ids)];

  if (active >= MAX_AT_ONCE) {
    return res.status(429).json({ error: 'Another report is being prepared right now. Please try again in a moment.' });
  }
  active++;

  try {
    const entries = await reports.fetchEntriesByIds(ids);
    if (!entries.length) return res.status(404).json({ error: 'Those records could not be found. Please reload the page and try again.' });
    const rows = entries.map(reports.toRow);

    let buffer;
    let photoNote = '';
    if (body.format === 'csv') {
      buffer = reports.buildCsv(rows);
    } else {
      const attached = reports.countPhotos(rows);
      if (attached > reports.MAX_PHOTOS) {
        return res.status(413).json({ error: `This report has ${attached} photos — too many for one file. Narrow the filters (for example to one month) or choose CSV.` });
      }
      const thumbs = await reports.loadThumbnails(rows);
      const meta = { user: reports.cleanText(req.user.name, 60) || 'user', filtersText: reports.cleanText(body.filtersText, 300) };
      buffer = body.format === 'xlsx' ? await reports.buildXlsx(rows, meta, thumbs) : await reports.buildPdf(rows, meta, thumbs);
      if (attached) photoNote = reports.photoSummary(rows, thumbs);     // what the report really contains
    }

    // Exporting business data is recorded in the Activity Logs, like any other action.
    await logActivity(req, {
      category: 'entry', action: 'report_exported', entityType: 'report',
      entityLabel: `${fmt.label} report · ${rows.length} record${rows.length === 1 ? '' : 's'}${photoNote ? ` · ${photoNote}` : ''}`,
    });

    res.set({
      'Content-Type': fmt.type,
      'Content-Disposition': `attachment; filename="SCC-site-log-${reports.todayStamp()}.${fmt.ext}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (err) {
    console.error('POST /reports/entries:', err.message);
    res.status(err.status || 500).json({ error: err.userMessage || 'The report could not be prepared. Please try again.' });
  } finally {
    active--;
  }
});

module.exports = router;
