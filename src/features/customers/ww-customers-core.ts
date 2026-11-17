// Customers made in WW (migration 20261116230000, save_ww_customer). Only
// rows with source 'ww' are edited here; NetSuite customers are edited in
// NetSuite. New customers are refused while NetSuite is connected.
import { rpc } from "@/features/orders/ww-orders-core";

export type ShipAddress = { addr1?: string | null; addr2?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null };

export type WwCustomerInput = {
  customer_number: string;
  name: string;
  delivery_zone: string;
  email: string;
  phone: string;
  ship_address: ShipAddress;
  on_credit_hold: boolean;
  credit_review_required: boolean;
  ship_complete: boolean;
};

/** An address with no filled part is sent as null. */
export function cleanAddress(address: ShipAddress): ShipAddress | null {
  const entries = Object.entries(address).filter(([, v]) => typeof v === "string" && v.trim() !== "").map(([k, v]) => [k, (v as string).trim()]);
  return entries.length ? (Object.fromEntries(entries) as ShipAddress) : null;
}

export async function saveWwCustomer(id: string | null, input: WwCustomerInput): Promise<string> {
  const { data, error } = await rpc("save_ww_customer", {
    p_id: id,
    p_fields: { ...input, ship_address: cleanAddress(input.ship_address) },
  });
  if (error) throw error;
  return data as string;
}
