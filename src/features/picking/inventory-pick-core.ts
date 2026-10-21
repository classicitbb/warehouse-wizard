import { supabase } from "@/integrations/supabase/client";
import { db, fetchAllRows } from "@/features/shared/core-types";

export type WholePallet = {
  inventory_balance_id: string;
  pallet_id: string;
  pallet_code: string;
  product_id: string;
  sku: string;
  client_id: string | null;
  location_id: string;
  location_code: string;
  quantity: number;
  received_at: string | null;
  expiry_date: string | null;
  rotation_method: string;
};
export type InventoryPickRequest = { warehouseId: string; balanceIds: string[]; mode: "pallet" | "product" };
export type InventoryPickPlan = { selected: WholePallet[]; recommended: WholePallet[]; warning: boolean; token: string };

export async function inventoryPickWork(request: InventoryPickRequest, commit?: {
  token: string; choice: "selected" | "recommended"; listId: string | null; orderNumber: string;
}): Promise<InventoryPickPlan & { lists?: { id: string; pick_list_number: string }[] }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("Reconnect and refresh the pallet preview before adding work.");
  }
  const { data, error } = await (supabase.rpc as any)("inventory_whole_pallet_pick_work", {
    in_warehouse_id: request.warehouseId,
    in_balance_ids: [...new Set(request.balanceIds)],
    in_mode: request.mode,
    in_commit: Boolean(commit),
    in_choice: commit?.choice ?? "selected",
    in_token: commit?.token ?? null,
    in_pick_list_id: commit?.listId ?? null,
    in_order_number: commit?.orderNumber ?? null,
  });
  if (error) throw new Error(error.message ?? "Could not check pallet availability.");
  return data;
}

export async function inventoryPickLists(warehouseId: string, clientId: string | null) {
  return fetchAllRows<any>((from, to) => {
    let query = db("pick_lists").select("id, pick_list_number, client_id, order_id, orders:orders!pick_lists_order_id_fkey!inner(status, warehouse_id, client_id)")
      .eq("warehouse_id", warehouseId).eq("status", "queued").is("transfer_id", null)
      .in("orders.status", ["draft", "queued"]).eq("orders.warehouse_id", warehouseId).order("id");
    query = clientId ? query.eq("client_id", clientId).eq("orders.client_id", clientId)
      : query.is("client_id", null).is("orders.client_id", null);
    return query.range(from, to);
  });
}
