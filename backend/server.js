require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const rateLimit = require('express-rate-limit');

// ── Fail fast on missing config ──────────────────────────────────────────────
// Without JWT_SECRET, every login would 500 with a confusing message.
if (!process.env.JWT_SECRET) {
  console.error('❌  Missing JWT_SECRET in .env — set it to a long random string.');
  process.exit(1);
}
if (/change-this/i.test(process.env.JWT_SECRET) && process.env.NODE_ENV === 'production') {
  console.error('❌  JWT_SECRET is still the placeholder value. Set a real secret before running in production.');
  process.exit(1);
}

const entriesRouter   = require('./routes/entries');
const summariesRouter = require('./routes/summaries');
const authRouter      = require('./routes/auth');
const usersRouter     = require('./routes/users');
const inventoryRouter = require('./routes/inventory');
const logsRouter      = require('./routes/logs');
const { checkLogsTable } = require('./utils/activity');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind Render / Railway / nginx the real client IP arrives in X-Forwarded-For.
// Without this, the rate limiters see the proxy's IP for everybody (so one
// person's failed logins would lock out every user) and express-rate-limit
// logs validation errors.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// ── Middleware ───────────────────────────────────────────────────────────────
// Sets sane security headers (X-Content-Type-Options, HSTS, etc.).
// CSP is disabled here because the frontend is plain static HTML/JS served
// from the same origin with only Google Fonts as an external resource — if
// that changes, turn CSP back on and configure it explicitly.
app.use(helmet({ contentSecurityPolicy: false }));

// By default this only allows same-origin requests (the browser doesn't send
// an Origin header for same-origin calls, so cors() with no config is a
// no-op there). Set ALLOWED_ORIGIN in .env only if the frontend is ever
// served from a different domain than the API.
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));

// Cap body size — the app only ever posts small JSON payloads (log entries),
// so this blocks accidental/malicious oversized requests.
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true, limit: '200kb' }));

// Rate limiting (protect API from abuse). The login route has its own,
// stricter limiter layered on top of this (see routes/auth.js).
// The message is JSON so the frontend can show it instead of failing to parse it.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});
app.use('/api/', limiter);

// ── Serve Frontend ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/entries',   entriesRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/users',     usersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/logs',      logsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Sri Charan Constructions', time: new Date().toISOString() });
});

// Unknown /api/* routes get a proper JSON 404 (not the index.html page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.originalUrl}` });
});

// ── Catch-all → serve frontend ───────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ── Error handler ────────────────────────────────────────────────────────────
// Malformed JSON bodies, oversized payloads, etc. would otherwise return
// Express's default HTML error page, which the frontend can't parse.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON in request body.' });
  if (err.type === 'entity.too.large')    return res.status(413).json({ error: 'Request is too large.' });
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong on the server.' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏗️  Sri Charan Constructions`);
  console.log(`✅  Server running at http://localhost:${PORT}`);
  console.log(`📋  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  checkLogsTable();   // warns if the activity_logs table hasn't been created yet
});
