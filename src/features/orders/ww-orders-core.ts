// Standalone outbound (migration 20261116230000): sales orders and trips
// made in WW when NetSuite is not connected. Every write goes
// through a security-definer RPC that checks the role, the warehouse and that
// NetSuite is not the system of record. The floor flow on the Trips page is
// the same for WW and NetSuite fulfillments.
import { supabase } from "@/integrations/supabase/client";
import type { DetailFulfillment, DetailLine } from "./orders-inbox-core";

export type WwOrderLineInput = { product_id: string; quantity: number };

export type WwOrderInput = {
  warehouse_id: string;
  customer_id: string;
  requested_ship_date: string | null;
  customer_reference: string;
  notes: string;
  lines: WwOrderLineInput[];
};

export type WwTripInput = {
  order_id: string;
  fulfillment_date: string;
  truck_name: string;
  trip_number: string;
  picker_name: string;
};

export type OrderFormOptions = {
  warehouses: { id: string; name: string }[];
  customers: { id: string; customer_number: string; name: string; on_credit_hold: boolean }[];
  products: { id: string; sku: string; name: string; barcode: string | null }[];
};

export const ORDER_FORM_OPTIONS_QUERY_KEY = ["orders-inbox", "form-options"] as const;

/** Lines with a product and a quantity above 0; the same product twice is added together. */
export function normalizeOrderLines(lines: { product_id: string; quantity: number | string }[]): WwOrderLineInput[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const qty = Number(line.quantity);
    if (!line.product_id || !Number.isFinite(qty) || qty <= 0) continue;
    totals.set(line.product_id, (totals.get(line.product_id) ?? 0) + qty);
  }
  return [...totals].map(([product_id, quantity]) => ({ product_id, quantity }));
}

/** Why the order cannot be saved yet, or null when it can. */
export function orderInputProblem(input: Pick<WwOrderInput, "warehouse_id" | "customer_id" | "lines">): string | null {
  if (!input.warehouse_id) return "Choose the warehouse.";
  if (!input.customer_id) return "Choose the customer.";
  if (input.lines.length === 0) return "Add at least one line with a product and a quantity.";
  return null;
}

/** Base units still to plan: ordered - shipped - on an open fulfillment. */
export function openToPlan(lines: Pick<DetailLine, "id" | "quantity" | "fulfilled_quantity" | "is_closed">[], fulfillments: Pick<DetailFulfillment, "external_status" | "order_fulfillment_lines">[]): number {
  const planned = new Map<string, number>();
  for (const f of fulfillments) {
    if (f.external_status === "C") continue;
    for (const l of f.order_fulfillment_lines) if (l.order_line_id) planned.set(l.order_line_id, (planned.get(l.order_line_id) ?? 0) + Number(l.quantity));
  }
  return lines.reduce((sum, l) => (l.is_closed ? sum : sum + Math.max(0, Number(l.quantity) - Number(l.fulfilled_quantity) - (planned.get(l.id) ?? 0))), 0);
}

export async function fetchOrderFormOptions(): Promise<OrderFormOptions> {
  const [warehouses, customers, products] = await Promise.all([
    supabase.from("warehouses").select("id, name").order("name"),
    supabase.from("customers").select("id, customer_number, name, on_credit_hold").eq("active", true).order("name").limit(5000),
    supabase.from("products").select("id, sku, name, barcode").eq("active", true).order("sku").limit(10000),
  ]);
  if (warehouses.error) throw warehouses.error;
  if (customers.error) throw customers.error;
  if (products.error) throw products.error;
  return {
    warehouses: (warehouses.data ?? []) as OrderFormOptions["warehouses"],
    customers: (customers.data ?? []) as OrderFormOptions["customers"],
    products: (products.data ?? []) as OrderFormOptions["products"],
  };
}

export const rpc = (name: string, args: Record<string, unknown>) => (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: Error | null }>)(name, args);

export async function createWwOrder(input: WwOrderInput): Promise<string> {
  const { data, error } = await rpc("create_ww_order", {
    p_warehouse_id: input.warehouse_id,
    p_customer_id: input.customer_id,
    p_requested_ship_date: input.requested_ship_date || null,
    p_customer_reference: input.customer_reference,
    p_notes: input.notes,
    p_lines: input.lines,
  });
  if (error) throw error;
  return data as string;
}

export async function cancelWwOrder(orderId: string): Promise<void> {
  const { error } = await rpc("cancel_ww_order", { p_order_id: orderId });
  if (error) throw error;
}

export async function planWwTrip(input: WwTripInput): Promise<string> {
  const { data, error } = await rpc("plan_ww_fulfillment", {
    p_order_id: input.order_id,
    p_fulfillment_date: input.fulfillment_date,
    p_truck_name: input.truck_name,
    p_trip_number: input.trip_number,
    p_picker_name: input.picker_name,
    p_lines: null,
  });
  if (error) throw error;
  return data as string;
}

export async function removeWwTrip(fulfillmentId: string): Promise<void> {
  const { error } = await rpc("cancel_ww_fulfillment", { p_fulfillment_id: fulfillmentId });
  if (error) throw error;
}
