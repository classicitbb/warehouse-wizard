import { supabase } from "@/integrations/supabase/client";
import { recordPlacementObservation } from "@/lib/ai-assist";
import {
  db,
  getStoredPalletCount,
  validatePutawayAssignment,
  formatSupabaseError,
} from "@/features/shared/core-types";
import { resolveLocationClearanceMm, resolvePalletHeightMm } from "@/lib/measure";
import { normalizeRackLocationCode } from "@/features/setup/setup-core";
import { assertNotFrozen } from "@/features/cycle-counts/freeze-core";

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
  if (!["receiving", "putaway", "hold", "quarantine"].includes(pallet.status)) {
    throw new Error(`Pallet is no longer available for putaway (status: ${pallet.status}).`);
  }

  const { data: location, error: locationError } = await db("locations")
    .select("*")
    .eq("code", normalizeRackLocationCode(scannedLocationCode))
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location) throw new Error(`Location not found: ${scannedLocationCode}`);
  await assertNotFrozen(location.id, { palletId: pallet.id });

  const { data: product, error: productError } = await db("products")
    .select("*")
    .eq("id", pallet.product_id)
    .single();
  if (productError) throw productError;

  const occupiedCount = await getStoredPalletCount(location.id);

  // Height at put-away is a hard block. Both sides are resolved to millimetres
  // — the pallet's built height against the least non-null bin ceiling — and
  // the warehouse safety margin is fetched only when both are known, so a bin
  // or a pallet with no recorded height never triggers a lookup or a block.
  const palletHeightMm = resolvePalletHeightMm(pallet);
  const locationClearanceMm = resolveLocationClearanceMm(location);
  let clearanceMarginMm: number | null = null;
  if (palletHeightMm != null && locationClearanceMm != null && location.warehouse_id) {
    const { data: warehouse } = await db("warehouses")
      .select("clearance_safety_margin_mm")
      .eq("id", location.warehouse_id)
      .maybeSingle();
    clearanceMarginMm = warehouse?.clearance_safety_margin_mm ?? null;
  }

  const ruleCheck = validatePutawayAssignment({
    productTemperature: product.temperature_requirement,
    locationTemperature: location.temperature_class,
    locationStatus: location.status,
    locationMaxPallets: location.max_pallets,
    occupiedPallets: occupiedCount,
    mixedSkuAllowed: location.mixed_sku_allowed,
    hasOtherSku: false,
    palletHeightMm,
    locationClearanceMm,
    clearanceMarginMm,
  });

  // A height failure comes back `overridable: false` and stays refused however
  // the caller asks. Everything else keeps the override-with-a-reason path.
  const overrideUsed =
    !ruleCheck.valid && ruleCheck.overridable !== false && options?.override === true;
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

export type PutawayReconnectValidationResult =
  | { status: "ok" }
  | { status: "reselect"; summary: string }
  | { status: "reset-task"; summary: string };

