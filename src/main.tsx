import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { AppErrorBoundary } from "@/components/error-boundary";
import { installConsoleErrorTelemetry, installToastTelemetry, logErrorTelemetry, logSystemTelemetry } from "@/lib/system-telemetry";
import { installHabitTracking, recordAction } from "@/lib/habit-tracking";
import { isActiveWorkInProgress } from "@/lib/active-work";
import "./index.css";

// ── Global error telemetry ────────────────────────────────────────────────────

installConsoleErrorTelemetry();
installToastTelemetry();
installHabitTracking();

// Catch unhandled promise rejections (e.g. fire-and-forget async calls that
// throw). We log to console and show a toast, but never crash the app.
window.addEventListener("unhandledrejection", (event) => {
  const error = event.reason;
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unhandled async error";

  // Skip noisy network errors — the offline banner already covers these.
  const isNetwork = /fetch|network|failed to fetch|load failed/i.test(message);

  // Even a suppressed rejection is a failure the operator lived through, so it
  // still becomes a breadcrumb. Without this, "it just stopped working" reports
  // arrive with no trace of the thing that actually broke.
  recordAction({
    action: "error.unhandled_rejection",
    outcome: "error",
    metadata: { message: message.slice(0, 160), suppressed: isNetwork },
  });

  if (!isNetwork) {
    console.error("[unhandledrejection]", error);
    logErrorTelemetry({
      error,
      title: "Unhandled promise rejection",
      source: "window.unhandledrejection",
      details: {
        reasonType: typeof event.reason,
      },
    });
    toast.error(message, { id: "unhandled-rejection", duration: 8_000 });
  }
});

// Log uncaught synchronous errors (belt-and-suspenders alongside ErrorBoundary).
window.addEventListener("error", (event) => {
  if (event.error) {
    console.error("[uncaught error]", event.error);
    recordAction({
      action: "error.uncaught",
      outcome: "error",
      metadata: { message: String(event.message ?? "").slice(0, 160) },
    });
    logErrorTelemetry({
      error: event.error,
      title: "Uncaught browser error",
      source: "window.error",
      details: {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
      },
    });
  }
});

// ── App mount ─────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);

// Auto-check for new service worker every hour and prompt to reload when an
// update is ready. Skip in iframes / Lovable preview to avoid stale shells.
const isInIframe = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
const isPreviewHost =
  typeof window !== "undefined" &&
  (window.location.hostname.includes("lovableproject.com") ||
    window.location.hostname.includes("lovable.app") ||
    window.location.hostname.includes("id-preview--"));

if (!isInIframe && !isPreviewHost) {
  // One-shot cache/SW purge per app version. Ensures returning users on the
  // published app get a fresh shell after a deploy, even if a prior SW
  // precached stale bundles. Runs before re-registering the current SW.
  const PURGE_KEY = `__ww_cache_purged_v_${String(__APP_VERSION__)}`;
  if (!sessionStorage.getItem(PURGE_KEY)) {
    void (async () => {
      let removed = false;
      try {
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          if (regs.length > 0) {
            removed = true;
            await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
          }
        }
        if ("caches" in window) {
          const names = await caches.keys();
          if (names.length > 0) {
            removed = true;
            await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
          }
        }
      } catch {
        /* no-op */
      }
      sessionStorage.setItem(PURGE_KEY, "1");
      if (removed && !isActiveWorkInProgress()) {
        window.location.reload();
        return;
      }
      if (removed) {
        const tryReload = () => {
          if (isActiveWorkInProgress()) return;
          document.removeEventListener("visibilitychange", tryReload);
          window.removeEventListener("focus", tryReload);
          window.location.reload();
        };
        document.addEventListener("visibilitychange", tryReload);
        window.addEventListener("focus", tryReload);
      }
    })();
  }
  const updateSW = registerSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Poll for updates every 30 minutes
      setInterval(() => {
        registration.update().catch(() => {});
      }, 30 * 60 * 1000);
    },
    onNeedRefresh() {
      // If the tab is already in the background AND no work is in progress,
      // apply silently — no disruption.
      if (document.hidden && !isActiveWorkInProgress()) {
        updateSW(true);
        return;
      }
      // Show a non-intrusive toast. Also auto-apply the next time the user
      // backgrounds the tab AND no active scan/confirm flow is in progress.
      const applyWhenHidden = () => {
        if (document.hidden && !isActiveWorkInProgress()) {
          document.removeEventListener("visibilitychange", applyWhenHidden);
          updateSW(true);
        }
      };
      document.addEventListener("visibilitychange", applyWhenHidden);
      logSystemTelemetry({
        log_type: "info",
        severity: "info",
        title: "Toast: Update available",
        message: "A new version of Warehouse Wizard is ready. It will apply automatically in the background.",
        source: "toast.default",
        details: {
          toast: {
            method: "default",
            title: "Update available",
            options: {
              description: "A new version of Warehouse Wizard is ready. It will apply automatically in the background.",
              action: "Reload now",
            },
          },
        },
      });
      toast("Update available", {
        description: "A new version of Warehouse Wizard is ready. It will apply automatically in the background.",
        duration: 20_000,
        action: {
          label: "Reload now",
          onClick: () => {
            document.removeEventListener("visibilitychange", applyWhenHidden);
            updateSW(true);
          },
        },
      });
    },
    onOfflineReady() {
      toast.success("Ready to work offline");
    },
  });
} else {
  // In preview / iframe: aggressively unregister any pre-existing SW
  // and clear caches so the latest build is always served. We do this
  // synchronously-awaited inside an IIFE so the reload only fires after
  // both the SW unregister and cache deletion have actually completed,
  // and the reload guard is keyed on the current build version so a new
  // deploy is allowed to trigger another cleanup reload.
  // NOTE: we never reload or rewrite the URL here. Inside the Lovable preview
  // iframe a programmatic reload / history rewrite makes the preview proxy
  // re-fetch the (token-bearing) preview URL, which intermittently fails and
  // shows the generic "cloud" error page instead of the app.
  void (async () => {
    try {
      if ("serviceWorker" in navigator) {
        // Ask any controlling SW to step aside before we unregister it.
        try {
          navigator.serviceWorker.controller?.postMessage({ type: "SKIP_WAITING" });
        } catch {
          /* no-op */
        }
        const regs = await navigator.serviceWorker.getRegistrations();
        if (regs.length > 0) {
          await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        }
      }
      if ("caches" in window) {
        const names = await caches.keys();
        if (names.length > 0) {
          await Promise.all(names.map((n) => caches.delete(n).catch(() => false)));
        }
      }
    } catch {
      /* no-op */
    }
  })();
}
