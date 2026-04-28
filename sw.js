const CACHE_NAME = 'bo-wander-v73';
const TILE_CACHE = 'bo-wander-tiles-v1';
const MAX_TILE_CACHE = 2000;

// Critical CDN resources — app won't render without these
const CRITICAL_CDN = [
  'https://unpkg.com/react@18/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18/umd/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone/babel.min.js',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
];

// Optional CDN resources — nice to have offline but not essential
const OPTIONAL_CDN = [
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
    caches.open(CACHE_NAME).then(async cache => {
      // 1. Cache the app shell — MUST succeed
      try {
        const resp = await fetch('/index.html', { cache: 'no-cache' });
        if (resp.ok) {
          const clone = resp.clone();
          await cache.put('/index.html', resp);
          await cache.put('/', clone);
          console.log('[SW] App shell cached');
        }
      } catch (e) {
        console.warn('[SW] Failed to cache app shell:', e);
      }

      // 2. Cache critical CDN resources — MUST succeed for app to render offline
      for (const url of CRITICAL_CDN) {
        try {
          await cache.add(url);
          console.log('[SW] Cached critical:', url.split('/').pop());
        } catch (e) {
          console.warn('[SW] CRITICAL cache failed:', url, e);
          // Retry once
          try {
            await new Promise(r => setTimeout(r, 500));
            await cache.add(url);
            console.log('[SW] Cached critical (retry):', url.split('/').pop());
          } catch (e2) {
            console.error('[SW] CRITICAL cache failed after retry:', url);
          }
        }
      }

      // 3. Cache optional CDN resources — don't block install
      await Promise.allSettled(
        OPTIONAL_CDN.map(url => cache.add(url).catch(() => console.log('[SW] Optional skip:', url.split('/').pop())))
      );

      console.log('[SW] Install complete');
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      // Clean old caches
      const names = await caches.keys();
      await Promise.all(names.map(n => {
        if (n !== CACHE_NAME && n !== TILE_CACHE) return caches.delete(n);
      }));
      // Verify cache has app shell, re-cache if Safari evicted it
      const cache = await caches.open(CACHE_NAME);
      const existing = await cache.match('/index.html');
      if (!existing) {
        console.log('[SW] Cache empty after activation, re-caching');
        try {
          const resp = await fetch('/index.html', { cache: 'no-cache' });
          if (resp.ok) {
            await cache.put('/index.html', resp.clone());
            await cache.put('/', resp);
          }
        } catch (e) {}
      }
      // Also verify critical CDN resources
      for (const url of CRITICAL_CDN) {
        const cached = await cache.match(url);
        if (!cached) {
          try { await cache.add(url); } catch (e) {}
        }
      }
    })()
  );
  self.clients.claim();
});

function isTileRequest(url) {
  return url.includes('tile.openstreetmap.org') || url.includes('tile.') || url.match(/\/\d+\/\d+\/\d+\.png/);
}

function isApiCall(url) {
  return url.includes('googleapis.com') || url.includes('firestore.googleapis.com')
      || url.includes('firebase') || url.includes('photon.komoot.io')
      || url.includes('allorigins') || url.includes('corsproxy');
}

// Offline fallback page
const OFFLINE_HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bo Wander - Offline</title>
<style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1e293b;color:#e2e8f0;text-align:center}
.c{max-width:320px;padding:20px}h1{font-size:48px;margin:0}h2{font-size:18px;margin:8px 0 16px}p{font-size:14px;color:#94a3b8;line-height:1.5}
button{margin-top:16px;padding:10px 24px;border:none;border-radius:8px;background:#3b82f6;color:white;font-size:14px;cursor:pointer}</style></head>
<body><div class="c"><h1>🗺️</h1><h2>Bo Wander is offline</h2><p>Open the app while connected to the internet first, then it'll work offline on future visits.</p>
<button onclick="location.reload()">Try Again</button></div></body></html>`;

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;

  if (isApiCall(url)) return;

  // Navigation requests: cache-first with background update
  if (event.request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        let cached = await cache.match('/index.html')
                  || await cache.match('/')
                  || await caches.match(event.request);

        if (cached) {
          // Serve cached, update in background
          try {
            const resp = await fetch(event.request);
            if (resp.ok) {
              cache.put('/', resp.clone());
              cache.put('/index.html', resp.clone());
            }
          } catch (e) {}
          return cached;
        }

        try {
          const resp = await fetch(event.request);
          if (resp.ok) {
            cache.put('/', resp.clone());
            cache.put('/index.html', resp.clone());
          }
          return resp;
        } catch (e) {
          return new Response(OFFLINE_HTML, {
            status: 503,
            headers: { 'Content-Type': 'text/html' },
          });
        }
      })()
    );
    return;
  }

  // Map tiles: cache-first with LRU eviction
  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(resp => {
            if (resp.ok) {
              cache.put(event.request, resp.clone());
              cache.keys().then(keys => {
                if (keys.length > MAX_TILE_CACHE) {
                  keys.slice(0, keys.length - MAX_TILE_CACHE).forEach(k => cache.delete(k));
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

  // CDN + other resources: stale-while-revalidate
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
