const CACHE_NAME = 'barcodepro-v2_0';
const RUNTIME_CACHE = 'barcodepro-runtime-v2_0';
const OPTIONAL_CDN = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/bwip-js@4.5.1/dist/bwip-js-min.js'
];

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './version.js',
  './version.json',
  './update-config.js',
  './utils.js',
  './storage.js',
  './scanner.js',
  './importer.js',
  './generator.js',
  './history.js',
  './updater.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(async () => {
        const runtime = await caches.open(RUNTIME_CACHE);
        await Promise.allSettled(OPTIONAL_CDN.map(async url => {
          const response = await fetch(url, { mode: 'cors' });
          if (response.ok) await runtime.put(url, response);
        }));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => ![CACHE_NAME, RUNTIME_CACHE].includes(key))
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.endsWith('/version.json')) {
    event.respondWith(networkFirst(request, CACHE_NAME));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => (await caches.match(request)) || caches.match('./index.html'))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}
