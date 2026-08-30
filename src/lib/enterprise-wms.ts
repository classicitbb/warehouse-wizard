import type { DashboardMetrics, DashboardTaskRow, RoleCode } from "@/lib/wms-core";
import { inferProductCategory } from "@/features/reports/reports-core";

type InventoryRow = {
  sku?: string | null;
  product_name?: string | null;
  warehouse_code?: string | null;
  location_code?: string | null;
  pallet_code?: string | null;
  status?: string | null;
  available_quantity?: number | null;
  expiry_date?: string | null;
  received_at?: string | null;
};

type OccupancyRow = {
  warehouse_id?: string | null;
  location_id?: string | null;
  location_code?: string | null;
  temperature_class?: string | null;
  occupied_pallets?: number | null;
  max_pallets?: number | null;
  is_full?: boolean | null;
};

type ReorderAlertRow = {
  id?: string | null;
  warehouse_id?: string | null;
  available_quantity?: number | null;
  reorder_point?: number | null;
  recommended_quantity?: number | null;
  products?: { sku?: string | null; name?: string | null } | null;
};

type CycleCountLine = {
  variance_quantity?: number | null;
  variance_percent?: number | null;
  status?: string | null;
};

type StagingLoadRow = {
  id?: string | null;
  route_code?: string | null;
  status?: DockHandoffLoad["status"] | null;
  blocker?: string | null;
  load_sequence?: number | null;
  pick_list_id?: string | null;
  dock_appointment_id?: string | null;
  pick_lists?: {
    pick_list_number?: string | null;
    warehouse_id?: string | null;
    clients?: { code?: string | null; name?: string | null } | null;
  } | null;
};

type DockAppointmentRow = {
  id?: string | null;
  dock_door?: string | null;
  carrier?: string | null;
  driver_name?: string | null;
  status?: string | null;
};

type PrinterStationRow = {
  active?: boolean | null;
};

type LabelTemplateRow = {
  active?: boolean | null;
};

type PrintJobRow = {
  status?: string | null;
};

type AiRecommendationRow = {
  id?: string | null;
  recommendation_key?: string | null;
  title?: string | null;
  severity?: WarehouseBrainRecommendation["severity"] | null;
  audience?: RoleCode[] | null;
  reason?: string | null;
  next_action?: string | null;
};

export type EnterpriseReportData = {
  inventory?: InventoryRow[];
  occupancy?: OccupancyRow[];
  audits?: Array<Record<string, unknown>>;
  cycleCounts?: CycleCountLine[];
  stagingLoads?: StagingLoadRow[];
  dockAppointments?: DockAppointmentRow[];
  printerStations?: PrinterStationRow[];
  labelTemplates?: LabelTemplateRow[];
  printJobs?: PrintJobRow[];
  replenishments?: Array<Record<string, unknown>>;
  reorderAlerts?: ReorderAlertRow[];
  aiRecommendations?: AiRecommendationRow[];
};

export type DashboardMode = "floor" | "dock" | "office";

export type WarehouseBrainRecommendation = {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info" | "success";
  audience: RoleCode[];
  reason: string;
  nextAction: string;
  route: string;
  evidence: string[];
};

export type DockHandoffLoad = {
  id: string;
  route: string;
  door: string;
  customer: string;
  driver: string;
  status: "ready" | "called" | "loading" | "blocked" | "loaded";
  pallets: number;
  temperatureClass: string;
  blocker?: string;
};

export type EnterpriseDashboardSnapshot = {
  officeWidgets: Array<{ label: string; value: string; tone: "success" | "warning" | "critical" | "info"; detail: string; route: string }>;
  floorQueues: Array<{ label: string; count: number; action: string; route: string; tone: "success" | "warning" | "critical" | "info"; tasks: DashboardTaskRow[] }>;
  dockLoads: DockHandoffLoad[];
  leanMetrics: Array<{ label: string; value: string; target: string; status: "on_target" | "watch" | "off_target"; route: string }>;
  setupChecklist: Array<{ label: string; complete: boolean; owner: string }>;
  recommendations: WarehouseBrainRecommendation[];
};

