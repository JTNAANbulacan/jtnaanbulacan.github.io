/* JTNAAN PWA shell cache. Never cache API, auth, user data, or live-session requests. */
'use strict';
const CACHE_NAME = 'jtnaan-shell-v1';
const SHELL_URLS = [
  '/worship-team-hub/portal/',
  '/worship-team-hub/install/',
  '/worship-team-hub/manifest.webmanifest'
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const url of SHELL_URLS) {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok && response.type === 'basic') await cache.put(url, response);
      } catch (_) { /* Install should still succeed when a route is temporarily unavailable. */ }
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('jtnaan-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/functions/') || url.pathname.startsWith('/storage/') ||
      url.pathname.includes('/realtime') || url.searchParams.has('portal_embed') ||
      url.searchParams.has('wx_monitor') || url.searchParams.has('wx_display') ||
      url.searchParams.has('wx_join') || url.searchParams.has('legacy')) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        if (fresh.ok && !url.search) {
          const cache = await caches.open(CACHE_NAME);
          const key = url.pathname.endsWith('/') ? url.pathname : url.pathname + '/';
          if (SHELL_URLS.includes(key)) await cache.put(key, fresh.clone());
        }
        return fresh;
      } catch (_) {
        const cache = await caches.open(CACHE_NAME);
        const exact = await cache.match(request, { ignoreSearch: true });
        if (exact) return exact;
        const fallback = await cache.match('/worship-team-hub/portal/');
        if (fallback) return fallback;
        return new Response('JTNAAN is offline. Reconnect to the internet to sign in and synchronize worship data.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }
  if (url.pathname === '/worship-team-hub/manifest.webmanifest') {
    event.respondWith((async () => (await caches.match(request)) || fetch(request))());
  }
});
