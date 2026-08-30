import { supabase } from "@/integrations/supabase/client";
import {
  db,
  formatSupabaseError,
  parseCsv,
  type ResourceDefinition,
} from "@/features/shared/core-types";
import { writeSystemLog } from "@/features/system/system-core";
import { displayRackLocationCode } from "@/features/setup/setup-core";

export async function getReportData({ warehouseId }: { warehouseId?: string | null } = {}) {
  const withinWarehouse = <T extends { eq: (column: string, value: string) => T }>(query: T, column = "warehouse_id") =>
    warehouseId ? query.eq(column, warehouseId) : query;
  const [balances, occupancy, audits, clients, warehouses, cycleCounts, stagingLoads, dockAppointments, printerStations, labelTemplates, printJobs, replenishments, aiRecommendations] = await Promise.all([
    withinWarehouse(db("inventory_search_view").select("*")),
    withinWarehouse(db("location_occupancy_view").select("*")),
    withinWarehouse(db("audit_events").select("*").order("created_at", { ascending: false }).limit(12)),
    db("clients").select("*"),
    db("warehouses").select("*"),
    warehouseId
      ? db("cycle_count_lines").select("*, cycle_counts!inner(warehouse_id)").eq("cycle_counts.warehouse_id", warehouseId).order("updated_at", { ascending: false }).limit(12)
      : db("cycle_count_lines").select("*").order("updated_at", { ascending: false }).limit(12),
    warehouseId
      ? db("staging_loads").select("*, pick_lists!inner(pick_list_number, warehouse_id, clients(code, name))").eq("pick_lists.warehouse_id", warehouseId).order("created_at", { ascending: false })
      : db("staging_loads").select("*, pick_lists(pick_list_number, warehouse_id, clients(code, name))").order("created_at", { ascending: false }),
    withinWarehouse(db("dock_appointments").select("*").order("scheduled_at", { ascending: true })),
    withinWarehouse(db("printer_stations").select("*")),
    db("label_templates").select("*"),
    warehouseId
      ? db("print_jobs").select("*, printer_stations!inner(warehouse_id)").eq("printer_stations.warehouse_id", warehouseId).order("created_at", { ascending: false }).limit(20)
      : db("print_jobs").select("*").order("created_at", { ascending: false }).limit(20),
    withinWarehouse(db("replenishment_tasks").select("*").order("created_at", { ascending: false }).limit(20)),
    warehouseId
      ? Promise.resolve({ data: [], error: null })
      : db("ai_recommendations").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(10),
  ]);

  if (balances.error) throw balances.error;
  if (occupancy.error) throw occupancy.error;
  if (audits.error) throw audits.error;
  if (clients.error) throw clients.error;
  if (warehouses.error) throw warehouses.error;
  if (cycleCounts.error) throw cycleCounts.error;
  if (stagingLoads.error) throw stagingLoads.error;
  if (dockAppointments.error) throw dockAppointments.error;
  if (printerStations.error) throw printerStations.error;
  if (labelTemplates.error) throw labelTemplates.error;
  if (printJobs.error) throw printJobs.error;
  if (replenishments.error) throw replenishments.error;
  if (aiRecommendations.error) throw aiRecommendations.error;

  return {
    inventory: (balances.data ?? []).map((row: any) => ({
      ...row,
      location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
    })),
    occupancy: (occupancy.data ?? []).map((row: any) => ({
      ...row,
      location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
    })),
    audits: audits.data ?? [],
    clients: clients.data ?? [],
    warehouses: warehouses.data ?? [],
    cycleCounts: cycleCounts.data ?? [],
    stagingLoads: stagingLoads.data ?? [],
    dockAppointments: dockAppointments.data ?? [],
    printerStations: printerStations.data ?? [],
    labelTemplates: labelTemplates.data ?? [],
    printJobs: printJobs.data ?? [],
    replenishments: replenishments.data ?? [],
    reorderAlerts: await getActiveReorderAlerts(warehouseId),
    aiRecommendations: aiRecommendations.data ?? [],
  };
}