export async function revalidatePutawayTaskPosition(input: {
  taskId: string;
  scannedPalletBarcode?: string;
  scannedLocationCode?: string;
}): Promise<PutawayReconnectValidationResult> {
  const { data: task, error: taskError } = await db("putaway_tasks")
    .select("*, pallets(*), locations: suggested_location_id(*), products: pallets(product_id)")
    .eq("id", input.taskId)
    .maybeSingle();

  if (taskError) throw taskError;
  if (!task || !["queued", "assigned", "in_progress", "exception"].includes(task.status)) {
    return {
      status: "reset-task",
      summary: "While you were offline: this Put-Away task was already completed or closed. Refresh the queue and rescan the pallet if it still needs work.",
    };
  }

  const pallet = task.pallets as any;
  if (!pallet) {
    return {
      status: "reset-task",
      summary: "While you were offline: the pallet linked to this Put-Away task is no longer available. Refresh the queue and confirm the pallet's true location.",
    };
  }

  if (input.scannedPalletBarcode && pallet.pallet_barcode !== input.scannedPalletBarcode) {
    return {
      status: "reset-task",
      summary: `While you were offline: pallet ${input.scannedPalletBarcode} no longer matches this Put-Away task. Refresh the queue and confirm the pallet's true location.`,
    };
  }

  if (!["receiving", "putaway", "hold", "quarantine"].includes(pallet.status)) {
    return {
      status: "reset-task",
      summary: `While you were offline: pallet ${pallet.pallet_barcode ?? "for this task"} is no longer waiting for Put-Away (status: ${pallet.status}). Refresh the queue before continuing.`,
    };
  }

  const normalizedLocationCode = normalizeRackLocationCode(input.scannedLocationCode ?? "");
  if (!normalizedLocationCode) {
    return { status: "ok" };
  }

  const { data: location, error: locationError } = await db("locations")
    .select("*")
    .eq("code", normalizedLocationCode)
    .maybeSingle();
  if (locationError) throw locationError;
  if (!location) {
    return {
      status: "reselect",
      summary: `While you were offline: location ${normalizedLocationCode} is no longer available. Scan a different bin before confirming Put-Away.`,
    };
  }

  if (location.status !== "active") {
    return {
      status: "reselect",
      summary: `While you were offline: location ${location.code} became ${location.status}. Scan a different bin before confirming Put-Away.`,
    };
  }

  const occupiedCount = await getStoredPalletCount(location.id);
  if (occupiedCount >= Number(location.max_pallets ?? 0)) {
    return {
      status: "reselect",
      summary: `While you were offline: bin ${location.code} was filled by another operator. Your target is no longer available.`,
    };
  }

  return { status: "ok" };
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
  const { error } = await (supabase.rpc as any)("return_putaway_to_receiving_draft", { in_task_id: taskId });
  if (error) throw new Error(formatSupabaseError(error, "Could not return this Put-Away task to Receiving."));
}

// ── Orphaned Put-Away pallets ─────────────────────────────────────────────
// A pallet can end up marked "putaway" with no bin and no open task (for
// example after a status change from Missing). It is then invisible to the
// floor. These two helpers list those pallets and queue a task for them.

export type OrphanPutawayPallet = {
  palletId: string;
  palletBarcode: string;
  quantity: number;
  productName: string | null;
  sku: string | null;
};

export async function listOrphanPutawayPallets(warehouseId?: string | null): Promise<OrphanPutawayPallet[]> {
  let query = db("pallets")
    .select("id, pallet_barcode, quantity, current_warehouse_id, products(name, sku)")
    .eq("status", "putaway")
    .eq("is_stored", false)
    .is("current_location_id", null)
    .is("correction_state", null)
    .limit(50);
  if (warehouseId) query = query.eq("current_warehouse_id", warehouseId);

  const { data, error } = await query;
  if (error) throw error;
  const pallets = (data ?? []) as any[];
  if (pallets.length === 0) return [];

  const { data: openTasks, error: taskError } = await db("putaway_tasks")
    .select("pallet_id")
    .in("pallet_id", pallets.map((p) => p.id))
    .in("status", ["draft", "queued", "assigned", "in_progress", "exception"]);
  if (taskError) throw taskError;
  const withTask = new Set((openTasks ?? []).map((t: any) => t.pallet_id));

  return pallets
    .filter((p) => !withTask.has(p.id))
    .map((p) => ({
      palletId: p.id,
      palletBarcode: p.pallet_barcode,
      quantity: Number(p.quantity ?? 0),
      productName: p.products?.name ?? null,
      sku: p.products?.sku ?? null,
    }));
}

export async function queuePutawayTaskForPallet(palletId: string): Promise<{ taskNumber: string | null; created: boolean }> {
  const { data, error } = await (supabase.rpc as any)("ensure_putaway_task_for_pallet", { in_pallet_id: palletId });
  if (error) throw new Error(formatSupabaseError(error, "Could not queue a Put-Away task for this pallet."));
  const row = Array.isArray(data) ? data[0] : data;
  return { taskNumber: row?.putaway_task_number ?? null, created: Boolean(row?.created) };
}

