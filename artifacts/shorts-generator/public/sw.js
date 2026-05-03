// Minimal service worker — enables PWA install prompt
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  // Pass all requests through to the network — no offline caching
  e.respondWith(fetch(e.request));
});
