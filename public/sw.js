/**
 * Warehouse Wizard — minimal app-shell service worker.
 *
 * Scope: satisfies TWA/PWA installability requirements (registered SW with a
 * fetch handler) and gives the Android wrapper an offline fallback shell.
 * Deliberately does NOT cache API calls, auth routes, or anything under
 * /api — this is a live operations app and stale data is worse than no
 * offline support.
 */

const CACHE_VERSION = "ww-shell-v2";
const SHELL_ASSETS = ["/", "/manifest.json", "/favicon.png", "/logo.png"];

// Never cache these path prefixes, even opportunistically.
const NEVER_CACHE_PREFIXES = ["/api", "/auth", "/functions", "/rest", "/realtime"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return;

  // Network-first for navigations, so the app always gets the latest build
  // when online; falls back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/"))
    );
    return;
  }

  // Cache-first for static shell assets, revalidated in the background.
  if (SHELL_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
  }
});
