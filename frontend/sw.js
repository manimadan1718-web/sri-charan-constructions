/*
 * Service worker — makes the app installable and gives a friendly "you're offline" page.
 *
 * SAFETY RULES (do not change lightly):
 *   • Requests to /api/ are NEVER touched or cached — no personal or business data is stored on the phone.
 *   • Pages and scripts are "network first": after every deploy, people get the new version straight away.
 *     The cache is only a fallback for when the network fails.
 *   • Bump VERSION whenever you change the list below, so old caches are cleaned up.
 */
const VERSION = 'v1';
const SHELL   = `scc-shell-${VERSION}`;
const RUNTIME = `scc-runtime-${VERSION}`;

const PRECACHE = [
  '/offline.html',
  '/css/style.css',
  '/js/api.js',
  '/js/app.js',
  '/img/logo.png',
  '/img/favicon.png',
  '/img/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isImage = path => /\.(?:png|jpe?g|webp|svg|ico)$/i.test(path);
const cacheable = res => res && res.ok && res.type === 'basic';

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (cacheable(res)) {
      const copy = res.clone();
      caches.open(RUNTIME).then(c => c.put(request, copy));
    }
    return res;
  } catch {
    const hit = await caches.match(request);
    return hit || new Response('', { status: 504, statusText: 'Offline' });
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(res => {
    if (cacheable(res)) { const copy = res.clone(); caches.open(RUNTIME).then(c => c.put(request, copy)); }
    return res;
  }).catch(() => null);
  return cached || (await refresh) || new Response('', { status: 504, statusText: 'Offline' });
}

async function page(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match('/offline.html')) || new Response('You are offline.', { status: 503 });
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                 // Google Fonts etc.: leave alone
  if (url.pathname.startsWith('/api/')) return;                    // never cache API / personal data
  if (url.pathname.startsWith('/.well-known/')) return;
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') { event.respondWith(page(req)); return; }
  if (isImage(url.pathname))   { event.respondWith(staleWhileRevalidate(req)); return; }
  event.respondWith(networkFirst(req));
});
