// Offline support: precache the app shell and every data file on install, then serve
// network-first with the cache as fallback. Bump CACHE when shipping new files or data.
const CACHE = 'frlg-dex-v11';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'features.js', 'tools.js', 'trackers.js', 'modes.js', 'saveimport.js', 'map.js', 'manifest.webmanifest', 'icons/icon.svg',
  'data/locations.json', 'data/pokedex.json', 'data/trainers.json', 'data/types.json', 'data/walkthrough.json', 'data/moves.json',
  'data/team-plan.json', 'data/tms.json', 'data/extras.json', 'data/save-map.json', 'data/region-map.json'];
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
