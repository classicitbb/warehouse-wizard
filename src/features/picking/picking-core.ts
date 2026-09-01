import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  pickListSchema,
} from "@/features/shared/core-types";
import { upsertRecord } from "@/features/admin/admin-core";
import { createLabelRecord } from "@/features/receiving/receiving-core";

/**
 * Splits a requested pick quantity across pallets in the order they're
 * given (caller is responsible for FEFO/FIFO sorting).
 *
 * Pallets are whole-pallet-only: a pick task can never ask for less than a
 * pallet's full available quantity, because operators cannot break a pallet
 * down at pick time (see confirmPickTask's "partial picks are disabled"
 * rule). So each candidate pallet is allocated in FULL, and pallets keep
 * being added — in rotation order — until the accumulated quantity meets or
 * exceeds what was requested. This means the total picked can exceed the
 * requested quantity (e.g. 25 units requested off 50-unit pallets picks the
 * whole 50; 75 requested off two 50-unit pallets picks both, 100 total; 80
 * requested off four 25-unit pallets picks all four, 100 total) — that's
 * expected, not a bug. Exported so the split math can be unit tested
 * without touching Supabase.
 */
export function allocatePickQuantities<T extends { available_quantity: number | null }>(
  sortedCandidates: T[],
  quantity: number,
): { allocations: Array<T & { allocated_quantity: number }>; short: number } {
  const allocations: Array<T & { allocated_quantity: number }> = [];
  let remaining = quantity;
  for (const candidate of sortedCandidates) {
    if (remaining <= 0) break;
    const available = Number(candidate.available_quantity ?? 0);
    if (available <= 0) continue;
    // Always take the pallet's full available quantity — never a partial
    // slice — even if that means picking more than what's outstanding.
    allocations.push({ ...candidate, allocated_quantity: available });
    remaining -= available;
  }
  return { allocations, short: remaining > 0 ? remaining : 0 };
}

async function selectPickCandidates(productId: string, warehouseId: string, quantity: number) {
  const { data: product } = await db("products").select("*").eq("id", productId).single();

  const { data, error } = await db("inventory_balances")
    .select("pallet_id, location_id, available_quantity, expiry_date, received_at")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("status", "available")
    .gt("available_quantity", 0);
  if (error) throw error;

  const { data: freezes, error: freezeError } = await db("inventory_freezes")
    .select("location_id")
    .eq("warehouse_id", warehouseId)
    .eq("status", "active");
  if (freezeError) throw freezeError;
  const frozenLocationIds = new Set((freezes ?? []).map((freeze: any) => freeze.location_id).filter(Boolean));
  const availableCandidates = (data ?? []).filter((candidate: any) => !candidate.location_id || !frozenLocationIds.has(candidate.location_id));

  const sorted = [...availableCandidates].sort((left, right) => {
    if (product?.rotation_method === "fefo") {
      return (left.expiry_date ?? "9999-12-31").localeCompare(right.expiry_date ?? "9999-12-31");
    }
    return String(left.received_at ?? "").localeCompare(String(right.received_at ?? ""));
  });

  const { allocations, short } = allocatePickQuantities(sorted, quantity);
  return { candidates: allocations, short };
}

