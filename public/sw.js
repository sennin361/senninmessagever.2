self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('chat-cache').then(cache => {
      return cache.addAll(['/', '/index.html', '/main.js']);
    })
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(res => res || fetch(e.request))
  );
});
