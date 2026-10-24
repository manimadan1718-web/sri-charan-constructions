/**
 * Payments ledger — Company Payments and Outside Rental Payments (the same lines for both, to reconcile what we owe and have paid).
 *   GET    /api/payments?kind=company|outside   the saved lines (oldest date first) with their totals                   (payments.view)
 *          &from=&to=&name=&paid_by=&status=&q=  …narrowed by any of these search filters (all optional)
 *   GET    /api/payments/summary                the cumulative picture: both kinds, party-wise, and overall (same filters)  (payments.view)
 *   GET    /api/payments/mine                   what THIS person saved recently (read-only)                          (payments.add)
 *   GET    /api/payments/names?kind=            names used before, for the type-ahead list                          (payments.add)
 *   POST   /api/payments                        { kind, items:[{ party_name, item, description, payable, paid }] }   (payments.add) — all lines or none
 *   PUT    /api/payments/:id                    change a line — needs a written reason                               (payments.edit)
 *   DELETE /api/payments/:id                    remove a line — needs a written reason                               (payments.edit)
 * Balance = Payable − Paid is always worked out here, never stored. Every line has a Date and a typed "Paid By".
 */
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const archive = require('../utils/archive');
const { fetchAll } = require('../utils/db');
const pay = require('../utils/payments');

router.use(requireAuth);

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

const publicRow = p => {
  const payable = Number(p.payable) || 0, paid = Number(p.paid) || 0, balance = pay.balanceOf(payable, paid);
  return {
    id: p.id, kind: p.kind, party_name: p.party_name, item: p.item || '', description: p.description || '',
    pay_date: p.pay_date ? String(p.pay_date).slice(0, 10) : String(p.created_at || '').slice(0, 10),     // (lines saved before dates existed show the day they were saved)
    payable, paid, balance, status: pay.statusOf(balance), paid_by: p.paid_by || '',
    created_by_name: p.created_by_name, created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name,
  };
};

function sendError(res, err, where) {
  if (pay.isMissingPaymentColumns(err)) return res.status(503).json({ error: pay.PAYMENTS_COLUMNS_MESSAGE, setup_required: true });
  if (pay.isMissingPayments(err)) return res.status(503).json({ error: pay.PAYMENTS_SETUP_MESSAGE, setup_required: true });
  return serverError(res, err, where);
}

const allLines = kind => fetchAll(() => {
  let q = supabase.from('payment_lines').select('*').order('created_at', { ascending: true }).order('id', { ascending: true });
  if (kind) q = q.eq('kind', kind);
  return q;
}, 20000);

router.get('/', requirePerm('payments.view'), async (req, res) => {
  try {
    const kind = req.query.kind;
    if (kind !== undefined && !pay.KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be company or outside.' });
    const pf = pay.parseFilters(req.query);
    if (pf.error) return res.status(400).json({ error: pf.error });
    const { data, error } = await allLines(kind);
    if (error) throw error;
    const everything = pay.sortRows(data.map(publicRow)), rows = pay.applyFilters(everything, pf.filters);
    res.json({ success: true, data: rows, totals: pay.totalsOf(rows), all_count: everything.length, options: pay.optionsOf(everything), filters: pf.filters });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: [], totals: pay.totalsOf([]), all_count: 0, options: pay.optionsOf([]), filters: {}, setup_required: true });
    sendError(res, err, 'GET /payments');
  }
});

router.get('/summary', requirePerm('payments.view'), async (req, res) => {
  try {
    const pf = pay.parseFilters(req.query);
    if (pf.error) return res.status(400).json({ error: pf.error });
    const { data, error } = await allLines();
    if (error) throw error;
    const everything = pay.sortRows(data.map(publicRow).map(r => ({ ...r, party_key: pay.keyOf(r.party_name) }))), rows = pay.applyFilters(everything, pf.filters);
    res.json({ success: true, data: pay.cumulative(rows), all_count: everything.length, options: pay.optionsOf(everything), filters: pf.filters });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: pay.cumulative([]), all_count: 0, options: pay.optionsOf([]), filters: {}, setup_required: true });
    sendError(res, err, 'GET /payments/summary');
  }
});

router.get('/mine', requirePerm('payments.add'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('payment_lines').select('*').eq('created_by_id', String(req.user.id))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 99);
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(publicRow) });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: [] });
    serverError(res, err, 'GET /payments/mine');
  }
});

router.get('/names', requirePerm('payments.add'), async (req, res) => {
  try {
    const kind = req.query.kind;
    if (kind !== undefined && !pay.KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be company or outside.' });
    let q = supabase.from('payment_lines').select('party_name, paid_by, created_at').order('created_at', { ascending: false }).range(0, 1999);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q;
    if (error) throw error;
    const seen = new Set(), names = [], seenBy = new Set(), paidBy = [];
    for (const r of data || []) {
      const k = pay.keyOf(r.party_name);
      if (!seen.has(k)) { seen.add(k); names.push(r.party_name); }
      const b = pay.keyOf(r.paid_by || '');
      if (b && !seenBy.has(b)) { seenBy.add(b); paidBy.push(r.paid_by); }
      if (names.length >= 300 && paidBy.length >= 100) break;
    }
    res.json({ success: true, data: names.sort((a, b) => a.localeCompare(b)).slice(0, 300), paid_by: paidBy.sort((a, b) => a.localeCompare(b)).slice(0, 100) });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: [] });
    serverError(res, err, 'GET /payments/names');
  }
});

