// Report catalog modelled on the inventory report families NetSuite offers
// (Inventory Status, Inventory by Location/Bin, Lot/Expiry, Aging, Reorder,
// Cycle-count accuracy, Activity). Every report is a pure function of the data
// loaded by getReportData(), so it can be scoped to one warehouse or run across
// all of them in overseer mode, and reused by the subscription runner.

export type ReportCategoryId = "stock" | "location" | "quality" | "replenishment" | "operations" | "activity";

export const REPORT_CATEGORIES: Array<{ id: ReportCategoryId; label: string; description: string }> = [
  { id: "stock", label: "Inventory status", description: "What is on hand, by item, owner, and age." },
  { id: "location", label: "Locations & capacity", description: "Bin contents and space utilization." },
  { id: "quality", label: "Quality & accuracy", description: "Expiry risk, held stock, and count variance." },
  { id: "replenishment", label: "Replenishment", description: "Reorder points and open replenishment work." },
  { id: "operations", label: "Dock & fulfilment", description: "Appointments and staged loads." },
  { id: "activity", label: "Activity", description: "Audit trail of inventory movement." },
];

export type ReportData = {
  inventory: any[];
  occupancy: any[];
  audits: any[];
  warehouses: any[];
  cycleCounts: any[];
  stagingLoads: any[];
  dockAppointments: any[];
  replenishments: any[];
  reorderAlerts: any[];
};

export type ReportColumn = { key: string; label: string; numeric?: boolean };
export type ReportRow = Record<string, string | number>;
export type ReportResult = { columns: ReportColumn[]; rows: ReportRow[] };

export type ReportDefinition = {
  id: string;
  category: ReportCategoryId;
  title: string;
  description: string;
  run: (data: ReportData) => ReportResult;
};

const num = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const text = (value: unknown, fallback = "—") => (value == null || value === "" ? fallback : String(value));
const day = (value: unknown) => (value ? String(value).slice(0, 10) : "—");
const DAY_MS = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY_MS);
const RETIRED = new Set(["picked", "shipped", "in_transit", "missing"]);
const liveStock = (data: ReportData) => data.inventory.filter((row) => !RETIRED.has(String(row.status)));

/** Narrow every dataset to one warehouse. `null` keeps everything (overseer). */
export function scopeReportData(data: ReportData, warehouse: { id: string; code: string } | null): ReportData {
  if (!warehouse) return data;
  const byId = (rows: any[]) => rows.filter((row) => row.warehouse_id == null || row.warehouse_id === warehouse.id);
  return {
    ...data,
    inventory: byId(data.inventory),
    occupancy: data.occupancy.filter((row) => row.warehouse_code === warehouse.code),
    audits: byId(data.audits),
    cycleCounts: data.cycleCounts.filter((row) => (row.cycle_counts?.warehouse_id ?? row.warehouse_id ?? warehouse.id) === warehouse.id),
    stagingLoads: data.stagingLoads.filter((row) => (row.pick_lists?.warehouse_id ?? warehouse.id) === warehouse.id),
    dockAppointments: byId(data.dockAppointments),
    replenishments: byId(data.replenishments),
    reorderAlerts: byId(data.reorderAlerts),
    warehouses: data.warehouses.filter((row) => row.id === warehouse.id),
  };
}

function groupSum<T>(rows: T[], keyOf: (row: T) => string, init: () => Record<string, number>, add: (acc: Record<string, number>, row: T) => void) {
  const map = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = keyOf(row);
    const acc = map.get(key) ?? init();
    add(acc, row);
    map.set(key, acc);
  }
  return map;
}

