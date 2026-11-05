// Offline support and cross-origin isolation. The page and its code are cached on install; the WASM runtime and the models, too big to
// fetch up front, are cached the first time they are used. The build fills in the constants (see
// vite.config.js): each deploy gets a new app cache, and the models are fetched again only when export.py or
// its lock file changes.
const { version, modelVersion, precache } = __BUILD__;
const appCache = `app-${version}`;
const modelCache = `models-${modelVersion}`;
const root = new URL("./", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(appCache)
      .then((cache) => cache.addAll(["./", ...precache]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => names.filter((name) => name !== appCache && name !== modelCache))
      .then((stale) => Promise.all(stale.map((name) => caches.delete(name))))
      // Control the page that installed us, so the first model it loads is cached too.
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    if (url.origin + url.pathname === root) event.respondWith(networkFirst(request).then(isolated));
    return;
  }
  const name = url.pathname.endsWith(".onnx") ? modelCache : appCache;
  // Without storage (private windows in some browsers), fall back to the network.
  event.respondWith(
    cacheFirst(name, request)
      .catch(() => fetch(request))
      .then(isolated),
  );
});

// GitLab Pages can't send these headers, so the worker adds them. They make the page cross-origin isolated,
// which gives ORT's WASM backend SharedArrayBuffer and so threads. Every cross-origin resource the page
// loads must then allow it: GoatCounter's script sends CORP, its hits go by sendBeacon, Sentry uses CORS.
// A first visit loads before the worker takes over, so main.jsx reloads it once.
function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// The page itself comes from the network when it can, so a deploy shows on the next load.
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) await (await caches.open(appCache)).put("./", response.clone());
    return response;
  } catch (err) {
    return (await caches.match("./", { ignoreVary: true })) ?? Promise.reject(err);
  }
}

// Downloaded into the cache and then read back from it, rather than teed to the page and the cache at once,
// so a 64 MB model is never buffered for two readers. Each URL has one version, so Vary (Origin, from module
// scripts; Accept-Encoding, from the server's gzip) can only cause misses.
async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  await cache.add(request);
  return cache.match(request, { ignoreVary: true });
}
