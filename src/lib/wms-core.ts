import { z } from "zod";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";

// Helper to bypass strict Supabase typing for tables not yet in the schema.
// Once all WMS tables are migrated, this can be replaced with direct db() calls.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase.from.bind(supabase) as (table: string) => any;
// These types will come from the DB once all WMS tables are created.
// For now we define them locally so the code compiles.
export type RoleCode =
  | "admin"
  | "warehouse_manager"
  | "inventory_clerk"
  | "warehouse_operator"
  | "dispatch_driver";

export type InventoryStatus = string;
export type TaskStatus = string;
export type TemperatureClass = string;

export type AppRoute =
  | "/"
  | "/dashboard"
  | "/warehouses"
  | "/zones"
  | "/locations"
  | "/products"
  | "/packaging-profiles"
  | "/receiving"
  | "/putaway-tasks"
  | "/inventory-search"
  | "/inventory/:balanceId"
  | "/pick-lists"
  | "/pick-lists/:pickListId"
  | "/transfers"
  | "/cycle-counts"
  | "/status"
  | "/reports"
  | "/users"
  | "/settings"
  | "/help"
  | "/setup-wizard";

type FieldType = "text" | "textarea" | "number" | "select" | "boolean" | "date";
type ArchiveField = "active" | "is_hidden";

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
  maxPallets: number;
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

export type DashboardMetrics = {
  totalPallets: number;
  availablePallets: number;
  coolZoneOccupancy: number;
  openReceipts: number;
  openPutawayTasks: number;
  openPickLists: number;
  holdStock: number;
  quarantineStock: number;
};

export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: "Admin",
  warehouse_manager: "Warehouse Manager",
  inventory_clerk: "Inventory Clerk",
  warehouse_operator: "Warehouse Operator",
  dispatch_driver: "Dispatch Driver",
};

