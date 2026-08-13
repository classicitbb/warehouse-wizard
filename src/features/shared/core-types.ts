import { z } from "zod";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { validateIso6346ContainerNumber } from "@/lib/container-number";
import { recordPalletQtyObservation, recordPlacementObservation } from "@/lib/ai-assist";
// isDesktopClient reserved for future device-aware flows

// Helper to bypass strict Supabase typing for tables not yet in the schema.
// Once all WMS tables are migrated, this can be replaced with direct db() calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase.from.bind(supabase) as (table: string) => any;

// Safely embeds a scanned/typed value inside a PostgREST `.or()` filter
// string. Without quoting, commas/parens/periods in the raw value change
// the filter's structure instead of being treated as a literal to match.
export function escapePostgrestOrValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
// These types will come from the DB once all WMS tables are created.
// For now we define them locally so the code compiles.
export type RoleCode =
  | "developer"
  | "admin"
  | "warehouse_manager"
  | "warehouse_supervisor"
  | "inventory_clerk"
  | "warehouse_operator"
  | "dispatch_driver";

export type InventoryStatus = string;
export type TaskStatus = string;
export type TemperatureClass = string;

const PICK_COMPLETED_INVENTORY_STATUS: InventoryStatus = "shipped";
const DB_RETIRED_INVENTORY_STATUS_FILTER = "(shipped,in_transit,missing)";
const RETIRED_INVENTORY_STATUSES = new Set(["picked", "shipped", "in_transit", "missing"]);

function isRetiredInventoryStatus(status: unknown): boolean {
  return RETIRED_INVENTORY_STATUSES.has(String(status ?? "").toLowerCase());
}

function hasVisibleInventoryQuantity(row: Record<string, unknown>): boolean {
  return Number(row.available_quantity ?? 0) > 0 || Number(row.quantity ?? 0) > 0;
}

export type AppRoute =
  | "/"
  | "/dashboard"
  | "/warehouses"
  | "/zones"
  | "/locations"
  | "/products"
  | "/packaging-profiles"
  | "/clients"
  | "/receiving"
  | "/putaway-tasks"
  | "/inventory-search"
  | "/inventory/:balanceId"
  | "/pick-lists"
  | "/pick-lists/:pickListId"
  | "/transfers"
  | "/location-moves"
  | "/cycle-counts"
  | "/status"
  | "/reports"
  | "/users"
  | "/settings"
  | "/system-log"
  | "/email-log"
  | "/help"
  | "/setup-wizard";

type FieldType = "text" | "textarea" | "number" | "select" | "boolean" | "date";
export type ArchiveField = "active" | "is_hidden";

export type FieldDefinition = {
  name: string;
  label: string;
  type: FieldType;
  options?: { label: string; value: string }[];
  description?: string;
  required?: boolean;
};

export type ResourceDefinition<T extends string = string> = {
  table: T;
  title: string;
  description: string;
  singular: string;
  fields: FieldDefinition[];
  orderBy?: { column: string; ascending?: boolean };
  select?: string;
  roles: RoleCode[];
  importable?: boolean;
  exportable?: boolean;
  helpId: string;
  supportsHide?: boolean;
  archiveField?: ArchiveField;
};

export type WarehouseVisibilityScope = {
  warehouseId?: string | null;
  restrictToWarehouse?: boolean;
};

export type ProfileUpdateInput = {
  profileId: string;
  full_name: string;
  phone?: string | null;
  default_warehouse_id?: string | null;
  active: boolean;
  approved: boolean;
  user_code?: string | null;
  badge_code?: string | null;
};

function formatSupabaseError(error: unknown, fallback: string) {
  if (!error) return fallback;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const details = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    return [details.message, details.details, details.hint, details.code ? `(${details.code})` : null]
      .filter(Boolean)
      .map(String)
      .join(" ");
  }
  return String(error);
}