export type ZplLabelInput = {
  labelType: "pallet" | "location" | "carton" | "count_sheet" | "pick_list" | "transfer_document";
  code: string;
  title: string;
  subtitle?: string;
  quantity?: number;
};

export type NetSuiteItemPayload = {
  id: string;
  itemId: string;
  displayName?: string;
  upcCode?: string;
  custitem_temperature_class?: string;
  custitem_lot_tracked?: boolean;
  custitem_expiry_tracked?: boolean;
  isInactive?: boolean;
};

/** Shared result shape for all sync mappers. */
export type MappedProductPayload = {
  external_system: string;
  external_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  temperature_requirement: string;
  lot_tracked: boolean;
  expiry_tracked: boolean;
  batch_tracked: boolean;
  rotation_method: string;
  active: boolean;
  /** True when one or more fields were filled by the auto-categoriser, not the source system. */
  auto_categorised: boolean;
  /** Human-readable label from the matched rule, e.g. "Food — Flour / Grain". Null if no rule matched. */
  category_label: string | null;
};

export function generateZplLabel(input: ZplLabelInput) {
  const title = sanitizeZpl(input.title).slice(0, 34);
  const subtitle = sanitizeZpl(input.subtitle ?? input.labelType.replace(/_/g, " ")).slice(0, 42);
  const code = sanitizeZpl(input.code).slice(0, 64);
  const quantityLine = input.quantity == null ? "" : `^FO40,238^A0N,28,28^FDQTY ${input.quantity}^FS`;

  return [
    "^XA",
    "^CI28",
    "^PW609",
    "^LL406",
    "^FO28,24^GB553,358,3^FS",
    `^FO40,44^A0N,36,36^FD${title}^FS`,
    `^FO40,92^A0N,24,24^FD${subtitle}^FS`,
    `^FO40,134^BY2,3,88^BCN,88,Y,N,N^FD${code}^FS`,
    quantityLine,
    `^FO40,286^A0N,22,22^FD${input.labelType.toUpperCase().replace(/_/g, " ")}^FS`,
    "^FO40,320^A0N,18,18^FDWarehouse Wizard Enterprise WMS^FS",
    "^XZ",
  ].filter(Boolean).join("\n");
}

export function mapNetSuiteItemToProduct(payload: NetSuiteItemPayload): MappedProductPayload {
  const name = payload.displayName || payload.itemId;
  const hasTemperature = Boolean(payload.custitem_temperature_class?.trim());
  const hasTracking = payload.custitem_lot_tracked != null || payload.custitem_expiry_tracked != null;

  // Fall back to keyword categoriser when NetSuite custom fields are absent
  const inferred = (!hasTemperature || !hasTracking) ? inferProductCategory(name) : null;

  const temperature_requirement = hasTemperature
    ? normalizeTemperature(payload.custitem_temperature_class)
    : (inferred?.temperature_requirement ?? "ambient");

  const expiry_tracked = payload.custitem_expiry_tracked != null
    ? Boolean(payload.custitem_expiry_tracked)
    : (inferred?.expiry_tracked ?? false);

  const lot_tracked = payload.custitem_lot_tracked != null
    ? Boolean(payload.custitem_lot_tracked)
    : (inferred?.lot_tracked ?? false);

  const batch_tracked = inferred?.batch_tracked ?? false;
  const rotation_method = expiry_tracked ? "fefo" : (inferred?.rotation_method ?? "fifo");

  return {
    external_system: "netsuite",
    external_id: payload.id,
    sku: payload.itemId,
    barcode: payload.upcCode ?? null,
    name,
    temperature_requirement,
    lot_tracked,
    expiry_tracked,
    batch_tracked,
    rotation_method,
    active: !payload.isInactive,
    auto_categorised: inferred !== null,
    category_label: inferred?.label ?? null,
  };
}

/** Generic REST payload — minimal shape expected from a third-party connector. */
export type GenericRestItemPayload = {
  id: string;
  sku?: string;
  barcode?: string;
  name?: string;
  description?: string;
  temperature?: string;
  lot_tracked?: boolean;
  expiry_tracked?: boolean;
  batch_tracked?: boolean;
  active?: boolean;
};

