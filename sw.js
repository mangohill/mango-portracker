// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Tracker — Service Worker
// Strategy: Cache-first, background update
// Scope: https://mangohill.github.io/mango-mango/
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'portfolio-tracker-v3';
const BASE       = '/mango-mango/';

const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.css',
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

// ── Install: pre-cache everything ────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Pre-caching', PRECACHE_URLS.length, 'files');
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          fetch(url).then(res => {
            if (res.ok) return cache.put(url, res);
          }).catch(() => {})
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first, background revalidation ──────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== location.origin)  return;

  // Skip API calls
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

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      const networkFetch = fetch(event.request).then(res => {
        if (res && res.ok) {
          cache.put(event.request, res.clone());
          self.clients.matchAll().then(clients =>
            clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
          );
        }
        return res;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const res = await networkFetch;
      if (res) return res;

      return new Response('App offline. Open while connected first.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' }
      });
    })
  );
});
