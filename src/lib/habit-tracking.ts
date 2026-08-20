/**
 * habit-tracking.ts
 *
 * What the operator actually did, so the copilot can ask a better question.
 *
 * Two jobs:
 *  1. **Breadcrumbs.** The last N actions stay in memory (and sessionStorage, so
 *     they survive a crash-reload). When someone reports "it did not work", the
 *     copilot already knows the last thing they touched instead of asking.
 *  2. **Habits.** Actions are batched to `record_user_action_events`, and the
 *     server rolls them into `user_habit_profiles`. The same summary shape is
 *     computed locally from the buffer, so a report filed seconds after the
 *     problem still carries habit context that has not been flushed yet.
 *
 * Privacy: an action records *what kind of thing* happened and where, never the
 * content of a field. Metadata is shallow, key-redacted, and length-capped.
 * Nothing here blocks or fails a user action — every path is best-effort.
 */

import { supabase } from "@/integrations/supabase/client";

export type ActionOutcome = "ok" | "error" | "abandoned";

export type ActionEvent = {
  /** Stable verb-ish label, e.g. "putaway.confirm" or "route.view". */
  action: string;
  /** App path the action happened on. */
  route: string;
  /** Optional subject: a task number, a resource table, a control name. */
  target?: string | null;
  outcome: ActionOutcome;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  warehouseId?: string | null;
  occurredAt: string;
};

export type HabitSummary = {
  sampleSize: number;
  topRoutes: Array<{ route: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  frictionPoints: Array<{
    action: string;
    route: string;
    errors: number;
    attempts: number;
    errorRate: number;
  }>;
  activeHours: Array<{ hour: number; count: number }>;
};

const BREADCRUMB_CAPACITY = 60;
const PENDING_CAPACITY = 200;
const FLUSH_AT = 25;
const FLUSH_INTERVAL_MS = 30_000;
const STORAGE_KEY = "wms.habits.breadcrumbs";
const MAX_METADATA_KEYS = 8;
const MAX_STRING = 160;
const SENSITIVE_KEY = /pass|pin|token|secret|key|auth|cookie|session|credential|email|phone/i;

/**
 * The generated Supabase types are regenerated from the schema and do not yet
 * know about these functions. A narrow seam beats sprinkling `as any` at the
 * call sites, and it goes away once the types are regenerated.
 */
type UntypedRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

const rpc = supabase.rpc as unknown as UntypedRpc;

let breadcrumbs: ActionEvent[] = [];
let pending: ActionEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;
let flushInFlight: Promise<number> | null = null;
/** Set when the ingest RPC is missing (migration not applied) — stop retrying. */
let ingestDisabled = false;

// ── Sanitising ───────────────────────────────────────────────────────────────

/** One level deep, key-redacted, length-capped. Free text never gets stored. */
export function redactActionMetadata(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>).slice(0, MAX_METADATA_KEYS)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]";
      continue;
    }
    if (value == null || typeof value === "boolean" || typeof value === "number") {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
    } else if (Array.isArray(value)) {
      output[key] = value.length;
    } else {
      output[key] = "[object]";
    }
  }
  return output;
}

function normalizeText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Collapse ids out of a path so `/inventory/9f3c…` and `/inventory/1a2b…`
 * count as the same screen. Without this every detail view is its own "route"
 * and no route ever looks frequent.
 */
export function normalizeRoute(pathname: string): string {
  const path = normalizeText(pathname, 200) || "/";
  return path
    .split("/")
    .map((segment) => {
      if (!segment) return segment;
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment)) return ":id";
      if (/^\d+$/.test(segment)) return ":id";
      return segment;
    })
    .join("/");
}

// ── Recording ────────────────────────────────────────────────────────────────

function persistBreadcrumbs() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(breadcrumbs.slice(-BREADCRUMB_CAPACITY)));
  } catch {
    // Private mode / quota — breadcrumbs stay in memory only.
  }
}

