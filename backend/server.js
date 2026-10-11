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
if (process.env.JWT_SECRET.length < 32) {
  // Not fatal (that could take a working site down on deploy), but anyone can forge a login token
  // if this secret can be guessed, so it deserves a loud warning.
  console.warn('\n⚠️   JWT_SECRET is shorter than 32 characters. Use a long random value (64+ characters), for example:');
  console.warn('    node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"\n');
}
if (/change-this/i.test(process.env.JWT_SECRET) && process.env.NODE_ENV === 'production') {
  console.error('❌  JWT_SECRET is still the placeholder value. Set a real secret before running in production.');
  process.exit(1);
}

const entriesRouter   = require('./routes/entries');
const authRouter      = require('./routes/auth');
const usersRouter     = require('./routes/users');
const inventoryRouter = require('./routes/inventory');
const logsRouter      = require('./routes/logs');
const uploadsRouter   = require('./routes/uploads');
const reportsRouter   = require('./routes/reports');
const documentsRouter = require('./routes/documents');
const paymentsRouter  = require('./routes/payments');
const documentsUtil   = require('./utils/documents');
const { ensureBucket } = require('./utils/photos');
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
// Content Security Policy: tells the browser exactly where this site may load things from, so that even
// if some page text were ever tricked into running a script, the script could not load code from another
// website, send data to one, or frame / re-base the page.
// (Inline scripts and styles are still allowed because the pages use inline click handlers.)
const supabaseOrigin = (() => { try { return new URL(process.env.SUPABASE_URL).origin; } catch { return 'https://*.supabase.co'; } })();
const extraImgOrigins = (process.env.CSP_IMG_EXTRA || '').split(',').map(o => o.trim()).filter(Boolean);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', supabaseOrigin, ...extraImgOrigins],   // reading photos open from the Supabase address
      connectSrc: ["'self'"],
      manifestSrc: ["'self'"],
      workerSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
    },
  },
}));

// The website and the API are served from the SAME address, so no cross-origin access is needed at all:
// by default NO CORS headers are sent, and browsers then stop other websites from reading API responses.
// (cors() with no options would do the opposite — it sends "Access-Control-Allow-Origin: *".)
// Only if the frontend is ever hosted on a different domain, set ALLOWED_ORIGIN (comma-separated list).
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '').split(',').map(o => o.trim()).filter(Boolean);
if (allowedOrigins.length) app.use(cors({ origin: allowedOrigins }));

// Extra browser hardening on every response.
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), payment=(), usb=()');
  res.set('Cross-Origin-Resource-Policy', 'same-origin');
  next();
});

// Cap body size — the app only ever posts small JSON payloads (log entries),
// so this blocks accidental/malicious oversized requests.
app.use(express.json({ limit: '200kb' }));   // the app only ever sends JSON, so no other body format is accepted

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
// Explicit route as a safety net: some static-file configs ignore dotfiles/dot-folders
// by default, and .well-known/assetlinks.json must always be reachable for the
// Android app (Play Store) to verify this domain and hide its browser address bar.
app.use('/.well-known', express.static(path.join(__dirname, '../frontend/.well-known'), { dotfiles: 'allow' }));

// API answers contain business data — never let a browser, proxy or shared computer keep a copy.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/entries',   entriesRouter);
app.use('/api/users',     usersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/logs',      logsRouter);
app.use('/api/uploads',   uploadsRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/payments',  paymentsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Sri Charan Constructions', time: new Date().toISOString() });
});

// Unknown /api/* routes get a proper JSON 404 (not the index.html page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });   // (deliberately does not repeat what was asked for)
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
  if (err.type === 'entity.too.large') {
    const url = String(req.originalUrl || '');
    const msg = url.startsWith('/api/uploads') ? 'That photo is too large. Please choose a smaller one.'
      : url.startsWith('/api/documents') ? `That file is too large (${documentsUtil.MAX_MB} MB at most).`
      : 'Request is too large.';
    return res.status(413).json({ error: msg });
  }
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong on the server.' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏗️  Sri Charan Constructions`);
  console.log(`✅  Server running at http://localhost:${PORT}`);
  console.log(`📋  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  checkLogsTable();   // warns if the activity_logs table hasn't been created yet
  ensureBucket();     // creates the private photo bucket on first start if it doesn't exist
  documentsUtil.ensureBucket();   // …and the private documents bucket
});