async function getActiveReorderAlerts(warehouseId?: string | null) {
  const query = db("reorder_alerts")
    .select("id, warehouse_id, available_quantity, reorder_point, recommended_quantity, products(sku, name)")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  const { data, error } = warehouseId ? await query.eq("warehouse_id", warehouseId) : await query;
  if (error) throw error;
  return data ?? [];
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

// ─────────────────────────────────────────────────────────────────────────────
// CSV Import (preview + commit)
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIP_FIELDS = new Set(["id", "created_at", "updated_at"]);
const PRODUCT_DEFERRED_FIELDS = new Set(["client_owner_id"]);

// ─── Product Auto-Categoriser ────────────────────────────────────────────────

export type ProductCategory = {
  label: string;                     // human-readable e.g. "Food — Flour / Grain"
  temperature_requirement: string;   // "ambient" | "cool" | "frozen"
  rotation_method: string;           // "fifo" | "fefo"
  expiry_tracked: boolean;
  lot_tracked: boolean;
  batch_tracked: boolean;
};

type CategoryRule = {
  label: string;
  keywords: RegExp;
  category: Omit<ProductCategory, "label">;
};

const CATEGORY_RULES: CategoryRule[] = [
  // ── Frozen ──────────────────────────────────────────────────────────────
  {
    label: "Food — Frozen",
    keywords: /\bfrozen?\b|ice\s*cream|gelato|sorbet|freezer/i,
    category: { temperature_requirement: "frozen", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: false },
  },
  // ── Meat / Seafood / Poultry (cool) ─────────────────────────────────────
  {
    label: "Food — Meat / Seafood",
    keywords: /\b(beef|pork|chicken|poultry|lamb|veal|turkey|fish|salmon|tuna|shrimp|prawn|seafood|crab|lobster|scallop|clam|mussel|oyster|meat)\b/i,
    category: { temperature_requirement: "cool", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: true },
  },
  // ── Dairy ────────────────────────────────────────────────────────────────
  {
    label: "Food — Dairy",
    keywords: /\b(milk|cheese|butter|cream|yogh?urt|dairy|whey|lactose|mozzarella|cheddar|brie|gouda)\b/i,
    category: { temperature_requirement: "cool", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: false },
  },
  // ── Deli / Prepared / Chilled ────────────────────────────────────────────
  {
    label: "Food — Deli / Prepared",
    keywords: /\b(deli|sandwich|prepared\s+meal|ready[\s-]to[\s-]eat|rte|cooked|smoked|cured|pate|terrine|hummus)\b/i,
    category: { temperature_requirement: "cool", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: true },
  },
  // ── Produce (fresh fruit & veg) ──────────────────────────────────────────
  {
    label: "Food — Fresh Produce",
    keywords: /\b(fruit|vegetable|veg|lettuce|tomato|potato|onion|carrot|apple|banana|grape|citrus|berry|berries|spinach|kale|cabbage|broccoli|cauliflower|celery|cucumber|pepper|zucchini|avocado|mushroom)\b/i,
    category: { temperature_requirement: "cool", rotation_method: "fefo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  // ── Flour / Grain / Bakery dry ───────────────────────────────────────────
  {
    label: "Food — Flour / Grain",
    keywords: /\b(flour|wheat|grain|semolina|bran|oat|barley|rye|corn\s*meal|cornmeal|bread\s*mix|baking\s*mix|gluten)\b/i,
    category: { temperature_requirement: "cool", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: false },
  },
  // ── Pasta / Noodles ──────────────────────────────────────────────────────
  {
    label: "Food — Pasta / Noodles",
    keywords: /\b(pasta|noodle|spaghetti|penne|fettuccine|linguine|tagliatelle|lasagna|vermicelli|ramen|udon|soba|instant\s*noodle)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: false },
  },
  // ── Canned / Preserved Food ──────────────────────────────────────────────
  {
    label: "Food — Canned / Preserved",
    keywords: /\b(canned|tinned|jarred|preserved|pickle|relish|chutney|jam|jelly|marmalade|conserve|compote)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  // ── Dry Grocery / Shelf-stable ───────────────────────────────────────────
  {
    label: "Food — Dry Grocery",
    keywords: /\b(sugar|salt|spice|seasoning|sauce|ketchup|mustard|vinegar|oil|syrup|honey|chocolate|cocoa|coffee|tea|cereal|cracker|biscuit|cookie|snack|chip|crisp|nuts?|seed|dried\s*fruit|rice|lentil|bean|legume)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  // ── Beverages ────────────────────────────────────────────────────────────
  {
    label: "Food — Beverage",
    keywords: /\b(beverage|drink|juice|water|soda|cola|beer|wine|spirit|liquor|whisky|vodka|gin|rum|energy\s*drink|smoothie|kombucha)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  // ── Medical / Pharma / Gloves ────────────────────────────────────────────
  {
    label: "Medical / PPE",
    keywords: /\b(glove|nitrile|latex|vinyl|exam\s*glove|surgical|mask|ppe|medical|pharmaceutical|pharma|drug|medication|bandage|dressing)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fefo", expiry_tracked: true, lot_tracked: true, batch_tracked: true },
  },
  // ── Cleaning / Chemical ──────────────────────────────────────────────────
  {
    label: "Cleaning / Chemical",
    keywords: /\b(disinfectant|cleaner|detergent|sanitizer|bleach|degreaser|dishwash|laundry|soap|chemical|solvent|acid|alkali)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: true, lot_tracked: false, batch_tracked: false },
  },
  // ── Paper / Disposable / Packaging ──────────────────────────────────────
  {
    label: "Paper / Disposables",
    keywords: /\b(tissue|toilet\s*paper|paper\s*towel|napkin|tissue|bathroom\s*tissue|roll\s*towel|pan\s*liner|parchment|wrap|film|bag|cup|plate|container|tray|box|carton|packaging|disposable|cutlery|straw)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false },
  },
  // ── Sponge / Cleaning Pad ────────────────────────────────────────────────
  {
    label: "Household / Cleaning Supplies",
    keywords: /\b(sponge|scouring|cloth|wipe|mop|broom|brush|scrub|pad)\b/i,
    category: { temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false },
  },
];

/**
 * Infer product category fields from the product name and/or description.
 * Returns null if no rule matches (caller should fall back to defaults).
 */
export function inferProductCategory(name: string, description?: string): (ProductCategory) | null {
  const haystack = `${name} ${description ?? ""}`.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.test(haystack)) {
      return { label: rule.label, ...rule.category };
    }
  }
  return null;
}

export type ImportRowPreview = {
  rowNumber: number;
  raw: Record<string, string>;
  normalized: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
  inferred?: ProductCategory | null;   // populated for product rows that used auto-categorisation
};

export type ImportPreview = {
  resourceTable: string;
  headers: string[];
  rows: ImportRowPreview[];
  summary: { total: number; valid: number; invalid: number };
  file: File;
};

function parseCsvRobust(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some((v) => v !== "")) records.push(cur);
        cur = [];
      } else { field += c; }
    }
  }
  if (field !== "" || cur.length > 0) { cur.push(field); if (cur.some((v) => v !== "")) records.push(cur); }
  if (records.length === 0) return { headers: [], rows: [] };
  const headers = records[0].map((h) => h.trim());
  const rows = records.slice(1).map((vals) => {
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = (vals[i] ?? "").trim(); });
    return o;
  });
  return { headers, rows };
}

