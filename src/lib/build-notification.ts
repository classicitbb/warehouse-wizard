/**
 * Local OS/browser notification for "a new build was pushed".
 *
 * Fires only when the user already granted notification permission — we never
 * prompt from here. Deduped per build so a poll loop that re-detects the same
 * waiting service worker doesn't spam the operator.
 */

const NOTIFIED_BUILD_KEY = "warehouseWizard.build.notifiedTag";

function alreadyNotified(tag: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(NOTIFIED_BUILD_KEY) === tag;
  } catch {
    return false;
  }
}

function rememberNotified(tag: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFIED_BUILD_KEY, tag);
  } catch {
    // Storage unavailable — worst case the operator sees a repeat notification.
  }
}

/**
 * @param buildTag Stable identifier for the pending build (usually the version
 *   currently running, since the waiting bundle's version isn't readable yet).
 *   Used for dedupe and as the notification tag.
 */
export async function notifyNewBuildAvailable(buildTag: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!isBuildNotificationEnabled()) return;
  if (alreadyNotified(buildTag)) return;
  rememberNotified(buildTag);

  const title = "New Warehouse Wizard build";
  const options: NotificationOptions = {
    body: "A newer version was just pushed. It installs automatically — reload to use it now.",
    tag: `ww-build-${buildTag}`,
    icon: "/favicon.png",
    badge: "/favicon.png",
  };


  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && "showNotification" in registration) {
        await registration.showNotification(title, options);
        return;
      }
    }
  } catch {
    // Fall through to the page-level constructor.
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Unsupported context — the in-app toast still covers it.
  }
}
