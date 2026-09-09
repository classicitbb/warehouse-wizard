import { supabase } from "@/integrations/supabase/client";
import {
  getDashboardMetricKeysForModules,
  type DashboardMetrics,
  type DashboardTaskRow,
  TRANSFERS_ENABLED,
} from "@/features/shared/core-types";

type SummaryPayload = Record<string, unknown>;

function num(payload: SummaryPayload, key: string): number {
  return Number(payload?.[key] ?? 0);
}

function rows(payload: SummaryPayload, key: string): DashboardTaskRow[] {
  const value = payload?.[key];
  return Array.isArray(value) ? (value as DashboardTaskRow[]) : [];
}

/**
 * One database call returns every Command Center count plus the clickable task
 * rows behind each tile. Counting used to happen in the browser after
 * downloading raw inventory rows, which both cost ~10 round trips per refresh
 * and silently truncated at the 1,000-row API cap, under-reporting totals.
 */
export async function getDashboardMetrics(
  warehouseId?: string | null,
  enabledModules?: Partial<Record<string, boolean>>,
) {
  const dashboardMetricKeys = getDashboardMetricKeysForModules(enabledModules);

  const { data, error } = await (supabase.rpc as any)("dashboard_metrics_summary", {
    p_warehouse_id: warehouseId ?? null,
  });
  if (error) throw error;
  const payload = (data ?? {}) as SummaryPayload;

  const transferRows = TRANSFERS_ENABLED ? rows(payload, "transferRows") : [];

  return {
    totalPallets: num(payload, "totalPallets"),
    totalPalletCapacity: num(payload, "totalPalletCapacity"),
    warehousePallets: num(payload, "warehousePallets"),
    warehousePalletCapacity: num(payload, "warehousePalletCapacity"),
    availablePallets: num(payload, "availablePallets"),
    coolZoneOccupancy: num(payload, "coolZoneOccupancy"),
    // Counts come from full database counts, not the capped detail-row arrays.
    openReceipts: num(payload, "openReceipts"),
    openPutawayTasks: num(payload, "openPutawayTasks"),
    openPickLists: num(payload, "openPickLists"),
    openMoveTasks: num(payload, "openMoveTasks"),
    openTransfers: TRANSFERS_ENABLED ? num(payload, "openTransfers") : 0,
    openCycleCounts: num(payload, "openCycleCounts"),
    openDockLoads: num(payload, "openDockLoads"),
    openReplenishmentTasks: num(payload, "openReplenishmentTasks"),
    recentAuditEvents: num(payload, "recentAuditEvents"),
    holdStock: num(payload, "holdStock"),
    quarantineStock: num(payload, "quarantineStock"),
    expiryWarning60: num(payload, "expiryWarning60"),
    expiryWarning30: num(payload, "expiryWarning30"),
    stockAge3Months: num(payload, "stockAge3Months"),
    stockAge6Months: num(payload, "stockAge6Months"),
    stockAge12Months: num(payload, "stockAge12Months"),
    receiptRows: rows(payload, "receiptRows"),
    putawayTaskRows: rows(payload, "putawayTaskRows"),
    pickListRows: rows(payload, "pickListRows"),
    moveTaskRows: rows(payload, "moveTaskRows"),
    transferRows,
    cycleCountRows: rows(payload, "cycleCountRows"),
    dockLoadRows: rows(payload, "dockLoadRows"),
    replenishmentRows: rows(payload, "replenishmentRows"),
    blockedBalanceRows: rows(payload, "blockedBalanceRows"),
    dashboardMetricKeys,
  } satisfies DashboardMetrics;
}
