/**
 * Server-controlled release policy.
 *
 * A single row in `public.app_release_policy` says which build is the oldest
 * one still allowed on the floor. Every client reads it, compares against its
 * own `__APP_VERSION__`, and — when it is behind — shows a countdown banner and
 * then hard-reloads onto the new bundle.
 *
 * Design notes worth keeping in mind before changing anything here:
 *
 * - **Nothing is promised that isn't done.** There is deliberately no
 *   "save drafts before reload" hook here: the reload waits on
 *   `isActiveWorkInProgress()` instead, and the banner copy says only that.
 * - **Never loop.** If a forced reload does not actually raise the running
 *   version (bad policy value, CDN not propagated, SW serving a stale shell),
 *   the fleet would reload forever. Attempts are counted per target version and
 *   capped; past the cap the banner stays but the app stops reloading itself.
 * - **Fail open.** An unparseable running version (`"test"`, `"dev"`) or an
 *   unreadable policy never forces anything.
 * - **Never purge while offline.** Clearing caches and unregistering the
 *   service worker on a disconnected tablet leaves it with no app at all.
 * - **Clock skew is assumed.** `force_after` comes from the server but the
 *   countdown is computed locally and clamped into `grace_minutes`, so a tablet
 *   with a wrong clock can neither reload instantly nor wait forever.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDeviceId } from "@/lib/device-identity";
import { isPreviewEnvironment } from "@/lib/preview-env";

export type ReleasePolicy = {
  minRequiredVersion: string | null;
  forceAfter: string | null;
  graceMinutes: number;
  message: string | null;
  nightlySignoutEnabled: boolean;
  dailyRefreshEnabled: boolean;
  dailyRefreshHour: number;
  updatedAt: string | null;
};

export const DEFAULT_RELEASE_POLICY: ReleasePolicy = {
  minRequiredVersion: null,
  forceAfter: null,
  graceMinutes: 10,
  message: null,
  nightlySignoutEnabled: false,
  dailyRefreshEnabled: true,
  dailyRefreshHour: 4,
  updatedAt: null,
};

/** Floor on the countdown, so the banner is always readable before the reload. */
export const MIN_FORCED_GRACE_MS = 15_000;
/** Hard cap on how long an active scan/confirm flow may hold off an expired grace. */
export const MAX_ACTIVE_WORK_EXTENSION_MS = 5 * 60_000;
/** Reload attempts per target version before we stop trying and just warn. */
export const MAX_FORCED_RELOAD_ATTEMPTS = 2;
/** How often clients re-read the policy and refresh their heartbeat. */
export const RELEASE_POLICY_POLL_MS = 60_000;
export const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
/** A heartbeat older than this is not counted as an active session. */
export const HEARTBEAT_ACTIVE_WINDOW_MS = 15 * 60_000;

/** Bounds the policy fields accept. The migration enforces the same ranges. */
export const GRACE_MINUTES_MIN = 0;
export const GRACE_MINUTES_MAX = 240;
export const REFRESH_HOUR_MIN = 0;
export const REFRESH_HOUR_MAX = 23;

/** One place each bound is applied, so the form and the countdown cannot drift. */
export function clampGraceMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RELEASE_POLICY.graceMinutes;
  return Math.max(GRACE_MINUTES_MIN, Math.min(GRACE_MINUTES_MAX, Math.floor(value)));
}

export function clampRefreshHour(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_RELEASE_POLICY.dailyRefreshHour;
  return Math.max(REFRESH_HOUR_MIN, Math.min(REFRESH_HOUR_MAX, Math.floor(value)));
}

const POLICY_CACHE_KEY = "warehouseWizard.releasePolicy.cache";
const DEADLINE_KEY = "warehouseWizard.forcedUpdate.deadline";
const ATTEMPTS_KEY = "warehouseWizard.forcedUpdate.attempts";

// ── Version comparison ───────────────────────────────────────────────────────

/**
 * Parse `1.29.2` / `1.28` into numeric segments. Returns null for anything that
 * is not a plain dotted number — the caller then fails open.
 *
 * The project's "roll at 10" numbering (`1.28.10` -> `1.29.0`) keeps every
 * segment a plain integer, so ordinary per-segment numeric comparison is
 * already correct; no special casing is needed.
 */
export function parseAppVersion(value: string | null | undefined): number[] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+(\.\d+){0,3}$/.test(trimmed)) return null;
  return trimmed.split(".").map((part) => Number(part));
}

/** -1 / 0 / 1, or null when either side is not a comparable version. */
export function compareAppVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const left = parseAppVersion(a);
  const right = parseAppVersion(b);
  if (!left || !right) return null;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

/** True only when we are certain the running build predates the required one. */
export function isBuildOutdated(current: string | null | undefined, minRequired: string | null | undefined): boolean {
  if (!minRequired) return false;
  const comparison = compareAppVersions(current, minRequired);
  if (comparison === null) return false;
  return comparison < 0;
}

