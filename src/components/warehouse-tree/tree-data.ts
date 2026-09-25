// Warehouse structure tree: row types, Supabase fetches, grouping and fill maths.
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows, getStoredPalletCounts, resolveLocationCapacity } from "@/lib/wms-core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WarehouseRow {
  id: string; code: string; name: string;
  city?: string | null; country?: string | null;
  has_cool_zone?: boolean | null; active?: boolean | null;
}

export interface ZoneRow {
  id: string; code: string; name: string; warehouse_id: string;
  temperature_class: string;
  is_staging?: boolean | null; is_dispatch?: boolean | null; is_quarantine?: boolean | null;
}

export interface LocationRow {
  id: string; code: string;
  aisle?: string | null; bay?: string | null; level?: number | null; position?: string | null;
  level_style?: string | null;
  depth?: number | null; location_type?: string | null; temperature_class?: string | null;
  max_pallets?: number | null; status?: string | null;
  pick_sequence?: number | null; putaway_sequence?: number | null;
  mixed_sku_allowed?: boolean | null; mixed_lot_allowed?: boolean | null;
  max_height?: number | null; notes?: string | null;
  zone_id: string; warehouse_id: string;
}

export interface LevelGroup { level: string; displayLevel: string; positions: LocationRow[] }

export interface BayGroup { bay: string; levels: LevelGroup[] }

interface AisleGroup { aisle: string; bays: BayGroup[] }

export interface FillStats { occupied: number; capacity: number; disabled: number; total: number }

export type TreeSearchLocation = Pick<LocationRow, "id" | "code" | "aisle" | "bay" | "level" | "position" | "zone_id" | "warehouse_id">;

// ─── Data helpers ─────────────────────────────────────────────────────────────

export async function fetchZoneLocations(zoneId: string): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("id, code, aisle, bay, level, level_style, position, depth, location_type, temperature_class, max_pallets, status, pick_sequence, putaway_sequence, mixed_sku_allowed, mixed_lot_allowed, max_height, notes, zone_id, warehouse_id")
    .eq("zone_id", zoneId)
    .eq("is_hidden", false)
    .order("aisle").order("bay").order("level").order("position")
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as LocationRow[];
}

type FillStatsRow = Pick<LocationRow, "id" | "warehouse_id" | "zone_id" | "max_pallets" | "depth" | "status">;

export async function fetchLocationFillStats() {
  // Paged: the unbounded select was capped at 1000 rows by the data API, so
  // racks past that cut-off (e.g. Rack J) rendered with no capacity stats.
  const rows = await fetchAllRows<FillStatsRow>((from, to) =>
    supabase
      .from("locations")
      .select("id, warehouse_id, zone_id, max_pallets, depth, status")
      .eq("is_hidden", false)
      .order("id", { ascending: true })
      .range(from, to) as any,
  );
  const storedCounts = await getStoredPalletCounts(rows.map((row) => row.id));
  const byWarehouse = new Map<string, FillStats>();
  const byZone = new Map<string, FillStats>();
  const byLocation = new Map<string, FillStats>();

  function add(target: Map<string, FillStats>, key: string | null | undefined, stats: FillStats) {
    if (!key) return;
    const current = target.get(key) ?? { occupied: 0, capacity: 0, disabled: 0, total: 0 };
    target.set(key, {
      occupied: current.occupied + stats.occupied,
      capacity: current.capacity + stats.capacity,
      disabled: current.disabled + stats.disabled,
      total: current.total + stats.total,
    });
  }

  for (const row of rows) {
    const stats = locationFillStats(row as LocationRow, storedCounts.get(row.id) ?? 0);
    byLocation.set(row.id, stats);
    add(byWarehouse, row.warehouse_id, stats);
    add(byZone, row.zone_id, stats);
  }

  return { byWarehouse, byZone, byLocation };
}

export async function fetchTreeSearchLocations(): Promise<TreeSearchLocation[]> {
  // Paged: an unbounded select is capped at 1000 rows by the data API, which
  // silently hid whole racks from tree search on larger warehouses.
  const rows = await fetchAllRows<TreeSearchLocation>((from, to) =>
    supabase
      .from("locations")
      .select("id, code, aisle, bay, level, position, zone_id, warehouse_id")
      .eq("is_hidden", false)
      .order("id", { ascending: true })
      .range(from, to) as any,
  );
  return rows;
}

