const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const supabase = require('../config/supabase');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');
const { matchesPin, isHashed, hashPin } = require('../utils/pin');
const { logActivity } = require('../utils/activity');

// Login attempts are rate-limited much more tightly than the rest of the API,
// since PINs are short and otherwise brute-forceable.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // Record the moment an address gets blocked (once — not for every blocked request).
  handler: (req, res, next, options) => {
    if (req.rateLimit && req.rateLimit.used === req.rateLimit.limit + 1) {
      logActivity(req, { category: 'auth', action: 'login_blocked', entityLabel: 'Too many login attempts — temporarily blocked' });
    }
    res.status(options.statusCode).json({ error: 'Too many login attempts. Please try again in a few minutes.' });
  },
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { pin } = req.body || {};
    if (!pin || typeof pin !== 'string') {
      return res.status(400).json({ error: 'PIN is required.' });
    }

    // PINs are stored as bcrypt hashes, so a direct equality lookup isn't
    // possible — fetch active users and compare against each.
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('active', true);

    if (error) throw error;

    let user = null;
    for (const candidate of users || []) {
      // eslint-disable-next-line no-await-in-loop
      if (await matchesPin(pin, candidate.pin)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      // The PIN that was typed is never stored — only the fact that an attempt failed.
      await logActivity(req, { category: 'auth', action: 'login_failed', entityLabel: 'Incorrect PIN' });
      return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });
    }

    // Legacy plain-text PIN (e.g. the seeded Admin from an older setup) —
    // upgrade it to a bcrypt hash now that we know the correct PIN.
    if (!isHashed(user.pin)) {
      try {
        const { error: upErr } = await supabase
          .from('users')
          .update({ pin: await hashPin(pin) })
          .eq('id', user.id);
        if (upErr) throw upErr;
      } catch (e) {
        console.error('PIN hash upgrade failed:', e.message);
      }
    }

    await logActivity(req, { category: 'auth', action: 'login', entityLabel: 'Signed in', user });

    const token = jwt.sign(
      { id: user.id, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('POST /auth/login:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
// Tokens are stateless, so this only records the sign-out in the activity log.
router.post('/logout', requireAuth, async (req, res) => {
  await logActivity(req, { category: 'auth', action: 'logout', entityLabel: 'Signed out' });
  res.json({ success: true });
});

// ── GET /api/auth/verify ─────────────────────────────────────────────────────
router.get('/verify', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
