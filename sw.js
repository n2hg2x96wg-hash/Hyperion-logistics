// Service worker for the installed app. Deliberately minimal: every request goes to the network as usual (nothing is
// served from a cache, so shipment data and pages are never stale). The only thing it stores is a small offline page,
// shown when a page can't be opened because the phone has no connection.
const CACHE = "hx-offline-v1";
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/assets/app/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith("hx-") && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  } else if (PRECACHE.includes(new URL(req.url).pathname)) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