// ── Grace window ─────────────────────────────────────────────────────────────

/**
 * Deadline for a client that has just noticed it is behind.
 *
 * `force_after` is honoured, but only inside `[15s, grace_minutes]` measured
 * from now — a skewed device clock cannot shorten the window below what an
 * operator can read, nor stretch it past the grace the admin chose.
 */
export function computeForcedUpdateDeadline(input: {
  nowMs: number;
  forceAfterMs: number | null;
  graceMinutes: number;
}): number {
  const graceMs = clampGraceMinutes(input.graceMinutes) * 60_000;
  const ceiling = Math.max(MIN_FORCED_GRACE_MS, graceMs);
  if (input.forceAfterMs === null || !Number.isFinite(input.forceAfterMs)) {
    return input.nowMs + ceiling;
  }
  const remaining = input.forceAfterMs - input.nowMs;
  return input.nowMs + Math.min(ceiling, Math.max(MIN_FORCED_GRACE_MS, remaining));
}

// ── Local state (deadline + attempt guard) ───────────────────────────────────

function readJson<T>(storage: Storage | undefined, key: string): T | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable — the in-memory value still drives this session.
  }
}

function sessionStore(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function localStore(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** Deadline already chosen for this target version in this tab, if any. */
export function readForcedDeadline(version: string): number | null {
  const stored = readJson<{ version: string; deadline: number }>(sessionStore(), DEADLINE_KEY);
  if (!stored || stored.version !== version) return null;
  return Number.isFinite(stored.deadline) ? stored.deadline : null;
}

export function writeForcedDeadline(version: string, deadline: number) {
  writeJson(sessionStore(), DEADLINE_KEY, { version, deadline });
}

export function readForcedReloadAttempts(version: string): number {
  const stored = readJson<{ version: string; count: number }>(localStore(), ATTEMPTS_KEY);
  if (!stored || stored.version !== version) return 0;
  return Number.isFinite(stored.count) ? stored.count : 0;
}

export function recordForcedReloadAttempt(version: string): number {
  const next = readForcedReloadAttempts(version) + 1;
  writeJson(localStore(), ATTEMPTS_KEY, { version, count: next, at: new Date().toISOString() });
  return next;
}

/** Called once the running build satisfies the policy — the gate worked. */
export function clearForcedReloadAttempts() {
  const storage = localStore();
  if (!storage) return;
  try {
    storage.removeItem(ATTEMPTS_KEY);
  } catch {
    /* no-op */
  }
}

// ── Applying the update ──────────────────────────────────────────────────────

/**
 * Drop every cache and service worker registration. Callers must check
 * connectivity first: doing this offline strands the device with no app.
 */
export async function purgeCachesAndServiceWorkers(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
    }
  } catch {
    /* no-op */
  }
  try {
    if (typeof window !== "undefined" && "caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name).catch(() => false)));
    }
  } catch {
    /* no-op */
  }
}

/**
 * Save-then-purge-then-reload. Returns false when it deliberately did nothing
 * (preview iframe, offline, or the attempt cap was already reached).
 */
export async function applyForcedUpdate(targetVersion: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (isPreviewEnvironment()) return false;
  if (navigator.onLine === false) return false;
  if (readForcedReloadAttempts(targetVersion) >= MAX_FORCED_RELOAD_ATTEMPTS) return false;

  recordForcedReloadAttempt(targetVersion);
  await purgeCachesAndServiceWorkers();
  window.location.reload();
  return true;
}

// ── Reading and writing the policy ───────────────────────────────────────────

/** Every policy column, named once so the read and the write cannot drift. */
const POLICY_COLUMNS =
  "min_required_version, force_after, grace_minutes, message, nightly_signout_enabled, daily_refresh_enabled, daily_refresh_hour, updated_at";

type PolicyRow = {
  min_required_version: string | null;
  force_after: string | null;
  grace_minutes: number | null;
  message: string | null;
  nightly_signout_enabled: boolean | null;
  daily_refresh_enabled: boolean | null;
  daily_refresh_hour: number | null;
  updated_at: string | null;
};

function toPolicy(row: PolicyRow | null | undefined): ReleasePolicy {
  if (!row) return DEFAULT_RELEASE_POLICY;
  return {
    minRequiredVersion: row.min_required_version ?? null,
    forceAfter: row.force_after ?? null,
    graceMinutes: typeof row.grace_minutes === "number" ? row.grace_minutes : DEFAULT_RELEASE_POLICY.graceMinutes,
    message: row.message ?? null,
    nightlySignoutEnabled: row.nightly_signout_enabled === true,
    dailyRefreshEnabled: row.daily_refresh_enabled !== false,
    dailyRefreshHour:
      typeof row.daily_refresh_hour === "number" ? row.daily_refresh_hour : DEFAULT_RELEASE_POLICY.dailyRefreshHour,
    updatedAt: row.updated_at ?? null,
  };
}