function numComp(a: string, b: string) {
  const na = Number(a), nb = Number(b);
  return !isNaN(na) && !isNaN(nb) ? na - nb : a.localeCompare(b);
}

function displayLevel(level: string, levelStyle: string | null | undefined) {
  if (levelStyle !== "alpha") return level;
  const numericLevel = Number(level);
  return Number.isInteger(numericLevel) && numericLevel >= 1 && numericLevel <= 26
    ? String.fromCharCode(64 + numericLevel)
    : level;
}

export function groupIntoTree(locs: LocationRow[]): AisleGroup[] {
  const m = new Map<string, Map<string, Map<string, LocationRow[]>>>();
  for (const l of locs) {
    const a = l.aisle ?? "—", b = l.bay ?? "—", lv = l.level != null ? String(l.level) : "—";
    if (!m.has(a)) m.set(a, new Map());
    const bm = m.get(a)!;
    if (!bm.has(b)) bm.set(b, new Map());
    const lm = bm.get(b)!;
    if (!lm.has(lv)) lm.set(lv, []);
    lm.get(lv)!.push(l);
  }
  return [...m.entries()].sort(([a], [b]) => numComp(a, b)).map(([aisle, bm]) => ({
    aisle,
    bays: [...bm.entries()].sort(([a], [b]) => numComp(a, b)).map(([bay, lm]) => ({
      bay,
      levels: [...lm.entries()].sort(([a], [b]) => numComp(a, b)).map(([level, positions]) => ({
        level,
        displayLevel: displayLevel(level, positions[0]?.level_style),
        positions: positions.sort((a, b) => numComp(String(a.position ?? ""), String(b.position ?? ""))),
      })),
    })),
  }));
}

export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function prefixedCode(prefix: string | null | undefined, code: string) {
  const cleanPrefix = String(prefix ?? "").trim();
  const cleanCode = String(code ?? "").trim();
  if (!cleanPrefix || !cleanCode) return cleanCode;
  return cleanCode.toUpperCase().startsWith(`${cleanPrefix}-`.toUpperCase())
    ? cleanCode
    : `${cleanPrefix}-${cleanCode}`;
}

export function normalizeTreeSearch(value: unknown) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function selectorEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export function scrollToTreeNodeWhenReady(nodeKey: string) {
  let attempts = 0;
  const findAndFocus = () => {
    const el = document.querySelector<HTMLElement>(`[data-tree-key="${selectorEscape(nodeKey)}"]`);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus({ preventScroll: true });
    el.classList.add("ring-2", "ring-primary", "ring-offset-2");
    window.setTimeout(() => el.classList.remove("ring-2", "ring-primary", "ring-offset-2"), 1200);
    return true;
  };
  if (findAndFocus()) return;
  const handle = window.setInterval(() => {
    attempts += 1;
    if (findAndFocus() || attempts > 25) window.clearInterval(handle);
  }, 80);
}

export function emptyFillStats(): FillStats {
  return { occupied: 0, capacity: 0, disabled: 0, total: 0 };
}

export function locationFillStats(location: LocationRow, occupied = 0): FillStats {
  const capacity = resolveLocationCapacity(location.max_pallets, location.depth);
  return {
    occupied: Number.isFinite(occupied) ? Math.max(0, occupied) : 0,
    capacity: Number.isFinite(capacity) ? Math.max(0, capacity) : 0,
    disabled: location.status && location.status !== "active" ? 1 : 0,
    total: 1,
  };
}

export function combineFillStats(locations: LocationRow[], byLocation: Map<string, FillStats>) {
  return locations.reduce((total, location) => {
    const stats = byLocation.get(location.id) ?? locationFillStats(location);
    return {
      occupied: total.occupied + stats.occupied,
      capacity: total.capacity + stats.capacity,
      disabled: total.disabled + stats.disabled,
      total: total.total + stats.total,
    };
  }, emptyFillStats());
}