function throwIfSupabaseError(result: { error?: unknown } | null | undefined, fallback: string) {
  if (result?.error) throw new Error(formatSupabaseError(result.error, fallback));
}

export type WarehouseSetupWarehouse = {
  code: string;
  name: string;
  city: string;
  country: string;
  hasCoolZone: boolean;
};

export type WarehouseSetupZone = {
  warehouseCode: string;
  code: string;
  name: string;
  temperatureClass: TemperatureClass;
  isStaging: boolean;
  isDispatch: boolean;
  isQuarantine: boolean;
  sortOrder: number;
};

export type WarehouseLocationTemplate = {
  warehouseCode: string;
  zoneCode: string;
  aisleCount: number;
  baysPerAisle: number;
  levels: number;
  positionsPerLevel: number;
  depth: number;
  locationType: string;
  temperatureClass: TemperatureClass;
  mixedSkuAllowed: boolean;
  mixedLotAllowed: boolean;
  status: string;
};

export type WarehouseSetupPayload = {
  warehouses: WarehouseSetupWarehouse[];
  zones: WarehouseSetupZone[];
  locationTemplates: WarehouseLocationTemplate[];
};

export type DashboardTaskRow = {
  id: string;
  label: string;
  sublabel: string;
  route: string;
  createdAt: string;
};

export type DashboardMetricKey =
  | "totalPallets"
  | "warehousePallets"
  | "availablePallets"
  | "coolZoneOccupancy"
  | "openReceipts"
  | "openPutawayTasks"
  | "openPickLists"
  | "openMoveTasks"
  | "openTransfers"
  | "openCycleCounts"
  | "openDockLoads"
  | "openReplenishmentTasks"
  | "recentAuditEvents"
  | "holdStock"
  | "quarantineStock"
  | "expiryWarning60"
  | "expiryWarning30"
  | "stockAge3Months"
  | "stockAge6Months"
  | "stockAge12Months";

export type DashboardMetrics = {
  totalPallets: number;
  totalPalletCapacity: number;
  warehousePallets: number;
  warehousePalletCapacity: number;
  availablePallets: number;
  coolZoneOccupancy: number;
  openReceipts: number;
  openPutawayTasks: number;
  openPickLists: number;
  openMoveTasks: number;
  openTransfers: number;
  openCycleCounts: number;
  openDockLoads: number;
  openReplenishmentTasks: number;
  recentAuditEvents: number;
  holdStock: number;
  quarantineStock: number;
  expiryWarning60: number;
  expiryWarning30: number;
  stockAge3Months: number;
  stockAge6Months: number;
  stockAge12Months: number;
  receiptRows: DashboardTaskRow[];
  putawayTaskRows: DashboardTaskRow[];
  pickListRows: DashboardTaskRow[];
  moveTaskRows: DashboardTaskRow[];
  transferRows: DashboardTaskRow[];
  cycleCountRows: DashboardTaskRow[];
  dockLoadRows: DashboardTaskRow[];
  replenishmentRows: DashboardTaskRow[];
  blockedBalanceRows: DashboardTaskRow[];
  dashboardMetricKeys?: DashboardMetricKey[];
};

export function getDashboardMetricKeysForModules(enabledModules?: Partial<Record<string, boolean>>): DashboardMetricKey[] {
  const moduleEnabled = (key: string) => enabledModules?.[key] !== false;
  const metricModules: Array<[string, DashboardMetricKey]> = [
    ["inventory", "totalPallets"],
    ["inventory", "warehousePallets"],
    ["receiving", "openReceipts"],
    ["putaway", "openPutawayTasks"],
    ["pick-lists", "openPickLists"],
    ["location-moves", "openMoveTasks"],
    ["inventory", "expiryWarning30"],
    ["inventory", "expiryWarning60"],
    ["inventory", "stockAge3Months"],
    ["inventory", "stockAge6Months"],
    ["inventory", "stockAge12Months"],
  ];

  return metricModules.flatMap(([moduleKey, metricKey]) => moduleEnabled(moduleKey) ? [metricKey] : []);
}