export const REPORT_CATALOG: ReportDefinition[] = [
  {
    id: "inventory-status",
    category: "stock",
    title: "Inventory status by item",
    description: "On hand, available, reserved, held, and damaged units per SKU with pallet count.",
    run: (data) => {
      const map = groupSum(
        liveStock(data),
        (r) => `${r.sku}|${r.product_name}`,
        () => ({ pallets: 0, onHand: 0, available: 0, reserved: 0, held: 0, damaged: 0 }),
        (a, r) => {
          a.pallets += 1;
          a.onHand += num(r.quantity);
          a.available += num(r.available_quantity);
          a.reserved += num(r.reserved_quantity);
          a.held += num(r.held_quantity);
          a.damaged += num(r.damaged_quantity);
        },
      );
      return {
        columns: [
          { key: "sku", label: "SKU" }, { key: "name", label: "Item" },
          { key: "pallets", label: "Pallets", numeric: true }, { key: "onHand", label: "On hand", numeric: true },
          { key: "available", label: "Available", numeric: true }, { key: "reserved", label: "Reserved", numeric: true },
          { key: "held", label: "Held", numeric: true }, { key: "damaged", label: "Damaged", numeric: true },
        ],
        rows: [...map.entries()]
          .map(([key, a]): ReportRow => { const [sku, name] = key.split("|"); return { sku: text(sku), name: text(name), ...a }; })
          .sort((x, y) => Number(y.onHand) - Number(x.onHand)),
      };
    },
  },
  {
    id: "inventory-by-owner",
    category: "stock",
    title: "Inventory by owner",
    description: "Units and pallets held for each client/owner.",
    run: (data) => {
      const map = groupSum(
        liveStock(data),
        (r) => text(r.owner_name ?? r.client_name, "Unassigned"),
        () => ({ skus: 0, pallets: 0, onHand: 0, available: 0 }),
        (a, r) => { a.pallets += 1; a.onHand += num(r.quantity); a.available += num(r.available_quantity); },
      );
      const skuSets = new Map<string, Set<string>>();
      for (const r of liveStock(data)) {
        const k = text(r.owner_name ?? r.client_name, "Unassigned");
        (skuSets.get(k) ?? skuSets.set(k, new Set()).get(k)!).add(String(r.sku));
      }
      return {
        columns: [
          { key: "owner", label: "Owner" }, { key: "skus", label: "SKUs", numeric: true },
          { key: "pallets", label: "Pallets", numeric: true }, { key: "onHand", label: "On hand", numeric: true },
          { key: "available", label: "Available", numeric: true },
        ],
        rows: [...map.entries()].map(([owner, a]): ReportRow => ({ owner, ...a, skus: skuSets.get(owner)?.size ?? 0 })).sort((x, y) => Number(y.onHand) - Number(x.onHand)),
      };
    },
  },
  {
    id: "inventory-aging",
    category: "stock",
    title: "Inventory aging",
    description: "Units by days since receipt (0–30, 31–60, 61–90, 90+) to expose slow-moving stock.",
    run: (data) => {
      const now = new Date();
      const map = groupSum(
        liveStock(data),
        (r) => `${r.sku}|${r.product_name}`,
        () => ({ d30: 0, d60: 0, d90: 0, d90p: 0, oldest: 0 }),
        (a, r) => {
          const age = r.received_at ? Math.max(0, daysBetween(new Date(r.received_at), now)) : 0;
          const qty = num(r.quantity);
          if (age <= 30) a.d30 += qty; else if (age <= 60) a.d60 += qty; else if (age <= 90) a.d90 += qty; else a.d90p += qty;
          a.oldest = Math.max(a.oldest, age);
        },
      );
      return {
        columns: [
          { key: "sku", label: "SKU" }, { key: "name", label: "Item" },
          { key: "d30", label: "0–30 d", numeric: true }, { key: "d60", label: "31–60 d", numeric: true },
          { key: "d90", label: "61–90 d", numeric: true }, { key: "d90p", label: "90+ d", numeric: true },
          { key: "oldest", label: "Oldest (days)", numeric: true },
        ],
        rows: [...map.entries()]
          .map(([key, a]): ReportRow => { const [sku, name] = key.split("|"); return { sku: text(sku), name: text(name), ...a }; })
          .sort((x, y) => Number(y.d90p) - Number(x.d90p) || Number(y.oldest) - Number(x.oldest)),
      };
    },
  },
  {
    id: "abc-analysis",
    category: "stock",
    title: "ABC stock concentration",
    description: "Ranks SKUs by on-hand volume; A = first 80% of units, B = next 15%, C = the tail.",
    run: (data) => {
      const totals = new Map<string, { name: string; qty: number }>();
      for (const r of liveStock(data)) {
        const entry = totals.get(String(r.sku)) ?? { name: text(r.product_name), qty: 0 };
        entry.qty += num(r.quantity);
        totals.set(String(r.sku), entry);
      }
      const sorted = [...totals.entries()].sort((a, b) => b[1].qty - a[1].qty);
      const grand = sorted.reduce((s, [, v]) => s + v.qty, 0) || 1;
      let running = 0;
      return {
        columns: [
          { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "onHand", label: "On hand", numeric: true },
          { key: "share", label: "% of units", numeric: true }, { key: "cumulative", label: "Cumulative %", numeric: true }, { key: "class", label: "Class" },
        ],
        rows: sorted.map(([sku, v]) => {
          const before = running;
          running += v.qty;
          return {
            sku, name: v.name, onHand: v.qty,
            share: Math.round((v.qty / grand) * 1000) / 10,
            cumulative: Math.round((running / grand) * 1000) / 10,
            class: before / grand < 0.8 ? "A" : before / grand < 0.95 ? "B" : "C",
          };
        }),
      };
    },
  },
  {
    id: "inventory-by-location",
    category: "location",
    title: "Inventory by location",
    description: "Every occupied bin with its pallets, SKUs, and units — the bin-level stock listing.",
    run: (data) => {
      const map = groupSum(
        liveStock(data),
        (r) => `${r.zone_code ?? ""}|${r.location_code ?? "No location"}`,
        () => ({ pallets: 0, onHand: 0 }),
        (a, r) => { a.pallets += 1; a.onHand += num(r.quantity); },
      );
      const skus = new Map<string, Set<string>>();
      for (const r of liveStock(data)) {
        const k = `${r.zone_code ?? ""}|${r.location_code ?? "No location"}`;
        (skus.get(k) ?? skus.set(k, new Set()).get(k)!).add(String(r.sku));
      }
      return {
        columns: [
          { key: "zone", label: "Zone" }, { key: "location", label: "Location" },
          { key: "pallets", label: "Pallets", numeric: true }, { key: "skus", label: "SKUs", numeric: true }, { key: "onHand", label: "Units", numeric: true },
        ],
        rows: [...map.entries()]
          .map(([key, a]) => { const [zone, location] = key.split("|"); return { zone: text(zone), location, ...a, skus: skus.get(key)?.size ?? 0 }; })
          .sort((x, y) => x.location.localeCompare(y.location, undefined, { numeric: true })),
      };
    },
  },
  {
    id: "bin-utilization",
    category: "location",
    title: "Bin utilization",
    description: "Pallet capacity vs. occupancy per zone, with full and empty bin counts.",
    run: (data) => {
      const map = groupSum(
        data.occupancy,
        (r) => text(r.zone_code),
        () => ({ bins: 0, capacity: 0, occupied: 0, full: 0, empty: 0 }),
        (a, r) => {
          a.bins += 1;
          a.capacity += num(r.max_pallets);
          a.occupied += num(r.occupied_pallets);
          if (r.is_full) a.full += 1;
          if (num(r.occupied_pallets) === 0) a.empty += 1;
        },
      );
      return {
        columns: [
          { key: "zone", label: "Zone" }, { key: "bins", label: "Bins", numeric: true }, { key: "capacity", label: "Pallet capacity", numeric: true },
          { key: "occupied", label: "Pallets stored", numeric: true }, { key: "utilization", label: "Utilization %", numeric: true },
          { key: "full", label: "Full bins", numeric: true }, { key: "empty", label: "Empty bins", numeric: true },
        ],
        rows: [...map.entries()].map(([zone, a]) => ({ zone, ...a, utilization: a.capacity ? Math.round((a.occupied / a.capacity) * 1000) / 10 : 0 })).sort((x, y) => y.utilization - x.utilization),
      };
    },
  },
  {
    id: "expiration-risk",
    category: "quality",
    title: "Lot expiration risk",
    description: "Lots expired or expiring within 90 days, soonest first (FEFO).",
    run: (data) => {
      const now = new Date();
      const rows = liveStock(data)
        .filter((r) => r.expiry_date)
        .map((r) => ({ r, days: daysBetween(now, new Date(r.expiry_date)) }))
        .filter(({ days }) => days <= 90)
        .sort((a, b) => a.days - b.days)
        .map(({ r, days }) => ({
          sku: text(r.sku), name: text(r.product_name), lot: text(r.lot_number), expiry: day(r.expiry_date),
          daysLeft: days, units: num(r.quantity), location: text(r.location_code),
          risk: days < 0 ? "Expired" : days <= 30 ? "Critical" : days <= 60 ? "High" : "Watch",
        }));
      return {
        columns: [
          { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "lot", label: "Lot" }, { key: "expiry", label: "Expires" },
          { key: "daysLeft", label: "Days left", numeric: true }, { key: "units", label: "Units", numeric: true }, { key: "location", label: "Location" }, { key: "risk", label: "Risk" },
        ],
        rows,
      };
    },
  },
  {
    id: "held-damaged",
    category: "quality",
    title: "Held & damaged stock",
    description: "Pallets carrying held or damaged units that are unavailable to pick.",
    run: (data) => ({
      columns: [
        { key: "pallet", label: "Pallet" }, { key: "sku", label: "SKU" }, { key: "status", label: "Status" },
        { key: "held", label: "Held", numeric: true }, { key: "damaged", label: "Damaged", numeric: true }, { key: "location", label: "Location" },
      ],
      rows: liveStock(data)
        .filter((r) => num(r.held_quantity) > 0 || num(r.damaged_quantity) > 0)
        .map((r) => ({ pallet: text(r.pallet_code), sku: text(r.sku), status: text(r.status), held: num(r.held_quantity), damaged: num(r.damaged_quantity), location: text(r.location_code) })),
    }),
  },
  {
    id: "cycle-count-variance",
    category: "quality",
    title: "Cycle count accuracy",
    description: "Recent count lines with expected vs. counted units and variance.",
    run: (data) => ({
      columns: [
        { key: "line", label: "Line" }, { key: "expected", label: "Expected", numeric: true }, { key: "counted", label: "Counted", numeric: true },
        { key: "variance", label: "Variance", numeric: true }, { key: "status", label: "Status" },
      ],
      rows: data.cycleCounts.map((r) => ({
        line: text(String(r.id ?? "").slice(0, 8)), expected: num(r.expected_quantity), counted: num(r.counted_quantity),
        variance: num(r.variance_quantity), status: text(r.status),
      })),
    }),
  },
  {
    id: "reorder-items",
    category: "replenishment",
    title: "Items below reorder point",
    description: "Active reorder alerts with available units, reorder point, and recommended order quantity.",
    run: (data) => ({
      columns: [
        { key: "sku", label: "SKU" }, { key: "name", label: "Item" }, { key: "available", label: "Available", numeric: true },
        { key: "reorderPoint", label: "Reorder point", numeric: true }, { key: "recommended", label: "Recommended qty", numeric: true },
      ],
      rows: data.reorderAlerts.map((r) => ({
        sku: text(r.products?.sku), name: text(r.products?.name), available: num(r.available_quantity),
        reorderPoint: num(r.reorder_point), recommended: num(r.recommended_quantity),
      })),
    }),
  },
  {
    id: "replenishment-tasks",
    category: "replenishment",
    title: "Replenishment tasks",
    description: "Recent forward-pick replenishment tasks and their completion status.",
    run: (data) => ({
      columns: [
        { key: "task", label: "Task" }, { key: "target", label: "Target qty", numeric: true }, { key: "status", label: "Status" },
        { key: "created", label: "Created" }, { key: "completed", label: "Completed" },
      ],
      rows: data.replenishments.map((r) => ({ task: text(String(r.id ?? "").slice(0, 8)), target: num(r.target_quantity), status: text(r.status), created: day(r.created_at), completed: day(r.completed_at) })),
    }),
  },
  {
    id: "dock-schedule",
    category: "operations",
    title: "Dock appointment schedule",
    description: "Scheduled dock appointments with their status.",
    run: (data) => ({
      columns: [{ key: "scheduled", label: "Scheduled" }, { key: "status", label: "Status" }],
      rows: data.dockAppointments.map((r) => ({ scheduled: text(String(r.scheduled_at ?? "").replace("T", " ").slice(0, 16)), status: text(r.status) })),
    }),
  },
  {
    id: "staged-loads",
    category: "operations",
    title: "Staged load status",
    description: "Staging loads by pick list and customer with ready/loading/blocked state.",
    run: (data) => ({
      columns: [{ key: "pickList", label: "Pick list" }, { key: "customer", label: "Customer" }, { key: "status", label: "Status" }, { key: "created", label: "Created" }],
      rows: data.stagingLoads.map((r) => ({ pickList: text(r.pick_lists?.pick_list_number), customer: text(r.pick_lists?.clients?.name), status: text(r.status), created: day(r.created_at) })),
    }),
  },
  {
    id: "inventory-activity",
    category: "activity",
    title: "Inventory activity log",
    description: "Most recent audited inventory events.",
    run: (data) => ({
      columns: [{ key: "when", label: "When" }, { key: "event", label: "Event" }, { key: "entity", label: "Entity" }, { key: "ref", label: "Reference" }],
      rows: data.audits.map((r) => ({ when: text(String(r.created_at ?? "").replace("T", " ").slice(0, 16)), event: text(r.event_type), entity: text(r.entity_table), ref: text(r.entity_id) })),
    }),
  },
];