function coerceBoolean(v: string): boolean | null {
  const s = v.trim().toLowerCase();
  if (s === "") return null;
  if (["true", "1", "yes", "y", "t"].includes(s)) return true;
  if (["false", "0", "no", "n", "f"].includes(s)) return false;
  return null;
}

export async function parseCsvForResource(resource: ResourceDefinition, file: File): Promise<ImportPreview> {
  const text = await file.text();
  const { headers, rows } = parseCsvRobust(text);

  // Build field lookup for normalization
  const fieldByName = new Map(resource.fields.map((f) => [f.name, f]));

  // For products: preload clients to resolve client_owner_id by code/name
  let clientLookup: Map<string, string> | null = null;
  if (resource.table === "products") {
    const { data } = await db("clients").select("id, code, name");
    clientLookup = new Map();
    (data ?? []).forEach((c: any) => {
      if (c.code) clientLookup!.set(`code:${String(c.code).toLowerCase()}`, c.id);
      if (c.name) clientLookup!.set(`name:${String(c.name).toLowerCase()}`, c.id);
      clientLookup!.set(`id:${c.id}`, c.id);
    });
  }

  // For products: preload existing SKUs to flag duplicates
  let existingSkus: Set<string> | null = null;
  if (resource.table === "products") {
    const { data } = await db("products").select("sku");
    existingSkus = new Set((data ?? []).map((r: any) => String(r.sku).toLowerCase()));
  }
  const seenInFile = new Set<string>();

  // Fields that can be auto-inferred for products — not hard errors if missing
  const PRODUCT_INFERRED_FIELDS = new Set(["temperature_requirement", "rotation_method", "expiry_tracked", "lot_tracked", "batch_tracked"]);

  const preview: ImportRowPreview[] = rows.map((raw, idx) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const normalized: Record<string, unknown> = {};
    let inferred: ProductCategory | null = null;

    // Skip template metadata rows (label row "required/optional" pattern, all "required"/"optional" tokens)
    const allValues = Object.values(raw);
    if (allValues.length > 0 && allValues.every((v) => v === "required" || v === "optional" || v === "")) {
      return { rowNumber: idx + 2, raw, normalized: null, errors: ["Skipped template marker row"], warnings: [] };
    }

    for (const [key, valueRaw] of Object.entries(raw)) {
      if (STRIP_FIELDS.has(key)) continue; // ignore server-managed fields
      const field = fieldByName.get(key);
      if (!field) {
        warnings.push(`Unknown column "${key}" (ignored)`);
        continue;
      }
      const value = valueRaw;
      if (value === "" || value == null) {
        if (resource.table === "products" && PRODUCT_DEFERRED_FIELDS.has(field.name)) {
          normalized[key] = null;
          warnings.push(`${field.name}: left blank — assign after import`);
          continue;
        }
        // For inferred product fields, skip here — we'll fill them from categoriser below
        if (field.required && !PRODUCT_INFERRED_FIELDS.has(field.name)) {
          errors.push(`Missing required: ${field.name}`);
        }
        continue;
      }
      if (field.type === "boolean") {
        const b = coerceBoolean(value);
        if (b == null) { errors.push(`${field.name}: invalid boolean "${value}"`); continue; }
        normalized[key] = b;
      } else if (field.type === "number") {
        const n = Number(value);
        if (!Number.isFinite(n)) { errors.push(`${field.name}: invalid number "${value}"`); continue; }
        normalized[key] = n;
      } else if (field.type === "select" && field.options?.length) {
        const match = field.options.find((o) => o.value.toLowerCase() === value.toLowerCase());
        if (!match) {
          errors.push(`${field.name}: "${value}" not one of ${field.options.map((o) => o.value).join("/")}`);
          continue;
        }
        normalized[key] = match.value;
      } else if (key.endsWith("_id")) {
        // FK resolution
        if (UUID_RE.test(value)) {
          if (key === "client_owner_id" && clientLookup && !clientLookup.has(`id:${value}`)) {
            warnings.push(`client_owner_id: UUID ${value} not found — left blank, assign after import`);
            normalized[key] = null;
            continue;
          }
          normalized[key] = value;
        } else if (key === "client_owner_id" && clientLookup) {
          const resolved = clientLookup.get(`code:${value.toLowerCase()}`) ?? clientLookup.get(`name:${value.toLowerCase()}`);
          if (!resolved) {
            warnings.push(`client_owner_id: "${value}" not found — left blank, assign after import`);
            normalized[key] = null;
            continue;
          }
          normalized[key] = resolved;
        } else {
          errors.push(`${key}: expected UUID, got "${value}"`);
          continue;
        }
      } else {
        normalized[key] = value;
      }
    }

    // ── Products: auto-categorise + sku/barcode cross-fill ─────────────────
    if (resource.table === "products") {
      // SKU ↔ barcode cross-fill
      const hasSku = normalized.sku && String(normalized.sku).trim() !== "";
      const hasBarcode = normalized.barcode && String(normalized.barcode).trim() !== "";
      if (!hasSku && hasBarcode) {
        normalized.sku = normalized.barcode;
        warnings.push("SKU was blank — set to barcode value");
      } else if (hasSku && !hasBarcode) {
        normalized.barcode = normalized.sku;
        warnings.push("Barcode was blank — set to SKU value");
      } else if (!hasSku && !hasBarcode) {
        errors.push("At least one of SKU or barcode is required");
      }

      // Auto-infer category fields from name/description when blank
      const nameVal = String(raw.name ?? raw.description ?? "");
      const descVal = String(raw.description ?? "");
      if (nameVal) {
        inferred = inferProductCategory(nameVal, descVal);
        if (inferred) {
          const inferredFields: Array<[string, unknown]> = [
            ["temperature_requirement", inferred.temperature_requirement],
            ["rotation_method", inferred.rotation_method],
            ["expiry_tracked", inferred.expiry_tracked],
            ["lot_tracked", inferred.lot_tracked],
            ["batch_tracked", inferred.batch_tracked],
          ];
          for (const [k, v] of inferredFields) {
            if (!(k in normalized) || normalized[k] === "" || normalized[k] == null) {
              normalized[k] = v;
            }
          }
          warnings.push(`Auto-categorised as "${inferred.label}" — review inferred fields`);
        } else {
          // No rule matched — apply safe defaults
          if (!("temperature_requirement" in normalized)) normalized.temperature_requirement = "ambient";
          if (!("rotation_method" in normalized)) normalized.rotation_method = "fifo";
          if (!("expiry_tracked" in normalized)) normalized.expiry_tracked = false;
          if (!("lot_tracked" in normalized)) normalized.lot_tracked = false;
          if (!("batch_tracked" in normalized)) normalized.batch_tracked = false;
          warnings.push("No category matched — defaulted to ambient/FIFO. Review before confirming.");
        }
      }

      // Products always import as active unless the CSV explicitly says false
      if (!("active" in normalized) || normalized.active == null) {
        normalized.active = true;
      }
    }

    // Required field check for columns missing entirely.
    // Skip nullable-in-DB FKs (e.g. client_owner_id) and inferred product fields.
    const skipRequired = new Set(["client_owner_id", ...PRODUCT_INFERRED_FIELDS]);
    for (const f of resource.fields) {
      if (skipRequired.has(f.name)) continue;
      if (f.required && !(f.name in normalized) && !errors.some((e) => e.includes(f.name))) {
        errors.push(`Missing required: ${f.name}`);
      }
    }

    // Products: dedupe by SKU (insert-only)
    if (resource.table === "products" && normalized.sku) {
      const sku = String(normalized.sku).toLowerCase();
      if (seenInFile.has(sku)) errors.push(`Duplicate SKU "${normalized.sku}" within file`);
      else seenInFile.add(sku);
      if (existingSkus?.has(sku)) errors.push(`SKU "${normalized.sku}" already exists`);
    }

    return {
      rowNumber: idx + 2,
      raw,
      normalized: errors.length === 0 ? normalized : null,
      errors,
      warnings,
      inferred,
    };
  });

  const valid = preview.filter((r) => r.normalized).length;
  return {
    resourceTable: resource.table,
    headers,
    rows: preview,
    summary: { total: preview.length, valid, invalid: preview.length - valid },
    file,
  };
}

