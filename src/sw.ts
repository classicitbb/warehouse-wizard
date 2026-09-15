/// <reference lib="webworker" />

/**
 * Warehouse Wizard service worker.
 *
 * This file replaces both the old hand-written `public/sw.js` and the worker
 * that vite-plugin-pwa used to generate for us. We own it now because push
 * notifications need `push` / `notificationclick` handlers and the generateSW
 * strategy has no way to emit them.
 *
 * Everything generateSW previously provided for free is reimplemented below.
 * Read the comments before removing anything here — two of these blocks look
 * inert but are load-bearing.
 */

import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

// In a module context this shadows the ambient `self`, which is how
// vite-plugin-pwa's own injectManifest template types the worker scope.
declare let self: ServiceWorkerGlobalScope & {
  // Injected at build time by vite-plugin-pwa. `PrecacheEntry` is not
  // re-exported from workbox-precaching's entry point, so it is spelled out.
  __WB_MANIFEST: Array<{ url: string; revision?: string | null; integrity?: string } | string>;
};

precacheAndRoute(self.__WB_MANIFEST);

// generateSW applied this implicitly. Without it every deploy leaves its
// predecessor's precache behind and storage grows without bound.
cleanupOutdatedCaches();

/**
 * Paths that must never be answered with the SPA shell.
 *
 * Carries over `workbox.navigateFallbackDenylist` (`/~oauth`) together with the
 * NEVER_CACHE_PREFIXES list from the retired `public/sw.js`. Supabase traffic is
 * cross-origin and so never matches a same-origin navigation route, but these
 * same-origin prefixes would otherwise be served `index.html` and break the
 * OAuth consent hand-off.
 *
 * Built with `new RegExp` rather than literals so the prefixes stay readable as
 * plain paths and match the list they were copied from.
 */
const NAVIGATION_DENYLIST_PREFIXES = ["/~oauth", "/api", "/auth", "/functions", "/rest", "/realtime"];

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: NAVIGATION_DENYLIST_PREFIXES.map((prefix) => new RegExp(`^${prefix}`)),
  }),
);

/**
 * Required by `registerType: "prompt"`.
 *
 * `updateSW(true)` in src/main.tsx posts SKIP_WAITING and waits for the new
 * worker to take over. Without this listener that call silently does nothing:
 * every device stays on the stale bundle while the forced-update machinery in
 * src/lib/release-policy.ts keeps firing at it. The generated worker used to
 * include this handler for us.
 */
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// build-probe: temporary marker to force a new sw.js during verification
