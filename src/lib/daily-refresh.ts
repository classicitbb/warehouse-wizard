/**
 * Daily freshness for tablets that never close.
 *
 * Once per day, after a configured local hour (default 04:00), the app drops
 * every cache and service worker and reloads once, so the morning shift always
 * starts on the published bundle rather than a shell cached days ago.
 *
 * Guards, in the order they matter:
 *  - never inside the Lovable preview iframe (a hard reload breaks the proxy),
 *  - never while offline (a purge with no network leaves no app at all),
 *  - never during an active scan/confirm flow,
 *  - the "already ran" stamp is written *before* the reload, so a failure to
 *    come back up cannot turn into a reload loop,
 *  - a device with no stamp yet records one silently instead of reloading on
 *    its very first run.
 */

import { isActiveWorkInProgress } from "@/lib/active-work";
import { isPreviewEnvironment } from "@/lib/preview-env";
import { purgeCachesAndServiceWorkers, readCachedReleasePolicy } from "@/lib/release-policy";

const LAST_REFRESH_KEY = "warehouseWizard.dailyRefresh.lastRunAt";
const LAST_ACTIVITY_KEY = "warehouseWizard.lastActivityAt";
const ACTIVITY_WRITE_THROTTLE_MS = 60_000;

function readStamp(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function writeStamp(key: string, ms: number) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, new Date(ms).toISOString());
  } catch {
    /* no-op */
  }
}

/**
 * The most recent local occurrence of `hour:00`. If it is 02:00 now and the
 * hour is 4, this is yesterday at 04:00.
 */
export function mostRecentCutoff(nowMs: number, hour: number): number {
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
  const cutoff = new Date(nowMs);
  cutoff.setHours(safeHour, 0, 0, 0);
  if (cutoff.getTime() > nowMs) cutoff.setDate(cutoff.getDate() - 1);
  return cutoff.getTime();
}

/** When this document itself started loading — i.e. how old the running shell is. */
export function documentLoadedAt(): number {
  if (typeof performance === "undefined") return Date.now();
  if (Number.isFinite(performance.timeOrigin)) return performance.timeOrigin;
  const elapsed = performance.now();
  return Number.isFinite(elapsed) ? Date.now() - elapsed : Date.now();
}

export type DailyRefreshDecision =
  /** Nothing to do. */
  | "idle"
  /** Record today as handled, but do not reload — the shell is already fresh. */
  | "stamp-only"
  /** Purge and reload: this shell predates the cutoff. */
  | "reload";

/**
 * The single decision behind the morning refresh.
 *
 * The stamp alone is not enough to justify a reload: a tablet that was switched
 * on at 07:00 already loaded today's bundle, so purging and reloading it would
 * cost the operator a second, cache-empty start for no gain. Only a shell that
 * has been running since before the cutoff is actually stale.
 */
export function decideDailyRefresh(input: {
  nowMs: number;
  lastRunMs: number | null;
  documentLoadedAtMs: number;
  hour: number;
  enabled: boolean;
}): DailyRefreshDecision {
  if (!input.enabled) return "idle";
  // First run on this device: seed the stamp so the first due morning is the
  // next one, and never reload on a brand new install.
  if (input.lastRunMs === null) return "stamp-only";

  const cutoff = mostRecentCutoff(input.nowMs, input.hour);
  if (input.lastRunMs >= cutoff) return "idle";
  if (input.documentLoadedAtMs >= cutoff) return "stamp-only";
  return "reload";
}

/** True when this device sat idle across the nightly cutoff and must sign out. */
export function shouldSignOutForNight(input: {
  nowMs: number;
  lastActivityMs: number | null;
  hour: number;
  enabled: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.lastActivityMs === null) return false;
  return input.lastActivityMs < mostRecentCutoff(input.nowMs, input.hour);
}

export function readLastActivity(): number | null {
  return readStamp(LAST_ACTIVITY_KEY);
}

let activityAtLoad: number | null | undefined;

/**
 * The last-activity stamp as it stood when this document loaded, pinned on
 * first read.
 *
 * The nightly sign-out asks "was this device idle across the cutoff?", which
 * only has an answer *before* the current session writes its own activity. Read
 * the live stamp for that and it is always fresh, so the check never fires.
 */
export function readActivityAtLoad(): number | null {
  if (activityAtLoad === undefined) activityAtLoad = readStamp(LAST_ACTIVITY_KEY);
  return activityAtLoad;
}

/** Test helper — forget the pinned load-time snapshot. */
export function __resetActivitySnapshotForTests(): void {
  activityAtLoad = undefined;
}

export function markActivity(nowMs: number = Date.now()) {
  const last = readStamp(LAST_ACTIVITY_KEY);
  if (last !== null && nowMs - last < ACTIVITY_WRITE_THROTTLE_MS) return;
  writeStamp(LAST_ACTIVITY_KEY, nowMs);
}

export function readLastDailyRefresh(): number | null {
  return readStamp(LAST_REFRESH_KEY);
}

export function markDailyRefresh(nowMs: number = Date.now()) {
  writeStamp(LAST_REFRESH_KEY, nowMs);
}

/**
 * Run the purge + reload if it is due. Returns false whenever a guard held it
 * back, so the caller can try again on the next focus.
 */
export async function runDailyRefreshIfDue(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isPreviewEnvironment()) return false;
  if (navigator.onLine === false) return false;

  const policy = readCachedReleasePolicy();
  const now = Date.now();

  const decision = decideDailyRefresh({
    nowMs: now,
    lastRunMs: readLastDailyRefresh(),
    documentLoadedAtMs: documentLoadedAt(),
    hour: policy.dailyRefreshHour,
    enabled: policy.dailyRefreshEnabled,
  });

  if (decision === "idle") return false;
  if (decision === "stamp-only") {
    markDailyRefresh(now);
    return false;
  }
  if (isActiveWorkInProgress()) return false;

  // Stamp first: if the reload fails to come back cleanly we still only ever
  // attempt this once per day.
  markDailyRefresh(now);
  await purgeCachesAndServiceWorkers();
  window.location.reload();
  return true;
}

/**
 * Wire the daily refresh to app start and to the first focus after the cutoff,
 * and keep the per-device activity stamp that the nightly sign-out reads.
 */
export function installDailyRefresh(): void {
  if (typeof window === "undefined") return;
  if (isPreviewEnvironment()) return;

  // Pin the pre-session activity stamp before anything can overwrite it — the
  // nightly sign-out is decided from that snapshot, not from live activity.
  readActivityAtLoad();

  const onActivity = () => markActivity();
  window.addEventListener("pointerdown", onActivity, { passive: true });
  window.addEventListener("keydown", onActivity, { passive: true });

  const check = () => {
    if (document.visibilityState === "hidden") return;
    void runDailyRefreshIfDue();
  };

  void runDailyRefreshIfDue();
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
  document.addEventListener("visibilitychange", check);
}
