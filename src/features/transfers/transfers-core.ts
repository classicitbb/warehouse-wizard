import { createLabelRecord, createReturnedPalletDraft } from "@/features/receiving/receiving-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  escapePostgrestOrValue,
  formatSupabaseError,
  transferSchema,
} from "@/features/shared/core-types";
import { upsertRecord } from "@/features/admin/admin-core";

const TRANSFERS_DISABLED_MESSAGE = "Transfers are temporarily disabled for all users while the workflow is being redesigned.";

function assertTransfersEnabled(): void {
  throw new Error(TRANSFERS_DISABLED_MESSAGE);
}

async function resolvePalletId(palletInput: string) {
  const normalized = palletInput.trim();
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

export async function createTransferFlow(input: z.infer<typeof transferSchema>) {
  assertTransfersEnabled();
  const payload = transferSchema.parse(input);

  const { data: pallet, error: palletError } = await db("pallets").select("*").eq("id", payload.pallet_id).single();
  if (palletError) throw palletError;

  const transferableStatuses = new Set(["available", "quarantine", "hold"]);
  if (!transferableStatuses.has(String(pallet.status))) {
    throw new Error(`Pallet status "${pallet.status}" cannot be transferred.`);
  }
  if (pallet.current_warehouse_id !== payload.source_warehouse_id) {
    throw new Error("Pallet is not in the selected source warehouse.");
  }
  if (!pallet.is_stored || !pallet.current_location_id) {
    throw new Error("Pallet must be stored in a location before transfer.");
  }

  const fromLocationId = pallet.current_location_id as string | null;

  const transfer = await upsertRecord("transfers", {
    transfer_number: buildPalletCode("TRF"),
    transfer_type: payload.transfer_type,
    source_warehouse_id: payload.source_warehouse_id,
    destination_warehouse_id: payload.destination_warehouse_id,
    status: "queued",
    notes: payload.notes || null,
  });

  await upsertRecord("transfer_lines", {
    transfer_id: transfer.id,
    pallet_id: payload.pallet_id,
    product_id: pallet.product_id,
    client_id: pallet.client_id,
    quantity: payload.quantity,
    inventory_lot_id: pallet.inventory_lot_id,
  });

  await upsertRecord("move_tasks", {
    task_number: buildPalletCode("MOV"),
    pallet_id: payload.pallet_id,
    warehouse_id: payload.source_warehouse_id,
    transfer_id: transfer.id,
    from_location_id: fromLocationId,
    status: "queued",
    reason: "Transfer dispatch",
  });

  // Debit source-warehouse inventory immediately so the pallet stops appearing
  // in source inventory views once the transfer is created.
  await Promise.all([
    db("pallets")
      .update({ status: "in_transit", current_location_id: null, is_stored: false })
      .eq("id", payload.pallet_id),
    db("inventory_balances")
      .update({ status: "in_transit", location_id: null, zone_id: null })
      .eq("pallet_id", payload.pallet_id),
  ]);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "transfer_created",
    in_entity_table: "transfers",
    in_entity_id: transfer.id,
    in_warehouse_id: payload.source_warehouse_id,
    in_pallet_id: payload.pallet_id,
    in_from_location_id: fromLocationId,
    in_metadata: {
      transfer_number: transfer.transfer_number,
      destination_warehouse_id: payload.destination_warehouse_id,
      quantity: payload.quantity,
    },
  });

  await createLabelRecord("transfer_document", transfer.id, transfer.transfer_number);
  return transfer;
}

