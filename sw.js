/*
 * Service Worker — La Jefa 90.8 FM (La Celia)
 * PWA cache strategy: robust / network-first for live-changing assets.
 * Cambia CACHE_VERSION cada vez que publiques una versión importante.
 */
const CACHE_VERSION = 'v4-2026-09-13';
const CACHE_NAME = `la-jefa-908-la-celia-${CACHE_VERSION}`;
const OFFLINE_URL = './index.html';

const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32x32.png',
  './icons/favicon-16x16.png',
  './icons/favicon.ico'
];

function isGoodResponse(response) {
  return response && response.ok && response.type !== 'opaque';
}

async function putInCache(request, response) {
  if (!isGoodResponse(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // No dejamos que una descarga rota durante la instalación cree un precache corrupto.
    for (const asset of PRECACHE_ASSETS) {
      try {
        const request = new Request(asset, { cache: 'reload' });
        const response = await fetch(request);
        if (isGoodResponse(response)) {
          await cache.put(request, response.clone());
        } else {
          console.warn('[SW] No se pudo precargar:', asset, response && response.status);
        }
      } catch (error) {
        console.warn('[SW] Error precargando:', asset, error);
      }
    }

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('la-jefa-908-la-celia-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // El stream de radio y cualquier recurso externo no deben entrar en nuestro caché.
  if (
    request.destination === 'audio' ||
    url.pathname.includes('listen.php') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Navegación / HTML: RED PRIMERO. Si falla, usamos la última copia válida.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (isGoodResponse(response)) {
          await putInCache(request, response);
        }
        return response;
      } catch (_) {
        return (await caches.match(request)) || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  // Manifest e iconos: RED PRIMERO.
  // Esto evita que un icono descargado mal quede congelado indefinidamente.
  const isIcon = url.pathname.includes('/icons/');
  const isManifest = url.pathname.endsWith('/manifest.json');

  if (isIcon || isManifest) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (isGoodResponse(response)) {
          await putInCache(request, response);
          return response;
        }
        throw new Error(`HTTP ${response.status}`);
      } catch (_) {
        const cached = await caches.match(request);
        if (cached) return cached;
        return fetch(request);
      }
    })());
    return;
  }

  // CSS, JS y demás recursos propios: red primero con fallback offline.
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (isGoodResponse(response)) {
        await putInCache(request, response);
      }
      return response;
    } catch (_) {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw _;
    }
  })());
});

// Permite actualizar el SW desde la página sin esperar a cerrar la aplicación.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
