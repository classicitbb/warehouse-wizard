// Trip board and floor picking (outbound picking design, slice E: O1, O3, N1,
// N2, D8, D10). The office plans each trip in NetSuite on the Fulfill Orders
// page; WW reads its item fulfillments (slice C) and groups them into trips
// by IF date + truck + trip number (O3). Each fulfillment gets one WW pick
// list (start_fulfillment_pick) with one task per line. A task directs the
// picker to a bin: a pick face that holds the product, else bulk. The picker
// scans the bin and enters what they took (confirm_trip_pick); "Short" closes
// the line with what was found and asks for an urgent pallet on the face.
// Quantities are base units (D9); the screen shows them in the line's unit.
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/features/shared/core-types";
import { formatLineQuantity, type UnitInfo } from "@/features/orders/orders-inbox-core";

export const TRIPS_QUERY_KEY = ["trips"] as const;

export type TripBoardRow = {
  fulfillment_id: string;
  warehouse_id: string;
  warehouse_code: string;
  document_number: string;
  external_status: string;
  fulfillment_date: string | null;
  truck_external_id: string | null;
  truck_name: string | null;
  trip_number: string | null;
  picker_name: string | null;
  order_id: string;
  order_number: string;
  order_type: "sales" | "transfer";
  customer_name: string | null;
  delivery_zone: string | null;
  on_credit_hold: boolean;
  part_number: number;
  part_count: number;
  line_count: number;
  unmapped_count: number;
  quantity: number;
  pick_list_id: string | null;
  pick_list_status: string | null;
  picked_quantity: number;
  open_tasks: number;
  short_tasks: number;
  exception_tasks: number;
  is_aged: boolean;
};

export type PickState = "blocked" | "not_started" | "picking" | "exception" | "short" | "picked";

/** Where one fulfillment stands on the floor. */
export function pickState(row: Pick<TripBoardRow, "on_credit_hold" | "order_type" | "pick_list_id" | "pick_list_status" | "open_tasks" | "short_tasks" | "exception_tasks">): PickState {
  if (row.order_type === "sales" && row.on_credit_hold && !row.pick_list_id) return "blocked";
  if (!row.pick_list_id) return "not_started";
  if (row.pick_list_status === "completed") return row.short_tasks > 0 ? "short" : "picked";
  if (row.exception_tasks > 0 && row.open_tasks === 0) return "exception";
  return "picking";
}

export const PICK_STATE_LABELS: Record<PickState, string> = {
  blocked: "Credit hold",
  not_started: "Not started",
  picking: "Picking",
  exception: "Needs stock",
  short: "Picked short",
  picked: "Picked",
};

export type Trip = {
  key: string;
  date: string | null;
  truck: string | null;
  tripNumber: string | null;
  warehouseCode: string;
  fulfillments: TripBoardRow[];
  picked: number;
  total: number;
  isAged: boolean;
};

/** O3: a trip is the IF date + truck + trip number. */
export function tripKey(row: Pick<TripBoardRow, "warehouse_id" | "fulfillment_date" | "truck_external_id" | "truck_name" | "trip_number">): string {
  return [row.warehouse_id, row.fulfillment_date ?? "", row.truck_external_id ?? row.truck_name ?? "", row.trip_number ?? ""].join("|");
}

function compareTripNumber(a: string | null, b: string | null): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && a && b) return na - nb;
  return (a ?? "").localeCompare(b ?? "");
}

/** Newest date first, then trip number, then truck. Fulfillments by order number. */
export function groupTrips(rows: TripBoardRow[]): Trip[] {
  const trips = new Map<string, Trip>();
  for (const row of rows) {
    const key = tripKey(row);
    let trip = trips.get(key);
    if (!trip) {
      trip = {
        key,
        date: row.fulfillment_date,
        truck: row.truck_name,
        tripNumber: row.trip_number,
        warehouseCode: row.warehouse_code,
        fulfillments: [],
        picked: 0,
        total: 0,
        isAged: false,
      };
      trips.set(key, trip);
    }
    trip.fulfillments.push(row);
    trip.total += 1;
    const state = pickState(row);
    if (state === "picked" || state === "short") trip.picked += 1;
    trip.isAged = trip.isAged || row.is_aged;
  }
  const list = [...trips.values()];
  for (const trip of list) trip.fulfillments.sort((a, b) => a.order_number.localeCompare(b.order_number));
  return list.sort((a, b) => {
    const byDate = (b.date ?? "").localeCompare(a.date ?? "");
    if (byDate !== 0) return byDate;
    const byTrip = compareTripNumber(a.tripNumber, b.tripNumber);
    if (byTrip !== 0) return byTrip;
    return (a.truck ?? "").localeCompare(b.truck ?? "");
  });
}

/** N2: floor staff see the order number, with "part n of m" when there is more than one IF. */
export function orderLabel(row: Pick<TripBoardRow, "order_number" | "part_number" | "part_count">): string {
  return row.part_count > 1 ? `${row.order_number} · part ${row.part_number} of ${row.part_count}` : row.order_number;
}

export function tripTitle(trip: Pick<Trip, "tripNumber" | "truck">): string {
  return [trip.tripNumber ? `Trip ${trip.tripNumber}` : "No trip number", trip.truck ?? "No truck"].join(" · ");
}

