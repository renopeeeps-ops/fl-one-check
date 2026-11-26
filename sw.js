/* Réception chantier – service worker : l'application s'ouvre sans connexion.
   Réseau d'abord (toujours la dernière version quand il y a du réseau), copie locale en secours.
   Pour forcer la mise à jour du cache après une modification, change VERSION. */
const VERSION = 'v1';
const CACHE = 'fl-one-check-' + VERSION;
const FILES = [
  './', 'index.html', 'style.css', 'manifest.json',
  'js/app.js', 'js/logo-data.js', 'lib/jspdf.umd.min.js',
  'img/logo.png', 'img/icon-192.png', 'img/icon-512.png', 'img/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(FILES.map((f) => c.add(f).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fl-one-check-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google (connexion, Drive) : géré par le navigateur
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())))
  );
});
