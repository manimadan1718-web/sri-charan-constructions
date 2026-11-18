/**
 * Feedback from the people using the app — suggestions, problems and questions — read by the Admin.
 *   POST   /api/feedback          { kind: suggestion|problem|question, message, page? }   anyone signed in
 *   GET    /api/feedback          the messages, newest first (+ how many are new)         Admin
 *   PUT    /api/feedback/:id      { status: 'new' | 'read' }                              Admin
 *   DELETE /api/feedback/:id                                                              Admin
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../utils/activity');

const KINDS = ['suggestion', 'problem', 'question'];
const MIN_LEN = 5, MAX_LEN = 1500;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETUP_MESSAGE = 'Feedback needs a one-time database update. Run run-in-supabase-16-feedback.sql in Supabase > SQL Editor, then try again.';
const isMissing = err => !!err && /feedback/i.test(String(err.message || '')) && (/(relationship|schema cache|does not exist|relation)/i.test(String(err.message || '')) || ['PGRST200', 'PGRST205', '42P01'].includes(err.code));
const clean = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'You have sent a lot of feedback just now. Please try again later.' } });

router.use(requireAuth);

router.post('/', limiter, async (req, res) => {
  try {
    const b = req.body || {};
    const kind = KINDS.includes(b.kind) ? b.kind : null;
    if (!kind) return res.status(400).json({ error: 'Choose what you are sending: a suggestion, a problem or a question.' });
    const message = String(b.message == null ? '' : b.message).replace(/\r\n/g, '\n').trim();
    if (message.length < MIN_LEN) return res.status(400).json({ error: 'Please write a little more (at least 5 characters).' });
    if (message.length > MAX_LEN) return res.status(400).json({ error: `Please keep it under ${MAX_LEN} characters.` });
    const r = Number(b.rating);
    const rating = Number.isInteger(r) && r >= 1 && r <= 5 ? r : null;
    const row = { user_id: String(req.user.id), user_name: req.user.name, user_role: req.user.role, kind, message, page: clean(b.page, 60), status: 'new' };
    if (rating) row.rating = rating;
    let { data, error } = await supabase.from('feedback').insert(row).select('*').maybeSingle();
    if (error && rating && /rating/i.test(String(error.message || ''))) {        // run-in-supabase-17 not run yet: still save the message
      delete row.rating; ({ data, error } = await supabase.from('feedback').insert(row).select('*').maybeSingle());
    }
    if (error) { if (isMissing(error)) return res.status(503).json({ error: SETUP_MESSAGE, setup_required: true }); throw error; }
    await logActivity(req, { category: 'system', action: 'feedback_sent', entityType: 'feedback', entityId: data && data.id ? String(data.id) : null, entityLabel: `${req.user.name} sent a ${kind}` });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('POST /feedback:', err.message);
    res.status(500).json({ error: 'Your feedback could not be sent. Please try again.' });
  }
});

router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const { data, error } = await supabase.from('feedback').select('*').order('created_at', { ascending: false }).range(0, 299);
    if (error) { if (isMissing(error)) return res.json({ success: true, data: [], unread: 0, setup_required: true }); throw error; }
    res.json({ success: true, data: data || [], unread: (data || []).filter(r => r.status === 'new').length });
  } catch (err) {
    console.error('GET /feedback:', err.message);
    res.status(500).json({ error: 'The feedback could not be loaded.' });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Feedback not found.' });
    const status = req.body && req.body.status;
    if (status !== 'new' && status !== 'read') return res.status(400).json({ error: 'status must be new or read.' });
    const { data, error } = await supabase.from('feedback').update({ status }).eq('id', req.params.id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Feedback not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /feedback/:id:', err.message);
    res.status(500).json({ error: 'Could not update it.' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    if (!ID_RE.test(req.params.id)) return res.status(404).json({ error: 'Feedback not found.' });
    const { error } = await supabase.from('feedback').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /feedback/:id:', err.message);
    res.status(500).json({ error: 'Could not delete it.' });
  }
});

module.exports = router;
