// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Tracker — Service Worker
// Strategy: Cache-first, background update
// Scope: https://mangohill.github.io/mango-mango/
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_NAME = 'portfolio-tracker-v8';
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

self.addEventListener('message', e => { if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting(); });

function isNetworkFirst(u){ const p=new URL(u).pathname; return p.endsWith('.js')||p.endsWith('.css')||p.endsWith('.html')||p.endsWith('/'); }

// ── Fetch ─────────────────────────────────────────────────────────────────────
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

  if(isNetworkFirst(event.request.url)){
    event.respondWith(fetch(event.request,{cache:'no-cache'}).then(res=>{ if(res&&res.ok) caches.open(CACHE_NAME).then(c=>c.put(event.request,res.clone())); return res; }).catch(()=>caches.match(event.request)));
  } else {
    event.respondWith(caches.open(CACHE_NAME).then(async cache=>{ const cached=await cache.match(event.request); if(cached) return cached; const res=await fetch(event.request).catch(()=>null); if(res&&res.ok) cache.put(event.request,res.clone()); return res||new Response('Offline',{status:503}); }));
  }
});