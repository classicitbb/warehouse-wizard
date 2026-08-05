import { upsertRecord } from "@/features/admin/admin-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  statusChangeSchema,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  buildPalletCode,
} from "@/features/shared/core-types";
import { writeSystemLog } from "@/features/system/system-core";
import { displayRackLocationCode } from "@/features/setup/setup-core";

async function resolvePalletId(palletInput: string) {
  const normalized = palletInput.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized;
  }

  const { data, error } = await db("pallets")
    .select("id")
    .or(`pallet_code.eq.${normalized},pallet_barcode.eq.${normalized}`)
    .single();
  if (error) throw new Error("Pallet barcode was not found.");
  return data.id as string;
}

export async function listStatusPallets() {
  const { data, error } = await db("inventory_search_view")
    .select("*")
    .in("status", ["hold", "quarantine", "damaged", "missing"])
    .order("received_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
  }));
}

export async function changePalletStatus(input: z.infer<typeof statusChangeSchema>) {
  const payload = statusChangeSchema.parse(input);
  const palletId = await resolvePalletId(payload.pallet_id);
  const { data: balance, error: balanceError } = await db("inventory_balances").select("*").eq("pallet_id", palletId).single();
  if (balanceError) throw balanceError;

  await Promise.all([
    db("pallets").update({ status: payload.new_status }).eq("id", palletId),
    db("inventory_balances").update({ status: payload.new_status }).eq("id", balance.id),
    upsertRecord("stock_adjustments", {
      adjustment_number: buildPalletCode("STS"),
      pallet_id: palletId,
      inventory_balance_id: balance.id,
      adjustment_type: "status_change",
      quantity_delta: 0,
      old_status: balance.status,
      new_status: payload.new_status,
      reason: payload.reason,
    }),
  ]);

  const statusAudit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "status_change",
    in_entity_table: "pallets",
    in_entity_id: palletId,
    in_pallet_id: palletId,
    in_warehouse_id: balance.warehouse_id,
    in_metadata: {
      old_status: balance.status,
      new_status: payload.new_status,
      reason: payload.reason,
    } as any,
  });
  if (statusAudit.error) console.error("[changePalletStatus] log_audit_event failed:", statusAudit.error);
  await writeSystemLog({
    log_type: "system_change",
    severity: ["missing", "damaged", "quarantine"].includes(payload.new_status) ? "warning" : "info",
    title: "Pallet status changed",
    message: `Pallet status changed from ${balance.status} to ${payload.new_status}.`,
    source: "inventory",
    table_name: "pallets",
    details: { palletId, old_status: balance.status, new_status: payload.new_status, reason: payload.reason },
  }).catch((error) => console.error("[changePalletStatus] writeSystemLog failed:", error));
}
