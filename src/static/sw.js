// Litwave Stage Remote - Service Worker (Offline PWA)
const CACHE_NAME = "litwave-remote-v1";
const STATIC_ASSETS = [
  "/remote",
  "/static/remote.html",
  "/static/chord_timeline.js",
  "/static/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png",
  "/static/icon.svg"
];

// Install: Cache Shell Assets
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up old caches & take control
self.addEventListener("activate", (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Cache-First for static UI, Network-Only bypass for live API/WebSocket calls
self.addEventListener("fetch", (evt) => {
  const url = new URL(evt.request.url);

  // Always bypass cache for API routes, uploads, or non-GET requests
  if (evt.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  // Handle navigation requests (e.g. /remote) with network-first falling back to cache
  if (evt.request.mode === "navigate" || url.pathname === "/remote") {
    evt.respondWith(
      fetch(evt.request)
        .then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(evt.request, resClone));
          return res;
        })
        .catch(() => {
          return caches.match("/remote").then((cached) => {
            return cached || caches.match("/static/remote.html");
          });
        })
    );
    return;
  }

  // Cache-first falling back to network for static files
  evt.respondWith(
    caches.match(evt.request).then((cached) => {
      if (cached) {
        // Fetch fresh copy in background (stale-while-revalidate)
        fetch(evt.request).then((netRes) => {
          if (netRes && netRes.status === 200) {
            caches.open(CACHE_NAME).then((c) => c.put(evt.request, netRes));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(evt.request);
    })
  );
});