function loadBreadcrumbs() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      breadcrumbs = parsed.filter((entry): entry is ActionEvent =>
        Boolean(entry && typeof entry === "object" && typeof (entry as ActionEvent).action === "string"),
      );
    }
  } catch {
    // Corrupt payload — start clean rather than throwing during module init.
  }
}

/**
 * Record one action. Never throws: telemetry must not be able to break a
 * warehouse workflow.
 */
export function recordAction(input: {
  action: string;
  route?: string;
  target?: string | null;
  outcome?: ActionOutcome;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  warehouseId?: string | null;
  occurredAt?: string;
}): ActionEvent | null {
  try {
    const action = normalizeText(input.action, 120);
    if (!action) return null;

    const event: ActionEvent = {
      action,
      route: normalizeRoute(
        input.route ?? (typeof window === "undefined" ? "" : window.location.pathname),
      ),
      target: input.target ? normalizeText(input.target, 200) : null,
      outcome: input.outcome ?? "ok",
      durationMs:
        typeof input.durationMs === "number" && Number.isFinite(input.durationMs)
          ? Math.max(0, Math.round(input.durationMs))
          : null,
      metadata: redactActionMetadata(input.metadata),
      warehouseId: input.warehouseId ?? null,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
    };

    breadcrumbs.push(event);
    if (breadcrumbs.length > BREADCRUMB_CAPACITY) breadcrumbs = breadcrumbs.slice(-BREADCRUMB_CAPACITY);
    persistBreadcrumbs();

    if (!ingestDisabled) {
      pending.push(event);
      // Drop the oldest rather than growing without bound while offline.
      if (pending.length > PENDING_CAPACITY) pending = pending.slice(-PENDING_CAPACITY);
      if (pending.length >= FLUSH_AT) void flushActionEvents();
      else scheduleFlush();
    }

    return event;
  } catch {
    return null;
  }
}

function scheduleFlush() {
  if (flushTimer || typeof setTimeout !== "function") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushActionEvents();
  }, FLUSH_INTERVAL_MS);
}

/** Last actions, oldest first. Used as ticket evidence. */
export function recentActions(limit = 20): ActionEvent[] {
  return breadcrumbs.slice(-Math.max(0, limit));
}

/** The most recent failure, which is almost always what a report is about. */
export function lastFailedAction(): ActionEvent | null {
  for (let index = breadcrumbs.length - 1; index >= 0; index--) {
    if (breadcrumbs[index].outcome === "error") return breadcrumbs[index];
  }
  return null;
}

// ── Flushing ─────────────────────────────────────────────────────────────────

/**
 * Send buffered events. Returns how many were accepted. Failures put the batch
 * back so nothing is lost to a dropped connection — except a missing RPC, which
 * disables ingest for the session instead of retrying forever.
 */
export async function flushActionEvents(): Promise<number> {
  if (flushInFlight) return flushInFlight;
  if (ingestDisabled || pending.length === 0) return 0;

  const batch = pending;
  pending = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  flushInFlight = (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        // Signed out: habits belong to a user, so drop rather than queue.
        return 0;
      }
      const { error } = await rpc("record_user_action_events", {
        in_events: batch.map((event) => ({
          warehouse_id: event.warehouseId,
          route: event.route,
          action: event.action,
          target: event.target,
          outcome: event.outcome,
          duration_ms: event.durationMs,
          metadata: event.metadata ?? {},
          occurred_at: event.occurredAt,
        })),
      });
      if (error) {
        // 42883 / PGRST202: function not deployed yet. Retrying every 30s for
        // the rest of the session would just be noise.
        const code = String(error.code ?? "");
        if (code === "42883" || code === "PGRST202") {
          ingestDisabled = true;
          return 0;
        }
        pending = [...batch, ...pending].slice(-PENDING_CAPACITY);
        return 0;
      }
      return batch.length;
    } catch {
      pending = [...batch, ...pending].slice(-PENDING_CAPACITY);
      return 0;
    } finally {
      flushInFlight = null;
    }
  })();

  return flushInFlight;
}