export function mapGenericRestItemToProduct(payload: GenericRestItemPayload): MappedProductPayload {
  const name = payload.name || payload.sku || payload.id;
  const hasTemperature = Boolean(payload.temperature?.trim());
  const hasTracking = payload.lot_tracked != null || payload.expiry_tracked != null;

  const inferred = (!hasTemperature || !hasTracking)
    ? inferProductCategory(name, payload.description)
    : null;

  const temperature_requirement = hasTemperature
    ? normalizeTemperature(payload.temperature)
    : (inferred?.temperature_requirement ?? "ambient");

  const expiry_tracked = payload.expiry_tracked != null
    ? Boolean(payload.expiry_tracked)
    : (inferred?.expiry_tracked ?? false);

  const lot_tracked = payload.lot_tracked != null
    ? Boolean(payload.lot_tracked)
    : (inferred?.lot_tracked ?? false);

  const batch_tracked = payload.batch_tracked != null
    ? Boolean(payload.batch_tracked)
    : (inferred?.batch_tracked ?? false);

  const rotation_method = expiry_tracked ? "fefo" : (inferred?.rotation_method ?? "fifo");

  // Cross-fill sku ↔ barcode when one side is blank
  const sku = payload.sku || payload.barcode || payload.id;
  const barcode = payload.barcode || payload.sku || null;

  return {
    external_system: "generic_rest",
    external_id: payload.id,
    sku,
    barcode,
    name,
    temperature_requirement,
    lot_tracked,
    expiry_tracked,
    batch_tracked,
    rotation_method,
    active: payload.active !== false,
    auto_categorised: inferred !== null,
    category_label: inferred?.label ?? null,
  };
}

export function buildNetSuiteInventoryAdjustment(input: {
  accountId: string;
  sku: string;
  locationExternalId: string;
  quantityDelta: number;
  memo: string;
}) {
  return {
    accountId: input.accountId,
    recordType: "inventoryAdjustment",
    body: {
      memo: input.memo,
      subsidiary: { id: "1" },
    },
    inventory: {
      items: [
        {
          item: { externalId: input.sku },
          location: { externalId: input.locationExternalId },
          adjustQtyBy: input.quantityDelta,
        },
      ],
    },
    idempotencyKey: `netsuite-adjustment-${input.sku}-${input.locationExternalId}-${input.quantityDelta}`,
  };
}