export async function commitImportRows(
  resource: ResourceDefinition,
  preview: ImportPreview,
): Promise<{ inserted: number; failed: number; errors: Array<{ row: number; error: string }> }> {
  const errors: Array<{ row: number; error: string }> = [];
  let inserted = 0;
  for (const row of preview.rows) {
    if (!row.normalized) continue;
    const { error } = await db(resource.table).insert(row.normalized as never).select();
    if (error) {
      errors.push({ row: row.rowNumber, error: formatSupabaseError(error, "Insert failed") });
    } else {
      inserted++;
    }
  }
  // Best-effort archive of the original file
  try {
    await supabase.storage.from("imports").upload(
      `${resource.table}/${Date.now()}-${preview.file.name}`,
      preview.file,
      { cacheControl: "3600", upsert: true },
    );
  } catch { /* ignore */ }
  return { inserted, failed: errors.length, errors };
}

export async function snapshotRecordCounts() {
  const tables = [
    "warehouses", "zones", "locations", "clients", "products",
    "pallets", "inventory_balances", "receipts", "putaway_tasks",
    "pick_lists", "transfers", "cycle_counts", "audit_events",
  ];

  const counts = await Promise.all(
    tables.map(async (table) => {
      const { count, error } = await db(table).select("*", { count: "exact", head: true });
      return { table, count: error ? null : (count ?? 0) };
    }),
  );

  await Promise.all(
    counts.map(({ table, count }) =>
      count !== null
        ? writeSystemLog({
            log_type: "record_count",
            severity: "info",
            title: `Record count snapshot: ${table}`,
            message: `${table} had ${count} record${count === 1 ? "" : "s"} at snapshot time.`,
            table_name: table,
            record_count: count,
            source: "snapshot",
          })
        : Promise.resolve(),
    ),
  );

  return counts;
}
