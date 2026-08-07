import { supabase } from "@/integrations/supabase/client";
import {
  db,
  getStoredPalletCounts,
  getStoredPalletCount,
  isRetiredInventoryStatus,
  hasVisibleInventoryQuantity,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  fetchAllRows,
  type InventoryAgeBucket,
  type InventoryExpiryWindow,
  type InventoryStatus,
} from "@/features/shared/core-types";
import {
  buildBayOccupancyGrid,
  getBayCellLevel,
  getBayCellPosition,
  displayRackLocationCode,
  normalizeRackLocationCode,
  bayCodeFromLocationCode,
  type BayOccupancyCell,
  type BayOccupancyGridSlot,
} from "@/features/setup/setup-core";

export async function searchInventory(filters: {
  search?: string;
  warehouseId?: string;
  status?: InventoryStatus | "all";
  ageBucket?: InventoryAgeBucket | "";
  expiryWindow?: InventoryExpiryWindow | "";
  limit?: number;
}) {
  if (filters.status && filters.status !== "all" && isRetiredInventoryStatus(filters.status)) return [];
  let query = db("inventory_search_view").select("*");

  if (filters.warehouseId) {
    query = query.eq("warehouse_id", filters.warehouseId);
  }

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.ageBucket) {
    const minimumDays = filters.ageBucket === "12m" ? 365 : filters.ageBucket === "6m" ? 180 : 90;
    query = query.lte("received_at", new Date(Date.now() - minimumDays * 24 * 60 * 60 * 1000).toISOString());
  }
  if (filters.expiryWindow) {
    const maximumDays = filters.expiryWindow === "30d" ? 30 : 60;
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() + maximumDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    query = query.gte("expiry_date", today).lte("expiry_date", cutoff);
  }

  const loadAll = Boolean(filters.search?.trim());
  let rawRows: any[];
  if (loadAll) {
    rawRows = await fetchAllRows<any>((from, to) => query.order("received_at", { ascending: false }).range(from, to));
  } else {
    const { data, error } = await query.order("received_at", { ascending: false }).limit(Math.max(1, filters.limit ?? 50));
    if (error) throw error;
    rawRows = data ?? [];
  }
  let rows = rawRows
    .filter((row) => !isRetiredInventoryStatus(row.status) && hasVisibleInventoryQuantity(row))
    .map((row) => ({
      ...row,
      location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
    }));
  const searchTokens = (filters.search ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (searchTokens.length > 0) {
    rows = rows.filter((row) => {
      const haystack = [
        row.sku,
        row.product_name,
        row.product_barcode,
        row.pallet_code,
        row.pallet_barcode,
        row.container_number,
        row.po_number,
        row.lot_number,
        row.batch_number,
        row.expiry_date,
        row.client_name,
        row.owner_name,
        row.warehouse_code,
        row.warehouse_name,
        row.zone_code,
        row.location_code,
        row.status,
      ]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ");

      return searchTokens.every((token) => haystack.includes(token));
    });
  }
  return rows;
}

