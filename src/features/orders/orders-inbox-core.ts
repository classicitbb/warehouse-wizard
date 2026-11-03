// Orders inbox data and rules (outbound picking design, slice C). Reads the
// NetSuite sales and transfer orders that netsuite-orders mirrors, through the
// outbound_order_inbox view, and works out what blocks an order from release
// (D8 credit hold and committed quantity, N4 printed without a fulfillment).
import { supabase } from "@/integrations/supabase/client";

export const ORDERS_INBOX_QUERY_KEY = ["orders-inbox"] as const;
export const OPEN_ORDER_STATUSES = ["B", "D", "E"] as const;

export type OrderKindFilter = "all" | "sales" | "transfer";
/** open = every open order; the rest narrow it down. */
export type OrderViewFilter = "open" | "unplanned" | "planned" | "blocked" | "printed";

export type InboxRow = {
  id: string;
  order_number: string;
  order_type: string;
  warehouse_name: string | null;
  external_record_id: string | null;
  external_status: string | null;
  order_date: string | null;
  requested_ship_date: string | null;
  customer_name: string | null;
  customer_number: string | null;
  delivery_zone: string | null;
  on_credit_hold: boolean;
  credit_review_required: boolean;
  customer_reference: string | null;
  destination_location_name: string | null;
  truck_name: string | null;
  trip_number: string | null;
  picker_name: string | null;
  picking_ticket_printed: boolean;
  ship_complete: boolean;
  unmapped_line_count: number;
  last_synced_at: string | null;
  line_count: number;
  ordered_quantity: number;
  committed_quantity: number;
  fulfilled_quantity: number;
  fulfillment_count: number;
  open_fulfillment_count: number;
  latest_fulfillment_number: string | null;
  latest_fulfillment_status: string | null;
  latest_fulfillment_date: string | null;
  latest_truck_name: string | null;
  latest_trip_number: string | null;
  latest_picker_name: string | null;
};

const INBOX_COLUMNS =
  "id, order_number, order_type, warehouse_name, external_record_id, external_status, order_date, requested_ship_date, customer_name, customer_number, delivery_zone, on_credit_hold, credit_review_required, customer_reference, destination_location_name, truck_name, trip_number, picker_name, picking_ticket_printed, ship_complete, unmapped_line_count, last_synced_at, line_count, ordered_quantity, committed_quantity, fulfilled_quantity, fulfillment_count, open_fulfillment_count, latest_fulfillment_number, latest_fulfillment_status, latest_fulfillment_date, latest_truck_name, latest_trip_number, latest_picker_name";

/** PostgREST `or()` treats commas and parentheses as syntax, so they are dropped from the term. */
export function cleanSearch(value: string): string {
  return value.replace(/[,()%*\\]/g, " ").trim();
}

/**
 * The pick-ticket QR holds the SO internal id (custbody_qr_b64), so a scan of
 * digits only also matches external_record_id. Order numbers can be digits too
 * (older SOs such as 262964), so both are searched.
 */
export function isQrScan(term: string): boolean {
  return /^\d{1,12}$/.test(term);
}

export async function fetchInbox(opts: { search: string; kind: OrderKindFilter; view: OrderViewFilter; limit: number }) {
  let query = supabase
    .from("outbound_order_inbox")
    .select(INBOX_COLUMNS, { count: "exact" })
    .in("external_status", [...OPEN_ORDER_STATUSES])
    .order("requested_ship_date", { ascending: true, nullsFirst: false })
    .order("order_number", { ascending: true })
    .limit(opts.limit);
  const term = cleanSearch(opts.search);
  if (term) {
    const filters = [`order_number.ilike.%${term}%`, `customer_name.ilike.%${term}%`, `destination_location_name.ilike.%${term}%`];
    if (isQrScan(term)) filters.push(`external_record_id.eq.${term}`);
    query = query.or(filters.join(","));
  }
  if (opts.kind !== "all") query = query.eq("order_type", opts.kind);
  if (opts.view === "unplanned") query = query.eq("open_fulfillment_count", 0);
  if (opts.view === "planned") query = query.gt("open_fulfillment_count", 0);
  if (opts.view === "blocked") query = query.or("on_credit_hold.eq.true,unmapped_line_count.gt.0,committed_quantity.eq.0");
  if (opts.view === "printed") query = query.eq("picking_ticket_printed", true).eq("fulfillment_count", 0);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as InboxRow[], total: count ?? 0 };
}

export type PollState = { key: string; last_run_at: string | null; last_result: Record<string, unknown> | null };

export async function fetchPollState(): Promise<PollState[]> {
  const { data, error } = await supabase.from("netsuite_poll_cursors").select("key, last_run_at, last_result").in("key", ["orders", "fulfillments"]);
  if (error) throw error;
  return (data ?? []) as unknown as PollState[];
}

// ── detail ──────────────────────────────────────────────────────────────────

export type UnitInfo = { unit_name: string; abbreviation: string | null; conversion_rate: number } | null;

export type DetailLine = {
  id: string;
  line_number: number | null;
  external_line_id: string | null;
  quantity: number;
  committed_quantity: number;
  fulfilled_quantity: number;
  is_closed: boolean;
  product: { sku: string; name: string } | null;
  unit: UnitInfo;
};

export type DetailFulfillment = {
  id: string;
  document_number: string;
  external_status: string;
  fulfillment_date: string | null;
  truck_name: string | null;
  trip_number: string | null;
  picker_name: string | null;
  order_fulfillment_lines: { order_line_id: string | null; quantity: number }[];
};

