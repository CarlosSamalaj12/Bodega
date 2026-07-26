// ══════════════════════════════════════════════════════════════════════
// Custom Service Worker — Bodega Inventario
// ══════════════════════════════════════════════════════════════════════
// Este archivo es inyectado por vite-plugin-pwa (injectManifest).
// Se encarga de caching y de manejar notificaciones push.
// ══════════════════════════════════════════════════════════════════════

const STATIC_CACHE = 'bodega-static-v5';
const API_CACHE = 'bodega-api-v5';

// ─── Precache manifest (inyectado por vite-plugin-pwa) ──────────────
const precacheManifest = self.__WB_MANIFEST || [];

// ─── Install: pre-cache app shell ───────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      if (precacheManifest.length > 0) {
        const cache = await caches.open(STATIC_CACHE);
        const urls = precacheManifest.map((entry) => entry.url || entry);
        await cache.addAll(urls).catch(() => {});
      }
    })()
  );
  self.skipWaiting();
});

// ─── Activate: tomar control y limpiar caches viejos ────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const keep = new Set([STATIC_CACHE, API_CACHE]);
      await Promise.all(
        keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// ─── Fetch strategies ───────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache print endpoints or session-policy
  if (url.pathname.includes('/api/print/')) return;
  if (url.pathname.includes('/api/session-policy')) return;

  // API calls → network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Everything else (static, assets) → cache-first
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ─── Push Notification ──────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();

    const title = data.title || 'Bodega Inventario';
    const options = {
      body: data.body || '',
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      tag: data.tag || 'default',
      data: {
        url: data.url || '/',
        type: data.type || 'general',
        timestamp: Date.now(),
      },
      requireInteraction: true,
      vibrate: [200, 100, 200],
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // Si no es JSON válido, mostrar como texto plano
    const msg = event.data.text();
    event.waitUntil(
      self.registration.showNotification('Bodega Inventario', {
        body: msg,
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
      })
    );
  }
});

// ─── Notification Click ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';
  const type = event.notification.data?.type || 'general';

  // Enfocar o abrir una ventana/cliente existente
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          await client.focus();
          // Navegar a la URL si no está ya ahí
          if (new URL(client.url).pathname !== url) {
            client.navigate(url);
          }
          return;
        }
      }

      // Si no hay cliente, abrir una nueva ventana
      if (clients.openWindow) {
        await clients.openWindow(url);
      }
    })()
  );
});

// ─── Helpers ────────────────────────────────────────────────────────
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      if (response.type !== 'opaque') {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (_err) {
    return new Response(null, { status: 503, statusText: 'Offline' });
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
    return new Response(null, { status: 503, statusText: 'Offline' });
  }
}
