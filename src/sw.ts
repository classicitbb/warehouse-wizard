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

/**
 * Where pushsubscriptionchange parks a rotated subscription for the app to
 * pick up. Mirrored in src/lib/push-subscription.ts - keep the two in step.
 */
const PUSH_ROTATION_CACHE = "ww-push-pending";
const PUSH_ROTATION_KEY = "/__ww_push_rotation";

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

/**
 * Payload shape written by supabase/functions/push-notify/index.ts.
 * Kept structural rather than imported: the worker is compiled as its own
 * program (tsconfig.sw.json) and must not pull in app code.
 */
type WarehousePushPayload = {
  eventId: string;
  kind: "pick_list_created" | "putaway_task_created";
  title: string;
  body: string;
  url: string;
  /** Put-away is silent; a released pick ticket is not. */
  silent: boolean;
  tag: string;
  count?: number;
};

const FALLBACK_PAYLOAD: WarehousePushPayload = {
  eventId: "",
  kind: "putaway_task_created",
  title: "Warehouse Wizard",
  body: "You have a new warehouse notification.",
  url: "/dashboard",
  silent: true,
  tag: "ww-generic",
};

self.addEventListener("push", (event) => {
  // A push handler MUST show a notification. Chrome posts its own "this site
  // was updated in the background" notice when one doesn't, and repeat
  // offenders lose push permission altogether — so the fallback payload below
  // is a real requirement, not defensive padding.
  event.waitUntil(
    (async () => {
      let payload: WarehousePushPayload = FALLBACK_PAYLOAD;
      try {
        if (event.data) payload = { ...FALLBACK_PAYLOAD, ...(event.data.json() as WarehousePushPayload) };
      } catch {
        // Malformed or unencrypted payload — fall back rather than show nothing.
      }

      // Tell open tabs first so the page can ring before the OS banner lands.
      // A service worker has no AudioContext, so this message is the only way
      // the custom chime can ever play.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        client.postMessage({ type: "WW_PUSH", payload });
      }

      await self.registration.showNotification(payload.title, {
        body: payload.body,
        tag: payload.tag,
        silent: payload.silent,
        requireInteraction: !payload.silent,
        icon: "/favicon.png",
        badge: "/favicon.png",
        data: { url: payload.url, eventId: payload.eventId, kind: payload.kind },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as { url?: string };
  const target = data.url ?? "/dashboard";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        // navigate() rejects on cross-origin or detached clients; focusing is
        // the part that matters, so a failed navigation must not bubble.
        await existing.navigate(target).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * The push service rotated our endpoint.
 *
 * There is no Supabase session in a service worker, so the new subscription
 * cannot be registered from here. Park it in a cache entry; ensurePushSubscription()
 * drains that on the next page load and swaps the row server-side. The old
 * endpoint is pruned by the dispatcher on its first 404/410.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  const change = event as ExtendableEvent & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
  };

  event.waitUntil(
    (async () => {
      try {
        const applicationServerKey = change.oldSubscription?.options?.applicationServerKey;
        const fresh =
          change.newSubscription ??
          (applicationServerKey
            ? await self.registration.pushManager
                .subscribe({ userVisibleOnly: true, applicationServerKey })
                .catch(() => null)
            : null);

        const cache = await caches.open(PUSH_ROTATION_CACHE);
        await cache.put(
          PUSH_ROTATION_KEY,
          new Response(
            JSON.stringify({
              oldEndpoint: change.oldSubscription?.endpoint ?? null,
              next: fresh ? fresh.toJSON() : null,
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        );
      } catch {
        // Worst case the device re-subscribes from scratch on next load.
      }
    })(),
  );
});
