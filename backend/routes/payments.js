const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const { fetchAll } = require('../utils/db');
const pay = require('../utils/payments');

router.use(requireAuth);

const ID_RE = /^[0-9a-fA-F-]{8,64}$/;

const publicRow = p => ({
  id: p.id, pay_type: p.pay_type, period_start: p.period_start, period_end: p.period_end,
  employee_name: p.employee_name, days_worked: Number(p.days_worked), amount: Number(p.amount),
  created_by_name: p.created_by_name, created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name,
});

function sendError(res, err, where) {
  if (pay.isMissingPayments(err)) return res.status(503).json({ error: pay.PAYMENTS_SETUP_MESSAGE, setup_required: true });
  return serverError(res, err, where);
}
const isUniqueViolation = err => !!err && (err.code === '23505' || /duplicate key/i.test(String(err.message || '')));

// ── GET /api/payments?type=weekly|monthly  (Owner + Admin) — every saved line, newest period first ──
router.get('/', requireRole('owner', 'admin'), async (req, res) => {
  try {
    const type = req.query.type;
    if (type !== undefined && !pay.TYPES.includes(type)) return res.status(400).json({ error: 'type must be weekly or monthly.' });
    const { data, error } = await fetchAll(() => {
      let q = supabase.from('payments').select('*')
        .order('period_start', { ascending: false }).order('employee_name', { ascending: true }).order('id', { ascending: true });
      if (type) q = q.eq('pay_type', type);
      return q;
    }, 20000);
    if (error) throw error;
    const rows = data.map(publicRow);
    res.json({ success: true, data: rows, total_amount: rows.reduce((a, r) => a + r.amount, 0).toFixed(2) });
  } catch (err) {
    sendError(res, err, 'GET /payments');
  }
});

// ── GET /api/payments/mine  (Supervisor + Admin) — what THIS person saved recently (read-only) ──
router.get('/mine', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('payments').select('*').eq('created_by_id', String(req.user.id))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 99);
    if (error) throw error;
    res.json({ success: true, data: (data || []).map(publicRow) });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: [] });
    serverError(res, err, 'GET /payments/mine');
  }
});

// ── GET /api/payments/employees  (Supervisor + Admin) — names used before, for the type-ahead list ──
router.get('/employees', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('payments').select('employee_name, created_at').order('created_at', { ascending: false }).range(0, 1999);
    if (error) throw error;
    const seen = new Set(), names = [];
    for (const r of data || []) {
      const k = pay.keyOf(r.employee_name);
      if (!seen.has(k)) { seen.add(k); names.push(r.employee_name); }
      if (names.length >= 300) break;
    }
    res.json({ success: true, data: names.sort((a, b) => a.localeCompare(b)) });
  } catch (err) {
    if (pay.isMissingPayments(err)) return res.json({ success: true, data: [] });
    serverError(res, err, 'GET /payments/employees');
  }
});

// ── POST /api/payments  (Supervisor + Admin) ─────────────────────────────────
// { pay_type: 'weekly' | 'monthly', period: 'YYYY-MM-DD' (any day of the week) | 'YYYY-MM', items: [{ employee_name, days_worked, amount }] }
// All lines are saved together, or none are.
router.post('/', requireRole('supervisor', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!pay.TYPES.includes(b.pay_type)) return res.status(400).json({ error: 'Choose Weekly or Monthly.' });
    const per = pay.resolvePeriod(b.pay_type, b.period);
    if (per.error) return res.status(400).json({ error: per.error });
    const parsed = pay.parseItems(b.items, b.pay_type);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    // Already paid for this period?
    const { data: existing, error: exErr } = await supabase.from('payments')
      .select('employee_name, created_by_name, created_at')
      .eq('pay_type', b.pay_type).eq('period_start', per.start).in('employee_key', parsed.items.map(i => i.employee_key));
    if (exErr) throw exErr;
    if (existing && existing.length) {
      const names = existing.map(e => e.employee_name);
      return res.status(409).json({
        error: `${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} already saved for ${per.label} (${b.pay_type}). Remove ${names.length === 1 ? 'that person' : 'those people'} from this list — nothing was saved.`,
        duplicates: existing.map(e => ({ employee_name: e.employee_name, added_by: e.created_by_name, added_on: e.created_at })),
      });
    }

    const rows = parsed.items.map(i => ({
      pay_type: b.pay_type, period_start: per.start, period_end: per.end,
      employee_name: i.employee_name, employee_key: i.employee_key, days_worked: i.days_worked, amount: i.amount,
      created_by_id: String(req.user.id), created_by_name: req.user.name,
    }));
    const { error } = await supabase.from('payments').insert(rows);
    if (error) {
      if (isUniqueViolation(error)) {
        return res.status(409).json({ error: 'Someone has just saved one of these people for the same period. Reload the page and check before saving again — nothing was saved.' });
      }
      throw error;
    }

    const total = rows.reduce((a, r) => a + r.amount, 0);
    await logActivity(req, {
      category: 'payment', action: 'payments_added', entityType: 'payment',
      entityLabel: `${pay.typeLabel(b.pay_type)} · ${per.label} · ${rows.length} ${rows.length === 1 ? 'person' : 'people'} · ${pay.money(total)}`,
      changes: rows.map(r => ({ field: r.employee_name, from: null, to: `${pay.daysText(r.days_worked)} · ${pay.money(r.amount)}` })),
    });
    res.status(201).json({ success: true, count: rows.length, total: total.toFixed(2), period: { start: per.start, end: per.end, label: per.label } });
  } catch (err) {
    sendError(res, err, 'POST /payments');
  }
});