export type InventoryAgeBucket = "3m" | "6m" | "12m";
export type InventoryExpiryWindow = "30d" | "60d";

export const ROLE_LABELS: Record<RoleCode, string> = {
  developer: "Developer",
  admin: "Admin",
  warehouse_manager: "Warehouse Manager",
  warehouse_supervisor: "Warehouse Supervisor",
  inventory_clerk: "Inventory Clerk",
  warehouse_operator: "Warehouse Operator",
  dispatch_driver: "Dispatch Driver",
};

export const ROLE_DESCRIPTIONS: Record<RoleCode, string> = {
  developer: "Full system capabilities including developer tooling, role management, and all configuration",
  admin: "Full system access including reset, user management, and all configuration",
  warehouse_manager: "Operational control across all warehouse functions and reporting",
  warehouse_supervisor: "Operational oversight with team scheduling, task assignment, and escalation handling",
  inventory_clerk: "Receiving, cycle counts, inventory search, and routine stock moves",
  warehouse_operator: "Assigned task execution and limited inventory search",
  dispatch_driver: "Transfer sign-off and inter-warehouse handoff visibility",
};

export type ModuleKey =
  | "dashboard" | "copilot" | "receiving" | "putaway" | "inventory" | "location-moves" | "transfers" | "pick-lists"
  | "products" | "warehouses" | "zones" | "locations" | "users" | "settings"
  | "clients" | "packaging" | "cycle-counts" | "reports" | "status"
  | "system-log" | "email-log";

