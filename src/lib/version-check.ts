/**
 * "Is this device running the newest build?" — answered by the host, not by us.
 *
 * Every build emits `/version.json` (see the `ww-version-manifest` plugin in
 * vite.config.ts). A tab compares it with its own `__APP_VERSION__` the moment
 * somebody touches the device, so an operator never starts a shift on old code
 * just because the service worker or the 04:00 refresh has not caught up yet.
 *
 * This deliberately does not depend on Supabase or on an admin pressing "Force
 * everyone onto this build": it works signed out, on the login screen, and when
 * the database is unreachable.
 *
 * Fail open throughout — an unreadable file, a dev server that answers with
 * `index.html`, or a version that is not a plain dotted number never forces
 * anything.
 */

import { compareAppVersions } from "@/lib/release-policy";

/** Idle time after which the next touch counts as "starting work again". */
export const IDLE_BEFORE_WAKE_MS = 10 * 60_000;
/** Never probe the host more often than this, however many events fire. */
export const MIN_PROBE_GAP_MS = 15_000;
/** How often a deferred update re-checks whether the operator has finished. */
export const DEFERRED_RETRY_MS = 15_000;
/** Give up on the probe rather than hold up a touch on a bad connection. */
export const PROBE_TIMEOUT_MS = 8_000;

export type FirstTouchDecision =
  /** Running build is current (or we cannot tell) — do nothing. */
  | "current"
  /** Behind, safe to update right now. */
  | "apply"
  /** Behind, but a scan/confirm flow is open — wait for it to finish. */
  | "defer-work"
  /** Behind, but there is no connection — never purge offline. */
  | "defer-offline"
  /** Behind, and reloading already failed to move this device forward. */
  | "exhausted";

/** True only when the deployed build is certainly newer than the running one. */
export function isBehindDeployed(running: string | null | undefined, deployed: string | null | undefined): boolean {
  const comparison = compareAppVersions(running, deployed);
  return comparison !== null && comparison < 0;
}

export function decideFirstTouch(input: {
  running: string;
  deployed: string | null;
  online: boolean;
  activeWork: boolean;
  attemptsExhausted: boolean;
}): FirstTouchDecision {
  if (!isBehindDeployed(input.running, input.deployed)) return "current";
  if (input.attemptsExhausted) return "exhausted";
  if (!input.online) return "defer-offline";
  if (input.activeWork) return "defer-work";
  return "apply";
}

/**
 * Whether this event should trigger a probe. A wake event always may (subject
 * to the minimum gap); a plain touch only counts after a long idle spell, so a
 * busy operator is not probed on every tap.
 */
export function shouldProbe(input: {
  nowMs: number;
  lastProbeMs: number | null;
  lastTouchMs: number | null;
  kind: "load" | "wake" | "touch";
}): boolean {
  if (input.lastProbeMs !== null && input.nowMs - input.lastProbeMs < MIN_PROBE_GAP_MS) return false;
  if (input.kind !== "touch") return true;
  if (input.lastTouchMs === null) return true;
  return input.nowMs - input.lastTouchMs >= IDLE_BEFORE_WAKE_MS;
}

/** Version string from a `/version.json` body, or null if it is not one. */
export function parseVersionManifest(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const version = (body as { version?: unknown }).version;
  return typeof version === "string" && version.trim() ? version.trim() : null;
}

/**
 * Ask the host which build is deployed right now. Bypasses every cache layer —
 * the browser HTTP cache and the service worker — because a stale answer to
 * this question defeats its whole purpose.
 */
export async function fetchDeployedVersion(
  fetchImpl: typeof fetch = fetch,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS) : null;
  try {
    const response = await fetchImpl(`/version.json?t=${nowMs}`, {
      cache: "no-store",
      credentials: "omit",
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    // A dev server or SPA rewrite answers with index.html; that is "unknown", not an error.
    if (!(response.headers.get("content-type") ?? "").includes("json")) return null;
    return parseVersionManifest(await response.json());
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
