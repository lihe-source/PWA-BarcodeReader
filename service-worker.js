const CACHE_NAME = 'barcodepro-V1_5';
const ASSETS = [
  './', './index.html', './app.js', './scanner.js',
  './generator.js', './history.js', './db.js', './ui.js',
  './export.js', './importer.js', './updater.js', './version.js',
  './update-config.js', './styles.css', './manifest.json',
  './libs/zxing.min.js', './libs/jsbarcode.min.js',
  './libs/bwip-js.min.js', './libs/dexie.min.js',
  './icons/icon-192.png', './icons/icon-512.png'
];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('nocache=')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