export async function getInventoryDetail(balanceId: string) {
  const { data: balance, error: balanceError } = await db("inventory_balances")
    .select("*")
    .eq("id", balanceId)
    .single();
  if (balanceError) throw balanceError;

  const { data: pallet, error: palletError } = await db("pallets").select("*").eq("id", balance.pallet_id).single();
  if (palletError) throw palletError;

  const [{ data: audit }, { data: lot }, { data: product }, { data: client }, { data: warehouse }, { data: location }, { data: receiptLine }] = await Promise.all([
    db("audit_events").select("*").eq("pallet_id", balance.pallet_id).order("created_at", { ascending: false }),
    balance.inventory_lot_id
      ? db("inventory_lots").select("*").eq("id", balance.inventory_lot_id).single()
      : Promise.resolve({ data: null, error: null }),
    db("products").select("*").eq("id", balance.product_id).maybeSingle(),
    balance.client_id
      ? db("clients").select("*").eq("id", balance.client_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db("warehouses").select("*").eq("id", balance.warehouse_id).maybeSingle(),
    balance.location_id
      ? db("locations").select("*").eq("id", balance.location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    pallet.receipt_line_id
      ? db("receipt_lines").select("*, receipts(*)").eq("id", pallet.receipt_line_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const packagingId = (receiptLine as any)?.packaging_profile_id ?? pallet.packaging_profile_id ?? null;
  const { data: packaging } = packagingId
    ? await db("product_packaging_profiles").select("*").eq("id", packagingId).maybeSingle()
    : { data: null };

  return {
    balance,
    pallet,
    lot: lot ?? null,
    product: product ?? null,
    client: client ?? null,
    warehouse: warehouse ?? null,
    location: location ? { ...location, code: displayRackLocationCode((location as any).code) } : null,
    receiptLine: receiptLine ?? null,
    receipt: (receiptLine as any)?.receipts ?? null,
    packaging: packaging ?? null,
    audit: audit ?? [],
  };
}

export async function getBinOccupancy(locationCode: string): Promise<{
  locationId: string;
  locationCode: string;
  maxPallets: number;
  occupiedPallets: number;
  status: string;
} | null> {
  const { data: location, error } = await db("locations")
    .select("id, code, max_pallets, status")
    .eq("code", normalizeRackLocationCode(locationCode))
    .maybeSingle();
  if (error || !location) return null;

  const occupiedPallets = await getStoredPalletCount(location.id);

  return {
    locationId: location.id,
    locationCode: displayRackLocationCode(location.code),
    maxPallets: location.max_pallets ?? 0,
    occupiedPallets,
    status: location.status ?? "active",
  };
}

export async function getBayOccupancy(locationCode: string): Promise<{
  anchorCode: string;
  aisle: string | null;
  bay: string | null;
  cells: BayOccupancyCell[];
} | null> {
  const rawCode = locationCode.trim();
  const normalizedCode = rawCode.toUpperCase().startsWith("BAY:") ? rawCode : normalizeRackLocationCode(rawCode);
  let anchor: any = null;
  const bayParts = normalizedCode.match(/^BAY:([^:]+):([^:]+):([^:]+):([^:]+)$/i);
  const bayCodePrefix = bayParts ? `${bayParts[1]}-${bayParts[2]}-${bayParts[3]}-${bayParts[4]}-` : "";

  if (bayParts) {
    const [, warehouseCode, zoneCode, aisle, bay] = bayParts;
    const { data: warehouse, error: warehouseError } = await db("warehouses")
      .select("id")
      .eq("code", warehouseCode.toUpperCase())
      .maybeSingle();
    if (warehouseError) throw warehouseError;

    let zone: any = null;
    if (warehouse) {
      const zoneResult = await db("zones")
        .select("id")
        .eq("warehouse_id", warehouse.id)
        .eq("code", zoneCode.toUpperCase())
        .maybeSingle();
      if (zoneResult.error) throw zoneResult.error;
      zone = zoneResult.data;
    }

    anchor = {
      code: normalizedCode,
      warehouse_id: warehouse?.id ?? null,
      zone_id: zone?.id ?? null,
      aisle,
      bay,
    };
  } else {
    const { data, error } = await db("locations")
      .select("id, code, warehouse_id, zone_id, aisle, bay")
      .eq("code", normalizedCode.toUpperCase())
      .maybeSingle();
    if (error) throw error;
    if (data) {
      anchor = data;
    } else {
      // Detect WH-ZONE-AISLE-BAY dash format (4 parts; third is not a level indicator,
      // fourth is not a position indicator — distinguishes bay codes from location codes
      // like "A-05-L02-P1" which have L\d+ at [-2] and P\d+ at [-1]).
      const dashParts = normalizedCode.split("-").filter(Boolean);
      const isBayDashCode =
        dashParts.length === 4 &&
        !/^L\d+$/i.test(dashParts[2]) &&
        !/^P\d+$/i.test(dashParts[3]);
      if (isBayDashCode) {
        const [whCode, zoneCode, aisle, bay] = dashParts;
        const { data: warehouse, error: warehouseError } = await db("warehouses")
          .select("id")
          .eq("code", whCode)
          .maybeSingle();
        if (warehouseError) throw warehouseError;
        let zone: any = null;
        if (warehouse) {
          const zoneResult = await db("zones")
            .select("id")
            .eq("warehouse_id", warehouse.id)
            .eq("code", zoneCode)
            .maybeSingle();
          if (zoneResult.error) throw zoneResult.error;
          zone = zoneResult.data;
        }
        anchor = {
          code: normalizedCode,
          warehouse_id: warehouse?.id ?? null,
          zone_id: zone?.id ?? null,
          aisle,
          bay,
        };
      } else {
        const prefixCandidates = [
          normalizedCode.endsWith("-") ? normalizedCode : `${normalizedCode}-`,
          normalizedCode,
        ];
        for (const prefix of prefixCandidates) {
          const prefixResult = await db("locations")
            .select("id, code, warehouse_id, zone_id, aisle, bay")
            .eq("location_type", "rack")
            .ilike("code", `${prefix}%`)
            .order("level", { ascending: false })
            .order("position", { ascending: true })
            .order("code", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (prefixResult.error) throw prefixResult.error;
          if (prefixResult.data) {
            anchor = { ...prefixResult.data, code: normalizedCode };
            break;
          }
        }
        if (!anchor) return null;
      }
    }
  }

  let locations: any[] = [];
  if (anchor.warehouse_id && anchor.zone_id) {
    // Page through with .range() — a whole-zone select can exceed PostgREST's
    // default 1000-row cap on larger warehouses, which was silently dropping
    // bins from the bay grid and the "Browse bays" picker in putaway.
    locations = await fetchAllRows((from, to) => {
      let query = db("locations")
        .select("id, code, aisle, bay, level, position, depth, max_pallets, status, location_type, zone_sort_order:zones(sort_order), zone_name:zones(name), zone_code:zones(code)")
        .eq("warehouse_id", anchor.warehouse_id)
        .eq("zone_id", anchor.zone_id)
        .eq("location_type", "rack");
      if (anchor.aisle) query = query.eq("aisle", anchor.aisle);
      if (anchor.bay) query = query.eq("bay", anchor.bay);
      return query
        .order("level", { ascending: false })
        .order("position", { ascending: true })
        .order("code", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    });
  }

  if ((locations ?? []).length === 0 && bayCodePrefix) {
    locations = await fetchAllRows((from, to) =>
      db("locations")
        .select("id, code, aisle, bay, level, position, depth, max_pallets, status, location_type, zone_sort_order:zones(sort_order), zone_name:zones(name), zone_code:zones(code)")
        .eq("location_type", "rack")
        .ilike("code", `${bayCodePrefix}%`)
        .order("level", { ascending: false })
        .order("position", { ascending: true })
        .order("code", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  }

  const storedPalletCounts = await getStoredPalletCounts((locations ?? []).map((location: any) => location.id));
  const cells = (locations ?? []).map((location: any) => {
    const occupiedPallets = storedPalletCounts.get(location.id) ?? 0;
    const maxPallets = Number(location.max_pallets ?? 0);
    return {
      locationId: location.id,
      locationCode: displayRackLocationCode(location.code),
      level: location.level ?? null,
      position: location.position ?? null,
      depth: location.depth ?? null,
      maxPallets,
      occupiedPallets,
      status: location.status ?? "active",
      isFull: maxPallets > 0 && occupiedPallets >= maxPallets,
    };
  });

  return {
    anchorCode: displayRackLocationCode(anchor.code),
    aisle: anchor.aisle ?? null,
    bay: anchor.bay ?? null,
    cells,
  };
}

export type WarehouseBayGroup = {
  aisle: string;
  bay: string;
  bayCode: string;
  totalCapacity: number;
  totalOccupied: number;
  cells: BayOccupancyCell[];
  zoneName: string;
  zoneCode: string;
};

export async function getWarehouseBayOccupancy(warehouseId: string): Promise<WarehouseBayGroup[]> {
  // Page through with .range() — an unbounded select truncates to PostgREST's
  // default 1000-row cap, which is exactly what made the putaway bay
  // selectors miss bays/locations past the first page on larger warehouses.
  const locations = await fetchAllRows((from, to) =>
    db("locations")
      .select("id, code, aisle, bay, level, position, depth, max_pallets, status, location_type, zone_sort_order:zones(sort_order), zone_name:zones(name), zone_code:zones(code)")
      .eq("warehouse_id", warehouseId)
      .eq("location_type", "rack")
      .order("aisle")
      .order("bay")
      .order("level", { ascending: false })
      .order("position")
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (!locations?.length) return [];

  const counts = await getStoredPalletCounts(locations.map((l: any) => l.id));
  const bayMap = new Map<string, BayOccupancyCell[]>();
  for (const loc of locations as any[]) {
    const zoneCode = (loc.zone_code as any)?.code ?? "";
    const zoneName = (loc.zone_name as any)?.name ?? "";
    const zoneSortOrder = (loc.zone_sort_order as any)?.sort_order ?? 999;
    const key = `${zoneSortOrder}|${zoneCode}|${zoneName}|${loc.aisle ?? ""}|${loc.bay ?? ""}`;
    if (!bayMap.has(key)) bayMap.set(key, []);
    const maxPallets = Number(loc.max_pallets ?? 0);
    const occupiedPallets = counts.get(loc.id) ?? 0;
    bayMap.get(key)!.push({
      locationId: loc.id,
      locationCode: displayRackLocationCode(loc.code),
      level: loc.level ?? null,
      position: loc.position ?? null,
      depth: loc.depth ?? null,
      maxPallets,
      occupiedPallets,
      status: loc.status ?? "active",
      isFull: maxPallets > 0 && occupiedPallets >= maxPallets,
    });
  }

  return Array.from(bayMap.entries()).map(([key, cells]) => {
    const [, zoneCode, zoneName, aisle, bay] = key.split("|");
    const bayCode = bayCodeFromLocationCode(cells[0]?.locationCode) ?? "";
    const totalCapacity = cells.reduce((sum, c) => sum + c.maxPallets, 0);
    const totalOccupied = cells.reduce((sum, c) => sum + c.occupiedPallets, 0);
    return { aisle, bay, bayCode, totalCapacity, totalOccupied, cells, zoneName: zoneName ?? "", zoneCode: zoneCode ?? "" };
  });
}

export async function logPutawayBaySelection(input: {
  taskId: string;
  scannedCode: string;
  selectedLocationCode?: string;
}) {
  const { data: task, error } = await db("putaway_tasks")
    .select("id, task_number, warehouse_id, pallet_id")
    .eq("id", input.taskId)
    .maybeSingle();
  if (error || !task) return;

  const audit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway_bay_selection",
    in_entity_table: "putaway_tasks",
    in_entity_id: input.taskId,
    in_pallet_id: task.pallet_id,
    in_warehouse_id: task.warehouse_id,
    in_metadata: {
      task_number: task.task_number,
      scanned_code: input.scannedCode,
      selected_location_code: input.selectedLocationCode ?? null,
    },
  });
  if (audit.error) console.error("[logPutawayBaySelection] log_audit_event failed:", audit.error);
}

// ── Move to picking area ──────────────────────────────────────────────────────

export async function getPalletByBarcode(barcode: string): Promise<{
  id: string;
  pallet_code: string;
  pallet_barcode: string;
  product_id: string;
  current_warehouse_id: string;
  current_location_id: string | null;
  status: string;
  quantity: number;
  product_sku?: string;
  product_name?: string;
  location_code?: string;
} | null> {
  const { data: pallet, error } = await db("pallets")
    .select("id, pallet_code, pallet_barcode, product_id, current_warehouse_id, current_location_id, status, quantity")
    .eq("pallet_barcode", barcode)
    .maybeSingle();
  if (error || !pallet) return null;
  const [{ data: product }, { data: location }] = await Promise.all([
    db("products").select("sku, name").eq("id", pallet.product_id).maybeSingle(),
    pallet.current_location_id
      ? db("locations").select("code").eq("id", pallet.current_location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  return {
    ...pallet,
    product_sku: (product as any)?.sku,
    product_name: (product as any)?.name,
    location_code: location ? displayRackLocationCode((location as any).code) : undefined,
  };
}
