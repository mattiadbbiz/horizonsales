// Team Horizon: service worker minimo.
// Rende l'app installabile e, senza connessione, mostra almeno la schermata dell'app.
// Prende SEMPRE prima la versione online (così ogni deploy arriva subito) e
// non tocca mai le chiamate /api: i dati Trello non vengono salvati sul telefono.
const CACHE = 'horizon-shell-v1';
const SHELL = ['/', '/index.html', '/src/styles.css', '/src/main.js', '/src/config.js', '/assets/team-horizon.jpg', '/assets/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error()))
  );
});