router.post('/', requirePerm('payments.add'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!pay.KINDS.includes(b.kind)) return res.status(400).json({ error: 'Choose Company Payments or Outside Rental Payments.' });
    const parsed = pay.parseItems(b.items);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const rows = parsed.items.map(i => ({ kind: b.kind, ...i, created_by_id: String(req.user.id), created_by_name: req.user.name }));
    const { error } = await supabase.from('payment_lines').insert(rows);
    if (error) throw error;

    const t = pay.totalsOf(rows);
    await logActivity(req, {
      category: 'payment', action: 'payments_added', entityType: 'payment',
      entityLabel: `${pay.KIND_LABEL[b.kind]} — ${rows.length} line${rows.length === 1 ? '' : 's'} — payable ${pay.money(t.payable)}, paid ${pay.money(t.paid)}`,
      changes: rows.map(r => ({ field: r.party_name, from: null, to: `${pay.dmy(r.pay_date)} — ${r.item} — payable ${pay.money(r.payable)}, paid ${pay.money(r.paid)}${r.paid_by ? ` — paid by ${r.paid_by}` : ''}` })),
    });
    res.status(201).json({ success: true, count: rows.length, totals: t });
  } catch (err) {
    sendError(res, err, 'POST /payments');
  }
});

router.put('/:id', requirePerm('payments.edit'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Payment not found.' });
    const { data: before, error: getErr } = await supabase.from('payment_lines').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!before) return res.status(404).json({ error: 'Payment not found.' });

    const kind = req.body && req.body.kind !== undefined ? req.body.kind : before.kind;
    if (!pay.KINDS.includes(kind)) return res.status(400).json({ error: 'Choose Company Payments or Outside Rental Payments.' });
    const one = pay.parseLine(req.body || {});
    if (one.error) return res.status(400).json({ error: one.error });
    const n = one.line;

    const changes = [];
    if (kind !== before.kind) changes.push({ field: 'Paying', from: pay.KIND_LABEL[before.kind], to: pay.KIND_LABEL[kind] });
    const beforeDate = before.pay_date ? String(before.pay_date).slice(0, 10) : String(before.created_at || '').slice(0, 10);
    if (req.body.pay_date !== undefined && n.pay_date !== beforeDate) changes.push({ field: 'Date', from: pay.dmy(beforeDate), to: pay.dmy(n.pay_date) });
    if (n.party_name !== before.party_name) changes.push({ field: 'Name', from: before.party_name, to: n.party_name });
    if (n.item !== (before.item || '')) changes.push({ field: 'Item', from: before.item || null, to: n.item });
    if (n.description !== (before.description || '')) changes.push({ field: 'Description', from: before.description || null, to: n.description || null });
    if (n.payable !== Number(before.payable)) changes.push({ field: 'Payable', from: pay.money(before.payable), to: pay.money(n.payable) });
    if (n.paid !== Number(before.paid)) changes.push({ field: 'Paid', from: pay.money(before.paid), to: pay.money(n.paid) });
    if (n.paid_by !== (before.paid_by || '')) changes.push({ field: 'Paid by', from: before.paid_by || null, to: n.paid_by || null });
    if (!changes.length) return res.json({ success: true, unchanged: true, data: publicRow(before) });

    const rErr = reasonError(req.body.reason, 'change a payment');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data, error } = await supabase.from('payment_lines')
      .update({ kind, ...n, ...(req.body.pay_date === undefined ? { pay_date: beforeDate } : {}), updated_at: new Date().toISOString(), updated_by_name: req.user.name })
      .eq('id', req.params.id).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Payment not found.' });

    await logActivity(req, {
      category: 'payment', action: 'payment_updated', entityType: 'payment', entityId: data.id,
      entityLabel: `${n.party_name} — ${pay.KIND_LABEL[kind]} — ${n.item}`, reason, changes,
    });
    res.json({ success: true, data: publicRow(data) });
  } catch (err) {
    sendError(res, err, 'PUT /payments/:id');
  }
});

router.delete('/:id', requirePerm('payments.edit'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Payment not found.' });
    const rErr = reasonError(req.body && req.body.reason, 'delete a payment');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: p, error: getErr } = await supabase.from('payment_lines').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!p) return res.status(404).json({ error: 'Payment not found.' });

    await archive.keep(req, { type: 'payment', id: p.id, label: `${p.party_name} — ${pay.KIND_LABEL[p.kind]} — ${p.item || ''}`, detail: `Payable ${pay.money(p.payable)} · Paid ${pay.money(p.paid)}`, row: p, reason });
    const { error } = await supabase.from('payment_lines').delete().eq('id', req.params.id);
    if (error) throw error;
    await logActivity(req, {
      category: 'payment', action: 'payment_deleted', entityType: 'payment', entityId: p.id,
      entityLabel: `${p.party_name} — ${pay.KIND_LABEL[p.kind]} — ${p.item || ''}`, reason,
      changes: [
        { field: 'Payable', from: pay.money(p.payable), to: null },
        { field: 'Paid', from: pay.money(p.paid), to: null },
      ],
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'DELETE /payments/:id');
  }
});

module.exports = router;