export async function createPickListFlow(input: z.infer<typeof pickListSchema>) {
  const payload = pickListSchema.parse(input);
  // Ensure the order number is unique even if the operator re-uses one they
  // already typed (the orders table has a unique constraint on order_number).
  // We try the supplied number first, then fall back to suffixed retries.
  const baseOrderNumber = payload.order_number;
  let order: any;
  let attempt = 0;
   
  while (true) {
    const candidateNumber = attempt === 0
      ? baseOrderNumber
      : `${baseOrderNumber}-${Date.now().toString().slice(-6)}${attempt > 1 ? `-${attempt}` : ""}`;
    const { data: existing } = await db("orders")
      .select("id")
      .eq("order_number", candidateNumber)
      .maybeSingle();
    if (existing) {
      attempt += 1;
      if (attempt > 5) throw new Error("Could not allocate a unique order number — try a different one.");
      continue;
    }
    order = await upsertRecord("orders", {
      order_number: candidateNumber,
      client_id: payload.client_id,
      warehouse_id: payload.warehouse_id,
      requested_ship_date: payload.requested_ship_date || null,
      status: "queued",
      notes: payload.notes || null,
    });
    break;
  }

  const pickList = await upsertRecord("pick_lists", {
    pick_list_number: buildPalletCode("PKL"),
    warehouse_id: payload.warehouse_id,
    client_id: payload.client_id,
    order_id: order.id,
    consolidated: payload.lines.length > 1,
    status: "queued",
    released_at: new Date().toISOString(),
    notes: payload.notes || null,
  });

  for (const line of payload.lines) {
    const orderLine = await upsertRecord("order_lines", {
      order_id: order.id,
      product_id: line.product_id,
      quantity: line.quantity,
    });

    const selection = await selectPickCandidates(line.product_id, payload.warehouse_id, line.quantity);
    for (const candidate of selection.candidates) {
      await upsertRecord("pick_tasks", {
        task_number: buildPalletCode("PKT"),
        pick_list_id: pickList.id,
        order_line_id: orderLine.id,
        pallet_id: candidate.pallet_id,
        location_id: candidate.location_id ?? null,
        // Each task requests this pallet's FULL quantity — see
        // allocatePickQuantities — so a multi-pallet product is split into
        // one task per whole pallet, rolling up to the next full pallet
        // when one alone doesn't cover the line quantity (may exceed it).
        requested_quantity: candidate.allocated_quantity,
        status: selection.short > 0 ? "exception" : "queued",
        short_reason: selection.short > 0 ? `Short by ${selection.short}` : null,
      });
    }
  }

  await createLabelRecord("pick_list", pickList.id, pickList.pick_list_number);
  return pickList;
}

