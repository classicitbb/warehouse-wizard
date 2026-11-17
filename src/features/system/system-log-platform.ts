/**
 * system-log-platform.ts
 *
 * The system log as stored on the control plane (platform ADR-0023). Writes are
 * batched: telemetry fires on every toast and console error, so entries are
 * queued and sent together (on a short timer, when the queue fills, and when the
 * tab is hidden). Reads return rows shaped like the old `system_logs` rows so
 * the System page and shell alerts did not have to change.
 */

import { callPlatformSupport, PlatformSupportError } from "@/lib/platform-support";

export type PlatformLogInput = {
  log_type: string;
  severity: string;
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  source?: string;
  table_name?: string;
  record_count?: number;
};

type QueuedEntry = PlatformLogInput & { created_at: string; route: string; app_version: string };

const FLUSH_MS = 2_000;
const MAX_BATCH = 50;
const MAX_QUEUE = 500;

let queue: QueuedEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listenersInstalled = false;

function appVersion() {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  } catch {
    return "unknown";
  }
}

async function flush(keepalive = false) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    const batch = queue.splice(0, MAX_BATCH);
    try {
      await callPlatformSupport("logs.write", { entries: batch }, { keepalive });
    } catch (error) {
      // Signed out or offline: keep what fits and try again later. Never console.error
      // here, or console telemetry would log its own failure forever.
      if (!(error instanceof PlatformSupportError) || error.status >= 500 || error.status === 401) {
        queue = [...batch, ...queue].slice(-MAX_QUEUE);
      }
      console.warn("[system-telemetry] platform log write deferred:", (error as Error).message);
      scheduleFlush(15_000);
      return;
    }
  }
}

function scheduleFlush(delay = FLUSH_MS) {
  if (timer) return;
  timer = setTimeout(() => void flush(), delay);
}

function installListeners() {
  if (listenersInstalled || typeof document === "undefined") return;
  listenersInstalled = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
  window.addEventListener("online", () => void flush());
}

/** Queue one entry. Resolves once it is queued; delivery is best effort. */
export function queuePlatformLog(entry: PlatformLogInput): Promise<string> {
  installListeners();
  queue.push({
    ...entry,
    created_at: new Date().toISOString(),
    route: typeof window !== "undefined" ? window.location.pathname : "",
    app_version: appVersion(),
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (queue.length >= MAX_BATCH) void flush();
  else scheduleFlush();
  return Promise.resolve("");
}

/** Old `system_logs` row shape, so existing screens keep working. */
function toLegacyRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    created_by: row.tenant_user_id ?? null,
    profiles: row.tenant_user_email ? { full_name: null, email: row.tenant_user_email } : null,
    archived_by: null,
  };
}

export async function listPlatformLogs(filters: {
  log_type?: string;
  severity?: string;
  resolved?: boolean;
  limit?: number;
  archived?: boolean;
}) {
  try {
    const { logs } = await callPlatformSupport<{ logs: Record<string, unknown>[] }>("logs.list", filters);
    return logs.map(toLegacyRow);
  } catch (error) {
    // Roles below supervisor cannot read the log; the shell's alert poll simply sees nothing.
    if (error instanceof PlatformSupportError && error.status === 403) return [];
    throw error;
  }
}

export async function resolvePlatformLog(id: string) {
  await callPlatformSupport("logs.resolve", { id });
}

export async function archivePlatformLog(id: string) {
  await callPlatformSupport("logs.archive", { id });
}

export async function archivePlatformLogsOlderThan(days: number) {
  const { archived } = await callPlatformSupport<{ archived: number }>("logs.archive", { older_than_days: days });
  return archived ?? 0;
}
