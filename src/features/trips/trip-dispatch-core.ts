// Trip pack check, staging, load scan and departure (outbound picking design,
// slice F). After the pick (slice E) each fulfillment goes:
//   packed (every picked line counted) -> staged (in a staging lane)
//   -> loaded (scanned onto the truck) -> departed (the trip left)
// Depart queues the NetSuite IF change to Shipped with the picked quantities
// (ship short when a line is short, D10) and the real scan times (O4).
// Quantities are base units (D9); the screen shows them in the line unit.
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/features/shared/core-types";
import type { UnitInfo } from "@/features/orders/orders-inbox-core";
import { pickState, type Trip, type TripBoardRow } from "./trips-core";

export type FloorStage = "pick" | "pack" | "stage" | "load" | "departed" | "nothing_picked";

/** The next floor step for one fulfillment. */
export function floorStage(row: TripBoardRow): FloorStage {
  if (row.ww_stage === "departed") return "departed";
  if (row.ww_stage === "loaded") return "load";
  if (row.ww_stage === "staged") return "load";
  if (row.ww_stage === "packed") return "stage";
  const state = pickState(row);
  if (state === "picked" || state === "short") return Number(row.picked_quantity) > 0 ? "pack" : "nothing_picked";
  return "pick";
}

export const STAGE_LABELS: Record<string, string> = {
  packed: "Packed",
  staged: "Staged",
  loaded: "Loaded",
  departed: "Departed",
};

export type TripDispatchState = {
  /** Fulfillments with picks that are not loaded yet. */
  waiting: TripBoardRow[];
  loaded: TripBoardRow[];
  /** Nothing picked: they stay behind for the office (V22). */
  leftBehind: TripBoardRow[];
  departed: TripBoardRow[];
  canDepart: boolean;
  shipsShort: boolean;
};

export function tripDispatchState(trip: Pick<Trip, "fulfillments">): TripDispatchState {
  const waiting: TripBoardRow[] = [];
  const loaded: TripBoardRow[] = [];
  const leftBehind: TripBoardRow[] = [];
  const departed: TripBoardRow[] = [];
  for (const row of trip.fulfillments) {
    const stage = floorStage(row);
    if (stage === "departed") departed.push(row);
    else if (row.ww_stage === "loaded") loaded.push(row);
    // Same rule as depart_trip: only orders with picks must be on the truck.
    else if (Number(row.picked_quantity) === 0) leftBehind.push(row);
    else waiting.push(row);
  }
  return {
    waiting,
    loaded,
    leftBehind,
    departed,
    canDepart: loaded.length > 0 && waiting.length === 0,
    shipsShort: loaded.some((r) => Number(r.picked_quantity) < Number(r.quantity)),
  };
}

// ── Pack check ───────────────────────────────────────────────────────────────

export type PackLine = {
  id: string;
  external_line_id: string;
  quantity: number;
  packed_quantity: number | null;
  product: { sku: string; name: string; barcode: string | null } | null;
  order_line: { line_number: number | null; unit: UnitInfo } | null;
  picked: number;
};

export type PackFulfillment = {
  id: string;
  document_number: string;
  ww_stage: TripBoardRow["ww_stage"];
  truck_name: string | null;
  trip_number: string | null;
  order: { order_number: string; customer_name: string | null } | null;
};

export async function fetchPackCheck(fulfillmentId: string): Promise<{ fulfillment: PackFulfillment; lines: PackLine[] }> {
  const [ful, lines, tasks] = await Promise.all([
    db("order_fulfillments")
      .select("id, document_number, ww_stage, truck_name, trip_number, order:orders(order_number, customer_name)")
      .eq("id", fulfillmentId)
      .single(),
    db("order_fulfillment_lines")
      .select("id, external_line_id, quantity, packed_quantity, product:products(sku, name, barcode), order_line:order_lines(line_number, unit:uom_units(unit_name, abbreviation, conversion_rate))")
      .eq("fulfillment_id", fulfillmentId),
    db("pick_tasks")
      .select("fulfillment_line_id, confirmed_quantity, status, pick_list:pick_lists!inner(fulfillment_id)")
      .eq("pick_list.fulfillment_id", fulfillmentId),
  ]);
  if (ful.error) throw ful.error;
  if (lines.error) throw lines.error;
  if (tasks.error) throw tasks.error;
  const picked = new Map<string, number>();
  for (const t of (tasks.data ?? []) as { fulfillment_line_id: string | null; confirmed_quantity: number; status: string }[]) {
    if (!t.fulfillment_line_id || !["in_progress", "completed"].includes(t.status)) continue;
    picked.set(t.fulfillment_line_id, (picked.get(t.fulfillment_line_id) ?? 0) + Number(t.confirmed_quantity));
  }
  const packLines = ((lines.data ?? []) as Omit<PackLine, "picked">[])
    .map((l) => ({ ...l, picked: picked.get(l.id) ?? 0 }))
    .sort((a, b) => (a.order_line?.line_number ?? 0) - (b.order_line?.line_number ?? 0));
  return { fulfillment: ful.data as PackFulfillment, lines: packLines };
}

/** A line needs a count when WW picked something and it is not counted yet. */
export function needsPackCount(line: Pick<PackLine, "picked" | "packed_quantity">): boolean {
  return line.picked > 0 && line.packed_quantity !== line.picked;
}

/** The scanned code matches the line's item (SKU or barcode). */
export function scanMatchesLine(scan: string, line: Pick<PackLine, "product">): boolean {
  const code = scan.trim().toUpperCase();
  if (!code || !line.product) return false;
  return code === line.product.sku.toUpperCase() || code === (line.product.barcode ?? "").toUpperCase();
}

export async function confirmPackLine(lineId: string, scan: string, baseQuantity: number): Promise<{ packed: boolean; open_lines: number }> {
  const { data, error } = await (supabase.rpc as any)("confirm_pack_line", {
    p_fulfillment_line_id: lineId,
    p_scan: scan.trim(),
    p_quantity: baseQuantity,
  });
  if (error) throw error;
  return data as { packed: boolean; open_lines: number };
}

export async function stageFulfillment(fulfillmentId: string, laneCode: string): Promise<{ lane: string }> {
  const { data, error } = await (supabase.rpc as any)("stage_fulfillment", {
    p_fulfillment_id: fulfillmentId,
    p_location_code: laneCode.trim().toUpperCase(),
  });
  if (error) throw error;
  return data as { lane: string };
}

// ── Load and depart ──────────────────────────────────────────────────────────

export async function loadTripScan(fulfillmentIds: string[], scan: string): Promise<{ fulfillment_id: string; document_number: string }> {
  const { data, error } = await (supabase.rpc as any)("load_trip_scan", {
    p_fulfillment_ids: fulfillmentIds,
    p_scan: scan.trim(),
  });
  if (error) throw error;
  return data as { fulfillment_id: string; document_number: string };
}

export type DepartResult = { departed: number; queued: number; posting_enabled: boolean; ship_short: boolean };

export async function departTrip(fulfillmentIds: string[]): Promise<DepartResult> {
  const { data, error } = await (supabase.rpc as any)("depart_trip", { p_fulfillment_ids: fulfillmentIds });
  if (error) throw error;
  return data as DepartResult;
}
