/**
 * The signed-in person's own account.
 *   POST /api/account/change-pin   { current_pin, new_pin }   — anyone signed in may change THEIR OWN PIN
 * The PIN is never written to the Activity Log (only the fact that it was changed).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validatePin, hashPin, matchesPin } = require('../utils/pin');
const { logActivity } = require('../utils/activity');

const PIN_RULE = 'The PIN must be 4 to 10 characters with no spaces.';
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in a few minutes.' },
});

router.use(requireAuth);

router.post('/change-pin', limiter, async (req, res) => {
  try {
    const b = req.body || {};
    const current = typeof b.current_pin === 'string' ? b.current_pin : '';
    const next = typeof b.new_pin === 'string' ? b.new_pin : '';
    if (!current) return res.status(400).json({ error: 'Enter your current PIN.' });
    if (!validatePin(next)) return res.status(400).json({ error: PIN_RULE });
    if (next === current) return res.status(400).json({ error: 'The new PIN must be different from your current PIN.' });

    const { data: users, error } = await supabase.from('users').select('id, pin');
    if (error) throw error;
    const me = (users || []).find(u => String(u.id) === String(req.user.id));
    if (!me || !(await matchesPin(current, me.pin))) return res.status(400).json({ error: 'Your current PIN is not correct.' });
    for (const u of users) {
      // eslint-disable-next-line no-await-in-loop
      if (String(u.id) !== String(me.id) && await matchesPin(next, u.pin)) return res.status(409).json({ error: 'That PIN is already in use. Please choose a different one.' });
    }
    const { error: upErr } = await supabase.from('users').update({ pin: await hashPin(next) }).eq('id', me.id);
    if (upErr) throw upErr;
    await logActivity(req, { category: 'user', action: 'pin_changed', entityType: 'user', entityId: String(me.id), entityLabel: `${req.user.name} changed their own PIN` });
    res.json({ success: true });
  } catch (err) {
    console.error('POST /account/change-pin:', err.message);
    res.status(500).json({ error: 'Your PIN could not be changed. Please try again.' });
  }
});

module.exports = router;
