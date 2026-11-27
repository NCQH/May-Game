let CACHE = 'bangbang-web-v8';
const DAY = 24 * 60 * 60 * 1000;

function cacheKey(url, origin) {
  const u = new URL(url);
  if (u.origin !== origin) return null;
  if (u.pathname.startsWith('/html5/')) return origin + '/games/bangbang/html5/' + u.pathname.slice(7) + u.search;
  if (u.pathname.startsWith('/rez/')) return origin + '/games/bangbang/rez/' + u.pathname.slice(5) + u.search;
  if (u.pathname.startsWith('/games/bangbang/')) return u.href;
  return null;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    try {
      const manifest = await (await fetch('/games/bangbang/html5/cache-manifest.json', { cache: 'no-store' })).json();
      if (manifest.cache) CACHE = manifest.cache;
      const cache = await caches.open(CACHE);
      await Promise.allSettled((manifest.essential || []).map((url) => cache.add(url)));
    } catch (error) {
      console.warn('BangBang cache install:', error);
    }
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const key = cacheKey(request.url, location.origin);
  if (!key) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(key);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  })());
});