/** Wire the background flush. Safe to call more than once. */
export function installHabitTracking() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  loadBreadcrumbs();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushActionEvents();
  });
  window.addEventListener("pagehide", () => {
    void flushActionEvents();
  });
}

// ── Summarising ──────────────────────────────────────────────────────────────

function rank<T extends string>(counts: Map<T, number>, limit: number) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit);
}

/**
 * Roll events into the same shape `refresh_user_habit_profile` produces, so a
 * locally-derived summary and a server-derived one are interchangeable.
 */
export function summarizeActions(events: readonly ActionEvent[], limit = 5): HabitSummary {
  const routes = new Map<string, number>();
  const actions = new Map<string, number>();
  const hours = new Map<number, number>();
  const friction = new Map<string, { action: string; route: string; errors: number; attempts: number }>();

  for (const event of events) {
    if (event.route) routes.set(event.route, (routes.get(event.route) ?? 0) + 1);
    actions.set(event.action, (actions.get(event.action) ?? 0) + 1);

    const hour = new Date(event.occurredAt).getUTCHours();
    if (Number.isFinite(hour)) hours.set(hour, (hours.get(hour) ?? 0) + 1);

    const key = `${event.action} ${event.route}`;
    const entry = friction.get(key) ?? { action: event.action, route: event.route, errors: 0, attempts: 0 };
    entry.attempts += 1;
    if (event.outcome === "error") entry.errors += 1;
    friction.set(key, entry);
  }

  return {
    sampleSize: events.length,
    topRoutes: rank(routes, limit).map(([route, count]) => ({ route, count })),
    topActions: rank(actions, limit).map(([action, count]) => ({ action, count })),
    frictionPoints: [...friction.values()]
      .filter((entry) => entry.errors > 0)
      .map((entry) => ({
        ...entry,
        errorRate: Math.round((entry.errors / entry.attempts) * 1000) / 1000,
      }))
      .sort((a, b) => b.errors - a.errors || b.errorRate - a.errorRate || a.action.localeCompare(b.action))
      .slice(0, limit),
    activeHours: [...hours.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([hour, count]) => ({ hour, count })),
  };
}

/** Local-buffer habits, for grounding a report filed moments after the problem. */
export function localHabitSummary(limit = 5): HabitSummary {
  return summarizeActions(breadcrumbs, limit);
}

/** Compact, model-readable habit note. Empty string when there is nothing to say. */
export function describeHabitsForCopilot(summary: HabitSummary): string {
  if (summary.sampleSize === 0) return "";
  const lines: string[] = [];
  if (summary.topRoutes.length) {
    lines.push(`Most-used screens: ${summary.topRoutes.map((r) => `${r.route} (${r.count})`).join(", ")}`);
  }
  if (summary.topActions.length) {
    lines.push(`Most-used actions: ${summary.topActions.map((a) => `${a.action} (${a.count})`).join(", ")}`);
  }
  if (summary.frictionPoints.length) {
    lines.push(
      `Repeated trouble: ${summary.frictionPoints
        .map((f) => `${f.action} on ${f.route} — ${f.errors}/${f.attempts} failed`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

/** Server-side rollup. Best-effort: returns null when unavailable. */
export async function refreshHabitProfile(userId?: string): Promise<HabitSummary | null> {
  try {
    await flushActionEvents();
    const { data, error } = await rpc("refresh_user_habit_profile", {
      in_user_id: userId ?? null,
      in_window_days: 30,
    });
    if (error || !data) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      sampleSize: Number(row.sample_size ?? 0),
      topRoutes: (row.top_routes as HabitSummary["topRoutes"]) ?? [],
      topActions: (row.top_actions as HabitSummary["topActions"]) ?? [],
      frictionPoints: (row.friction_points as HabitSummary["frictionPoints"]) ?? [],
      activeHours: (row.active_hours as HabitSummary["activeHours"]) ?? [],
    };
  } catch {
    return null;
  }
}

/** Test seam — clears every buffer and re-enables ingest. */
export function resetHabitTracking() {
  breadcrumbs = [];
  pending = [];
  ingestDisabled = false;
  flushInFlight = null;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
