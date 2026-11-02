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
const supabase = require('../config/supabase');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const archive = require('../utils/archive');
const stock = require('../utils/dieselStock');

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

// GET /api/diesel/ledger?from&to&site=A&site=B  - Diesel Stock Received, Usage (from the entries, site and vehicle wise) and Balance Stock.
router.get('/ledger', requirePerm('summary.view'), async (req, res) => {
  try {
    const range = summaryRange(req.query);
    if (range.error) return res.status(400).json({ error: range.error });
    res.json({ success: true, data: await stock.ledger({ from: range.from, to: range.to, sites: many(req.query.site) }) });
  } catch (err) {
    return serverError(res, err, 'GET /diesel/ledger');
  }
});

// GET /api/diesel/balance?site=Name&date=YYYY-MM-DD  - what is left at one site; Data Entry shows it and asks for stock when there is none.
router.get('/balance', requirePerm('entry.add', 'diesel.stock.add', 'summary.view'), async (req, res) => {
  try {
    const site = typeof req.query.site === 'string' ? req.query.site.trim() : '';
    const date = typeof req.query.date === 'string' && req.query.date ? req.query.date : null;
    if (!site) return res.status(400).json({ error: 'Choose the site.' });
    if (date && !stock.isDate(date)) return res.status(400).json({ error: 'Choose a valid date.' });
    res.json({ success: true, data: await stock.balanceFor(site, date) });
  } catch (err) {
    return serverError(res, err, 'GET /diesel/balance');
  }
});

const stockLabel = r => `Diesel stock \u00b7 ${stock.dmy(r.stock_date || r.date)} \u00b7 ${r.site} \u00b7 ${stock.round2(r.litres).toLocaleString('en-IN', { minimumFractionDigits: 2 })} L`;
const setupFail = (res, err) => (stock.isMissingTable(err) ? res.status(503).json({ error: stock.SETUP_MESSAGE, setup_required: true }) : null);

// POST /api/diesel/stock  { date, site, litres, note }  - diesel received at a site.
router.post('/stock', requirePerm('diesel.stock.add'), async (req, res) => {
  try {
    const p = await stock.parseStock(req.body);
    if (p.error) return res.status(400).json({ error: p.error });
    const { data, error } = await supabase.from(stock.TABLE).insert({ ...p.value, created_by_id: String(req.user.id), created_by_name: req.user.name }).select().single();
    if (error) { if (setupFail(res, error)) return; throw error; }
    await logActivity(req, { category: 'entry', action: 'diesel_stock_added', entityType: 'diesel_stock', entityId: data.id, entityLabel: stockLabel(data) });
    res.status(201).json({ success: true, data: stock.publicRow(data), balance: await stock.balanceFor(data.site) });
  } catch (err) {
    return serverError(res, err, 'POST /diesel/stock');
  }
});

// PUT /api/diesel/stock/:id  { date, site, litres, note, reason }  - a written reason is always needed.
router.put('/stock/:id', requirePerm('diesel.stock.edit'), async (req, res) => {
  try {
    const { data: before, error: e0 } = await supabase.from(stock.TABLE).select('*').eq('id', req.params.id).maybeSingle();
    if (e0) { if (setupFail(res, e0)) return; throw e0; }
    if (!before) return res.status(404).json({ error: 'That diesel stock entry was not found. Please reload the page.' });
    const b = req.body || {};                                         // anything not sent stays as it was
    const p = await stock.parseStock({ date: b.date || before.stock_date, site: b.site !== undefined ? b.site : before.site, litres: b.litres !== undefined ? b.litres : before.litres, note: b.note !== undefined ? b.note : before.note });
    if (p.error) return res.status(400).json({ error: p.error });
    const n = p.value, changes = [];
    const push = (field, from, to) => { if (String(from == null ? '' : from) !== String(to == null ? '' : to)) changes.push({ field, from: from === '' ? null : from, to: to === '' ? null : to }); };
    push('Date', stock.dmy(before.stock_date), stock.dmy(n.stock_date)); push('Site', before.site, n.site); push('Litres', stock.round2(before.litres), n.litres); push('Note', before.note || '', n.note);
    if (!changes.length) return res.json({ success: true, unchanged: true, data: stock.publicRow(before) });
    const reason = cleanReason(b.reason), problem = reasonError(reason, 'change this diesel stock entry');
    if (problem) return res.status(400).json({ error: problem, reason_required: true });
    const { data, error } = await supabase.from(stock.TABLE).update({ ...n, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', before.id).select().single();
    if (error) throw error;
    await logActivity(req, { category: 'entry', action: 'diesel_stock_updated', entityType: 'diesel_stock', entityId: data.id, entityLabel: stockLabel(data), changes, reason });
    res.json({ success: true, data: stock.publicRow(data), balance: await stock.balanceFor(data.site) });
  } catch (err) {
    return serverError(res, err, 'PUT /diesel/stock');
  }
});

// DELETE /api/diesel/stock/:id  { reason }  - goes to the Archived tab (it can be restored).
router.delete('/stock/:id', requirePerm('diesel.stock.edit'), async (req, res) => {
  try {
    const reason = cleanReason(req.body && req.body.reason), problem = reasonError(reason, 'delete this diesel stock entry');
    if (problem) return res.status(400).json({ error: problem, reason_required: true });
    const { data: row, error: e0 } = await supabase.from(stock.TABLE).select('*').eq('id', req.params.id).maybeSingle();
    if (e0) { if (setupFail(res, e0)) return; throw e0; }
    if (!row) return res.status(404).json({ error: 'That diesel stock entry was not found. Please reload the page.' });
    await archive.keep(req, { type: 'diesel_stock', id: row.id, label: stockLabel(row), detail: `${row.note ? row.note + ' \u00b7 ' : ''}Added by ${row.created_by_name || 'someone'}`, row, reason });
    const { error } = await supabase.from(stock.TABLE).delete().eq('id', row.id);
    if (error) throw error;
    await logActivity(req, { category: 'entry', action: 'diesel_stock_deleted', entityType: 'diesel_stock', entityId: row.id, entityLabel: stockLabel(row), reason });
    res.json({ success: true });
  } catch (err) {
    if (err && err.setupRequired) return res.status(503).json({ error: err.userMessage, setup_required: true });
    return serverError(res, err, 'DELETE /diesel/stock');
  }
});

module.exports = router;