export async function listPickLists(warehouseId?: string | null) {
  let query = db("pick_lists")
    .select("*, pick_tasks(*, pallets:pallets!pick_tasks_pallet_id_fkey(pallet_barcode, pallet_code, quantity, available_quantity, products(*)), locations:locations!pick_tasks_location_id_fkey(code, aisle, bay, level, position))")
    .order("created_at", { ascending: false });
  if (warehouseId) {
    query = query.eq("warehouse_id", warehouseId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getPickExecution(pickListId: string) {
  const [pickList, pickTasks] = await Promise.all([
    db("pick_lists").select("*").eq("id", pickListId).single(),
    db("pick_tasks")
      .select("*, pallets:pallets!pick_tasks_pallet_id_fkey(pallet_barcode, pallet_code, quantity, available_quantity, products(sku, name)), locations:locations!pick_tasks_location_id_fkey(code, aisle, bay, level, position)")
      .eq("pick_list_id", pickListId)
      .order("created_at", { ascending: true }),
  ]);

  if (pickList.error) throw pickList.error;
  if (pickTasks.error) throw pickTasks.error;

  const enrichedTasks = await Promise.all(
    (pickTasks.data ?? []).map(async (task: any) => {
      if (!task.pallet_id || task.locations?.code) return task;
      const { data: balance } = await db("inventory_balances")
        .select("available_quantity, quantity, locations:location_id(code, aisle, bay, level, position)")
        .eq("pallet_id", task.pallet_id)
        .maybeSingle();
      return { ...task, pick_balance: balance ?? null };
    }),
  );

  return {
    pickList: pickList.data,
    pickTasks: enrichedTasks,
  };
}

/**
 * Thrown when the pallet backing a pick task can no longer fulfil the
 * requested/confirmed quantity (e.g. it was depleted by another pick,
 * transfer, or adjustment after this task was created). Callers can catch
 * this specifically — via `instanceof` — to offer the operator an override
 * rather than treating it as a generic failure. The message is also
 * prefixed so any consumer that only sees a stringified error (e.g. the
 * offline dead-letter queue) can still recognise it.
 */
export class PickQuantityAnomalyError extends Error {
  readonly code = "PICK_QTY_ANOMALY" as const;
  readonly availableQuantity: number;
  readonly requestedQuantity: number;

  constructor(message: string, availableQuantity: number, requestedQuantity: number) {
    super(`PICK_QTY_ANOMALY: ${message}`);
    this.name = "PickQuantityAnomalyError";
    this.availableQuantity = availableQuantity;
    this.requestedQuantity = requestedQuantity;
  }
}

export type PickSourcePreview = {
  sku: string;
  requested_quantity: number;
  scanned_available_quantity: number;
  quantity_variance: boolean;
  variance_delta: number;
  directed_pallet_id: string;
  directed_location_id: string | null;
  scanned_pallet_id: string;
  scanned_pallet_barcode: string;
  scanned_location_id: string;
  scanned_location_code: string;
  source_override: boolean;
};

export async function previewPickSourceOverride(taskId: string, pickListCode: string, scannedPallet: string) {
  const { data, error } = await (supabase.rpc as any)("preview_pick_source_override", {
    in_task_id: taskId,
    in_pick_list_code: pickListCode,
    in_scanned_pallet_barcode: scannedPallet,
  });
  if (error) throw new Error(String(error.message ?? error.details ?? "Could not verify the alternate pallet."));
  return data as PickSourcePreview;
}

export async function confirmPickTask(
  taskId: string,
  pickListCode: string,
  scannedPallet: string,
  confirmedQuantity: number,
  allowQuantityAnomaly = false,
  confirmSourceOverride = false,
  allowSourceQuantityVariance = false,
) {
  const { data, error } = await (supabase.rpc as any)("confirm_pick_task", {
    in_task_id: taskId,
    in_pick_list_code: pickListCode,
    in_scanned_pallet_barcode: scannedPallet,
    in_confirmed_quantity: confirmedQuantity,
    in_allow_quantity_anomaly: allowQuantityAnomaly,
    in_confirm_source_override: confirmSourceOverride,
    in_allow_source_quantity_variance: allowSourceQuantityVariance,
  });
  if (!error) return data;

  const message = String(error.message ?? error.details ?? "Pick confirmation failed");
  const anomaly = /PICK_QTY_ANOMALY:\s*available=([\d.]+);requested=([\d.]+)/i.exec(message);
  if (anomaly) {
    throw new PickQuantityAnomalyError(
      `Cannot pick ${anomaly[2]}; only ${anomaly[1]} available on this pallet.`,
      Number(anomaly[1]),
      Number(anomaly[2]),
    );
  }
  throw new Error(message);
}

/**
 * Creates a follow-up pick task on the same order line for the quantity still
 * outstanding after an operator substituted a smaller alternate pallet.
 */
export async function createPickShortfallTask(taskId: string, quantity: number) {
  const { data, error } = await (supabase.rpc as any)("create_pick_shortfall_task", {
    in_task_id: taskId,
    in_quantity: quantity,
  });
  if (error) throw new Error(String(error.message ?? error.details ?? "Could not create the follow-up pick task."));
  return data as { task_id: string; task_number: string; pallet_found: boolean };
}

export async function cancelPickList(pickListId: string, reason?: string) {
  const { data: pickList, error: pickListError } = await db("pick_lists")
    .select("*, pick_tasks(id, status)")
    .eq("id", pickListId)
    .single();
  if (pickListError) throw pickListError;
  if (["completed", "cancelled"].includes(pickList.status)) {
    throw new Error("Pick list is already closed.");
  }

  const trimmedReason = reason?.trim() || null;
  const noteSuffix = trimmedReason ? `Cancelled: ${trimmedReason}` : "Cancelled";
  const nextNotes = pickList.notes ? `${pickList.notes} · ${noteSuffix}` : noteSuffix;

  const openTaskIds = (pickList.pick_tasks ?? [])
    .filter((t: any) => !["completed", "cancelled"].includes(t.status))
    .map((t: any) => t.id);

  await db("pick_lists")
    .update({ status: "cancelled", notes: nextNotes })
    .eq("id", pickListId);

  if (openTaskIds.length > 0) {
    await db("pick_tasks")
      .update({ status: "cancelled", short_reason: trimmedReason })
      .in("id", openTaskIds);
  }

  if (pickList.order_id) {
    await db("orders").update({ status: "cancelled" }).eq("id", pickList.order_id);
  }

  const cancelAudit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "pick_list_cancelled",
    in_entity_table: "pick_lists",
    in_entity_id: pickListId,
    in_warehouse_id: pickList.warehouse_id,
    in_metadata: { reason: trimmedReason } as any,
  });
  if (cancelAudit.error) console.error("[cancelPickList] log_audit_event failed:", cancelAudit.error);
}