export async function dispatchTransfer(transferId: string, driverSignoffCode: string) {
  assertTransfersEnabled();
  const { data: userData } = await supabase.auth.getUser();
  const actorId = userData.user?.id;
  if (!actorId) throw new Error("Sign in is required before dispatch.");

  const normalizedCode = driverSignoffCode.trim();
  if (!normalizedCode) throw new Error("Driver sign-off code is required before departure.");

  const { data: profile, error: profileError } = await db("profiles")
    .select("id, full_name, user_code, badge_code")
    .eq("id", actorId)
    .single();
  if (profileError) throw profileError;

  if (profile.user_code !== normalizedCode && profile.badge_code !== normalizedCode) {
    throw new Error("Driver sign-off code did not match the signed-in user.");
  }

  const { data: roleRows, error: roleError } = await db("user_roles")
    .select("roles!inner(code)")
    .eq("user_id", actorId);
  if (roleError) throw roleError;
  const allowedToSign = (roleRows ?? []).some((row: { roles?: { code?: string } }) =>
    row.roles?.code ? ["dispatch_driver", "warehouse_manager", "admin"].includes(row.roles.code) : false,
  );
  if (!allowedToSign) {
    throw new Error("Only dispatch drivers, managers, or admins can sign off transfer departure.");
  }

  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;

  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    await Promise.all([
      db("pallets").update({ status: "in_transit", current_location_id: null }).eq("id", line.pallet_id),
      db("inventory_balances").update({ status: "in_transit", location_id: null, zone_id: null }).eq("pallet_id", line.pallet_id),
    ]);
  }

  const dispatchedAt = new Date().toISOString();
  await db("transfers")
    .update({
      status: "in_progress",
      dispatched_at: dispatchedAt,
      dispatch_signed_off_by: actorId,
      dispatch_signed_off_at: dispatchedAt,
      dispatch_signoff_code: normalizedCode,
    })
    .eq("id", transferId);

  const dispatchAudit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "transfer_driver_signoff",
    in_entity_table: "transfers",
    in_entity_id: transferId,
    in_warehouse_id: transfer.source_warehouse_id,
    in_metadata: {
      transfer_number: transfer.transfer_number,
      transfer_type: transfer.transfer_type,
      signed_off_by: profile.full_name ?? actorId,
    },
  });
  if (dispatchAudit.error) console.error("[dispatchTransfer] log_audit_event failed:", dispatchAudit.error);
}

export async function receiveTransfer(transferId: string) {
  assertTransfersEnabled();
  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;
  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    await Promise.all([
      db("pallets")
        .update({ current_warehouse_id: transfer.destination_warehouse_id, status: "receiving", current_location_id: null, is_stored: false })
        .eq("id", line.pallet_id),
      db("inventory_balances")
        .update({ warehouse_id: transfer.destination_warehouse_id, status: "receiving", location_id: null, zone_id: null })
        .eq("pallet_id", line.pallet_id),
      upsertRecord("putaway_tasks", {
        task_number: buildPalletCode("PTA"),
        pallet_id: line.pallet_id,
        warehouse_id: transfer.destination_warehouse_id,
        status: "queued",
      }),
    ]);
  }

  await db("transfers").update({ status: "completed", received_at: new Date().toISOString() }).eq("id", transferId);
}

export async function cancelTransfer(transferId: string, reason: string) {
  assertTransfersEnabled();
  const { data: transfer, error: transferError } = await db("transfers").select("*").eq("id", transferId).single();
  if (transferError) throw transferError;
  if (transfer.status === "completed") throw new Error("Cannot cancel a completed transfer.");

  const { data: lines, error: linesError } = await db("transfer_lines").select("*").eq("transfer_id", transferId);
  if (linesError) throw linesError;

  for (const line of lines ?? []) {
    if (!line.pallet_id) continue;
    // Return the pallet to receiving so it gets a fresh putaway task
    await Promise.all([
      db("pallets")
        .update({ status: "receiving", current_location_id: null, is_stored: false, available_quantity: 0 })
        .eq("id", line.pallet_id),
      db("inventory_balances")
        .update({ status: "receiving", location_id: null, zone_id: null, available_quantity: 0 })
        .eq("pallet_id", line.pallet_id),
    ]);
    await createReturnedPalletDraft({
      palletId: line.pallet_id,
      warehouseId: transfer.source_warehouse_id,
      sourceLabel: `Cancelled transfer ${transfer.transfer_number}`,
      sourceType: "transfer_cancelled",
      sourceId: transferId,
      reason,
    });
  }

  await db("transfers")
    .update({ status: "cancelled", notes: reason })
    .eq("id", transferId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "transfer_cancelled",
    in_entity_table: "transfers",
    in_entity_id: transferId,
    in_warehouse_id: transfer.source_warehouse_id,
    in_metadata: { reason, transfer_number: transfer.transfer_number },
  });
}

export async function flagCountLineException(lineId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to flag a count exception.");
  await db("cycle_count_lines")
    .update({ status: "exception", line_status: "exception", exception_reason: reason, notes: reason } as any)
    .eq("id", lineId);

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "count_line_exception",
    in_entity_table: "cycle_count_lines",
    in_entity_id: lineId,
    in_metadata: { reason },
  });
}

export async function listTransfers() {
  assertTransfersEnabled();
  const { data, error } = await db("transfers")
    .select("*, transfer_lines(*, pallets(pallet_barcode, products(*)))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