export function buildEnterpriseDashboard(
  metrics: DashboardMetrics | undefined,
  reportData: EnterpriseReportData | undefined,
): EnterpriseDashboardSnapshot {
  const inventory = reportData?.inventory ?? [];
  const occupancy = reportData?.occupancy ?? [];
  const cycleCounts = reportData?.cycleCounts ?? [];
  const expiring60 = metrics?.expiryWarning60 || countExpiringSoon(inventory, 60);
  const expiring30 = metrics?.expiryWarning30 || countExpiringSoon(inventory, 30);
  const lowStock = (reportData?.reorderAlerts ?? []).length;
  const controlled = (metrics?.holdStock ?? 0) + (metrics?.quarantineStock ?? 0);
  const fullLocations = occupancy.filter((row) => row.is_full).length;
  const totalCapacity = occupancy.reduce((sum, row) => sum + (row.max_pallets ?? 0), 0);
  const usedCapacity = occupancy.reduce((sum, row) => sum + (row.occupied_pallets ?? 0), 0);
  const fillRate = totalCapacity === 0 ? 0 : Math.round((usedCapacity / totalCapacity) * 100);
  const defects = cycleCounts.filter((line) => (line.variance_quantity ?? 0) !== 0 || line.status === "exception").length;
  const dpmo = cycleCounts.length === 0 ? 0 : Math.round((defects / cycleCounts.length) * 1_000_000);
  const activePrinters = (reportData?.printerStations ?? []).filter((row) => row.active).length;
  const activeLabelTemplates = (reportData?.labelTemplates ?? []).filter((row) => row.active).length;
  const failedPrintJobs = (reportData?.printJobs ?? []).filter((row) => row.status === "failed").length;

  return {
    officeWidgets: [
      { label: "Fill level", value: `${fillRate}%`, tone: fillRate > 92 ? "warning" : "success", detail: `${usedCapacity}/${totalCapacity || 0} slots used`, route: "/locations" },
      { label: "Reorder forecast watch", value: `${lowStock}`, tone: lowStock > 0 ? "warning" : "success", detail: "Active demand-and-lead-time reorder alerts", route: "/products" },
      { label: "Expiration risk", value: `${expiring30}`, tone: expiring30 > 0 ? "critical" : expiring60 > 0 ? "warning" : "success", detail: `${expiring60} inside 60 days · ${expiring30} inside 30 days`, route: "/inventory-search" },
      { label: "DPMO", value: `${dpmo}`, tone: dpmo > 50_000 ? "critical" : dpmo > 10_000 ? "warning" : "success", detail: "Cycle-count defect signal", route: "/cycle-counts" },
    ],
    floorQueues: [
      {
        label: "Inbound",
        count: metrics?.openReceipts ?? 0,
        action: "Receive or resume open receipts",
        route: "/receiving",
        tone: "info",
        tasks: (metrics?.receiptRows ?? []).slice(0, 5),
      },
      {
        label: "Put-Away",
        count: metrics?.openPutawayTasks ?? 0,
        action: "Complete scan-confirmed putaway",
        route: "/putaway-tasks",
        tone: (metrics?.openPutawayTasks ?? 0) > 0 ? "warning" : "success",
        tasks: (metrics?.putawayTaskRows ?? []).slice(0, 5),
      },
      {
        label: "Outbound",
        count: metrics?.openPickLists ?? 0,
        action: "Release or execute picks",
        route: "/pick-lists",
        tone: (metrics?.openPickLists ?? 0) > 0 ? "info" : "success",
        tasks: (metrics?.pickListRows ?? []).slice(0, 5),
      },
      {
        label: "Moves & Counts",
        count: (metrics?.openMoveTasks ?? 0) + (metrics?.openTransfers ?? 0) + (metrics?.openCycleCounts ?? 0),
        action: "Review active moves, transfers, and counts",
        route: "/location-moves",
        tone: "info",
        tasks: [
          ...(metrics?.moveTaskRows ?? []),
          ...(metrics?.transferRows ?? []),
          ...(metrics?.cycleCountRows ?? []),
        ].sort((a, b) => a.createdAt < b.createdAt ? -1 : 1).slice(0, 5),
      },
      {
        label: "Blocked Exceptions",
        count: controlled,
        action: "Review holds and quarantine",
        route: "/status",
        tone: controlled > 0 ? "critical" : "success",
        tasks: (metrics?.blockedBalanceRows ?? []).slice(0, 5),
      },
    ],
    dockLoads: buildDockLoads(reportData?.stagingLoads ?? [], reportData?.dockAppointments ?? []),
    leanMetrics: [
      { label: "5S location health", value: fullLocations === 0 ? "Clear" : `${fullLocations} full`, target: "No blocked aisles", status: fullLocations > 4 ? "off_target" : fullLocations > 0 ? "watch" : "on_target", route: "/locations" },
      { label: "Kanban replenishment", value: `${lowStock} signals`, target: "Zero stockouts", status: lowStock > 8 ? "off_target" : lowStock > 0 ? "watch" : "on_target", route: "/inventory-search" },
      { label: "Andon response", value: `${controlled} alerts`, target: "< 3 open", status: controlled > 8 ? "off_target" : controlled > 2 ? "watch" : "on_target", route: "/status" },
      { label: "DMAIC variance", value: `${defects} defects`, target: "Trend down", status: defects > 6 ? "off_target" : defects > 0 ? "watch" : "on_target", route: "/cycle-counts" },
    ],
    setupChecklist: [
      { label: "Warehouse layout and zones", complete: occupancy.length > 0, owner: "Admin" },
      { label: "Zebra printer stations", complete: activePrinters > 0 && failedPrintJobs === 0, owner: "Admin" },
      { label: "NetSuite connector mapping", complete: false, owner: "IT" },
      { label: "Barcode standards and label templates", complete: activeLabelTemplates > 0, owner: "Warehouse manager" },
      { label: "Operator tablet workflows", complete: (metrics?.recentAuditEvents ?? 0) > 0, owner: "Supervisor" },
      { label: "Saved reports and AI review cadence", complete: (reportData?.aiRecommendations ?? []).length > 0, owner: "Manager" },
    ],
    recommendations: buildWarehouseBrainRecommendations(metrics, reportData),
  };
}

