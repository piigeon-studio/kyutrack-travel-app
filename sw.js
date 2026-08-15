const CACHE = 'kyu-v2';
const STATIC_ASSETS = [
  './fonts/PlusJakartaSans-Variable.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-180.png',
  './icons/wordmark-lime.png'
];
const APP_SHELL = [
  './', './index.html', './manifest.webmanifest', './css/style.css',
  './js/format.js', './js/icons.js', './js/db.js', './js/ledger.js',
  './js/store.js', './js/views.js', './js/forms.js', './js/export.js', './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS.concat(APP_SHELL))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isStatic = STATIC_ASSETS.some(a => url.pathname.endsWith(a.replace('./', '/')));

  if (isStatic) {
    // Cache-first: fonts/icons are immutable-by-filename, safe to serve instantly.
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
        return res;
      }))
    );
    return;
  }

  // Network-first for the app shell (HTML/CSS/JS): always picks up the latest
  // code when online, falls back to cache only when offline.
  event.respondWith(
    fetch(event.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(event.request, copy)); }
      return res;
    }).catch(() => caches.match(event.request))
  );
});