export const NAVIGATION: Array<{ label: string; to: AppRoute; roles: RoleCode[] }> = [
  { label: "Dashboard", to: "/dashboard", roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator", "dispatch_driver"] },
  { label: "Warehouses", to: "/warehouses", roles: ["admin", "warehouse_manager"] },
  { label: "Zones", to: "/zones", roles: ["admin", "warehouse_manager"] },
  { label: "Locations", to: "/locations", roles: ["admin", "warehouse_manager"] },
  { label: "Products", to: "/products", roles: ["admin", "warehouse_manager", "inventory_clerk"] },
  { label: "Packaging", to: "/packaging-profiles", roles: ["admin", "warehouse_manager", "inventory_clerk"] },
  { label: "Receiving", to: "/receiving", roles: ["admin", "warehouse_manager", "inventory_clerk"] },
  { label: "Putaway", to: "/putaway-tasks", roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator"] },
  { label: "Inventory", to: "/inventory-search", roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator"] },
  { label: "Pick Lists", to: "/pick-lists", roles: ["admin", "warehouse_manager", "warehouse_operator"] },
  { label: "Transfers", to: "/transfers", roles: ["admin", "warehouse_manager", "inventory_clerk", "dispatch_driver"] },
  { label: "Cycle Counts", to: "/cycle-counts", roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator"] },
  { label: "Statuses", to: "/status", roles: ["admin", "warehouse_manager", "inventory_clerk"] },
  { label: "Reports", to: "/reports", roles: ["admin", "warehouse_manager", "inventory_clerk"] },
  { label: "Users", to: "/users", roles: ["admin"] },
  { label: "Settings", to: "/settings", roles: ["admin", "warehouse_manager"] },
  { label: "Help", to: "/help", roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator", "dispatch_driver"] },
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
    title: "Locations",
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
      { name: "warehouse_id", label: "Warehouse", type: "select", required: true },
      { name: "zone_id", label: "Zone", type: "select", required: true },
      { name: "code", label: "Code", type: "text", required: true },
      { name: "aisle", label: "Aisle", type: "text" },
      { name: "bay", label: "Bay", type: "text" },
      { name: "level", label: "Level", type: "number" },
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
      { name: "pick_sequence", label: "Pick sequence", type: "number" },
      { name: "putaway_sequence", label: "Putaway sequence", type: "number" },
      { name: "mixed_sku_allowed", label: "Mixed SKU allowed", type: "boolean" },
      { name: "mixed_lot_allowed", label: "Mixed lot allowed", type: "boolean" },
      { name: "status", label: "Status", type: "select", options: [
        { label: "Active", value: "active" },
        { label: "Blocked", value: "blocked" },
        { label: "Maintenance", value: "maintenance" },
        { label: "Disabled", value: "disabled" },
      ], required: true },
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
      { name: "client_owner_id", label: "Client", type: "select", required: true },
      { name: "product_family", label: "Family", type: "text" },
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
  receipt_type: z.enum(["po", "transfer", "manual"]),
  reference_number: z.string().min(2),
  warehouse_id: z.string().uuid(),
  client_id: z.string().uuid(),
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
});

export const pickListSchema = z.object({
  warehouse_id: z.string().uuid(),
  client_id: z.string().uuid(),
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
  scope: z.enum(["location", "zone", "sku", "spot"]),
  location_id: z.string().uuid().optional().or(z.literal("")),
  zone_id: z.string().uuid().optional().or(z.literal("")),
  product_id: z.string().uuid().optional().or(z.literal("")),
  variance_threshold_percent: z.coerce.number().min(0).max(100).default(5),
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

export async function listRecords(
  table: string,
  select = "*",
  orderBy?: { column: string; ascending?: boolean },
  options?: { includeHidden?: boolean; archiveField?: ArchiveField },
) {
  let query = (supabase.from as any)(table).select(select);

  if (orderBy) {
    query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
  }

  query = applyArchiveFilter(query, options?.archiveField, options?.includeHidden);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function upsertRecord(
  table: string,
  payload: Record<string, unknown>,
) {
  const cleanedPayload = Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [key, value === "" ? null : value]),
  );
  const { data, error } = await (supabase.from as any)(table).upsert(cleanedPayload as never).select().single();
  if (error) throw error;
  return data as any;
}

export async function deleteRecord(table: string, id: string) {
  const { error } = await (supabase.from as any)(table).delete().eq("id", id);
  if (error) throw error;
}

export async function setResourceVisibility(
  table: string,
  id: string,
  archiveField: ArchiveField,
  hidden: boolean,
  reason?: string,
) {
  const payload =
    archiveField === "active"
      ? { active: !hidden }
      : {
          is_hidden: hidden,
          hidden_at: hidden ? new Date().toISOString() : null,
          hidden_reason: hidden ? reason ?? null : null,
        };

  const { error } = await (supabase.from as any)(table).update(payload).eq("id", id);
  if (error) throw error;
}

export async function setProfileActive(profileId: string, active: boolean) {
  const { error } = await (supabase.from as any)("profiles").update({ active }).eq("id", profileId);
  if (error) throw error;
  await logUserActivity("user_access_change", "profiles", profileId, { active });
}

export async function updateProfileDetails(input: ProfileUpdateInput) {
  const payload = {
    full_name: input.full_name,
    phone: input.phone || null,
    default_warehouse_id: input.default_warehouse_id || null,
    active: input.active,
    approved: input.approved,
    user_code: input.user_code || null,
    badge_code: input.badge_code || null,
  };

  const { error } = await (supabase.from as any)("profiles").update(payload).eq("id", input.profileId);
  if (error) throw error;
  await logUserActivity("user_access_change", "profiles", input.profileId, {
    fields: Object.keys(payload),
    approved: input.approved,
    active: input.active,
  });
}

export async function setUserRoleVisibility(userRoleId: string, hidden: boolean, reason?: string) {
  const { error } = await (supabase.from as any)("user_roles")
    .update({
      is_hidden: hidden,
      hidden_at: hidden ? new Date().toISOString() : null,
      hidden_reason: hidden ? reason ?? null : null,
    })
    .eq("id", userRoleId);
  if (error) throw error;
  await logUserActivity("user_access_change", "user_roles", userRoleId, { hidden, reason: reason ?? null });
}

export async function fetchOptions(includeHidden = false, scope?: WarehouseVisibilityScope) {
  const [warehouses, zones, locations, clients, products, packagingProfiles, pallets, profiles, roles, userRoles] = await Promise.all([
    listRecords("warehouses", "*", undefined, { includeHidden, archiveField: "active" }),
    listRecords("zones", "*", undefined, { includeHidden, archiveField: "is_hidden" }),
    listRecords("locations", "*", undefined, { includeHidden, archiveField: "is_hidden" }),
    listRecords("clients"),
    listRecords("products", "*", undefined, { includeHidden, archiveField: "active" }),
    listRecords("product_packaging_profiles", "*", undefined, { includeHidden, archiveField: "is_hidden" }),
    listRecords("pallets"),
    listRecords("profiles", "*", undefined, includeHidden ? undefined : { archiveField: "active" }),
    listRecords("roles"),
    applyArchiveFilter(db("user_roles").select("*, roles(code, name)"), "is_hidden", includeHidden).then(({ data, error }: { data: any; error: any }) => {
      if (error) throw error;
      return data ?? [];
    }),
  ]);

  const scopedWarehouseId = scope?.restrictToWarehouse ? scope.warehouseId : null;

  return {
    warehouses: scopedWarehouseId ? warehouses.filter((warehouse: any) => warehouse.id === scopedWarehouseId) : warehouses,
    zones: scopedWarehouseId ? zones.filter((zone: any) => zone.warehouse_id === scopedWarehouseId) : zones,
    locations: scopedWarehouseId ? locations.filter((location: any) => location.warehouse_id === scopedWarehouseId) : locations,
    clients,
    products,
    packagingProfiles,
    pallets: scopedWarehouseId ? pallets.filter((pallet: any) => pallet.current_warehouse_id === scopedWarehouseId) : pallets,
    profiles,
    roles,
    userRoles,
  };
}

export async function getWarehouseForLocationBarcode(locationCode: string) {
  const normalizedCode = locationCode.trim();
  if (!normalizedCode) throw new Error("Scan a location barcode first.");

  const { data, error } = await db("locations")
    .select("warehouse_id, code, warehouses(id, code, name)")
    .eq("code", normalizedCode)
    .single();
  if (error) throw error;
  return data as any;
}

export async function listUserActivities(limit = 25) {
  const { data, error } = await db("audit_events")
    .select("*, profiles:actor_user_id(full_name, email)")
    .in("entity_table", ["profiles", "user_roles"])
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function resolveLoginCode(loginCode: string) {
  const { data, error } = await (supabase.rpc as any)("resolve_login_code", {
    in_login_code: loginCode.trim(),
  });
  if (error) throw error;
  return data as string | null;
}

export async function recordUserSignIn(method: "email" | "code" | "badge") {
  await logUserActivity("user_sign_in", "profiles", undefined, { method });
}

async function logUserActivity(
  eventType: string,
  entityTable: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) {
  const { data: userData } = await supabase.auth.getUser();
  const actorId = userData.user?.id;
  if (!actorId) return;

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: eventType,
    in_entity_table: entityTable,
    in_entity_id: entityId ?? actorId,
    in_metadata: metadata ?? {},
  });
}

export function createDefaultWarehouseSetupPayload(): WarehouseSetupPayload {
  const warehouses: WarehouseSetupWarehouse[] = [
    { code: "MAIN", name: "Main Warehouse", city: "Bridgetown", country: "Barbados", hasCoolZone: true },
    { code: "PORT", name: "Port Receiving Warehouse", city: "Bridgetown", country: "Barbados", hasCoolZone: false },
    { code: "WLD", name: "Wildey Distribution Warehouse", city: "Wildey", country: "Barbados", hasCoolZone: false },
  ];

  const ambientZones = (warehouseCode: string): WarehouseSetupZone[] => [
    { warehouseCode, code: "STG", name: "Staging", temperatureClass: "ambient", isStaging: true, isDispatch: false, isQuarantine: false, sortOrder: 10 },
    { warehouseCode, code: "DSP", name: "Dispatch", temperatureClass: "ambient", isStaging: false, isDispatch: true, isQuarantine: false, sortOrder: 20 },
    { warehouseCode, code: "QTN", name: "Quarantine", temperatureClass: "ambient", isStaging: false, isDispatch: false, isQuarantine: true, sortOrder: 30 },
    { warehouseCode, code: "AMB", name: "Ambient Rack", temperatureClass: "ambient", isStaging: false, isDispatch: false, isQuarantine: false, sortOrder: 40 },
  ];

  const zones: WarehouseSetupZone[] = [
    ...warehouses.flatMap((warehouse) => ambientZones(warehouse.code)),
    { warehouseCode: "MAIN", code: "COOL", name: "Cool Storage", temperatureClass: "cool", isStaging: false, isDispatch: false, isQuarantine: false, sortOrder: 50 },
  ];

  const ambientLocationTemplates = (warehouseCode: string): WarehouseLocationTemplate[] => [
    {
      warehouseCode,
      zoneCode: "STG",
      aisleCount: 1,
      baysPerAisle: 6,
      levels: 1,
      maxPallets: 4,
      locationType: "staging",
      temperatureClass: "ambient",
      mixedSkuAllowed: true,
      mixedLotAllowed: true,
      status: "active",
    },
    {
      warehouseCode,
      zoneCode: "DSP",
      aisleCount: 1,
      baysPerAisle: 4,
      levels: 1,
      maxPallets: 3,
      locationType: "dispatch",
      temperatureClass: "ambient",
      mixedSkuAllowed: true,
      mixedLotAllowed: true,
      status: "active",
    },
    {
      warehouseCode,
      zoneCode: "QTN",
      aisleCount: 1,
      baysPerAisle: 4,
      levels: 1,
      maxPallets: 1,
      locationType: "quarantine",
      temperatureClass: "ambient",
      mixedSkuAllowed: false,
      mixedLotAllowed: false,
      status: "active",
    },
    {
      warehouseCode,
      zoneCode: "AMB",
      aisleCount: 2,
      baysPerAisle: 8,
      levels: 3,
      maxPallets: 1,
      locationType: "rack",
      temperatureClass: "ambient",
      mixedSkuAllowed: false,
      mixedLotAllowed: false,
      status: "active",
    },
  ];

  const locationTemplates: WarehouseLocationTemplate[] = [
    ...warehouses.flatMap((warehouse) => ambientLocationTemplates(warehouse.code)),
    {
      warehouseCode: "MAIN",
      zoneCode: "COOL",
      aisleCount: 2,
      baysPerAisle: 8,
      levels: 3,
      maxPallets: 1,
      locationType: "rack",
      temperatureClass: "cool",
      mixedSkuAllowed: false,
      mixedLotAllowed: false,
      status: "active",
    },
  ];

  return { warehouses, zones, locationTemplates };
}

export async function resetWmsData() {
  const { data, error } = await (supabase.rpc as any)("reset_wms_data");
  if (error) throw error;
  return data;
}

export async function runWarehouseSetup(setupPayload: WarehouseSetupPayload, seedMode = "starter_ops") {
  const { data, error } = await (supabase.rpc as any)("run_warehouse_setup", {
    setup_payload: setupPayload,
    seed_mode: seedMode,
  });
  if (error) throw error;
  return data;
}

function buildPalletCode(prefix: string) {
  return `${prefix}-${Date.now().toString().slice(-8)}`;
}

async function resolveInventoryLot(payload: z.infer<typeof receivingSchema>) {
  const lotMatch = await db("inventory_lots")
    .select("*")
    .eq("product_id", payload.product_id)
    .eq("client_id", payload.client_id)
    .eq("lot_number", payload.lot_number ?? null)
    .eq("batch_number", payload.batch_number ?? null)
    .maybeSingle();

  if (lotMatch.data) {
    return lotMatch.data;
  }

  const { data, error } = await db("inventory_lots")
    .insert({
      product_id: payload.product_id,
      client_id: payload.client_id,
      lot_number: payload.lot_number ?? null,
      batch_number: payload.batch_number ?? null,
      manufacture_date: payload.manufacture_date || null,
      expiry_date: payload.expiry_date || null,
      loading_date: payload.loading_date || null,
      rotation_date: payload.rotation_date || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function createLabelRecord(label_type: string, entityId: string, labelCode: string) {
  const { error } = await db("barcode_labels").insert({
    label_type,
    entity_id: entityId,
    label_code: labelCode,
    last_printed_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function createReceiptFlow(input: z.infer<typeof receivingSchema>) {
  const payload = receivingSchema.parse(input);
  const lot = await resolveInventoryLot(payload);
  const receiptNumber = buildPalletCode("RCT");
  const palletCode = buildPalletCode("PLT");

  const { data: product, error: productError } = await db("products")
    .select("*")
    .eq("id", payload.product_id)
    .single();

  if (productError) throw productError;

  const { data: packagingProfile } = payload.packaging_profile_id
    ? await db("product_packaging_profiles").select("*").eq("id", payload.packaging_profile_id).single()
    : { data: null };

  const receipt = await upsertRecord("receipts", {
    receipt_number: receiptNumber,
    receipt_type: payload.receipt_type,
    reference_number: payload.reference_number,
    warehouse_id: payload.warehouse_id,
    client_id: payload.client_id,
    status: "completed",
  });

  const receiptLine = await upsertRecord("receipt_lines", {
    receipt_id: receipt.id,
    product_id: payload.product_id,
    packaging_profile_id: payload.packaging_profile_id || null,
    client_id: payload.client_id,
    quantity: payload.quantity,
    received_quantity: payload.quantity,
    inventory_lot_id: lot.id,
    override_length: payload.override_length ?? null,
    override_width: payload.override_width ?? null,
    override_height: payload.override_height ?? null,
    override_weight: payload.override_weight ?? null,
  });

  const pallet = await upsertRecord("pallets", {
    pallet_code: palletCode,
    pallet_barcode: palletCode,
    product_id: payload.product_id,
    client_id: payload.client_id,
    receipt_line_id: receiptLine.id,
    current_warehouse_id: payload.warehouse_id,
    inventory_lot_id: lot.id,
    packaging_profile_id: payload.packaging_profile_id || null,
    quantity: payload.quantity,
    available_quantity: 0,
    status: "receiving",
    is_stored: false,
    length: payload.override_length ?? packagingProfile?.length ?? product.length,
    width: payload.override_width ?? packagingProfile?.width ?? product.width,
    height: payload.override_height ?? packagingProfile?.height ?? product.height,
    weight: payload.override_weight ?? packagingProfile?.weight ?? product.weight,
  });

  await upsertRecord("inventory_balances", {
    pallet_id: pallet.id,
    product_id: payload.product_id,
    client_id: payload.client_id,
    warehouse_id: payload.warehouse_id,
    inventory_lot_id: lot.id,
    status: "receiving",
    quantity: payload.quantity,
    available_quantity: 0,
    expiry_date: lot.expiry_date,
  });

  const suggestions = await (supabase.rpc as any)("directed_putaway_candidates", { in_pallet_id: pallet.id });
  if (suggestions.error) throw suggestions.error;
  const topSuggestion = suggestions.data?.[0] ?? null;

  const putawayTask = await upsertRecord("putaway_tasks", {
    task_number: buildPalletCode("PTA"),
    pallet_id: pallet.id,
    warehouse_id: payload.warehouse_id,
    suggested_location_id: topSuggestion?.location_id ?? null,
    status: "queued",
  });

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "receipt",
    in_entity_table: "pallets",
    in_entity_id: pallet.id,
    in_pallet_id: pallet.id,
    in_warehouse_id: payload.warehouse_id,
    in_metadata: {
      receipt_id: receipt.id,
      receipt_line_id: receiptLine.id,
      quantity: payload.quantity,
    } as any,
  });

  await createLabelRecord("pallet", pallet.id, palletCode);

  return { receipt, receiptLine, pallet, putawayTask, topSuggestion };
}

export async function searchInventory(filters: {
  search?: string;
  warehouseId?: string;
  status?: InventoryStatus | "all";
}) {
  let query = db("inventory_search_view").select("*");

  if (filters.search) {
    query = query.or(
      [
        `sku.ilike.%${filters.search}%`,
        `product_name.ilike.%${filters.search}%`,
        `product_barcode.ilike.%${filters.search}%`,
        `pallet_code.ilike.%${filters.search}%`,
        `pallet_barcode.ilike.%${filters.search}%`,
        `lot_number.ilike.%${filters.search}%`,
        `batch_number.ilike.%${filters.search}%`,
        `location_code.ilike.%${filters.search}%`,
      ].join(","),
    );
  }

  if (filters.warehouseId) {
    query = query.eq("warehouse_id", filters.warehouseId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  const { data, error } = await query.order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function getInventoryDetail(balanceId: string) {
  const { data: balance, error: balanceError } = await db("inventory_balances")
    .select("*")
    .eq("id", balanceId)
    .single();
  if (balanceError) throw balanceError;

  const [{ data: pallet }, { data: audit }, { data: lot }] = await Promise.all([
    db("pallets").select("*").eq("id", balance.pallet_id).single(),
    db("audit_events").select("*").eq("pallet_id", balance.pallet_id).order("created_at", { ascending: false }),
    balance.inventory_lot_id
      ? db("inventory_lots").select("*").eq("id", balance.inventory_lot_id).single()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return {
    balance,
    pallet: pallet.data ?? null,
    lot: lot.data ?? null,
    audit: audit ?? [],
  };
}

export async function getPutawayTasks(userId?: string) {
  let query = db("putaway_tasks")
    .select("*, pallets(*, products(*), inventory_lots: inventory_lot_id(*)), locations: suggested_location_id(*)")
    .order("created_at", { ascending: false });

  if (userId) {
    query = query.eq("assigned_user_id", userId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function sendBackToReceiving(taskId: string, reason: string) {
  const { data: task, error: taskError } = await db("putaway_tasks")
    .select("*, pallets(*)")
    .eq("id", taskId)
    .single();
  if (taskError) throw taskError;

  const pallet = task.pallets as any;
  if (!pallet) throw new Error("Putaway task has no linked pallet.");

  await Promise.all([
    db("pallets")
      .update({ status: "receiving", current_location_id: null, is_stored: false, available_quantity: 0 })
      .eq("id", pallet.id),
    db("inventory_balances")
      .update({ status: "receiving", location_id: null, zone_id: null, available_quantity: 0 })
      .eq("pallet_id", pallet.id),
    db("putaway_tasks")
      .update({ status: "cancelled", notes: reason || "Returned to receiving by operator" })
      .eq("id", taskId),
  ]);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway_returned_to_receiving",
    in_entity_table: "putaway_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet.id,
    in_warehouse_id: task.warehouse_id,
    in_metadata: { reason: reason || "Returned to receiving by operator" },
  });
}

export async function flagPutawayException(taskId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to flag an exception.");

  const { data: task, error: taskError } = await db("putaway_tasks")
    .select("*, pallets(*)")
    .eq("id", taskId)
    .single();
  if (taskError) throw taskError;

  const pallet = task.pallets as any;

  await db("putaway_tasks")
    .update({ status: "exception", notes: reason })
    .eq("id", taskId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway_exception",
    in_entity_table: "putaway_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet?.id,
    in_warehouse_id: task.warehouse_id,
    in_metadata: { reason },
  });
}

export async function confirmPutaway(taskId: string, scannedPalletBarcode: string, scannedLocationCode: string) {
  const { data: task, error: taskError } = await db("putaway_tasks")
    .select("*, pallets(*), locations: suggested_location_id(*), products: pallets(product_id)")
    .eq("id", taskId)
    .single();

  if (taskError) throw taskError;

  const pallet = task.pallets as any;
  if (!pallet || pallet.pallet_barcode !== scannedPalletBarcode) {
    throw new Error("Scanned pallet barcode does not match the task pallet.");
  }

  const { data: location, error: locationError } = await db("locations")
    .select("*")
    .eq("code", scannedLocationCode)
    .single();
  if (locationError) throw locationError;

  const { data: product, error: productError } = await db("products")
    .select("*")
    .eq("id", pallet.product_id)
    .single();
  if (productError) throw productError;

  const ruleCheck = validatePutawayAssignment({
    productTemperature: product.temperature_requirement,
    locationTemperature: location.temperature_class,
    locationStatus: location.status,
    locationMaxPallets: location.max_pallets,
    occupiedPallets: 0,
    mixedSkuAllowed: location.mixed_sku_allowed,
    hasOtherSku: false,
  });

  if (!ruleCheck.valid) {
    throw new Error(ruleCheck.reason);
  }

  await Promise.all([
    db("pallets")
      .update({
        current_location_id: location.id,
        current_warehouse_id: location.warehouse_id,
        status: "available",
        is_stored: true,
        available_quantity: pallet.quantity,
      })
      .eq("id", pallet.id),
    db("inventory_balances")
      .update({
        warehouse_id: location.warehouse_id,
        zone_id: location.zone_id,
        location_id: location.id,
        status: "available",
        available_quantity: pallet.quantity,
      })
      .eq("pallet_id", pallet.id),
    db("putaway_tasks")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId),
  ]);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway",
    in_entity_table: "putaway_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet.id,
    in_warehouse_id: location.warehouse_id,
    in_to_location_id: location.id,
    in_metadata: {
      location_code: location.code,
      pallet_barcode: pallet.pallet_barcode,
    } as any,
  });
}

async function selectPickCandidates(productId: string, warehouseId: string, quantity: number) {
  const { data: product } = await db("products").select("*").eq("id", productId).single();

  const { data, error } = await db("inventory_search_view")
    .select("*")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("status", "available")
    .gt("available_quantity", 0);
  if (error) throw error;

  const candidates = [...(data ?? [])].sort((left, right) => {
    if (product?.rotation_method === "fefo") {
      return (left.expiry_date ?? "9999-12-31").localeCompare(right.expiry_date ?? "9999-12-31");
    }
    return left.received_at.localeCompare(right.received_at);
  });

  const chosen: any[] = [];
  let remaining = quantity;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    chosen.push(candidate);
    remaining -= candidate.available_quantity;
  }

  return { candidates: chosen, short: remaining > 0 ? remaining : 0 };
}

export async function createPickListFlow(input: z.infer<typeof pickListSchema>) {
  const payload = pickListSchema.parse(input);
  const orderNumber = payload.order_number;

  const order = await upsertRecord("orders", {
    order_number: orderNumber,
    client_id: payload.client_id,
    warehouse_id: payload.warehouse_id,
    requested_ship_date: payload.requested_ship_date || null,
    status: "queued",
    notes: payload.notes || null,
  });

  const pickList = await upsertRecord("pick_lists", {
    pick_list_number: buildPalletCode("PKL"),
    warehouse_id: payload.warehouse_id,
    client_id: payload.client_id,
    order_id: order.id,
    consolidated: payload.lines.length > 1,
    status: "queued",
    released_at: new Date().toISOString(),
    notes: payload.notes || null,
  });

  for (const line of payload.lines) {
    const orderLine = await upsertRecord("order_lines", {
      order_id: order.id,
      product_id: line.product_id,
      quantity: line.quantity,
    });

    const selection = await selectPickCandidates(line.product_id, payload.warehouse_id, line.quantity);
    for (const candidate of selection.candidates) {
      await upsertRecord("pick_tasks", {
        task_number: buildPalletCode("PKT"),
        pick_list_id: pickList.id,
        order_line_id: orderLine.id,
        pallet_id: candidate.pallet_id,
        location_id: candidate.location_code ? undefined : null,
        requested_quantity: Math.min(candidate.available_quantity, line.quantity),
        status: selection.short > 0 ? "exception" : "queued",
        short_reason: selection.short > 0 ? `Short by ${selection.short}` : null,
      });
    }
  }

  await createLabelRecord("pick_list", pickList.id, pickList.pick_list_number);
  return pickList;
}

export async function listPickLists() {
  const { data, error } = await db("pick_lists")
    .select("*, pick_tasks(*, pallets(pallet_barcode, products(*)))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getPickExecution(pickListId: string) {
  const [pickList, pickTasks] = await Promise.all([
    db("pick_lists").select("*").eq("id", pickListId).single(),
    db("pick_tasks")
      .select("*")
      .eq("pick_list_id", pickListId)
      .order("created_at", { ascending: true }),
  ]);

  if (pickList.error) throw pickList.error;
  if (pickTasks.error) throw pickTasks.error;

  return {
    pickList: pickList.data,
    pickTasks: pickTasks.data ?? [],
  };
}

export async function confirmPickTask(taskId: string, scannedLocation: string, scannedPallet: string, confirmedQuantity: number, shortReason?: string) {
  const { data: task, error: taskError } = await db("pick_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (taskError) throw taskError;

  if (!task.pallet_id) {
    throw new Error("Task is not linked to a pallet.");
  }

  const [{ data: pallet, error: palletError }, { data: balance, error: balanceError }] = await Promise.all([
    db("pallets").select("*").eq("id", task.pallet_id).single(),
    db("inventory_balances").select("*").eq("pallet_id", task.pallet_id).single(),
  ]);

  if (palletError) throw palletError;
  if (balanceError) throw balanceError;
  if (pallet.pallet_barcode !== scannedPallet) {
    throw new Error("Scanned pallet does not match the task.");
  }

  const location = balance.location_id
    ? await db("locations").select("*").eq("id", balance.location_id).single()
    : { data: null, error: null };
  if (location.error) throw location.error;
  if (location.data && location.data.code !== scannedLocation) {
    throw new Error("Scanned location does not match the suggested pick location.");
  }

  const nextAvailable = Math.max(balance.available_quantity - confirmedQuantity, 0);
  const nextStatus: InventoryStatus = nextAvailable === 0 ? "picked" : "available";

  await Promise.all([
    db("pick_tasks")
      .update({
        confirmed_quantity: confirmedQuantity,
        short_reason: shortReason ?? null,
        status: shortReason ? "exception" : "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskId),
    db("pallets")
      .update({
        available_quantity: nextAvailable,
        status: nextStatus,
      })
      .eq("id", pallet.id),
    db("inventory_balances")
      .update({
        available_quantity: nextAvailable,
        status: nextStatus,
      })
      .eq("id", balance.id),
  ]);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "pick",
    in_entity_table: "pick_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet.id,
    in_warehouse_id: balance.warehouse_id,
    in_from_location_id: balance.location_id,
    in_metadata: {
      confirmed_quantity: confirmedQuantity,
      short_reason: shortReason ?? null,
    } as any,
  });
}

export async function createTransferFlow(input: z.infer<typeof transferSchema>) {
  const payload = transferSchema.parse(input);
  const transfer = await upsertRecord("transfers", {
    transfer_number: buildPalletCode("TRF"),
    transfer_type: payload.transfer_type,
    source_warehouse_id: payload.source_warehouse_id,
    destination_warehouse_id: payload.destination_warehouse_id,
    status: "queued",
    notes: payload.notes || null,
  });

  const { data: pallet, error: palletError } = await db("pallets").select("*").eq("id", payload.pallet_id).single();
  if (palletError) throw palletError;

  await upsertRecord("transfer_lines", {
    transfer_id: transfer.id,
    pallet_id: payload.pallet_id,
    product_id: pallet.product_id,
    client_id: pallet.client_id,
    quantity: payload.quantity,
    inventory_lot_id: pallet.inventory_lot_id,
  });

  await upsertRecord("move_tasks", {
    task_number: buildPalletCode("MOV"),
    pallet_id: payload.pallet_id,
    warehouse_id: payload.source_warehouse_id,
    transfer_id: transfer.id,
    from_location_id: pallet.current_location_id,
    status: "queued",
    reason: "Transfer dispatch",
  });

  await createLabelRecord("transfer_document", transfer.id, transfer.transfer_number);
  return transfer;
}

export async function dispatchTransfer(transferId: string, driverSignoffCode: string) {
  const { data: userData } = await supabase.auth.getUser();
  const actorId = userData.user?.id;
  if (!actorId) throw new Error("Sign in is required before dispatch.");

  const normalizedCode = driverSignoffCode.trim();
  if (!normalizedCode) throw new Error("Driver sign-off code is required before departure.");

  const { data: profile, error: profileError } = await db("profiles")
    .select("id, full_name, user_code, badge_code")
    .eq("id", actorId)
    .single();
  if (profileError) throw profileError;

  if (profile.user_code !== normalizedCode && profile.badge_code !== normalizedCode) {
    throw new Error("Driver sign-off code did not match the signed-in user.");
  }

  const { data: roleRows, error: roleError } = await db("user_roles")
    .select("roles!inner(code)")
    .eq("user_id", actorId)
    .eq("is_hidden", false);
  if (roleError) throw roleError;
  const allowedToSign = (roleRows ?? []).some((row: { roles?: { code?: string } }) =>
    ["dispatch_driver", "warehouse_manager", "admin"].includes(row.roles?.code),
  );
  if (!allowedToSign) {
    throw new Error("Only dispatch drivers, managers, or admins can sign off transfer departure.");
  }

  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;

  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    await Promise.all([
      db("pallets").update({ status: "in_transit", current_location_id: null }).eq("id", line.pallet_id),
      db("inventory_balances").update({ status: "in_transit", location_id: null, zone_id: null }).eq("pallet_id", line.pallet_id),
    ]);
  }

  const dispatchedAt = new Date().toISOString();
  await db("transfers")
    .update({
      status: "in_progress",
      dispatched_at: dispatchedAt,
      dispatch_signed_off_by: actorId,
      dispatch_signed_off_at: dispatchedAt,
      dispatch_signoff_code: normalizedCode,
    })
    .eq("id", transferId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "transfer_driver_signoff",
    in_entity_table: "transfers",
    in_entity_id: transferId,
    in_warehouse_id: transfer.source_warehouse_id,
    in_metadata: {
      transfer_number: transfer.transfer_number,
      transfer_type: transfer.transfer_type,
      signed_off_by: profile.full_name ?? actorId,
    },
  });
}

export async function receiveTransfer(transferId: string) {
  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;
  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    await Promise.all([
      db("pallets")
        .update({ current_warehouse_id: transfer.destination_warehouse_id, status: "receiving", current_location_id: null, is_stored: false })
        .eq("id", line.pallet_id),
      db("inventory_balances")
        .update({ warehouse_id: transfer.destination_warehouse_id, status: "receiving", location_id: null, zone_id: null })
        .eq("pallet_id", line.pallet_id),
      upsertRecord("putaway_tasks", {
        task_number: buildPalletCode("PTA"),
        pallet_id: line.pallet_id,
        warehouse_id: transfer.destination_warehouse_id,
        status: "queued",
      }),
    ]);
  }

  await db("transfers").update({ status: "completed", received_at: new Date().toISOString() }).eq("id", transferId);
}

export async function cancelTransfer(transferId: string, reason: string) {
  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;
  if (transfer.status === "completed") throw new Error("Cannot cancel a completed transfer.");

  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    // Return the pallet to receiving so it gets a fresh putaway task
    await Promise.all([
      db("pallets")
        .update({ status: "receiving", current_location_id: null, is_stored: false, available_quantity: 0 })
        .eq("id", line.pallet_id),
      db("inventory_balances")
        .update({ status: "receiving", location_id: null, zone_id: null, available_quantity: 0 })
        .eq("pallet_id", line.pallet_id),
    ]);
  }

  await db("transfers")
    .update({ status: "cancelled", notes: reason })
    .eq("id", transferId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "transfer_cancelled",
    in_entity_table: "transfers",
    in_entity_id: transferId,
    in_warehouse_id: transfer.source_warehouse_id,
    in_metadata: { reason, transfer_number: transfer.transfer_number },
  });
}

export async function flagCountLineException(lineId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to flag a count exception.");
  await db("cycle_count_lines")
    .update({ status: "exception", notes: reason } as any)
    .eq("id", lineId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "count_line_exception",
    in_entity_table: "cycle_count_lines",
    in_entity_id: lineId,
    in_metadata: { reason },
  });
}

export async function listTransfers() {
  const { data, error } = await db("transfers")
    .select("*, transfer_lines(*, pallets(pallet_barcode, products(*)))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCycleCountFlow(input: z.infer<typeof cycleCountSchema>) {
  const payload = cycleCountSchema.parse(input);
  const count = await upsertRecord("cycle_counts", {
    count_number: buildPalletCode("CNT"),
    warehouse_id: payload.warehouse_id,
    zone_id: payload.zone_id || null,
    location_id: payload.location_id || null,
    scope: payload.scope,
    status: "queued",
    variance_threshold_percent: payload.variance_threshold_percent,
  });

  let balanceQuery = db("inventory_balances").select("*").eq("warehouse_id", payload.warehouse_id);
  if (payload.location_id) balanceQuery = balanceQuery.eq("location_id", payload.location_id);
  if (payload.zone_id) balanceQuery = balanceQuery.eq("zone_id", payload.zone_id);
  if (payload.product_id) balanceQuery = balanceQuery.eq("product_id", payload.product_id);

  const { data: balances, error } = await balanceQuery;
  if (error) throw error;

  for (const balance of balances ?? []) {
    await upsertRecord("cycle_count_lines", {
      cycle_count_id: count.id,
      location_id: balance.location_id,
      product_id: balance.product_id,
      pallet_id: balance.pallet_id,
      expected_quantity: balance.quantity,
      counted_quantity: balance.quantity,
      variance_quantity: 0,
      variance_percent: 0,
      status: "queued",
    });
  }

  await createLabelRecord("count_sheet", count.id, count.count_number);
  return count;
}

export async function listCycleCounts() {
  const { data, error } = await db("cycle_counts")
    .select("*, cycle_count_lines(*, products(*), locations(code, aisle, bay, level))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function submitCycleCountLine(lineId: string, countedQuantity: number) {
  const { data: line, error: lineError } = await db("cycle_count_lines").select("*").eq("id", lineId).single();
  if (lineError) throw lineError;

  const varianceQuantity = countedQuantity - line.expected_quantity;
  const variancePercent = line.expected_quantity === 0 ? 0 : Math.abs((varianceQuantity / line.expected_quantity) * 100);

  await db("cycle_count_lines")
    .update({
      counted_quantity: countedQuantity,
      variance_quantity: varianceQuantity,
      variance_percent: variancePercent,
      status: varianceQuantity === 0 ? "completed" : "exception",
    })
    .eq("id", lineId);

  if (line.pallet_id) {
    await Promise.all([
      db("pallets").update({ quantity: countedQuantity, available_quantity: countedQuantity }).eq("id", line.pallet_id),
      db("inventory_balances").update({ quantity: countedQuantity, available_quantity: countedQuantity }).eq("pallet_id", line.pallet_id),
      upsertRecord("stock_adjustments", {
        adjustment_number: buildPalletCode("ADJ"),
        pallet_id: line.pallet_id,
        adjustment_type: "cycle_count",
        quantity_delta: varianceQuantity,
        reason: `Cycle count variance ${varianceQuantity}`,
      }),
    ]);
  }
}

export async function listStatusPallets() {
  const { data, error } = await db("inventory_search_view")
    .select("*")
    .in("status", ["hold", "quarantine", "damaged", "missing"])
    .order("received_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function changePalletStatus(input: z.infer<typeof statusChangeSchema>) {
  const payload = statusChangeSchema.parse(input);
  const palletId = await resolvePalletId(payload.pallet_id);
  const { data: balance, error: balanceError } = await db("inventory_balances").select("*").eq("pallet_id", palletId).single();
  if (balanceError) throw balanceError;

  await Promise.all([
    db("pallets").update({ status: payload.new_status }).eq("id", palletId),
    db("inventory_balances").update({ status: payload.new_status }).eq("id", balance.id),
    upsertRecord("stock_adjustments", {
      adjustment_number: buildPalletCode("STS"),
      pallet_id: palletId,
      inventory_balance_id: balance.id,
      adjustment_type: "status_change",
      quantity_delta: 0,
      old_status: balance.status,
      new_status: payload.new_status,
      reason: payload.reason,
    }),
  ]);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "status_change",
    in_entity_table: "pallets",
    in_entity_id: palletId,
    in_pallet_id: palletId,
    in_warehouse_id: balance.warehouse_id,
    in_metadata: {
      old_status: balance.status,
      new_status: payload.new_status,
      reason: payload.reason,
    } as any,
  });
}

async function resolvePalletId(palletInput: string) {
  const normalized = palletInput.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized;
  }

  const { data, error } = await db("pallets")
    .select("id")
    .or(`pallet_code.eq.${normalized},pallet_barcode.eq.${normalized}`)
    .single();
  if (error) throw new Error("Pallet barcode was not found.");
  return data.id as string;
}

export async function getDashboardMetrics() {
  const [balances, receipts, putawayTasks, pickLists] = await Promise.all([
    db("inventory_balances").select("*"),
    db("receipts").select("*").in("status", ["draft", "queued", "assigned", "in_progress"]),
    db("putaway_tasks").select("*").in("status", ["queued", "assigned", "in_progress", "exception"]),
    db("pick_lists").select("*").in("status", ["draft", "queued", "assigned", "in_progress", "exception"]),
  ]);

  if (balances.error) throw balances.error;
  if (receipts.error) throw receipts.error;
  if (putawayTasks.error) throw putawayTasks.error;
  if (pickLists.error) throw pickLists.error;

  const balanceRows = balances.data ?? [];
  const coolRows = balanceRows.filter((row: any) => row.zone_id);

  return {
    totalPallets: balanceRows.length,
    availablePallets: balanceRows.filter((row: any) => row.status === "available").length,
    coolZoneOccupancy: coolRows.length,
    openReceipts: receipts.data?.length ?? 0,
    openPutawayTasks: putawayTasks.data?.length ?? 0,
    openPickLists: pickLists.data?.length ?? 0,
    holdStock: balanceRows.filter((row: any) => row.status === "hold").length,
    quarantineStock: balanceRows.filter((row: any) => row.status === "quarantine").length,
  } satisfies DashboardMetrics;
}

export async function getReportData() {
  const [balances, occupancy, audits, clients, warehouses, cycleCounts] = await Promise.all([
    db("inventory_search_view").select("*"),
    db("location_occupancy_view").select("*"),
    db("audit_events").select("*").order("created_at", { ascending: false }).limit(12),
    db("clients").select("*"),
    db("warehouses").select("*"),
    db("cycle_count_lines").select("*").order("updated_at", { ascending: false }).limit(12),
  ]);

  if (balances.error) throw balances.error;
  if (occupancy.error) throw occupancy.error;
  if (audits.error) throw audits.error;
  if (clients.error) throw clients.error;
  if (warehouses.error) throw warehouses.error;
  if (cycleCounts.error) throw cycleCounts.error;

  return {
    inventory: balances.data ?? [],
    occupancy: occupancy.data ?? [],
    audits: audits.data ?? [],
    clients: clients.data ?? [],
    warehouses: warehouses.data ?? [],
    cycleCounts: cycleCounts.data ?? [],
  };
}

export async function importCsvToResource(resource: ResourceDefinition, file: File) {
  const text = await file.text();
  const rows = parseCsv(text);
  const errors: Array<Record<string, string | number>> = [];

  for (const [index, row] of rows.entries()) {
    const missingFields = resource.fields
      .filter((field) => field.required && !row[field.name])
      .map((field) => field.name);

    if (missingFields.length > 0) {
      errors.push({ row: index + 2, error: `Missing: ${missingFields.join(", ")}` });
      continue;
    }

    try {
      await db(resource.table).upsert(row as never);
    } catch (error) {
      errors.push({ row: index + 2, error: error instanceof Error ? error.message : "Import failed" });
    }
  }

  await supabase.storage.from("imports").upload(`${resource.table}/${Date.now()}-${file.name}`, file, {
    cacheControl: "3600",
    upsert: true,
  });

  return errors;
}