/** Last policy this device saw. Used at startup, before any session exists. */
export function readCachedReleasePolicy(): ReleasePolicy {
  const cached = readJson<ReleasePolicy>(localStore(), POLICY_CACHE_KEY);
  return cached ? { ...DEFAULT_RELEASE_POLICY, ...cached } : DEFAULT_RELEASE_POLICY;
}

export function cacheReleasePolicy(policy: ReleasePolicy) {
  writeJson(localStore(), POLICY_CACHE_KEY, policy);
}

export async function fetchReleasePolicy(): Promise<ReleasePolicy> {
  const { data, error } = await (supabase as any)
    .from("app_release_policy")
    .select(
      POLICY_COLUMNS,
    )
    .maybeSingle();
  if (error) throw error;
  const policy = toPolicy(data as PolicyRow | null);
  cacheReleasePolicy(policy);
  return policy;
}

export type ReleasePolicyPatch = Partial<{
  minRequiredVersion: string | null;
  forceAfter: string | null;
  graceMinutes: number;
  message: string | null;
  nightlySignoutEnabled: boolean;
  dailyRefreshEnabled: boolean;
  dailyRefreshHour: number;
}>;

export async function saveReleasePolicy(patch: ReleasePolicyPatch): Promise<ReleasePolicy> {
  const row: Record<string, unknown> = {};
  if ("minRequiredVersion" in patch) row.min_required_version = patch.minRequiredVersion;
  if ("forceAfter" in patch) row.force_after = patch.forceAfter;
  if ("graceMinutes" in patch) row.grace_minutes = patch.graceMinutes;
  if ("message" in patch) row.message = patch.message;
  if ("nightlySignoutEnabled" in patch) row.nightly_signout_enabled = patch.nightlySignoutEnabled;
  if ("dailyRefreshEnabled" in patch) row.daily_refresh_enabled = patch.dailyRefreshEnabled;
  if ("dailyRefreshHour" in patch) row.daily_refresh_hour = patch.dailyRefreshHour;

  const { data, error } = await (supabase as any)
    .from("app_release_policy")
    .update(row)
    .eq("id", true)
    .select(
      POLICY_COLUMNS,
    )
    .maybeSingle();
  if (error) throw error;
  // No row came back: the update matched nothing (missing singleton, or RLS
  // refused the write). Never report success and never cache defaults over the
  // policy that is actually in force.
  if (!data) throw new Error("Release policy was not updated — check that you have admin or developer access.");
  const policy = toPolicy(data as PolicyRow);
  cacheReleasePolicy(policy);
  return policy;
}

// ── Fleet heartbeat ──────────────────────────────────────────────────────────

export type FleetSession = {
  deviceId: string;
  appVersion: string;
  lastSeenAt: string;
  userLabel: string | null;
};

export async function sendClientHeartbeat(appVersion: string, userLabel?: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  await (supabase as any).from("app_client_heartbeat").upsert(
    {
      device_id: getOrCreateDeviceId(),
      user_id: data.session.user.id,
      app_version: appVersion,
      user_label: userLabel ?? null,
    },
    // Shared floor tablets carry one row per operator, so the conflict target
    // has to be the full key — see the migration for why.
    { onConflict: "device_id,user_id" },
  );
}

export async function fetchFleetSessions(): Promise<FleetSession[]> {
  const since = new Date(Date.now() - HEARTBEAT_ACTIVE_WINDOW_MS).toISOString();
  const { data, error } = await (supabase as any)
    .from("app_client_heartbeat")
    .select("device_id, app_version, last_seen_at, user_label")
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, string>>).map((row) => ({
    deviceId: row.device_id,
    appVersion: row.app_version,
    lastSeenAt: row.last_seen_at,
    userLabel: row.user_label ?? null,
  }));
}

/** Group heartbeats into "how many sessions on which version", newest build first. */
export function summarizeFleetVersions(sessions: FleetSession[]): Array<{ version: string; sessions: number }> {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    counts.set(session.appVersion, (counts.get(session.appVersion) ?? 0) + 1);
  }
  return Array.from(counts, ([version, count]) => ({ version, sessions: count })).sort((a, b) => {
    const comparison = compareAppVersions(b.version, a.version);
    if (comparison !== null) return comparison;
    return a.version.localeCompare(b.version);
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Polls the policy row and re-reads it whenever the tab regains focus or the
 * connection comes back, so a hot fix reaches a shift-long tab within a minute
 * without any realtime plumbing.
 */
export function useReleasePolicy(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false;
  const [policy, setPolicy] = useState<ReleasePolicy>(() => readCachedReleasePolicy());
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    inFlight.current = true;
    try {
      const next = await fetchReleasePolicy();
      setPolicy(next);
      setLoaded(true);
    } catch {
      // Offline or not yet signed in — the cached policy stays in force.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), RELEASE_POLICY_POLL_MS);
    const onWake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [enabled, refresh]);

  return useMemo(() => ({ policy, loaded, refresh }), [policy, loaded, refresh]);
}
