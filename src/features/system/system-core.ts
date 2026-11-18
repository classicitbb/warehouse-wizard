import { supabase } from "@/integrations/supabase/client";
import { db, formatSupabaseError } from "@/features/shared/core-types";
import { platformSupportEnabled } from "@/lib/platform-support";
import {
  archivePlatformLog,
  archivePlatformLogsOlderThan,
  listPlatformLogs,
  queuePlatformLog,
  resolvePlatformLog,
} from "@/features/system/system-log-platform";

export type ClientVariable = {
  id: string;
  client_id: string;
  key: string;
  value: string;
  variable_type: "text" | "number" | "boolean" | "date" | "json";
  description: string | null;
  is_hidden: boolean;
  created_at: string;
  updated_at: string;
};

export async function listClientVariables(clientId?: string) {
  let query = db("client_variables")
    .select("*, clients(code, name)")
    .eq("is_hidden", false)
    .order("client_id")
    .order("key");
  if (clientId) query = query.eq("client_id", clientId);
  const { data, error } = await query;
  if (error) throw new Error(formatSupabaseError(error, "Failed to load client variables"));
  return (data ?? []) as any[];
}

export async function upsertClientVariable(payload: {
  id?: string;
  client_id: string;
  key: string;
  value: string;
  variable_type?: string;
  description?: string;
}) {
  const record = {
    ...(payload.id ? { id: payload.id } : {}),
    client_id: payload.client_id,
    key: payload.key.trim(),
    value: payload.value,
    variable_type: payload.variable_type ?? "text",
    description: payload.description ?? null,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await db("client_variables").upsert(record as never).select().single();
  if (error) throw error;
  return data as ClientVariable;
}

export async function deleteClientVariable(id: string) {
  const { error } = await db("client_variables").update({ is_hidden: true }).eq("id", id);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// System Logs
// ─────────────────────────────────────────────────────────────────────────────

export type SystemLogEntry = {
  id: string;
  log_type: "error" | "bug" | "system_change" | "infrastructure" | "record_count" | "info";
  severity: "debug" | "info" | "warning" | "error" | "critical";
  title: string;
  message: string | null;
  details: Record<string, unknown> | null;
  source: string | null;
  table_name: string | null;
  record_count: number | null;
  resolved: boolean;
  resolved_at: string | null;
  created_by: string | null;
  created_at: string;
};

type LogFilters = {
  log_type?: string;
  severity?: string;
  source?: string;
  resolved?: boolean;
  limit?: number;
};

/**
 * Ids of rows that came from this tenant's own `system_logs` in the last read.
 * With platform support on, client telemetry goes to the platform, but database
 * triggers still write here, so both are shown and actions go to the right store.
 */
const localLogIds = new Set<string>();

const byNewest = (field: string) => (a: Record<string, unknown>, b: Record<string, unknown>) =>
  String(b[field] ?? "").localeCompare(String(a[field] ?? ""));

export async function listSystemLogs(filters?: LogFilters) {
  if (!platformSupportEnabled()) return listLocalSystemLogs(filters);
  const limit = filters?.limit ?? 200;
  const [remote, local] = await Promise.all([
    listPlatformLogs({ ...filters, limit }),
    listLocalSystemLogs(filters).catch(() => [] as any[]),
  ]);
  local.forEach((row) => localLogIds.add(String(row.id)));
  const source = filters?.source && filters.source !== "all" ? filters.source : null;
  return [...remote.filter((row) => !source || row.source === source), ...local]
    .sort(byNewest("created_at"))
    .slice(0, limit) as any[];
}

async function listLocalSystemLogs(filters?: LogFilters) {
  let query = db("system_logs")
    .select("*, profiles:created_by(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(filters?.limit ?? 200);

  if (filters?.log_type && filters.log_type !== "all") {
    query = query.eq("log_type", filters.log_type);
  }
  if (filters?.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }
  if (filters?.source && filters.source !== "all") {
    query = query.eq("source", filters.source);
  }
  if (filters?.resolved !== undefined) {
    query = query.eq("resolved", filters.resolved);
  }


  const { data, error } = await query;
  if (error) throw new Error(formatSupabaseError(error, "Failed to load system logs"));
  return (data ?? []) as any[];
}

export async function writeSystemLog(payload: {
  log_type: SystemLogEntry["log_type"];
  severity: SystemLogEntry["severity"];
  title: string;
  message?: string;
  details?: Record<string, unknown>;
  source?: string;
  table_name?: string;
  record_count?: number;
}) {
  // Client telemetry lives on the control plane now (platform ADR-0023).
  if (platformSupportEnabled()) return queuePlatformLog(payload);
  const { data, error } = await (supabase.rpc as any)("write_system_log", {
    in_log_type: payload.log_type,
    in_severity: payload.severity,
    in_title: payload.title,
    in_message: payload.message ?? null,
    in_details: payload.details ?? null,
    in_source: payload.source ?? null,
    in_table_name: payload.table_name ?? null,
    in_record_count: payload.record_count ?? null,
  });
  if (error) throw new Error(formatSupabaseError(error, "Failed to write system log"));
  return data as string;
}

export async function resolveSystemLog(id: string) {
  if (platformSupportEnabled() && !localLogIds.has(id)) return resolvePlatformLog(id);
  const { error } = await db("system_logs")
    .update({ resolved: true, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(formatSupabaseError(error, "Failed to resolve system log"));
}

// ─────────────────────────────────────────────────────────────────────────────
// System Log Archiving
// ─────────────────────────────────────────────────────────────────────────────

export type SystemLogArchiveEntry = SystemLogEntry & {
  archived_at: string;
  archived_by: string | null;
};

/** Moves a single log entry into system_logs_archive and removes it from the live table. */
export async function archiveSystemLog(id: string) {
  if (platformSupportEnabled() && !localLogIds.has(id)) return archivePlatformLog(id);
  const { error } = await (supabase.rpc as any)("archive_system_log", { in_id: id });
  if (error) throw new Error(formatSupabaseError(error, "Failed to archive log entry"));
}

/**
 * Bulk-moves log entries older than `days` (default 90) into system_logs_archive.
 * Returns the number of entries archived.
 */
export async function archiveSystemLogsOlderThan(days = 90) {
  if (platformSupportEnabled()) {
    const [remote, local] = await Promise.all([
      archivePlatformLogsOlderThan(days),
      archiveLocalSystemLogsOlderThan(days).catch(() => 0),
    ]);
    return remote + local;
  }
  return archiveLocalSystemLogsOlderThan(days);
}

async function archiveLocalSystemLogsOlderThan(days: number) {
  const { data, error } = await (supabase.rpc as any)("archive_system_logs_older_than", { in_days: days });
  if (error) throw new Error(formatSupabaseError(error, "Failed to archive old log entries"));
  return (data as number) ?? 0;
}

type ArchiveFilters = { log_type?: string; severity?: string; limit?: number };

export async function listArchivedSystemLogs(filters?: ArchiveFilters) {
  if (!platformSupportEnabled()) return listLocalArchivedSystemLogs(filters);
  const limit = filters?.limit ?? 200;
  const [remote, local] = await Promise.all([
    listPlatformLogs({ ...filters, archived: true, limit }),
    listLocalArchivedSystemLogs(filters).catch(() => [] as SystemLogArchiveEntry[]),
  ]);
  return ([...remote, ...local] as Record<string, unknown>[])
    .sort(byNewest("archived_at"))
    .slice(0, limit) as unknown as SystemLogArchiveEntry[];
}

async function listLocalArchivedSystemLogs(filters?: ArchiveFilters) {
  let query = db("system_logs_archive")
    .select("*")
    .order("archived_at", { ascending: false })
    .limit(filters?.limit ?? 200);

  if (filters?.log_type && filters.log_type !== "all") {
    query = query.eq("log_type", filters.log_type);
  }
  if (filters?.severity && filters.severity !== "all") {
    query = query.eq("severity", filters.severity);
  }

  const { data, error } = await query;
  if (error) throw new Error(formatSupabaseError(error, "Failed to load archived system logs"));
  return (data ?? []) as SystemLogArchiveEntry[];
}
