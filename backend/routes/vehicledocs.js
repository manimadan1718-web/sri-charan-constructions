/**
 * Vehicle documents — one row per vehicle: Insurance, Permit, Tax, FC, PUCC (their due dates) and the Registration date.
 *   GET /api/vehicle-docs                                  the table                                                      (renewals.view)
 *   PUT /api/vehicle-docs/:vehicleId/registration          { date, reason? }  set / change the registration date          (renewals.add; changing it: renewals.edit + reason)
 *   PUT /api/vehicle-docs/:vehicleId/:kind                 { date, reason? }  kind = insurance | permit | tax | fc | pucc
 *        – no date yet                → a new renewal is created (renewals.add)
 *        – a LATER date than the old  → counts as renewing: the old one is marked renewed and a new one starts (renewals.add)
 *        – an EARLIER date            → a correction: needs renewals.edit and a written reason
 */
const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requirePerm, hasPerm } = require('../middleware/auth');
const { logActivity, cleanReason, reasonError } = require('../utils/activity');
const { serverError } = require('../utils/http');
const R = require('../utils/renewals');
const V = require('../utils/vehicleDocs');

router.use(requireAuth);
const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;
const sendError = (res, err, where) => (V.isSetup(err) || R.isMissingRenewals(err) ? res.status(503).json({ error: V.SETUP_MESSAGE, setup_required: true }) : serverError(res, err, where));
const catchUp = () => R.runReminders().catch(e => console.warn('Renewal reminders:', e.message));
const denied = res => res.status(403).json({ error: 'You do not have permission to do this.' });

function parseDay(v, { noFuture, today } = {}) {
  const d = String(v == null ? '' : v).trim();
  if (!d) return { error: 'Choose the date.' };
  if (!R.validDay(d) || d < '2000-01-01' || d > '2100-12-31') return { error: 'That is not a valid date.' };
  if (noFuture && d > today) return { error: 'The registration date cannot be in the future.' };
  return { date: d };
}
async function vehicleOf(id) {
  const { data, error } = await supabase.from('vehicles').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

router.get('/', requirePerm('renewals.view'), async (req, res) => {
  try { res.json({ success: true, ...(await V.load()) }); } catch (err) { sendError(res, err, 'GET /vehicle-docs'); }
});

router.put('/:vid/registration', requirePerm('renewals.add'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.vid)) return res.status(404).json({ error: 'Vehicle not found.' });
    const p = parseDay(req.body && req.body.date, { noFuture: true, today: R.todayIST() }); if (p.error) return res.status(400).json({ error: p.error });
    const veh = await vehicleOf(req.params.vid); if (!veh) return res.status(404).json({ error: 'Vehicle not found.' });
    const was = veh.registration_date ? String(veh.registration_date).slice(0, 10) : null;
    if (was === p.date) return res.json({ success: true, unchanged: true });
    let reason;
    if (was) {
      if (!hasPerm(req, 'renewals.edit')) return denied(res);
      const rErr = reasonError(req.body.reason, 'change a registration date'); if (rErr) return res.status(400).json({ error: rErr });
      reason = cleanReason(req.body.reason);
    }
    const { error } = await supabase.from('vehicles').update({ registration_date: p.date }).eq('id', veh.id);
    if (error) throw error;
    await logActivity(req, { category: 'renewal', action: 'vehicle_reg_set', entityType: 'vehicle', entityId: veh.id, entityLabel: veh.vehicle_no, reason,
      changes: [{ field: 'Registration date', from: was ? R.dmy(was) : null, to: R.dmy(p.date) }] });
    res.json({ success: true });
  } catch (err) { sendError(res, err, 'PUT /vehicle-docs/:vid/registration'); }
});