export function buildWarehouseBrainRecommendations(
  metrics: DashboardMetrics | undefined,
  reportData: EnterpriseReportData | undefined,
): WarehouseBrainRecommendation[] {
  const inventory = reportData?.inventory ?? [];
  const expiring60 = metrics?.expiryWarning60 || countExpiringSoon(inventory, 60);
  const expiring30 = metrics?.expiryWarning30 || countExpiringSoon(inventory, 30);
  const reorderAlerts = reportData?.reorderAlerts ?? [];
  const lowStock = reorderAlerts.length;
  const controlled = (metrics?.holdStock ?? 0) + (metrics?.quarantineStock ?? 0);
  const openWork = (metrics?.openPutawayTasks ?? 0) + (metrics?.openPickLists ?? 0);
  const dockBlocks = (reportData?.stagingLoads ?? []).filter((row) => row.status === "blocked").length;
  const failedPrintJobs = (reportData?.printJobs ?? []).filter((row) => row.status === "failed").length;
  const savedRecommendations = (reportData?.aiRecommendations ?? []).filter((row) => row.title && row.reason && row.next_action);
  const recommendations: WarehouseBrainRecommendation[] = [];

  for (const item of savedRecommendations) {
    recommendations.push({
      id: item.id ?? item.recommendation_key ?? `saved-${recommendations.length + 1}`,
      title: item.title ?? "Saved recommendation",
      severity: item.severity ?? "info",
      audience: item.audience ?? ["warehouse_manager"],
      reason: item.reason ?? "Saved live recommendation is open.",
      nextAction: item.next_action ?? "Review the open recommendation.",
      route: "/reports",
      evidence: ["Saved recommendation record"],
    });
  }

  if (expiring60 > 0) {
    recommendations.push({
      id: "expiry-risk",
      title: "FEFO risk needs supervisor review",
      severity: expiring30 > 0 || expiring60 > 5 ? "critical" : "warning",
      audience: ["warehouse_manager", "inventory_clerk"],
      reason: `${expiring60} lot${expiring60 === 1 ? "" : "s"} expire inside 60 days; ${expiring30} inside 30 days.`,
      nextAction: "Prioritize those lots in wave release or move them to hold if QA requires review.",
      route: "/inventory-search",
      evidence: [`${expiring60} live inventory balance${expiring60 === 1 ? "" : "s"} with expiry inside 60 days`],
    });
  }

  if (lowStock > 0) {
    recommendations.push({
      id: "low-stock",
      title: "Reorder forecast needs review",
      severity: "warning",
      audience: ["warehouse_manager", "inventory_clerk"],
      reason: `${lowStock} product${lowStock === 1 ? "" : "s"} crossed its configured demand-and-lead-time reorder point.`,
      nextAction: "Review the forecast and create replenishment work before the next wave.",
      route: "/products",
      evidence: reorderAlerts.slice(0, 3).map((alert) => {
        const product = alert.products?.sku ?? alert.products?.name ?? "Product";
        return `${product}: ${Number(alert.available_quantity ?? 0)} available; reorder point ${Number(alert.reorder_point ?? 0)}; replenish ${Number(alert.recommended_quantity ?? 0)}`;
      }),
    });
  }

  if (controlled > 0) {
    recommendations.push({
      id: "controlled-stock",
      title: "Controlled stock is constraining flow",
      severity: controlled > 8 ? "critical" : "warning",
      audience: ["warehouse_manager", "inventory_clerk", "warehouse_operator"],
      reason: `${controlled} pallet${controlled === 1 ? "" : "s"} are on hold or quarantine.`,
      nextAction: "Resolve QA decisions, record root cause, and release or disposition the stock.",
      route: "/status",
      evidence: [`${metrics?.holdStock ?? 0} hold and ${metrics?.quarantineStock ?? 0} quarantine pallet${controlled === 1 ? "" : "s"}`],
    });
  }

  if (openWork > 0) {
    recommendations.push({
      id: "open-work",
      title: "Shift start work package is ready",
      severity: "info",
      audience: ["warehouse_operator", "warehouse_manager"],
      reason: `${openWork} task group${openWork === 1 ? "" : "s"} are open across putaway and picking.`,
      nextAction: "Use Start Shift on a tablet and work through scan-confirmed tasks.",
      route: "/putaway-tasks",
      evidence: [`${metrics?.openPutawayTasks ?? 0} open putaway and ${metrics?.openPickLists ?? 0} open pick list${(metrics?.openPickLists ?? 0) === 1 ? "" : "s"}`],
    });
  }

  if (dockBlocks > 0) {
    recommendations.push({
      id: "blocked-dock-loads",
      title: "Dock handoff has blocked loads",
      severity: "critical",
      audience: ["warehouse_manager", "warehouse_operator", "dispatch_driver"],
      reason: `${dockBlocks} staging load${dockBlocks === 1 ? "" : "s"} are blocked.`,
      nextAction: "Clear the blocker before calling the driver or loading the route.",
      route: "/pick-lists",
      evidence: [`${dockBlocks} blocked staging load${dockBlocks === 1 ? "" : "s"}`],
    });
  }

  if (failedPrintJobs > 0) {
    recommendations.push({
      id: "failed-print-jobs",
      title: "Label printing needs attention",
      severity: "warning",
      audience: ["admin", "warehouse_manager"],
      reason: `${failedPrintJobs} recent print job${failedPrintJobs === 1 ? "" : "s"} failed.`,
      nextAction: "Check printer stations and reprint failed labels before the next scan workflow.",
      route: "/settings",
      evidence: [`${failedPrintJobs} failed print job${failedPrintJobs === 1 ? "" : "s"}`],
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: "insufficient-data",
      title: "Not enough live data yet",
      severity: "info",
      audience: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator"],
      reason: "Warehouse Intelligence needs current inventory, task, dock, audit, or cycle-count activity before it can make a supported recommendation.",
      nextAction: "Run normal receiving, putaway, picking, dock, or count workflows, then return here for evidence-backed signals.",
      route: "/dashboard",
      evidence: ["No current scoped operational records met an intelligence rule"],
    });
  }

  return recommendations;
}

