const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');
const reports = require('../utils/reports');
const tableReports = require('../utils/tableReports');
const reportData = require('../utils/reportData');
const lq = require('../utils/logQuery');
const { summaryRange } = require('./entries');

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

/* ── Inventory / Users / Activity-Log reports (Excel + PDF) ─────────────────── */
const TABLE_FORMATS = { xlsx: FORMATS.xlsx, pdf: FORMATS.pdf };

/** Shared by the three reports below: who-may-ask is checked by the route, this does the rest. */
async function serveTableReport(req, res, { format, filePrefix, category, load }) {
  const fmt = TABLE_FORMATS[format];
  if (!fmt) return res.status(400).json({ error: 'Choose Excel or PDF.' });
  if (active >= MAX_AT_ONCE) return res.status(429).json({ error: 'Another report is being prepared right now. Please try again in a moment.' });
  active++;
  try {
    const data = await load(format);
    if (!data) return res.status(400).json({ error: 'Nothing to export.' });
    const meta = { user: reports.cleanText(req.user.name, 60) || 'user', subtitle: data.subtitle || '' };
    const args = { sheetName: data.sheet, title: data.title, columns: data.columns, rows: data.rows, meta };
    const buffer = format === 'xlsx' ? await tableReports.buildTableXlsx(args) : await tableReports.buildTablePdf(args);

    const n = data.realRows !== undefined ? data.realRows : data.rows.length;
    await logActivity(req, {
      category, action: 'report_exported', entityType: 'report',
      entityLabel: `${fmt.label} report · ${data.title} · ${n} row${n === 1 ? '' : 's'}`,
    });
    res.set({
      'Content-Type': fmt.type,
      'Content-Disposition': `attachment; filename="SCC-${filePrefix}-${reports.todayStamp()}.${fmt.ext}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    res.send(buffer);
  } catch (err) {
    console.error(`POST /reports/${filePrefix}:`, err.message);
    res.status(err.status || 500).json({ error: err.userMessage || 'The report could not be prepared. Please try again.' });
  } finally {
    active--;
  }
}

// ── POST /api/reports/inventory  (Admin) — { type: 'vehicles' | 'sites' | 'operators', format } ──
router.post('/inventory', requireRole('admin'), (req, res) => {
  const { type, format } = req.body || {};
  if (!Object.prototype.hasOwnProperty.call(reportData.INVENTORY, type)) return res.status(400).json({ error: 'Choose Vehicles, Sites or Operators.' });
  return serveTableReport(req, res, { format, filePrefix: type, category: 'inventory', load: () => reportData.inventoryReport(type) });
});

// ── POST /api/reports/users  (Admin) — { format } — includes deleted users and who/when for every change ──
router.post('/users', requireRole('admin'), (req, res) => {
  return serveTableReport(req, res, { format: (req.body || {}).format, filePrefix: 'users', category: 'user', load: () => reportData.usersReport() });
});

// ── POST /api/reports/summary  (Owner + Admin) — { format, from?, to? } — the Summary screen as Excel / PDF ──
router.post('/summary', requireRole('owner', 'admin'), (req, res) => {
  const body = req.body || {};
  const range = summaryRange(body);
  if (range.error) return res.status(400).json({ error: range.error });
  return serveTableReport(req, res, { format: body.format, filePrefix: 'summary', category: 'entry', load: () => reportData.summaryReport(range) });
});

// ── POST /api/reports/logs  (Owner + Admin) — { format, ids?: [...] | filters?: {...} } ──
router.post('/logs', requireRole('owner', 'admin'), (req, res) => {
  const body = req.body || {};
  let ids = null, filters = {};
  if (Array.isArray(body.ids)) {
    ids = [...new Set(body.ids)];
    if (!ids.length || !ids.every(id => typeof id === 'string' && ID_RE.test(id))) return res.status(400).json({ error: 'Some of the selected entries are not valid.' });
  } else {
    try { filters = lq.normalizeFilters(body.filters); }
    catch (e) { return res.status(e.status || 400).json({ error: e.userMessage || 'Invalid filters.' }); }
  }
  return serveTableReport(req, res, {
    format: body.format, filePrefix: 'activity-logs', category: 'system',
    load: format => reportData.logsReport({ ids, filters, format }),
  });
});

module.exports = router;
