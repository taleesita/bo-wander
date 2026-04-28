const CACHE_NAME = 'bo-wander-v66';
const TILE_CACHE = 'bo-wander-tiles-v1';
const MAX_TILE_CACHE = 2000;

const CDN_URLS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.css',
  'https://cdn.jsdelivr.net/npm/cropperjs@1.6.1/dist/cropper.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cache app shell
      cache.addAll(['/', '/index.html']).catch(() => {});
      // Cache CDN resources individually (don't fail install if one CDN is slow)
      return Promise.allSettled(
        CDN_URLS.map(url => cache.add(url).catch(() => console.log('[SW] Failed to cache:', url)))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(n => {
        if (n !== CACHE_NAME && n !== TILE_CACHE) return caches.delete(n);
      }))
    )
  );
  self.clients.claim();
});

// Detect map tile requests
function isTileRequest(url) {
  return url.includes('tile.openstreetmap.org') || url.includes('tile.') || url.match(/\/\d+\/\d+\/\d+\.png/);
}

// Detect API calls that should never be cached
function isApiCall(url) {
  return url.includes('googleapis.com') || url.includes('firestore.googleapis.com')
      || url.includes('firebase') || url.includes('photon.komoot.io')
      || url.includes('allorigins') || url.includes('corsproxy');
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;

  // API calls: network only, no caching
  if (isApiCall(url)) return;

  // Map tiles: cache-first with LRU eviction
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) {
              cache.put(event.request, resp.clone());
              // Evict old tiles if cache is too large
              cache.keys().then(keys => {
                if (keys.length > MAX_TILE_CACHE) {
                  const toDelete = keys.slice(0, keys.length - MAX_TILE_CACHE);
                  toDelete.forEach(k => cache.delete(k));
                }
              });
            }
            return resp;
          }).catch(() => cached || new Response('', { status: 408 }));
        })
      )
    );
    return;
  }

  // CDN + app shell: stale-while-revalidate
  // Serve from cache immediately, update in background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resp.clone()));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
