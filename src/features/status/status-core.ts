import { upsertRecord } from "@/features/admin/admin-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  statusChangeSchema,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  buildPalletCode,
  escapePostgrestOrValue,
} from "@/features/shared/core-types";
import { writeSystemLog } from "@/features/system/system-core";
import { displayRackLocationCode } from "@/features/setup/setup-core";
import { normalizePalletBarcode } from "@/lib/code-input";

async function resolvePalletId(palletInput: string) {
  const normalized = normalizePalletBarcode(palletInput);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)) {
    return normalized;
  }

  const escaped = escapePostgrestOrValue(normalized);
  const { data, error } = await db("pallets")
    .select("id")
    .or(`pallet_code.eq.${escaped},pallet_barcode.eq.${escaped}`)
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
  return (data ?? [])
    // A pallet that was superseded — returned to Drafts, or replaced by a
    // correction — is history, not stock anyone still controls.
    .filter((row: any) => ![row.correction_state, row.pallet_correction_state]
      .map((state) => String(state ?? "").toLowerCase())
      .includes("superseded"))
    .map((row: any) => ({
      ...row,
      location_code: row.location_code ? displayRackLocationCode(row.location_code) : row.location_code,
    }));
}

/** A found pallet with no home: what the recovery did, for the toast. */
export type MissingPalletPutawayResult = {
  palletId: string;
  palletBarcode: string;
  putawayTaskId: string | null;
  putawayTaskNumber: string | null;
};

export type MissingPalletDraftResult = {
  draftId: string;
  draftPalletBarcode: string;
  quantity: number;
};

/**
 * The pallet turned up intact. It keeps its own number — the label on it is
 * still the truth — and only needs a location, so a Put-Away task is queued.
 */
export async function recoverMissingPalletToPutaway(inventoryBalanceId: string): Promise<MissingPalletPutawayResult> {
  const { data, error } = await (supabase.rpc as any)("recover_missing_pallet_to_putaway", {
    in_inventory_balance_id: inventoryBalanceId,
  });
  if (error) throw new Error(error.message ?? "Could not send the found pallet to Put-Away.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.pallet_id) throw new Error("Could not send the found pallet to Put-Away.");
  return {
    palletId: row.pallet_id,
    palletBarcode: row.pallet_barcode,
    putawayTaskId: row.putaway_task_id ?? null,
    putawayTaskNumber: row.putaway_task_number ?? null,
  };
}

/**
 * The stock is found but the pallet itself is not fit to go back as-is. The
 * old pallet is retired and the quantity waits in Receiving > Drafts under a
 * new number, which becomes real when the draft label is printed and received.
 */
export async function recoverMissingPalletToDraft(
  inventoryBalanceId: string,
  quantity?: number | null,
): Promise<MissingPalletDraftResult> {
  const { data, error } = await (supabase.rpc as any)("recover_missing_pallet_to_draft", {
    in_inventory_balance_id: inventoryBalanceId,
    in_quantity: quantity ?? null,
  });
  if (error) throw new Error(error.message ?? "Could not return the found pallet to Drafts.");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.draft_id) throw new Error("Could not return the found pallet to Drafts.");
  return {
    draftId: row.draft_id,
    draftPalletBarcode: row.draft_pallet_barcode,
    quantity: Number(row.quantity ?? 0),
  };
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
