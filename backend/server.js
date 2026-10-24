require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
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
const progressRouter = require('./routes/progress');
const renewalsRouter = require('./routes/renewals');
const notificationsRouter = require('./routes/notifications');
const renewalsUtil = require('./utils/renewals');
const reportsRouter   = require('./routes/reports');
const documentsRouter = require('./routes/documents');
const paymentsRouter  = require('./routes/payments');
const purchasesRouter = require('./routes/purchases');
const permissionsRouter = require('./routes/permissions');
const filesRouter     = require('./routes/files');
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
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],               // fonts are served from this site (/fonts) — nothing is fetched from another company
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
  max: parseInt(process.env.API_RATE_LIMIT, 10) || 300,       // requests per address per 15 minutes (the default is right for real use)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});
app.use('/api/', limiter);

// Smaller downloads on a phone connection (app.js alone drops from ~130 KB to ~30 KB).
app.use(compression());

// ── Android app verification (Play Store) ────────────────────────────────────
// Google checks this file to confirm the Android app and this website belong together (which is what hides the
// browser address bar). It is built from the server settings, so no code change is needed once the app is signed:
//   ANDROID_PACKAGE_NAME             e.g. com.sricharanconstructions.sitelog
//   ANDROID_SHA256_CERT_FINGERPRINTS one or more SHA-256 fingerprints from Play Console, separated by commas
// Until a fingerprint is set the file is a valid but empty list — it never contains made-up values.
app.get('/.well-known/assetlinks.json', (req, res) => {
  const pkg = (process.env.ANDROID_PACKAGE_NAME || 'com.sricharanconstructions.sitelog').trim();
  const prints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '').split(',').map(x => x.trim().toUpperCase())
    .filter(x => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x));
  const valid = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(pkg);
  const body = prints.length && valid
    ? [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints } }]
    : [];
  res.set('Cache-Control', 'public, max-age=300').type('application/json').send(JSON.stringify(body, null, 2));
});

// ── Public contact details (shown in the footer and the privacy policy) ──────
// Only what the owner chooses to set on the server; nothing is invented. Validated before it is ever sent.
app.get('/api/public-config', (req, res) => {
  const email = (process.env.SUPPORT_EMAIL || '').trim();
  const phone = (process.env.SUPPORT_PHONE || '').trim();
  res.set('Cache-Control', 'public, max-age=3600').json({
    success: true,
    support_email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(email) && email.length <= 120 ? email : null,
    support_phone: /^\+?[0-9 ()-]{7,20}$/.test(phone) ? phone : null,
  });
});

// ── Serve Frontend ───────────────────────────────────────────────────────────
// Pictures and fonts change rarely: let the phone keep them for 30 days. Pages, scripts and styles are always
// re-checked, so a new deploy reaches everybody straight away.
app.use(express.static(path.join(__dirname, '../frontend'), {
  setHeaders(res, file) {
    res.setHeader('Cache-Control', /\.(?:woff2|png|jpe?g|webp|ico)$/i.test(file) ? 'public, max-age=2592000' : 'no-cache');
  },
}));

// API answers contain business data — never let a browser, proxy or shared computer keep a copy.
app.use('/api', (req, res, next) => { if (!res.get('Cache-Control')) res.set('Cache-Control', 'no-store'); next(); });

// ── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',      authRouter);
app.use('/api/entries',   entriesRouter);
app.use('/api/users',     usersRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/logs',      logsRouter);
app.use('/api/uploads',   uploadsRouter);
app.use('/api/progress',  progressRouter);
app.use('/api/renewals',  renewalsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports',   reportsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/payments',  paymentsRouter);
app.use('/api/purchases', purchasesRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/files',     filesRouter);        // short-lived "view" links (no sign-in header possible in a new tab)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Sri Charan Constructions', time: new Date().toISOString() });
});

// Unknown /api/* routes get a proper JSON 404 (not the index.html page).
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found.' });   // (deliberately does not repeat what was asked for)
});

// ── Anything else: a proper 404 page (with a 404 status) ─────────────────────
// The app lives at "/" and its pages are real files, so an address that matched nothing above does not exist.
app.use((req, res) => {
  res.status(404);
  if (req.method === 'GET' || req.method === 'HEAD') return res.sendFile(path.join(__dirname, '../frontend/404.html'));
  res.type('text/plain').send('Not found.');
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
      : url.startsWith('/api/documents') || url.startsWith('/api/purchases') || url.startsWith('/api/renewals') ? `That file is too large (${documentsUtil.MAX_MB} MB at most).`
      : 'Request is too large.';
    return res.status(413).json({ error: msg });
  }
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: 'Something went wrong on the server.' });
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  renewalsUtil.start();           // renewal reminders: checked every minute (and whenever somebody opens the app)
  console.log(`\n🏗️  Sri Charan Constructions`);
  console.log(`✅  Server running at http://localhost:${PORT}`);
  console.log(`📋  Environment: ${process.env.NODE_ENV || 'development'}\n`);
  checkLogsTable();   // warns if the activity_logs table hasn't been created yet
  ensureBucket();     // creates the private photo bucket on first start if it doesn't exist
  documentsUtil.ensureBucket();   // …and the private documents bucket
});
