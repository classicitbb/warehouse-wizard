import { useCallback, useEffect, useState } from "react";

export const OFFLINE_WORK_MESSAGE =
  "Connection lost. This device is frozen for live commits. Reconnect, refresh live state, and confirm again.";

function browserReportsOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * Checks the Supabase auth health endpoint rather than relying solely on the
 * browser's best-effort online flag. Any HTTP response proves the device can
 * reach the service; only a transport failure or timeout is considered offline.
 */
export async function probeLiveConnection(timeoutMs = 4_000): Promise<boolean> {
  if (typeof window === "undefined") return true;
  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  if (!baseUrl) return browserReportsOnline();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/auth/v1/health`, {
      cache: "no-store",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      },
      signal: controller.signal,
    });
    return response.status > 0;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function verifyConnection() {
  // A short retry prevents a transient Wi-Fi roam or radio wake-up from
  // freezing RF work and raising an unnecessary offline notification.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await probeLiveConnection()) return true;
    if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 600));
  }
  return false;
}

export function isAppOnline() {
  // Commit guards stay conservative. The UI performs the deeper retrying
  // probe below before presenting an RF disconnect notification.
  return browserReportsOnline();
}

export function assertOnline() {
  if (!isAppOnline()) {
    throw new Error(OFFLINE_WORK_MESSAGE);
  }
}

/** Fired once the app has healed itself after an outage. */
export const CONNECTION_RESTORED_EVENT = "ww:connection-restored";

const HEALTHY_POLL_MS = 45_000;
const RECOVERY_BACKOFF_MS = [2_000, 4_000, 8_000, 15_000];

export function useNetworkStatus() {
  // Operational screens freeze promptly on the browser signal. Consumers that
  // raise a notification can wait for `confirmed`, which is set only after the
  // retrying service probe completes.
  const [online, setOnline] = useState(isAppOnline);
  const [confirmed, setConfirmed] = useState(false);
  const wasOfflineRef = useRef(false);

  const refreshConnection = useCallback(async (isCurrent?: () => boolean) => {
    const nextOnline = await verifyConnection();
    if (isCurrent && !isCurrent()) return nextOnline;
    setOnline(nextOnline);
    setConfirmed(true);
    if (nextOnline && wasOfflineRef.current) {
      wasOfflineRef.current = false;
      // Self-heal in place: no page reload, no operator action. Listeners
      // refresh the session and refetch live data.
      window.dispatchEvent(new CustomEvent(CONNECTION_RESTORED_EVENT));
    }
    if (!nextOnline) wasOfflineRef.current = true;
    return nextOnline;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let attempt = 0;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(run, delay);
    };

    async function run() {
      if (cancelled) return;
      if (document.hidden && !wasOfflineRef.current) {
        schedule(HEALTHY_POLL_MS);
        return;
      }
      const nextOnline = await refreshConnection(() => !cancelled);
      if (cancelled) return;
      if (nextOnline) {
        attempt = 0;
        schedule(HEALTHY_POLL_MS);
      } else {
        // Fast self-healing retries while down, backing off to 15s.
        const delay = RECOVERY_BACKOFF_MS[Math.min(attempt, RECOVERY_BACKOFF_MS.length - 1)];
        attempt += 1;
        schedule(delay);
      }
    }

    const update = () => {
      attempt = 0;
      schedule(0);
    };
    const refreshWhenVisible = () => {
      if (!document.hidden) update();
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void run();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshConnection]);

  return { online, confirmed };
}

export function guardMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
) {
  return (...args: TArgs) => {
    assertOnline();
    return fn(...args);
  };
}
