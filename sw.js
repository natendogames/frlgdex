// Offline support: precache the app shell and every data file on install, then serve
// network-first with the cache as fallback. Bump CACHE when shipping new files or data.
const CACHE = 'frlg-dex-v4';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg',
  'data/locations.json', 'data/pokedex.json', 'data/trainers.json', 'data/types.json', 'data/walkthrough.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL);
    const idx = await (await c.match('data/locations.json')).json();
    await c.addAll(idx.locations.map(l => 'data/' + l.file));
  }));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
