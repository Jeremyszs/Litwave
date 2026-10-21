// Litwave Stage Remote - Service Worker (Offline PWA)
const CACHE_NAME = "litwave-remote-v4";
// The redesigned phone shell: page, styles, bundled font, kit and remote modules.
const STATIC_ASSETS = [
  "/remote",
  "/static/remote.html",
  "/static/chord_timeline.js",
  "/static/browser_api.js",
  "/static/ws_telemetry.js",
  "/static/css/tokens.css",
  "/static/css/kit.css",
  "/static/css/remote.css",
  "/static/fonts/inter-latin-wght-normal.woff2",
  "/static/js/kit/core.js",
  "/static/js/kit/spring.js",
  "/static/js/kit/icons.js",
  "/static/js/kit/controls.js",
  "/static/js/kit/island.js",
  "/static/js/kit/sheet.js",
  "/static/js/remote/state.js",
  "/static/js/remote/stage.js",
  "/static/js/remote/pads.js",
  "/static/js/remote/mix.js",
  "/static/js/remote/parts.js",
  "/static/js/remote/song.js",
  "/static/js/remote/sheets.js",
  "/static/js/remote/app.js",
  "/manifest.json",
  "/static/manifest.json",
  "/static/icon-192.png",
  "/static/icon-512.png"
];

// Install: Cache Shell Assets
self.addEventListener("install", (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Precache each asset independently so one missing file does not abort the whole install
      return Promise.allSettled(STATIC_ASSETS.map((asset) => cache.add(asset)));
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

  // Google Fonts: cache-first at runtime (cross-origin, so they are not part of the precache)
  if (evt.request.method === "GET" && (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com")) {
    evt.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(evt.request).then((cached) => cached || fetch(evt.request).then((res) => {
          if (res && (res.ok || res.type === "opaque")) cache.put(evt.request, res.clone());
          return res;
        }))
      ).catch(() => fetch(evt.request))
    );
    return;
  }

  // Always bypass cache for API routes, uploads, WebSocket, or non-GET requests
  if (evt.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws") || url.pathname.startsWith("/static/uploads/")) {
    return;
  }

  // Handle navigation to /remote only with network-first falling back to cache
  if (url.pathname === "/remote" && (evt.request.mode === "navigate" || evt.request.destination === "document")) {
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

  // Do not intercept other navigation requests (e.g. root "/" desktop UI)
  if (evt.request.mode === "navigate") {
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
