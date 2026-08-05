import {
  db,
  isRetiredInventoryStatus,
  hasVisibleInventoryQuantity,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  getDashboardMetricKeysForModules,
  type DashboardMetrics,
  type DashboardTaskRow,
  type DashboardMetricKey,
} from "@/features/shared/core-types";

export async function getDashboardMetrics(warehouseId?: string | null, enabledModules?: Partial<Record<string, boolean>>) {
  const dashboardMetricKeys = getDashboardMetricKeysForModules(enabledModules);

  const [balances, locations, receipts, putawayTasks, pickLists, moveTasks, transfers, cycleCounts, stagingLoads, replenishments, audits] = await Promise.all([
    db("inventory_balances").select("id, warehouse_id, status, zone_id, pallet_id, created_at, received_at, expiry_date"),
    db("locations").select("warehouse_id, max_pallets"),
    db("receipts").select("id, receipt_number, reference_number, warehouse_id, status, created_at").in("status", ["draft", "queued", "assigned", "in_progress"]),
    db("putaway_tasks").select("id, task_number, warehouse_id, status, created_at").in("status", ["queued", "assigned", "in_progress", "exception"]),
    db("pick_lists").select("id, pick_list_number, warehouse_id, status, created_at").in("status", ["draft", "queued", "assigned", "in_progress", "exception"]),
    db("move_tasks").select("id, task_number, warehouse_id, status, created_at").in("status", ["queued", "assigned", "in_progress", "exception"]),
    db("transfers").select("id, transfer_number, source_warehouse_id, destination_warehouse_id, status, created_at").in("status", ["draft", "queued", "assigned", "in_progress", "exception"]),
    db("cycle_counts").select("id, count_number, warehouse_id, status, created_at").in("status", ["queued", "assigned", "in_progress", "exception"]),
    db("staging_loads").select("id, route_code, status, created_at, pick_lists(warehouse_id)").in("status", ["ready", "called", "loading", "blocked"]),
    db("replenishment_tasks").select("id, task_number, warehouse_id, status, created_at").in("status", ["queued", "assigned", "in_progress", "exception"]),
    db("audit_events").select("id, warehouse_id").order("created_at", { ascending: false }).limit(50),
  ]);

  if (balances.error) throw balances.error;
  if (locations.error) throw locations.error;
  if (receipts.error) throw receipts.error;
  if (putawayTasks.error) throw putawayTasks.error;
  if (pickLists.error) throw pickLists.error;
  if (moveTasks.error) throw moveTasks.error;
  if (transfers.error) throw transfers.error;
  if (cycleCounts.error) throw cycleCounts.error;
  if (stagingLoads.error) throw stagingLoads.error;
  if (replenishments.error) throw replenishments.error;
  if (audits.error) throw audits.error;

  const allBalanceRows = balances.data ?? [];
  const balanceRows = warehouseId ? allBalanceRows.filter((row: any) => row.warehouse_id === warehouseId) : allBalanceRows;
  const liveAllBalanceRows = allBalanceRows.filter((row: any) => !isRetiredInventoryStatus(row.status));
  const liveBalanceRows = balanceRows.filter((row: any) => !isRetiredInventoryStatus(row.status));
  const coolRows = liveBalanceRows.filter((row: any) => row.zone_id);
  const locationRows = locations.data ?? [];
  const totalPalletCapacity = locationRows.reduce((sum: number, row: any) => sum + Number(row.max_pallets ?? 0), 0);
  const warehouseRows = warehouseId ? liveBalanceRows : [];
  const warehousePalletCapacity = warehouseId
    ? locationRows
        .filter((row: any) => row.warehouse_id === warehouseId)
        .reduce((sum: number, row: any) => sum + Number(row.max_pallets ?? 0), 0)
    : 0;
  const scopedReceipts = warehouseId ? (receipts.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (receipts.data ?? []);
  const scopedPutaway = warehouseId ? (putawayTasks.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (putawayTasks.data ?? []);
  const scopedPickLists = warehouseId ? (pickLists.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (pickLists.data ?? []);
  const scopedMoveTasks = warehouseId ? (moveTasks.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (moveTasks.data ?? []);
  const scopedTransfers = warehouseId
    ? (transfers.data ?? []).filter((row: any) => row.source_warehouse_id === warehouseId || row.destination_warehouse_id === warehouseId)
    : (transfers.data ?? []);
  const scopedCycleCounts = warehouseId ? (cycleCounts.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (cycleCounts.data ?? []);
  const scopedStagingLoads = warehouseId
    ? (stagingLoads.data ?? []).filter((row: any) => row.pick_lists?.warehouse_id === warehouseId)
    : (stagingLoads.data ?? []);
  const scopedReplenishments = warehouseId ? (replenishments.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (replenishments.data ?? []);
  const scopedAudits = warehouseId ? (audits.data ?? []).filter((row: any) => row.warehouse_id === warehouseId) : (audits.data ?? []);
  const nowMs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const daysUntil = (value: string | null | undefined) => value ? Math.ceil((new Date(value).getTime() - nowMs) / dayMs) : null;
  const ageDays = (value: string | null | undefined) => value ? Math.floor((nowMs - new Date(value).getTime()) / dayMs) : 0;
  const expiryWarning60 = liveBalanceRows.filter((row: any) => {
    const days = daysUntil(row.expiry_date);
    return days !== null && days >= 0 && days <= 60;
  }).length;
  const expiryWarning30 = liveBalanceRows.filter((row: any) => {
    const days = daysUntil(row.expiry_date);
    return days !== null && days >= 0 && days <= 30;
  }).length;
  const stockAge3Months = liveBalanceRows.filter((row: any) => ageDays(row.received_at ?? row.created_at) >= 90).length;
  const stockAge6Months = liveBalanceRows.filter((row: any) => ageDays(row.received_at ?? row.created_at) >= 180).length;
  const stockAge12Months = liveBalanceRows.filter((row: any) => ageDays(row.received_at ?? row.created_at) >= 365).length;

  const receiptRows: DashboardTaskRow[] = scopedReceipts
    .filter((row: any) => row.status === "draft")
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.receipt_number,
      sublabel: row.reference_number ?? row.receipt_number,
      route: "/receiving",
      createdAt: row.created_at,
    }));

  const putawayRows: DashboardTaskRow[] = scopedPutaway
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.task_number,
      sublabel: row.status,
      route: "/putaway-tasks",
      createdAt: row.created_at,
    }));

  const pickRows: DashboardTaskRow[] = scopedPickLists
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.pick_list_number,
      sublabel: row.status,
      route: "/pick-lists",
      createdAt: row.created_at,
    }));

  const moveRows: DashboardTaskRow[] = scopedMoveTasks
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.task_number,
      sublabel: row.status,
      route: "/location-moves",
      createdAt: row.created_at,
    }));

  const transferRows: DashboardTaskRow[] = scopedTransfers
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.transfer_number,
      sublabel: row.status,
      route: "/transfers",
      createdAt: row.created_at,
    }));

  const cycleCountRows: DashboardTaskRow[] = scopedCycleCounts
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.count_number,
      sublabel: row.status,
      route: "/cycle-counts",
      createdAt: row.created_at,
    }));

  const dockLoadRows: DashboardTaskRow[] = scopedStagingLoads
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.route_code,
      sublabel: row.status,
      route: "/pick-lists",
      createdAt: row.created_at,
    }));

  const replenishmentRows: DashboardTaskRow[] = scopedReplenishments
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: row.task_number,
      sublabel: row.status,
      route: "/inventory-search",
      createdAt: row.created_at,
    }));

  const blockedRows: DashboardTaskRow[] = balanceRows
    .filter((row: any) => row.status === "hold" || row.status === "quarantine")
    .sort((a: any, b: any) => a.created_at < b.created_at ? -1 : 1)
    .map((row: any) => ({
      id: row.id,
      label: String(row.pallet_id).slice(0, 8).toUpperCase(),
      sublabel: row.status,
      route: "/status",
      createdAt: row.created_at,
    }));

  return {
    totalPallets: liveAllBalanceRows.length,
    totalPalletCapacity,
    warehousePallets: warehouseRows.length,
    warehousePalletCapacity,
    availablePallets: balanceRows.filter((row: any) => row.status === "available").length,
    coolZoneOccupancy: coolRows.length,
    openReceipts: scopedReceipts.filter((row: any) => row.status === "draft").length,
    openPutawayTasks: scopedPutaway.length,
    openPickLists: scopedPickLists.length,
    openMoveTasks: scopedMoveTasks.length,
    openTransfers: scopedTransfers.length,
    openCycleCounts: scopedCycleCounts.length,
    openDockLoads: scopedStagingLoads.length,
    openReplenishmentTasks: scopedReplenishments.length,
    recentAuditEvents: scopedAudits.length,
    holdStock: balanceRows.filter((row: any) => row.status === "hold").length,
    quarantineStock: balanceRows.filter((row: any) => row.status === "quarantine").length,
    expiryWarning60,
    expiryWarning30,
    stockAge3Months,
    stockAge6Months,
    stockAge12Months,
    receiptRows,
    putawayTaskRows: putawayRows,
    pickListRows: pickRows,
    moveTaskRows: moveRows,
    transferRows,
    cycleCountRows,
    dockLoadRows,
    replenishmentRows,
    blockedBalanceRows: blockedRows,
    dashboardMetricKeys,
  } satisfies DashboardMetrics;
}