// ── PUT /api/payments/:id  (Admin only; a written reason is needed, like for entries) ──
router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Payment not found.' });
    const { data: before, error: getErr } = await supabase.from('payments').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!before) return res.status(404).json({ error: 'Payment not found.' });

    const one = pay.parseOne(req.body || {}, before.pay_type, 'This line');
    if (one.error) return res.status(400).json({ error: one.error });
    const n = one.item;

    const changes = [];
    if (n.employee_name !== before.employee_name) changes.push({ field: 'Employee', from: before.employee_name, to: n.employee_name });
    if (n.days_worked !== Number(before.days_worked)) changes.push({ field: 'Days worked', from: String(Number(before.days_worked)), to: String(n.days_worked) });
    if (n.amount !== Number(before.amount)) changes.push({ field: 'Amount', from: pay.money(before.amount), to: pay.money(n.amount) });
    if (!changes.length) return res.json({ success: true, unchanged: true, data: publicRow(before) });

    const rErr = reasonError(req.body.reason, 'change a payment');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    if (n.employee_key !== before.employee_key) {
      const { data: clash, error: clErr } = await supabase.from('payments').select('id')
        .eq('pay_type', before.pay_type).eq('period_start', before.period_start).eq('employee_key', n.employee_key);
      if (clErr) throw clErr;
      if (clash && clash.length) return res.status(409).json({ error: `${n.employee_name} is already saved for this period.` });
    }

    const { data, error } = await supabase.from('payments')
      .update({ employee_name: n.employee_name, employee_key: n.employee_key, days_worked: n.days_worked, amount: n.amount, updated_at: new Date().toISOString(), updated_by_name: req.user.name })
      .eq('id', req.params.id).select('*').maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: `${n.employee_name} is already saved for this period.` });
      throw error;
    }
    if (!data) return res.status(404).json({ error: 'Payment not found.' });

    await logActivity(req, {
      category: 'payment', action: 'payment_updated', entityType: 'payment', entityId: data.id,
      entityLabel: `${n.employee_name} · ${pay.typeLabel(before.pay_type)} · ${pay.dmy(before.period_start)}`, reason, changes,
    });
    res.json({ success: true, data: publicRow(data) });
  } catch (err) {
    sendError(res, err, 'PUT /payments/:id');
  }
});

// ── DELETE /api/payments/:id  (Admin only; needs a written reason) ───────────
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Payment not found.' });
    const rErr = reasonError(req.body && req.body.reason, 'delete a payment');
    if (rErr) return res.status(400).json({ error: rErr });
    const reason = cleanReason(req.body.reason);

    const { data: p, error: getErr } = await supabase.from('payments').select('*').eq('id', req.params.id).maybeSingle();
    if (getErr) throw getErr;
    if (!p) return res.status(404).json({ error: 'Payment not found.' });

    const { error } = await supabase.from('payments').delete().eq('id', req.params.id);
    if (error) throw error;
    await logActivity(req, {
      category: 'payment', action: 'payment_deleted', entityType: 'payment', entityId: p.id,
      entityLabel: `${p.employee_name} · ${pay.typeLabel(p.pay_type)} · ${pay.dmy(p.period_start)}`, reason,
      changes: [
        { field: 'Days worked', from: String(Number(p.days_worked)), to: null },
        { field: 'Amount', from: pay.money(p.amount), to: null },
      ],
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err, 'DELETE /payments/:id');
  }
});

module.exports = router;