export type TripDateFilter = "today" | "open";

export async function fetchTripBoard(): Promise<TripBoardRow[]> {
  const { data, error } = await db("trip_board")
    .select("*")
    .order("fulfillment_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return (data ?? []) as TripBoardRow[];
}

export function filterTrips(trips: Trip[], filter: TripDateFilter, today: string): Trip[] {
  if (filter === "today") return trips.filter((trip) => trip.date === today);
  return trips;
}

export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Makes or refreshes the WW pick list for one fulfillment; returns its id. */
export async function startFulfillmentPick(fulfillmentId: string): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("start_fulfillment_pick", { p_fulfillment_id: fulfillmentId });
  if (error) throw error;
  return data as string;
}

// ── Handset ──────────────────────────────────────────────────────────────────

export type TripPickTask = {
  id: string;
  task_number: string;
  status: string;
  requested_quantity: number;
  confirmed_quantity: number;
  short_reason: string | null;
  location: { id: string; code: string; status: string; pick_sequence: number } | null;
  fulfillment_line: {
    id: string;
    product_id: string | null;
    product: { sku: string; name: string } | null;
    order_line: { line_number: number | null; unit: UnitInfo } | null;
  } | null;
};

export type TripPickList = {
  id: string;
  pick_list_number: string;
  status: string;
  notes: string | null;
  fulfillment: Pick<TripBoardRow, "document_number" | "truck_name" | "trip_number" | "fulfillment_date"> & { order_id: string } | null;
  order: { order_number: string; customer_name: string | null } | null;
};

const TASK_COLUMNS =
  "id, task_number, status, requested_quantity, confirmed_quantity, short_reason, " +
  "location:locations!pick_tasks_location_id_fkey(id, code, status, pick_sequence), " +
  "fulfillment_line:order_fulfillment_lines(id, product_id, product:products(sku, name), order_line:order_lines(line_number, unit:uom_units(unit_name, abbreviation, conversion_rate)))";

export async function fetchTripPick(pickListId: string): Promise<{ list: TripPickList; tasks: TripPickTask[] }> {
  const [list, tasks] = await Promise.all([
    db("pick_lists")
      .select("id, pick_list_number, status, notes, fulfillment:order_fulfillments(document_number, truck_name, trip_number, fulfillment_date, order_id), order:orders!pick_lists_order_id_fkey(order_number, customer_name)")
      .eq("id", pickListId)
      .single(),
    db("pick_tasks").select(TASK_COLUMNS).eq("pick_list_id", pickListId),
  ]);
  if (list.error) throw list.error;
  if (tasks.error) throw tasks.error;
  return { list: list.data as TripPickList, tasks: sortPickTasks((tasks.data ?? []) as TripPickTask[]) };
}

const CLOSED = new Set(["completed", "cancelled"]);

export function isOpenTask(task: Pick<TripPickTask, "status">): boolean {
  return !CLOSED.has(task.status);
}

/** Open lines first in walk order (pick sequence, bin); no-stock lines after them; closed lines last. */
export function sortPickTasks<T extends Pick<TripPickTask, "status" | "location" | "fulfillment_line">>(tasks: T[]): T[] {
  const rank = (t: T) => (CLOSED.has(t.status) ? 2 : t.status === "exception" ? 1 : 0);
  return [...tasks].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    const s = (a.location?.pick_sequence ?? Number.MAX_SAFE_INTEGER) - (b.location?.pick_sequence ?? Number.MAX_SAFE_INTEGER);
    if (s !== 0) return s;
    const c = (a.location?.code ?? "~").localeCompare(b.location?.code ?? "~");
    if (c !== 0) return c;
    return (a.fulfillment_line?.order_line?.line_number ?? 0) - (b.fulfillment_line?.order_line?.line_number ?? 0);
  });
}

export function remainingQuantity(task: Pick<TripPickTask, "requested_quantity" | "confirmed_quantity">): number {
  return Math.max(Number(task.requested_quantity) - Number(task.confirmed_quantity), 0);
}

export function taskUnit(task: Pick<TripPickTask, "fulfillment_line">): UnitInfo {
  return task.fulfillment_line?.order_line?.unit ?? null;
}

/** A quantity in the line's unit, e.g. "3 CASE + 40". */
export function taskQuantityLabel(task: Pick<TripPickTask, "fulfillment_line">, base: number): string {
  return formatLineQuantity(base, taskUnit(task));
}

/** The picker enters line units; WW posts base units (D9). */
export function toBaseUnits(entered: number, unit: UnitInfo): number {
  const rate = Number(unit?.conversion_rate) || 1;
  return Math.round(entered * rate * 10000) / 10000;
}

export type ConfirmResult = {
  task_status: string;
  confirmed_quantity: number;
  requested_quantity: number;
  list_complete: boolean;
  replenishment_task_id: string | null;
};

export async function confirmTripPick(taskId: string, locationCode: string, baseQuantity: number, short = false): Promise<ConfirmResult> {
  const { data, error } = await (supabase.rpc as any)("confirm_trip_pick", {
    p_task_id: taskId,
    p_location_code: locationCode.trim().toUpperCase(),
    p_quantity: baseQuantity,
    p_short: short,
  });
  if (error) throw error;
  return data as ConfirmResult;
}