export const NAVIGATION: Array<{ label: string; to: AppRoute; roles: RoleCode[]; moduleKey?: ModuleKey }> = [
  { label: "Dashboard", to: "/dashboard", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator", "dispatch_driver"], moduleKey: "dashboard" },
  { label: "Receiving", to: "/receiving", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk"], moduleKey: "receiving" },
  { label: "Put-Away", to: "/putaway-tasks", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator"], moduleKey: "putaway" },
  { label: "Inventory", to: "/inventory-search", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator"], moduleKey: "inventory" },
  { label: "Pick Lists", to: "/pick-lists", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "warehouse_operator"], moduleKey: "pick-lists" },
  { label: "Location Moves", to: "/location-moves", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator"], moduleKey: "location-moves" },
  { label: "Cycle Counts", to: "/cycle-counts", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator"], moduleKey: "cycle-counts" },
  { label: "Transfers", to: "/transfers", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "dispatch_driver"], moduleKey: "transfers" },
  { label: "Warehouses", to: "/warehouses", roles: ["developer", "admin", "warehouse_manager"], moduleKey: "warehouses" },
  { label: "Zones", to: "/zones", roles: ["developer", "admin", "warehouse_manager"], moduleKey: "zones" },
  { label: "Bin Locations", to: "/locations", roles: ["developer", "admin", "warehouse_manager"], moduleKey: "locations" },
  { label: "Products", to: "/products", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk"], moduleKey: "products" },
  { label: "Clients", to: "/clients", roles: ["developer", "admin", "warehouse_manager"], moduleKey: "clients" },
  { label: "Settings", to: "/settings", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor"], moduleKey: "settings" },
  { label: "Help", to: "/help", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator", "dispatch_driver"] },
  { label: "Packaging", to: "/packaging-profiles", roles: ["developer", "admin", "warehouse_manager", "inventory_clerk"], moduleKey: "packaging" },
  { label: "Statuses", to: "/status", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk"], moduleKey: "status" },
  { label: "Reports", to: "/reports", roles: ["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk"], moduleKey: "reports" },
  { label: "System Log", to: "/system-log", roles: ["developer", "admin", "warehouse_manager"], moduleKey: "system-log" },
  { label: "Email Log", to: "/email-log", roles: ["developer", "admin"], moduleKey: "email-log" },
];

const tempOptions: FieldDefinition["options"] = [
  { label: "Ambient", value: "ambient" },
  { label: "Cool", value: "cool" },
  { label: "Frozen", value: "frozen" },
];

export const taskStatusOptions: FieldDefinition["options"] = [
  { label: "Draft", value: "draft" },
  { label: "Queued", value: "queued" },
  { label: "Assigned", value: "assigned" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Exception", value: "exception" },
];

export const RESOURCE_DEFINITIONS: Record<string, ResourceDefinition> = {
  clients: {
    table: "clients",
    title: "Clients",
    description: "Manage warehouse owners and 3PL clients with their stock-sharing rules.",
    singular: "client",
    helpId: "clients",
    roles: ["admin", "warehouse_manager"],
    orderBy: { column: "code" },
    importable: false,
    exportable: true,
    supportsHide: true,
    archiveField: "active",
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "allow_mixed_stock", label: "Mixed stock", type: "boolean" },
      { name: "allow_mixed_sku_pallet", label: "Mixed SKU pallet", type: "boolean" },
      { name: "allow_mixed_lot_pallet", label: "Mixed lot pallet", type: "boolean" },
      { name: "require_expiry", label: "Require expiry", type: "boolean" },
      { name: "active", label: "Active", type: "boolean" },
    ],
  },
  warehouses: {
    table: "warehouses",
    title: "Warehouses",
    description: "Maintain the physical warehouse network and warehouse-level flags.",
    singular: "warehouse",
    helpId: "warehouses",
    roles: ["admin", "warehouse_manager"],
    orderBy: { column: "code" },
    importable: false,
    exportable: true,
    supportsHide: true,
    archiveField: "active",
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "city", label: "City", type: "text" },
      { name: "country", label: "Country", type: "text" },
      { name: "has_cool_zone", label: "Has cool zone", type: "boolean" },
      { name: "variance_value_floor", label: "Variance value floor", type: "number", required: true, description: "Cycle-count variances at or above this value require review." },
      { name: "supervisor_approval_cap", label: "Supervisor approval cap", type: "number", required: true, description: "Cycle-count adjustment value supervisors can approve before manager escalation." },
      { name: "freeze_default_hours", label: "Freeze default hours", type: "number", required: true, description: "Default auto-expiry window for cycle-count bin freezes." },
      { name: "active", label: "Active", type: "boolean" },
    ],
  },
  zones: {
    table: "zones",
    title: "Zones",
    description: "Ambient, cool, staging, and quarantine zones inside each warehouse.",
    singular: "zone",
    helpId: "zones",
    roles: ["admin", "warehouse_manager"],
    orderBy: { column: "code" },
    importable: false,
    exportable: true,
    supportsHide: true,
    archiveField: "is_hidden",
    fields: [
      { name: "warehouse_id", label: "Warehouse", type: "select", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "temperature_class", label: "Temperature", type: "select", options: tempOptions, required: true },
      { name: "is_staging", label: "Staging zone", type: "boolean" },
      { name: "is_dispatch", label: "Dispatch zone", type: "boolean" },
      { name: "is_quarantine", label: "Quarantine zone", type: "boolean" },
    ],
  },
  locations: {
    table: "locations",
    title: "Bin Locations",
    description: "Rack, staging, and quarantine locations with capacity and sequencing.",
    singular: "location",
    helpId: "locations",
    roles: ["admin", "warehouse_manager"],
    orderBy: { column: "code" },
    importable: true,
    exportable: true,
    supportsHide: true,
    archiveField: "is_hidden",
    fields: [
      { name: "code", label: "Code", type: "text", required: true },
      { name: "aisle", label: "Aisle", type: "text" },
      { name: "bay", label: "Bay", type: "text" },
      { name: "level", label: "Level", type: "number" },
      { name: "position", label: "Position", type: "number" },
      { name: "depth", label: "Depth", type: "number", required: true },
      { name: "location_type", label: "Type", type: "select", options: [
        { label: "Rack", value: "rack" },
        { label: "Staging", value: "staging" },
        { label: "Quarantine", value: "quarantine" },
        { label: "Dispatch", value: "dispatch" },
        { label: "Receiving", value: "receiving" },
        { label: "Floor", value: "floor" },
        { label: "Returns", value: "returns" },
      ], required: true },
      { name: "temperature_class", label: "Temperature", type: "select", options: tempOptions, required: true },
      { name: "max_pallets", label: "Max pallets", type: "number", required: true },
      { name: "pick_sequence", label: "Pick seq", type: "number" },
      { name: "putaway_sequence", label: "Put-Away seq", type: "number" },
      { name: "mixed_sku_allowed", label: "Mixed SKU", type: "boolean" },
      { name: "mixed_lot_allowed", label: "Mixed lot", type: "boolean" },
      { name: "max_height", label: "Max height (cm)", type: "number", description: "Leave blank for no height restriction. Set for bays near roof beams." },
      { name: "status", label: "Status", type: "select", options: [
        { label: "Active", value: "active" },
        { label: "Blocked", value: "blocked" },
        { label: "Maintenance", value: "maintenance" },
        { label: "Disabled", value: "disabled" },
      ], required: true },
      { name: "notes", label: "Notes", type: "textarea", description: "Special constraints or beam clearance notes." },
      { name: "warehouse_id", label: "Warehouse", type: "select", required: true },
      { name: "zone_id", label: "Zone", type: "select", required: true },
    ],
  },
  products: {
    table: "products",
    title: "Products",
    description: "Manage owner-specific SKUs, barcodes, dimensions, and rotation policy.",
    singular: "product",
    helpId: "products",
    roles: ["admin", "warehouse_manager", "inventory_clerk"],
    orderBy: { column: "sku" },
    importable: true,
    exportable: true,
    supportsHide: true,
    archiveField: "active",
    fields: [
      { name: "sku", label: "SKU", type: "text", required: true },
      { name: "barcode", label: "Barcode", type: "text" },
      { name: "name", label: "Name", type: "text", required: true },
      { name: "description", label: "Description", type: "textarea" },
      { name: "client_owner_id", label: "Client", type: "select", description: "Optional owner for client-specific catalog items." },
      { name: "product_family", label: "Family", type: "text" },
      { name: "velocity_class", label: "ABC class", type: "select", options: [
        { label: "A", value: "A" },
        { label: "B", value: "B" },
        { label: "C", value: "C" },
      ] },
      { name: "unit_cost", label: "Unit cost", type: "number", description: "Used for cycle-count variance value review thresholds." },
      { name: "minimum_stock_level", label: "Minimum stock", type: "number", description: "Alert when available stock reaches this floor." },
      { name: "maximum_stock_level", label: "Maximum stock", type: "number", description: "Recommended replenishment target." },
      { name: "pick_down_to_level", label: "Pick down to", type: "number", description: "Target level for pick-face replenishment planning." },
      { name: "supplier_lead_time_days", label: "Supplier lead time (days)", type: "number", description: "Used with recent outbound demand for reorder forecasting." },
      { name: "temperature_requirement", label: "Temperature", type: "select", options: tempOptions, required: true },
      { name: "lot_tracked", label: "Lot tracked", type: "boolean" },
      { name: "batch_tracked", label: "Batch tracked", type: "boolean" },
      { name: "expiry_tracked", label: "Expiry tracked", type: "boolean" },
      { name: "rotation_method", label: "Rotation", type: "select", options: [
        { label: "FIFO", value: "fifo" },
        { label: "FEFO", value: "fefo" },
      ], required: true },
      { name: "active", label: "Active", type: "boolean" },
    ],
  },
  packagingProfiles: {
    table: "product_packaging_profiles",
    title: "Packaging Profiles",
    description: "Unit, carton, pallet, and custom packed forms for each product.",
    singular: "packaging profile",
    helpId: "packaging-profiles",
    roles: ["admin", "warehouse_manager", "inventory_clerk"],
    orderBy: { column: "profile_name" },
    importable: true,
    exportable: true,
    supportsHide: true,
    archiveField: "is_hidden",
    fields: [
      { name: "product_id", label: "Product", type: "select", required: true },
      { name: "profile_name", label: "Profile name", type: "text", required: true },
      { name: "package_type", label: "Package type", type: "text", required: true },
      { name: "units_per_package", label: "Units per package", type: "number", required: true },
      { name: "length", label: "Length", type: "number" },
      { name: "width", label: "Width", type: "number" },
      { name: "height", label: "Height", type: "number" },
      { name: "weight", label: "Weight", type: "number" },
      { name: "barcode", label: "Barcode", type: "text" },
      { name: "is_default", label: "Default", type: "boolean" },
    ],
  },
};

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export const signUpSchema = z.object({
  fullName: z.string().min(2, "Name is required"),
  email: z.string().email(),
  phone: z.string().min(6, "Phone number is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const receivingSchema = z.object({
  receipt_type: z.enum(["po", "transfer", "other"]),
  reference_number: z.string().optional().or(z.literal("")),
  container_number: z.string().optional().or(z.literal("")),
  po_number: z.string().optional().or(z.literal("")),
  warehouse_id: z.string().uuid(),
  client_id: z.string().uuid().optional().or(z.literal("")),
  product_id: z.string().uuid(),
  packaging_profile_id: z.string().uuid().optional().or(z.literal("")),
  quantity: z.coerce.number().positive(),
  lot_number: z.string().optional(),
  batch_number: z.string().optional(),
  manufacture_date: z.string().optional(),
  expiry_date: z.string().optional(),
  loading_date: z.string().optional(),
  rotation_date: z.string().optional(),
  override_length: z.coerce.number().optional(),
  override_width: z.coerce.number().optional(),
  override_height: z.coerce.number().optional(),
  override_weight: z.coerce.number().optional(),
  reuse_pallet_barcode: z.string().optional(),
  pallet_barcode: z.string().optional(),
  draft_group_id: z.string().uuid().optional(),
  draft_sequence: z.coerce.number().optional(),
  draft_count: z.coerce.number().optional(),
});

export const pickListSchema = z.object({
  warehouse_id: z.string().uuid(),
  client_id: z.string().uuid().optional(),
  order_number: z.string().min(2),
  requested_ship_date: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.coerce.number().positive(),
      }),
    )
    .min(1),
});

export const transferSchema = z.object({
  transfer_type: z.enum(["inter_warehouse", "intra_warehouse"]),
  source_warehouse_id: z.string().uuid(),
  destination_warehouse_id: z.string().uuid(),
  pallet_id: z.string().uuid(),
  quantity: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export const cycleCountSchema = z.object({
  warehouse_id: z.string().uuid(),
  scope: z.enum(["location", "zone", "sku", "spot", "abc"]),
  location_id: z.string().uuid().optional().or(z.literal("")),
  location_ids: z.array(z.string().uuid()).default([]),
  zone_id: z.string().uuid().optional().or(z.literal("")),
  zone_ids: z.array(z.string().uuid()).default([]),
  product_id: z.string().uuid().optional().or(z.literal("")),
  product_ids: z.array(z.string().uuid()).default([]),
  variance_threshold_percent: z.coerce.number().min(0).max(100).default(5),
  freeze_hours: z.coerce.number().positive().max(168).default(4),
  assigned_user_id: z.string().uuid().optional().or(z.literal("")),
  assigned_user_ids: z.array(z.string().uuid()).default([]),
});

export const statusChangeSchema = z.object({
  pallet_id: z.string().min(2, "Scan or enter a pallet barcode"),
  new_status: z.enum(["hold", "quarantine", "damaged", "available", "missing"]),
  reason: z.string().min(3),
});

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return format(new Date(value), "dd MMM yyyy");
}

export function formatNumber(value: number | null | undefined) {
  if (value == null) return "0";
  return new Intl.NumberFormat().format(value);
}

export function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      headers
        .map((header) => JSON.stringify(row[header] ?? ""))
        .join(","),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function downloadCsvTemplate(resource: ResourceDefinition) {
  const rows = [
    resource.fields.map((field) => field.name),
    resource.fields.map((field) => field.label),
    resource.fields.map((field) => templateExampleValue(resource.table, field)),
    resource.fields.map((field) => (field.required ? "required" : "optional")),
  ];
  const csv = rows.map((row) => row.map((value) => JSON.stringify(value ?? "")).join(",")).join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${resource.table}-import-template.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function templateExampleValue(resourceTable: string, field: FieldDefinition) {
  if (field.name.endsWith("_id")) return `replace-with-${field.name}`;
  if (field.type === "boolean") return "true";
  if (field.type === "number") return field.name.includes("sequence") ? "10" : "1";
  if (field.type === "select") return field.options?.[0]?.value ?? "";

  const examples: Record<string, Record<string, string>> = {
    locations: {
      code: "MAIN-STG-A-01-L01",
      aisle: "A",
      bay: "01",
      status: "active",
    },
    products: {
      sku: "SKU-EXAMPLE-001",
      barcode: "0123456789012",
      name: "Example Product",
      description: "Imported product master record",
      product_family: "Ambient",
      rotation_method: "fifo",
    },
  };

  return examples[resourceTable]?.[field.name] ?? "";
}

export function parseCsv(text: string) {
  const [headerLine, ...lines] = text.split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(",").map((value) => value.trim());

  return lines.map((line) => {
    const values = line.split(",").map((value) => value.replace(/^"|"$/g, "").trim());
    return headers.reduce<Record<string, string>>((accumulator, header, index) => {
      accumulator[header] = values[index] ?? "";
      return accumulator;
    }, {});
  });
}

export function validatePutawayAssignment(input: {
  productTemperature: TemperatureClass;
  locationTemperature: TemperatureClass;
  locationStatus: string;
  locationMaxPallets: number;
  occupiedPallets: number;
  mixedSkuAllowed: boolean;
  hasOtherSku: boolean;
  palletHeightCm?: number | null;
  locationMaxPalletHeightCm?: number | null;
}) {
  if (input.locationStatus !== "active") {
    return { valid: false, reason: "Location is not active" };
  }
  if (input.productTemperature === "cool" && input.locationTemperature !== "cool") {
    return { valid: false, reason: "Cool-chain pallet cannot be placed in a non-cool location" };
  }
  if (input.occupiedPallets >= input.locationMaxPallets) {
    return { valid: false, reason: "Location is full" };
  }
  if (input.hasOtherSku && !input.mixedSkuAllowed) {
    return { valid: false, reason: "Location blocks mixed SKU storage" };
  }
  if (
    input.locationMaxPalletHeightCm != null &&
    input.palletHeightCm != null &&
    input.palletHeightCm > input.locationMaxPalletHeightCm
  ) {
    return {
      valid: false,
      reason: `Pallet height ${input.palletHeightCm} cm exceeds location ceiling of ${input.locationMaxPalletHeightCm} cm`,
    };
  }
  return { valid: true, reason: "Assignment valid" };
}

function applyArchiveFilter(
  query: any,
  archiveField?: ArchiveField,
  includeHidden = false,
) {
  if (includeHidden || !archiveField) {
    return query;
  }

  if (archiveField === "active") {
    return query.eq("active", true);
  }

  return query.eq("is_hidden", false);
}

// PostgREST (Supabase's REST layer) caps any unbounded select at a server-side
// row limit — 1000 rows by default for this project. A query that doesn't
// page through with `.range()` will silently return only the first page, with
// no error, no matter how many rows actually match. This bit the Locations
// admin table (client-side search only ever saw the first 1000 rows) and the
// putaway bay selectors (bays past row 1000 never rendered). Any query that
// could plausibly return more than a page of rows should use this helper.
//
// `buildPage` must build a *fresh* query for each call (a Supabase query
// builder can only be awaited once), applying `.range(from, to)` as the last
// step before returning it.
const FETCH_ALL_ROWS_PAGE_SIZE = 1000;
const LOCATION_OCCUPANCY_BATCH_SIZE = 100;

async function fetchAllRows<T = any>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize: number = FETCH_ALL_ROWS_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  // Safety valve so a pagination bug can't spin forever against a live table.
  const maxPages = 10_000;
  for (let page = 0; page < maxPages; page += 1) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared helper exports (used by multiple feature modules)
// ─────────────────────────────────────────────────────────────────────────────

export { db };
export { DB_RETIRED_INVENTORY_STATUS_FILTER, RETIRED_INVENTORY_STATUSES };
export { isRetiredInventoryStatus, hasVisibleInventoryQuantity };
export { formatSupabaseError, throwIfSupabaseError, applyArchiveFilter };
export { fetchAllRows };
export { PICK_COMPLETED_INVENTORY_STATUS };

export function buildPalletCode(prefix: string) {
  const time = Date.now().toString().slice(-8);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}${rand}`;
}

export async function getStoredPalletCounts(locationIds: string[]): Promise<Map<string, number>> {
  if (locationIds.length === 0) return new Map();

  const uniqueLocationIds = [...new Set(locationIds)];
  const batches: string[][] = [];
  for (let index = 0; index < uniqueLocationIds.length; index += LOCATION_OCCUPANCY_BATCH_SIZE) {
    batches.push(uniqueLocationIds.slice(index, index + LOCATION_OCCUPANCY_BATCH_SIZE));
  }

  const batchResults = await Promise.all(batches.map(async (batch) => {
    const [balanceResult, palletResult] = await Promise.all([
      db("inventory_balances")
        .select("location_id, status")
        .in("location_id", batch)
        .not("status", "in", DB_RETIRED_INVENTORY_STATUS_FILTER),
      db("pallets")
        .select("current_location_id, status")
        .in("current_location_id", batch)
        .not("status", "in", DB_RETIRED_INVENTORY_STATUS_FILTER),
    ]);
    return { balanceResult, palletResult };
  }));

  const balanceCounts = new Map<string, number>();
  const palletCounts = new Map<string, number>();
  for (const { balanceResult, palletResult } of batchResults) {
    if (!balanceResult.error) {
      for (const row of balanceResult.data ?? []) {
        if (isRetiredInventoryStatus(row.status)) continue;
        const id = row.location_id;
        if (id) balanceCounts.set(id, (balanceCounts.get(id) ?? 0) + 1);
      }
    } else {
      console.warn("[getStoredPalletCounts] inventory balance count unavailable:", balanceResult.error);
    }

    if (!palletResult.error) {
      for (const row of palletResult.data ?? []) {
        if (isRetiredInventoryStatus(row.status)) continue;
        const id = row.current_location_id;
        if (id) palletCounts.set(id, (palletCounts.get(id) ?? 0) + 1);
      }
    } else {
      console.warn("[getStoredPalletCounts] pallet count unavailable:", palletResult.error);
    }
  }

  const counts = new Map<string, number>();
  for (const id of uniqueLocationIds) {
    counts.set(id, Math.max(balanceCounts.get(id) ?? 0, palletCounts.get(id) ?? 0));
  }
  return counts;
}


export async function getStoredPalletCount(locationId: string): Promise<number> {
  return (await getStoredPalletCounts([locationId])).get(locationId) ?? 0;
}


// Re-exports for backwards compatibility with split files that still import
// these types from core-types.
export type { CascadeDeleteResult, LocationRangeInput, ExpandedLocationRow } from "@/features/setup/setup-core";
export type { ImportPreview, ImportRowPreview } from "@/features/reports/reports-core";
