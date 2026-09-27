const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
require('dotenv').config();
const supabase = require('../config/supabase');
const { requireAuth, JWT_SECRET } = require('../middleware/auth');

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN is required.' });

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('pin', pin)
      .eq('active', true)
      .maybeSingle();

    if (error) throw error;
    if (!user) return res.status(401).json({ error: 'Incorrect PIN. Please try again.' });

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

// ── GET /api/auth/verify ─────────────────────────────────────────────────────
router.get('/verify', requireAuth, (req, res) => {
  res.json({ success: true, user: req.user });
});

module.exports = router;