export function getReport(id: string) {
  return REPORT_CATALOG.find((report) => report.id === id);
}

/** Run one report once per warehouse, tagging rows with their warehouse (overseer view). */
export function runReportAcrossWarehouses(report: ReportDefinition, data: ReportData): ReportResult {
  const rows: ReportRow[] = [];
  let columns: ReportColumn[] = report.run(scopeReportData(data, { id: "__none__", code: "__none__" })).columns;
  for (const warehouse of data.warehouses) {
    const result = report.run(scopeReportData(data, { id: warehouse.id, code: warehouse.code }));
    columns = result.columns;
    for (const row of result.rows) rows.push({ warehouse: warehouse.code, ...row });
  }
  return { columns: [{ key: "warehouse", label: "Warehouse" }, ...columns], rows };
}

export type WarehouseScorecard = {
  warehouseId: string;
  code: string;
  name: string;
  units: number;
  available: number;
  skus: number;
  pallets: number;
  utilization: number;
  fullBins: number;
  emptyBins: number;
  expiringLots: number;
  belowReorder: number;
  countVarianceLines: number;
  openReplenishments: number;
};

/** One KPI row per warehouse for the overseer comparison. */
export function buildWarehouseScorecards(data: ReportData): WarehouseScorecard[] {
  return data.warehouses.map((warehouse) => {
    const scoped = scopeReportData(data, { id: warehouse.id, code: warehouse.code });
    const stock = liveStock(scoped);
    const capacity = scoped.occupancy.reduce((s, r) => s + num(r.max_pallets), 0);
    const occupied = scoped.occupancy.reduce((s, r) => s + num(r.occupied_pallets), 0);
    const now = new Date();
    return {
      warehouseId: warehouse.id,
      code: String(warehouse.code),
      name: String(warehouse.name ?? warehouse.code),
      units: stock.reduce((s, r) => s + num(r.quantity), 0),
      available: stock.reduce((s, r) => s + num(r.available_quantity), 0),
      skus: new Set(stock.map((r) => r.sku)).size,
      pallets: stock.length,
      utilization: capacity ? Math.round((occupied / capacity) * 1000) / 10 : 0,
      fullBins: scoped.occupancy.filter((r) => r.is_full).length,
      emptyBins: scoped.occupancy.filter((r) => num(r.occupied_pallets) === 0).length,
      expiringLots: stock.filter((r) => r.expiry_date && daysBetween(now, new Date(r.expiry_date)) <= 30).length,
      belowReorder: scoped.reorderAlerts.length,
      countVarianceLines: scoped.cycleCounts.filter((r) => num(r.variance_quantity) !== 0).length,
      openReplenishments: scoped.replenishments.filter((r) => !["completed", "cancelled"].includes(String(r.status))).length,
    };
  });
}
