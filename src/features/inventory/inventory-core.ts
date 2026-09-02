import { supabase } from "@/integrations/supabase/client";
import {
  db,
  escapePostgrestOrValue,
  getStoredPalletCounts,
  getStoredPalletCount,
  isRetiredInventoryStatus,
  RETIRED_INVENTORY_STATUSES,
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

// ── Persisted search state ────────────────────────────────────────────────
// Inventory Search previously only reflected filters in the URL's query
// string, which meant leaving the page via a sidebar link (no query string on
// that link) and coming back reset the search — even though the operator
// never asked to clear it. sessionStorage keeps it for the life of the
// browser tab, matching "remember it until I clear it."
const INVENTORY_SEARCH_STATE_KEY = "wms:inventory-search-state";

export type InventorySearchPersistedState = {
  search: string;
  status: string;
  warehouseId: string;
  ageBucket: string;
  expiryWindow: string;
  includeHistoric: boolean;
};

const DEFAULT_INVENTORY_SEARCH_STATE: InventorySearchPersistedState = {
  search: "",
  status: "all",
  warehouseId: "",
  ageBucket: "",
  expiryWindow: "",
  includeHistoric: false,
};

export function loadInventorySearchState(): InventorySearchPersistedState {
  if (typeof window === "undefined") return { ...DEFAULT_INVENTORY_SEARCH_STATE };
  try {
    const raw = window.sessionStorage.getItem(INVENTORY_SEARCH_STATE_KEY);
    if (!raw) return { ...DEFAULT_INVENTORY_SEARCH_STATE };
    return { ...DEFAULT_INVENTORY_SEARCH_STATE, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_INVENTORY_SEARCH_STATE };
  }
}

export function saveInventorySearchState(state: InventorySearchPersistedState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(INVENTORY_SEARCH_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (private browsing, quota) — persistence is a
    // convenience, never a requirement, so fail silently.
  }
}

export function clearInventorySearchState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(INVENTORY_SEARCH_STATE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Structure scope filter — "View Contents" on a Warehouse Structure tree node
 * deep-links here so an operator can see everything stored under a rack, bay,
 * level, or single location.
 *
 * `zoneCode` scopes to a whole rack/zone; `locationPrefix` is a display location
 * code (RACK-BAY-LEVEL[-P#]) and matches that code plus everything beneath it.
 */
export type InventoryStructureNode = "rack" | "bay" | "level" | "location";

export type InventoryStructureScope = {
  zoneCode?: string;
  locationPrefix?: string;
  /** Which tree node the scope came from — codes alone can't tell a
   *  single-position location (A-08-A) from the level above it. */
  node?: string;
};

const STRUCTURE_NODE_LABELS: Record<InventoryStructureNode, string> = {
  rack: "Rack",
  bay: "Bay",
  level: "Level",
  location: "Location",
};

/** Human label for a structure scope, e.g. "Rack A" / "Bay A-08". */
export function describeInventoryStructureScope(scope: InventoryStructureScope): string {
  const node = STRUCTURE_NODE_LABELS[scope.node as InventoryStructureNode];
  const prefix = String(scope.locationPrefix ?? "").trim().toUpperCase();
  if (prefix) {
    // RACK-BAY-LEVEL[-P#]: the fourth segment is the pallet position, which
    // makes the code a single location rather than the level above it.
    const segments = prefix.split("-").filter(Boolean).length;
    const fallback = segments <= 1 ? "Rack" : segments === 2 ? "Bay" : segments === 3 ? "Level" : "Location";
    return `${node ?? fallback} ${prefix}`;
  }
  const zoneCode = String(scope.zoneCode ?? "").trim().toUpperCase();
  return zoneCode ? `${node ?? "Rack"} ${zoneCode}` : "";
}

/** True when a display location code sits at or beneath the scope prefix. */
export function locationCodeInScope(locationCode: string | null | undefined, prefix: string): boolean {
  const scope = String(prefix ?? "").trim().toUpperCase();
  const code = String(locationCode ?? "").trim().toUpperCase();
  if (!scope || !code) return false;
  return code === scope || code.startsWith(`${scope}-`);
}

// ── Historic pallet numbers ───────────────────────────────────────────────
// A pallet number never stops being a real thing an operator can hold in their
// hand: it can ship, go missing, be drawn down to zero, or be replaced by a
// correction, and the label is still stuck to a pallet somewhere. Inventory
// Search used to drop all of those rows, so scanning such a label returned
// "No inventory matched" — indistinguishable from a label that never existed.
// Every pallet number ever created is now findable; historic ones come back
// tagged so they can't be mistaken for live stock.

/** Statuses that retire a pallet from live stock but keep its number searchable. */
export const HISTORIC_INVENTORY_STATUSES = ["picked", "in_transit", "shipped", "missing"] as const;

function correctionStatesOf(row: any): string[] {
  return [row?.correction_state, row?.pallet_correction_state]
    .map((value) => String(value ?? "").toLowerCase())
    .filter(Boolean);
}

/** True when a row is a past record rather than live, on-hand stock. */
export function isHistoricInventoryRow(row: any): boolean {
  return (
    isRetiredInventoryStatus(row?.status) ||
    !hasVisibleInventoryQuantity(row ?? {}) ||
    correctionStatesOf(row).includes("superseded")
  );
}

/**
 * Pallets that carry a number but no inventory balance — the balance row was
 * removed (cascade, purge, or a data fix) while the pallet record survived.
 * Without this fallback those numbers are unfindable anywhere in the app.
 */
async function findOrphanPalletRows(term: string, knownPalletIds: Set<string>) {
  const cleaned = term.trim();
  if (!cleaned) return [];
  const escaped = escapePostgrestOrValue(`%${cleaned}%`);
  const { data, error } = await db("pallets")
    .select(
      "id, pallet_code, pallet_barcode, status, quantity, available_quantity, created_at, current_warehouse_id, current_location_id, correction_state, products(sku, name), warehouses:current_warehouse_id(code, name), locations:current_location_id(code)",
    )
    .or(`pallet_code.ilike.${escaped},pallet_barcode.ilike.${escaped}`)
    .limit(200);
  if (error) throw error;

  return (data ?? [])
    .filter((pallet: any) => !knownPalletIds.has(pallet.id))
    .map((pallet: any) => ({
      // No balance row means no detail page to open — the UI keys and gates on this.
      inventory_balance_id: null,
      pallet_id: pallet.id,
      pallet_code: pallet.pallet_code,
      pallet_barcode: pallet.pallet_barcode,
      sku: pallet.products?.sku ?? null,
      product_name: pallet.products?.name ?? null,
      warehouse_id: pallet.current_warehouse_id ?? null,
      warehouse_code: pallet.warehouses?.code ?? null,
      warehouse_name: pallet.warehouses?.name ?? null,
      location_code: pallet.locations?.code ? displayRackLocationCode(pallet.locations.code) : null,
      status: pallet.status ?? "unknown",
      quantity: pallet.quantity ?? 0,
      available_quantity: pallet.available_quantity ?? 0,
      received_at: pallet.created_at ?? null,
      expiry_date: null,
      container_number: null,
      po_number: null,
      correction_state: pallet.correction_state ?? null,
      is_historic: true,
      is_orphan_pallet: true,
    }));
}

/** The filters Postgres can apply. Shared so the row query and the total-row
 *  count can never drift apart and report two different tables. */
type InventoryServerFilters = {
  warehouseId?: string;
  status?: InventoryStatus | "all";
  ageBucket?: InventoryAgeBucket | "";
  expiryWindow?: InventoryExpiryWindow | "";
};

function applyInventoryServerFilters(query: any, filters: InventoryServerFilters) {
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
  return query;
}

/** PostgREST `in` list matching `isRetiredInventoryStatus`, built from the same
 *  set so adding a status there also excludes it from the browse count. */
const RETIRED_STATUS_IN_LIST = `(${Array.from(RETIRED_INVENTORY_STATUSES).join(",")})`;

/** `col <> value` is NULL — and therefore false — for a NULL column, so every
 *  "is not X" filter has to spell the NULL case out. */
function isNot(column: string, value: string) {
  return `${column}.is.null,${column}.neq.${value}`;
}

/**
 * How many inventory rows the operator could reach with these filters, without
 * transferring them. Mirrors the `isVisibleRow` rules `searchInventory` applies
 * client-side, so "50 of 3,704 loaded" counts the same rows the table renders.
 *
 * Search terms and structure scopes are deliberately not accepted: those are
 * matched client-side over the full result set, where the exact match count is
 * already in hand.
 */
export async function countInventory(filters: InventoryServerFilters & { includeHistoric?: boolean }) {
  const includeHistoric = Boolean(filters.includeHistoric);
  if (!includeHistoric && filters.status && filters.status !== "all" && isRetiredInventoryStatus(filters.status)) {
    return 0;
  }
  let query = applyInventoryServerFilters(
    db("inventory_search_view").select("inventory_balance_id", { count: "exact", head: true }),
    filters,
  );
  // In-flight corrections are hidden either way — they duplicate the pallet
  // being corrected.
  query = query.or(isNot("correction_state", "pending")).or(isNot("pallet_correction_state", "pending"));
  if (!includeHistoric) {
    query = query
      .or(isNot("correction_state", "superseded"))
      .or(isNot("pallet_correction_state", "superseded"))
      .or(`status.is.null,status.not.in.${RETIRED_STATUS_IN_LIST}`)
      .or("available_quantity.gt.0,quantity.gt.0");
  }
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function searchInventory(filters: {
  search?: string;
  warehouseId?: string;
  status?: InventoryStatus | "all";
  ageBucket?: InventoryAgeBucket | "";
  expiryWindow?: InventoryExpiryWindow | "";
  zoneCode?: string;
  locationPrefix?: string;
  limit?: number;
  /** Include retired/zero-quantity rows while browsing (a search term implies it). */
  includeHistoric?: boolean;
}) {
  const searchTokens = (filters.search ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  // A typed or scanned term is a hunt for one specific pallet, so history is
  // always in scope there. Browsing with no term stays live-stock-only unless
  // the operator explicitly asks for history.
  const includeHistoric = Boolean(filters.includeHistoric) || searchTokens.length > 0;

  if (!includeHistoric && filters.status && filters.status !== "all" && isRetiredInventoryStatus(filters.status)) {
    return [];
  }
  const query = applyInventoryServerFilters(db("inventory_search_view").select("*"), filters);

  // In-flight corrections ('pending') stay hidden either way — showing them
  // duplicates the pallet being corrected. 'superseded' rows are history, so
  // they surface alongside the other historic records.
  const isVisibleRow = (row: any) => {
    const corrections = correctionStatesOf(row);
    if (corrections.includes("pending")) return false;
    if (includeHistoric) return true;
    if (corrections.includes("superseded")) return false;
    return !isRetiredInventoryStatus(row.status) && hasVisibleInventoryQuantity(row);
  };

  const scopeZoneCode = String(filters.zoneCode ?? "").trim().toUpperCase();
  const scopeLocationPrefix = String(filters.locationPrefix ?? "").trim().toUpperCase();
  // Structure scopes are matched client-side (the view exposes prefixed codes),
  // so every matching row has to be in hand before filtering — same as search.
  const loadAll = searchTokens.length > 0 || Boolean(scopeZoneCode) || Boolean(scopeLocationPrefix);
  let rawRows: any[];
  if (loadAll) {
    rawRows = await fetchAllRows<any>((from, to) => query.order("received_at", { ascending: false }).range(from, to));
  } else {
    // Keep fetching pages until we have enough *visible* rows (retired/zero-qty rows
    // are filtered client-side and would otherwise silently shrink the page and hide
    // the "load more" affordance).
    const wanted = Math.max(1, filters.limit ?? 50);
    const pageSize = wanted;
    rawRows = [];
    let visibleCount = 0;
    for (let page = 0; page < 20; page += 1) {
      const from = page * pageSize;
      const { data, error } = await query
        .order("received_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = data ?? [];
      rawRows.push(...batch);
      visibleCount += batch.filter(isVisibleRow).length;
      if (batch.length < pageSize || visibleCount >= wanted) break;
    }
  }
  let rows = rawRows
    .filter(isVisibleRow)
    .map((row) => ({
      ...row,
      location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
      is_historic: isHistoricInventoryRow(row),
      is_orphan_pallet: false,
    }));
  if (scopeZoneCode) {
    rows = rows.filter((row) => String(row.zone_code ?? "").trim().toUpperCase() === scopeZoneCode);
  }
  if (scopeLocationPrefix) {
    rows = rows.filter((row) => locationCodeInScope(row.location_code, scopeLocationPrefix));
  }
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

    // Last resort: a pallet number that matches nothing above may still exist as
    // a pallet record with no balance behind it. Only worth the extra round trip
    // when the operator is searching and the number looks like a pallet code.
    const rawTerm = (filters.search ?? "").trim();
    const knownPalletIds = new Set(rows.map((row) => row.pallet_id).filter(Boolean));
    // Lot/expiry and age filters read fields an orphan pallet no longer has,
    // so a filtered search legitimately excludes them.
    const orphanCandidates =
      filters.expiryWindow || filters.ageBucket ? [] : await findOrphanPalletRows(rawTerm, knownPalletIds);
    const orphans = orphanCandidates.filter((row: any) => {
      if (filters.warehouseId && row.warehouse_id !== filters.warehouseId) return false;
      if (filters.status && filters.status !== "all" && row.status !== filters.status) return false;
      if (scopeZoneCode) return false;
      if (scopeLocationPrefix) return locationCodeInScope(row.location_code, scopeLocationPrefix);
      return true;
    });
    rows = [...rows, ...orphans];
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

// ── Location occupancy fix ────────────────────────────────────────────────
// A bay can keep showing "1/5 pallets" after a stock record loses its physical
// pallet (a cancelled correction, a deleted pallet, a move that half-applied).
// Operators can run this check on the spot: it reports what is still claiming
// the bay and, on confirm, clears it. Cleared stock becomes "missing" rather
// than being deleted, so Status > Missing pallets is the undo path.

export type LocationOccupancyPhantom = {
  pallet_barcode?: string | null;
  quantity?: number | null;
  reason?: string | null;
};

export type LocationOccupancyFixResult = {
  location_code: string;
  max_pallets: number | null;
  stored_pallets: number;
  applied: boolean;
  cleared: number;
  phantom_count: number;
  phantom_balances: LocationOccupancyPhantom[];
  phantom_pallets: LocationOccupancyPhantom[];
};

export async function checkLocationOccupancy(
  locationCode: string,
  apply = false,
): Promise<LocationOccupancyFixResult> {
  const { data, error } = await supabase.rpc("reconcile_location_occupancy", {
    in_location_code: normalizeRackLocationCode(locationCode),
    in_apply: apply,
  } as never);
  if (error) throw error;
  const payload = (data ?? {}) as Partial<LocationOccupancyFixResult>;
  return {
    location_code: payload.location_code ?? locationCode,
    max_pallets: payload.max_pallets ?? null,
    stored_pallets: Number(payload.stored_pallets ?? 0),
    applied: Boolean(payload.applied),
    cleared: Number(payload.cleared ?? 0),
    phantom_count: Number(payload.phantom_count ?? 0),
    phantom_balances: payload.phantom_balances ?? [],
    phantom_pallets: payload.phantom_pallets ?? [],
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
