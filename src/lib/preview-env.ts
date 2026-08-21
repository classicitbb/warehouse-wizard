// Preview-environment helpers.
//
// Inside the Lovable preview iframe the URL carries short-lived `__lovable_token`
// / `__lovable_sha` params that are served through a proxy. A programmatic full
// page reload makes that proxy re-fetch the token-bearing URL, which
// intermittently fails and shows the browser's generic "this page may have
// moved permanently" error instead of the app.
//
// So: never hard-reload while in the preview. Ask the app to refresh its data
// instead (see APP_REFRESH_EVENT, handled in App.tsx).

export const APP_REFRESH_EVENT = "ww:app-refresh";

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function isPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (
    host.includes("lovableproject.com") ||
    host.includes("lovable.app") ||
    host.includes("id-preview--")
  );
}

/** True when a hard reload would break the preview proxy / dev session. */
export function isPreviewEnvironment(): boolean {
  if (typeof window === "undefined") return false;
  return isInIframe() || isPreviewHost();
}

/**
 * Refresh the app. Outside the preview this is a real page reload; inside the
 * preview it becomes a soft refresh so the token-bearing URL is never re-fetched.
 */
export function requestAppRefresh(): void {
  if (typeof window === "undefined") return;
  if (isPreviewEnvironment()) {
    window.dispatchEvent(new CustomEvent(APP_REFRESH_EVENT));
    return;
  }
  window.location.reload();
}

/** Navigate within the app without dropping preview query params. */
export function navigatePreservingPreviewParams(path: string): void {
  if (typeof window === "undefined") return;
  const search = window.location.search;
  window.location.replace(search ? `${path}${path.includes("?") ? "&" : "?"}${search.slice(1)}` : path);
}
