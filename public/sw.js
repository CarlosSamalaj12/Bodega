const STATIC_CACHE = "bodega-static-v2";
const API_CACHE = "bodega-api-v2";

const STATIC_ASSETS = [
  "./app.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./pw.ico",
  "./icon-192x192.png",
  "./icon-512x512.png",
  "https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css",
  "https://cdn.jsdelivr.net/npm/flatpickr/dist/themes/dark.css",
  "https://cdn.jsdelivr.net/npm/flatpickr",
  "https://cdn.jsdelivr.net/npm/flatpickr/dist/l10n/es.js",
];

// ─── Install: pre-cache app shell ───────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await cache.addAll(STATIC_ASSETS);
    })()
  );
  // skipWaiting is handled via SKIP_WAITING message for user-initiated updates
});

// ─── Activate: prune old caches ─────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([STATIC_CACHE, API_CACHE]);
      await Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))
      );
    })()
  );
  self.clients.claim();
});

// ─── Fetch strategies ───────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache print endpoints or session-policy
  if (url.pathname.includes("/api/print/")) return;
  if (url.pathname.includes("/api/session-policy")) return;

  // API calls → network-first
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Everything else (static, CDN) → cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ─── Helpers ────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      if (response.type !== "opaque") {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (_err) {
    return new Response(null, { status: 503, statusText: "Offline" });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(null, { status: 503, statusText: "Offline" });
  }
}

// ─── Message: listen for skip-waiting from client ─────────────────
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
