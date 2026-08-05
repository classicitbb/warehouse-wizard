import { createReturnedPalletDraft } from "@/features/receiving/receiving-core";
import { supabase } from "@/integrations/supabase/client";
import { recordPlacementObservation } from "@/lib/ai-assist";
import {
  db,
  getStoredPalletCount,
  validatePutawayAssignment,
  formatSupabaseError,
} from "@/features/shared/core-types";
import { normalizeRackLocationCode } from "@/features/setup/setup-core";

export async function getPutawayTasks(userId?: string, warehouseId?: string | null) {
  let query = db("putaway_tasks")
    .select("*, pallets(*, products(*)), locations: suggested_location_id(*)")
    .in("status", ["queued", "assigned", "in_progress", "exception"])
    .order("created_at", { ascending: false });

  if (userId) {
    // Show tasks assigned to this user OR unassigned (queue) so the
    // operator/manager can see and pick up open work.
    query = query.or(`assigned_user_id.eq.${userId},assigned_user_id.is.null`);
  }

  // When a specific warehouse is active, hide tasks that belong to other
  // warehouses. A null/undefined warehouseId means "All warehouses".
  if (warehouseId) {
    query = query.eq("warehouse_id", warehouseId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function confirmPutaway(
  taskId: string,
  scannedPalletBarcode: string,
  scannedLocationCode: string,
  options?: { override?: boolean; overrideReason?: string },
) {
  const { data: task, error: taskError } = await db("putaway_tasks")
    .select("*, pallets(*), locations: suggested_location_id(*), products: pallets(product_id)")
    .eq("id", taskId)
    .single();

  if (taskError) throw taskError;
  if (!["queued", "assigned", "in_progress", "exception"].includes(task.status)) {
    throw new Error("Put-Away task is already closed or no longer available.");
  }

  const pallet = task.pallets as any;
  if (!pallet || pallet.pallet_barcode !== scannedPalletBarcode) {
    throw new Error("Scanned pallet barcode does not match the task pallet.");
  }
  if (!["receiving", "hold", "quarantine"].includes(pallet.status)) {
    throw new Error(`Pallet is no longer available for putaway (status: ${pallet.status}).`);
  }

  const { data: location, error: locationError } = await db("locations")
    .select("*")
    .eq("code", normalizeRackLocationCode(scannedLocationCode))
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location) throw new Error(`Location not found: ${scannedLocationCode}`);

  const { data: product, error: productError } = await db("products")
    .select("*")
    .eq("id", pallet.product_id)
    .single();
  if (productError) throw productError;

  const occupiedCount = await getStoredPalletCount(location.id);

  const ruleCheck = validatePutawayAssignment({
    productTemperature: product.temperature_requirement,
    locationTemperature: location.temperature_class,
    locationStatus: location.status,
    locationMaxPallets: location.max_pallets,
    occupiedPallets: occupiedCount,
    mixedSkuAllowed: location.mixed_sku_allowed,
    hasOtherSku: false,
  });

  const overrideUsed = !ruleCheck.valid && options?.override === true;
  if (!ruleCheck.valid && !overrideUsed) {
    // Prefix lets the UI detect rule violations and offer an override path
    throw new Error(`RULE_VIOLATION: ${ruleCheck.reason}`);
  }

  const { data: claimedTask, error: claimError } = await db("putaway_tasks")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId)
    .in("status", ["queued", "assigned", "in_progress", "exception"])
    .select("id")
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimedTask) throw new Error("Put-Away task was completed by another user. Refresh the queue.");

  await Promise.all([
    db("pallets")
      .update({
        current_location_id: location.id,
        current_warehouse_id: location.warehouse_id,
        status: "available",
        is_stored: true,
        available_quantity: pallet.quantity,
      })
      .eq("id", pallet.id),
    db("inventory_balances")
      .update({
        warehouse_id: location.warehouse_id,
        zone_id: location.zone_id,
        location_id: location.id,
        status: "available",
        available_quantity: pallet.quantity,
      })
      .eq("pallet_id", pallet.id),
  ]);

  const putawayAudit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway",
    in_entity_table: "putaway_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet.id,
    in_warehouse_id: location.warehouse_id,
    in_to_location_id: location.id,
    in_metadata: {
      location_code: location.code,
      pallet_barcode: pallet.pallet_barcode,
      override: overrideUsed,
      override_reason: overrideUsed ? (options?.overrideReason ?? ruleCheck.reason ?? null) : null,
      suggested_location_id: task.suggested_location_id ?? null,
      suggestion_overridden:
        task.suggested_location_id != null && task.suggested_location_id !== location.id,
    } as any,
  });
  if (putawayAudit.error) console.error("[confirmPutaway] log_audit_event failed:", putawayAudit.error);

  // AI assist: record placement observation (fire-and-forget, never throws)
  const aiLocation = location as any;
  recordPlacementObservation(
    pallet.product_id,
    location.warehouse_id,
    location.id,
    location.code,
    aiLocation.zones?.name ?? aiLocation.zone_name ?? null,
  ).catch((err) => console.error("[ai-assist] placement record failed:", err));
}

export async function getPutawayTaskHistory(userId?: string) {
  let query = db("putaway_tasks")
    .select("*, pallets(*, products(*)), locations: suggested_location_id(*)")
    .in("status", ["completed", "cancelled"])
    .order("completed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (userId) {
    query = query.or(`assigned_user_id.eq.${userId},assigned_user_id.is.null`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function revertPutawayToDraft(taskId: string): Promise<void> {
  const { data: task, error } = await db("putaway_tasks").select("*, pallets(pallet_barcode)").eq("id", taskId).single();
  if (error) throw error;
  if (task.status === "completed") throw new Error("Cannot revert a completed putaway task.");
  if (task.status === "cancelled") throw new Error("Put-Away task has already been returned to Receiving.");

  await createReturnedPalletDraft({
    palletId: task.pallet_id,
    warehouseId: task.warehouse_id,
    sourceLabel: `Put-Away task ${task.task_number}`,
    sourceType: "putaway_returned",
    sourceId: taskId,
    reason: "Returned to receiving from putaway",
  });

  const [{ error: updErr }, { error: palletErr }, { error: balanceErr }] = await Promise.all([
    db("putaway_tasks")
      .update({ status: "cancelled", completed_at: new Date().toISOString() } as any)
      .eq("id", taskId)
      .in("status", ["queued", "assigned", "in_progress", "exception", "draft"]),
    db("pallets")
      .update({ status: "receiving", current_location_id: null, is_stored: false, available_quantity: 0 } as any)
      .eq("id", task.pallet_id),
    db("inventory_balances")
      .update({ status: "receiving", location_id: null, zone_id: null, available_quantity: 0 } as any)
      .eq("pallet_id", task.pallet_id),
  ]);
  if (updErr) throw updErr;
  if (palletErr) throw palletErr;
  if (balanceErr) throw balanceErr;

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "putaway_reverted_to_draft",
    in_entity_table: "putaway_tasks",
    in_entity_id: taskId,
    in_warehouse_id: task.warehouse_id,
    in_metadata: { previous_status: task.status },
  });
}