export function buildCsvReportRows(reportData: EnterpriseReportData | undefined) {
  return (reportData?.inventory ?? []).map((row) => ({
    sku: row.sku ?? "",
    product: row.product_name ?? "",
    warehouse: row.warehouse_code ?? "",
    location: row.location_code ?? "receiving",
    pallet: row.pallet_code ?? "",
    status: row.status ?? "",
    available_quantity: row.available_quantity ?? 0,
    expiry_date: row.expiry_date ?? "",
  }));
}

function sanitizeZpl(value: string) {
  return value.replace(/[\^~]/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeTemperature(value: string | undefined) {
  const normalized = value?.toLowerCase();
  if (normalized === "cool" || normalized === "frozen") return normalized;
  return "ambient";
}

function countExpiringSoon(inventory: InventoryRow[], days: number) {
  const now = new Date();
  const max = new Date(now);
  max.setDate(now.getDate() + days);

  return inventory.filter((row) => {
    if (!row.expiry_date) return false;
    const expiry = new Date(row.expiry_date);
    return expiry >= now && expiry <= max;
  }).length;
}

function buildDockLoads(stagingLoads: StagingLoadRow[], appointments: DockAppointmentRow[]): DockHandoffLoad[] {
  return stagingLoads.map((row, index) => {
    const appointment = appointments.find((item) => item.id === row.dock_appointment_id);
    const customer = row.pick_lists?.clients?.name ?? row.pick_lists?.clients?.code ?? row.pick_lists?.pick_list_number ?? "Open load";
    return {
      id: row.id ?? `dock-${index + 1}`,
      route: row.route_code ?? row.pick_lists?.pick_list_number ?? `Load ${index + 1}`,
      door: appointment?.dock_door ?? "Unassigned",
      customer,
      driver: appointment?.driver_name ?? appointment?.carrier ?? "Awaiting check-in",
      status: row.status ?? "ready",
      pallets: 1,
      temperatureClass: "live load",
      blocker: row.blocker ?? undefined,
    };
  });
}