router.put('/:vid/:kind', requirePerm('renewals.add'), async (req, res) => {
  try {
    const kind = V.KIND[req.params.kind];
    if (!kind || !ID_RE.test(req.params.vid)) return res.status(404).json({ error: 'Vehicle or document not found.' });
    const p = parseDay(req.body && req.body.date); if (p.error) return res.status(400).json({ error: p.error });
    const veh = await vehicleOf(req.params.vid); if (!veh) return res.status(404).json({ error: 'Vehicle not found.' });
    const lbl = r => `${kind.type} — ${veh.vehicle_no} — ${R.dmy(String(r.renewal_date).slice(0, 10))}`;
    const { data: live, error: gErr } = await supabase.from('renewals').select('*').eq('vehicle_id', String(veh.id)).eq('doc_kind', kind.key).eq('status', 'active').order('renewal_date', { ascending: true });
    if (gErr) throw gErr;
    const cur = (live || [])[0], by = { created_by_id: String(req.user.id), created_by_name: req.user.name };
    const insert = async src => {
      const { data, error } = await supabase.from('renewals').insert({ renewal_type: kind.type, description: veh.vehicle_no, amount: src ? src.amount : 0, paid_by: src ? src.paid_by || '' : '',
        renewal_date: p.date, status: 'active', vehicle_id: String(veh.id), doc_kind: kind.key, ...by }).select('*').single();
      if (error) { if (error.code === '23505') { const e = new Error('conflict'); e.conflict = true; throw e; } throw error; }
      return data;
    };
    if (!cur) {
      const row = await insert(null);
      await logActivity(req, { category: 'renewal', action: 'renewal_added', entityType: 'renewal', entityId: row.id, entityLabel: lbl(row), changes: [{ field: 'Vehicle', from: null, to: veh.vehicle_no }, { field: 'Renewal date', from: null, to: R.dmy(p.date) }] });
    } else {
      const was = String(cur.renewal_date).slice(0, 10);
      if (was === p.date) return res.json({ success: true, unchanged: true });
      if (p.date > was) {                                                   // a later date = it was renewed
        const today = R.todayIST();
        const { error } = await supabase.from('renewals').update({ status: 'renewed', renewed_on: today, renewed_by_name: req.user.name, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', cur.id);
        if (error) throw error;
        await R.resetAlerts(cur.id);
        await logActivity(req, { category: 'renewal', action: 'renewal_renewed', entityType: 'renewal', entityId: cur.id, entityLabel: lbl(cur), changes: [{ field: 'Status', from: 'Active', to: `Renewed on ${R.dmy(today)}` }] });
        const row = await insert(cur);
        await logActivity(req, { category: 'renewal', action: 'renewal_added', entityType: 'renewal', entityId: row.id, entityLabel: lbl(row), changes: [{ field: 'Next cycle of', from: null, to: lbl(cur) }] });
      } else {                                                              // an earlier date = fixing a mistake
        if (!hasPerm(req, 'renewals.edit')) return res.status(403).json({ error: 'A date earlier than the saved one is a correction, and you may not edit renewals. Ask the Admin.' });
        const rErr = reasonError(req.body.reason, 'change a due date'); if (rErr) return res.status(400).json({ error: rErr });
        const { error } = await supabase.from('renewals').update({ renewal_date: p.date, updated_at: new Date().toISOString(), updated_by_name: req.user.name }).eq('id', cur.id);
        if (error) throw error;
        await R.resetAlerts(cur.id);
        await logActivity(req, { category: 'renewal', action: 'renewal_updated', entityType: 'renewal', entityId: cur.id, entityLabel: lbl(cur), reason: cleanReason(req.body.reason),
          changes: [{ field: 'Renewal date', from: R.dmy(was), to: R.dmy(p.date) }] });
      }
    }
    await catchUp();
    res.json({ success: true });
  } catch (err) {
    if (err && err.conflict) return res.status(409).json({ error: 'Someone just changed this date. Please reload and try again.' });
    sendError(res, err, 'PUT /vehicle-docs/:vid/:kind');
  }
});

module.exports = router;
