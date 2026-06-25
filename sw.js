// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Tracker — Service Worker
// Strategy: Network-first for JS/CSS/HTML, cache fallback for offline
// Bumping CACHE_NAME forces old cache deletion on next visit.
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'portfolio-tracker-v7';
const BASE       = '/mango-mango/';

const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.css',
  BASE + 'version.json',
  BASE + 'lib/xlsx.min.js',
  BASE + 'lib/chart.min.js',
  BASE + 'js/helpers.js',
  BASE + 'js/imports.js',
  BASE + 'js/portfolio.js',
  BASE + 'js/trades.js',
  BASE + 'js/prices.js',
  BASE + 'js/analytics.js',
  BASE + 'js/dividends.js',
  BASE + 'js/properties.js',
  BASE + 'js/settings.js',
  BASE + 'js/spending.js',
  BASE + 'js/backup.js',
  BASE + 'js/tax.js',
  BASE + 'js/sw-register.js',
];

// JS/CSS/HTML files — always try network first so updates are instant
const NETWORK_FIRST_EXTS = ['.js', '.css', '.html'];
function isNetworkFirst(url) {
  const path = new URL(url).pathname;
  return NETWORK_FIRST_EXTS.some(ext => path.endsWith(ext)) || path.endsWith('/');
}

// ── Install: pre-cache everything, take over immediately ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching', PRECACHE_URLS.length, 'files');
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          fetch(url, { cache: 'no-cache' }).then(res => {
            if (res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())  // take over without waiting for tabs to close
  );
});

// ── Activate: delete ALL old caches, claim all clients immediately ────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())  // take control of all open tabs now
  );
});

// ── Message: page can request skipWaiting ────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin)  return;

  // Skip API/external calls entirely — let them go straight to network
  const isApi = url.pathname.startsWith('/api/') ||
    url.searchParams.has('symbols') ||
    url.searchParams.has('maif') ||
    url.searchParams.has('divs') ||
    url.hostname.includes('github') ||
    url.hostname.includes('yahoo') ||
    url.hostname.includes('gist') ||
    url.hostname.includes('monash') ||
    url.hostname.includes('cloudflare');
  if (isApi) return;

  if (isNetworkFirst(event.request.url)) {
    // ── Network-first for JS/CSS/HTML: always get fresh code ─────────────────
    event.respondWith(
      fetch(event.request, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) {
          // Update cache with fresh version
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, res.clone()));
        }
        return res;
      }).catch(() =>
        // Offline fallback: serve from cache
        caches.match(event.request)
      )
    );
  } else {
    // ── Cache-first for images/fonts/other static assets ─────────────────────
    event.respondWith(
      caches.open(CACHE_NAME).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const res = await fetch(event.request).catch(() => null);
        if (res && res.ok) cache.put(event.request, res.clone());
        return res || new Response('Offline', { status: 503 });
      })
    );
  }
});