export async function fetchOrderDetail(orderId: string) {
  const [lines, fulfillments] = await Promise.all([
    supabase
      .from("order_lines")
      .select("id, line_number, external_line_id, quantity, committed_quantity, fulfilled_quantity, is_closed, product:products(sku, name), unit:uom_units(unit_name, abbreviation, conversion_rate)")
      .eq("order_id", orderId)
      .order("line_number", { ascending: true, nullsFirst: false }),
    supabase
      .from("order_fulfillments")
      .select("id, document_number, external_status, fulfillment_date, truck_name, trip_number, picker_name, order_fulfillment_lines(order_line_id, quantity)")
      .eq("order_id", orderId)
      .order("fulfillment_date", { ascending: true, nullsFirst: false })
      .order("document_number", { ascending: true }),
  ]);
  if (lines.error) throw lines.error;
  if (fulfillments.error) throw fulfillments.error;
  return {
    lines: (lines.data ?? []) as unknown as DetailLine[],
    fulfillments: (fulfillments.data ?? []) as unknown as DetailFulfillment[],
  };
}

// ── rules and labels ────────────────────────────────────────────────────────

export type BlockReason = { code: "credit_hold" | "unmapped" | "nothing_committed" | "printed_no_fulfillment"; label: string; tone: "block" | "warn" };

/** Why an order cannot go to the floor as it stands (D8, N4). Empty when it can. */
export function blockReasons(row: Pick<InboxRow, "on_credit_hold" | "unmapped_line_count" | "committed_quantity" | "fulfilled_quantity" | "ordered_quantity" | "picking_ticket_printed" | "fulfillment_count">): BlockReason[] {
  const reasons: BlockReason[] = [];
  if (row.on_credit_hold) reasons.push({ code: "credit_hold", label: "Credit hold", tone: "block" });
  if (row.unmapped_line_count > 0) reasons.push({ code: "unmapped", label: `${row.unmapped_line_count} item${row.unmapped_line_count === 1 ? "" : "s"} not in WW`, tone: "block" });
  if (Number(row.committed_quantity) <= 0 && Number(row.ordered_quantity) > Number(row.fulfilled_quantity)) {
    reasons.push({ code: "nothing_committed", label: "Nothing committed", tone: "block" });
  }
  if (row.picking_ticket_printed && row.fulfillment_count === 0) {
    reasons.push({ code: "printed_no_fulfillment", label: "Ticket printed, no fulfillment", tone: "warn" });
  }
  return reasons;
}

/** Share of the open quantity that NetSuite has committed, 0-100. */
export function committedPercent(row: Pick<InboxRow, "ordered_quantity" | "committed_quantity" | "fulfilled_quantity">): number {
  const open = Number(row.ordered_quantity) - Number(row.fulfilled_quantity);
  if (open <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((Number(row.committed_quantity) / open) * 100)));
}

export type Plan = { truck: string | null; trip: string | null; picker: string | null; source: "fulfillment" | "order" | null };

/** The office's plan: the open fulfillment's truck and trip if there is one, else what is on the order. */
export function orderPlan(row: Pick<InboxRow, "open_fulfillment_count" | "latest_truck_name" | "latest_trip_number" | "latest_picker_name" | "truck_name" | "trip_number" | "picker_name">): Plan {
  if (row.open_fulfillment_count > 0) {
    return { truck: row.latest_truck_name, trip: row.latest_trip_number, picker: row.latest_picker_name, source: "fulfillment" };
  }
  if (row.truck_name || row.trip_number || row.picker_name) {
    return { truck: row.truck_name, trip: row.trip_number, picker: row.picker_name, source: "order" };
  }
  return { truck: null, trip: null, picker: null, source: null };
}

/** V22: a fulfillment still at Picked one day after its date is aged. */
export function isAgedFulfillment(status: string | null, date: string | null, today: Date = new Date()): boolean {
  if (status !== "A" || !date) return false;
  const limit = new Date(today);
  limit.setHours(0, 0, 0, 0);
  limit.setDate(limit.getDate() - 1);
  return new Date(`${date}T00:00:00`) < limit;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  B: "Pending fulfillment",
  D: "Partially fulfilled",
  E: "Pending billing / partially fulfilled",
  F: "Pending billing",
  G: "Billed",
  H: "Closed",
  C: "Cancelled",
};
const FULFILLMENT_STATUS_LABELS: Record<string, string> = { A: "Picked", B: "Packed", C: "Shipped" };

export function orderStatusLabel(status: string | null): string {
  return (status && ORDER_STATUS_LABELS[status]) || status || "—";
}

export function fulfillmentStatusLabel(status: string | null): string {
  return (status && FULFILLMENT_STATUS_LABELS[status]) || status || "—";
}

/** "IF2154 · part 2 of 2" (N2), numbered by date. */
export function fulfillmentParts<T extends { id: string }>(fulfillments: T[]): Map<string, string> {
  const parts = new Map<string, string>();
  if (fulfillments.length < 2) return parts;
  fulfillments.forEach((f, i) => parts.set(f.id, `part ${i + 1} of ${fulfillments.length}`));
  return parts;
}

/**
 * A base-unit quantity in the line's own unit, e.g. 1500 base of a 500-each
 * CASE → "3 CASE". A remainder stays in base units: "2 CASE + 40".
 */
export function formatLineQuantity(base: number, unit: UnitInfo): string {
  const n = Number(base) || 0;
  const name = unit?.abbreviation || unit?.unit_name || "";
  const rate = Number(unit?.conversion_rate) || 1;
  if (!unit || rate === 1) return `${formatQty(n)}${name ? ` ${name}` : ""}`;
  const whole = Math.floor(n / rate);
  const rest = n - whole * rate;
  if (rest === 0) return `${formatQty(whole)} ${name}`;
  return whole > 0 ? `${formatQty(whole)} ${name} + ${formatQty(rest)}` : `${formatQty(rest)} (of ${formatQty(rate)}/${name})`;
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
