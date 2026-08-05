import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  formatSupabaseError,
  throwIfSupabaseError,
  pickListSchema,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  PICK_COMPLETED_INVENTORY_STATUS,
  type InventoryStatus,
} from "@/features/shared/core-types";
import { normalizeRackLocationCode } from "@/features/setup/setup-core";
import { upsertRecord } from "@/features/admin/admin-core";
import { createLabelRecord } from "@/features/receiving/receiving-core";
import { writeSystemLog } from "@/features/system/system-core";

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

  const sorted = [...(data ?? [])].sort((left, right) => {
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
  // eslint-disable-next-line no-constant-condition
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
    .select("*, pick_tasks(*, pallets(pallet_barcode, pallet_code, quantity, available_quantity, products(*)), locations:location_id(code, aisle, bay, level, position))")
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
      .select("*, pallets(pallet_barcode, pallet_code, quantity, available_quantity, products(sku, name)), locations:location_id(code, aisle, bay, level, position)")
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

export async function confirmPickTask(
  taskId: string,
  scannedLocation: string,
  scannedPallet: string,
  confirmedQuantity: number,
  shortReason?: string,
  override = false,
) {
  const { data: task, error: taskError } = await db("pick_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (taskError) throw taskError;

  if (!task.pallet_id) {
    throw new Error("Task is not linked to a pallet.");
  }
  if (["completed", "cancelled"].includes(task.status)) {
    throw new Error("Pick task is already closed. Refresh the pick list.");
  }
  if (!Number.isFinite(Number(confirmedQuantity)) || Number(confirmedQuantity) <= 0) {
    throw new Error("Confirmed pick quantity must be greater than zero.");
  }

  const [{ data: pallet, error: palletError }, { data: balance, error: balanceError }] = await Promise.all([
    db("pallets").select("*").eq("id", task.pallet_id).single(),
    db("inventory_balances").select("*").eq("pallet_id", task.pallet_id).single(),
  ]);

  if (palletError) throw palletError;
  if (balanceError) throw balanceError;
  if (pallet.pallet_barcode !== scannedPallet) {
    throw new Error("Scanned pallet does not match the task.");
  }

  const location = balance.location_id
    ? await db("locations").select("*").eq("id", balance.location_id).single()
    : { data: null, error: null };
  if (location.error) throw location.error;
  if (location.data && normalizeRackLocationCode(location.data.code) !== normalizeRackLocationCode(scannedLocation)) {
    throw new Error("Scanned location does not match the suggested pick location.");
  }

  let nextBalanceQuantity = Number(balance.quantity ?? 0);
  let fullyDepleted = false;
  let quantityAnomaly = false;

  // effectiveQuantity is what actually gets debited/recorded. It starts as
  // the caller's confirmedQuantity, but is clamped down to the pallet's true
  // available quantity when an override resolves an anomaly below.
  let effectiveQuantity = Number(confirmedQuantity);

  if (effectiveQuantity > 0) {
    const trueAvailable = Number(balance.available_quantity ?? 0);
    const wholePalletQuantity = Number(balance.available_quantity ?? pallet.available_quantity ?? task.requested_quantity ?? 0);

    if (effectiveQuantity > trueAvailable) {
      // Someone/something else (another pick, transfer, or adjustment) has
      // debited this pallet since the task was created or the screen was
      // loaded, so the requested/confirmed quantity can no longer be
      // fulfilled from this pallet alone.
      if (!override) {
        throw new PickQuantityAnomalyError(
          `Cannot pick ${effectiveQuantity}; only ${trueAvailable} available on this pallet.`,
          trueAvailable,
          Number(task.requested_quantity ?? effectiveQuantity),
        );
      }
      if (trueAvailable <= 0) {
        throw new Error("This pallet has no remaining stock to pick. Cancel or reassign this pick task.");
      }
      // Operator re-scanned the pallet and confirmed the true remaining
      // quantity — proceed with that instead of the stale/expected amount,
      // and flag the discrepancy so it gets logged below.
      effectiveQuantity = trueAvailable;
      quantityAnomaly = true;
    } else if (effectiveQuantity !== wholePalletQuantity) {
      throw new Error(`Partial picks are disabled. Confirm the full pallet quantity of ${wholePalletQuantity}.`);
    }

    const nextAvailable = Math.max(balance.available_quantity - effectiveQuantity, 0);
    const nextStatus: InventoryStatus = nextAvailable === 0 ? PICK_COMPLETED_INVENTORY_STATUS : "available";
    fullyDepleted = nextAvailable === 0;
    const nextPalletQuantity = Math.max(Number(pallet.quantity ?? 0) - effectiveQuantity, 0);
    nextBalanceQuantity = Math.max(Number(balance.quantity ?? 0) - effectiveQuantity, 0);

    const palletUpdate = await db("pallets")
      .update(
        fullyDepleted
          ? {
              available_quantity: 0,
              quantity: 0,
              reserved_quantity: 0,
              status: nextStatus,
              current_location_id: null,
              is_stored: false,
            }
          : {
              available_quantity: nextAvailable,
              quantity: nextPalletQuantity,
              status: nextStatus,
            },
      )
      .eq("id", pallet.id);
    throwIfSupabaseError(palletUpdate, "Could not debit picked pallet.");

    const balanceUpdate = await db("inventory_balances")
      .update(
        fullyDepleted
          ? {
              available_quantity: 0,
              quantity: 0,
              reserved_quantity: 0,
              status: nextStatus,
              location_id: null,
              zone_id: null,
            }
          : {
              available_quantity: nextAvailable,
              quantity: nextBalanceQuantity,
              status: nextStatus,
            },
      )
      .eq("id", balance.id);
    throwIfSupabaseError(balanceUpdate, "Could not debit picked inventory balance.");
  }

  const requestedQuantity = Number(task.requested_quantity ?? 0);
  const autoShortReason = quantityAnomaly && effectiveQuantity < requestedQuantity
    ? `Override: pallet only had ${effectiveQuantity} available (requested ${requestedQuantity}).`
    : null;
  const finalShortReason = shortReason ?? autoShortReason;

  const taskUpdate = await db("pick_tasks")
    .update({
      confirmed_quantity: effectiveQuantity,
      short_reason: finalShortReason,
      status: finalShortReason ? "exception" : "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", taskId);
  throwIfSupabaseError(taskUpdate, "Could not close pick task after debiting inventory.");

  const pickAudit = await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "pick",
    in_entity_table: "pick_tasks",
    in_entity_id: taskId,
    in_pallet_id: pallet.id,
    in_warehouse_id: balance.warehouse_id,
    in_from_location_id: balance.location_id,
    in_metadata: {
      confirmed_quantity: effectiveQuantity,
      requested_quantity: requestedQuantity,
      short_reason: finalShortReason,
      previous_quantity: Number(balance.quantity ?? 0),
      remaining_quantity: nextBalanceQuantity,
      location_cleared: fullyDepleted,
      override: quantityAnomaly,
    } as any,
  });
  if (pickAudit.error) console.error("[submitPickTaskLine] log_audit_event failed:", pickAudit.error);

  // Notify admins/managers of the pick anomaly via the System Log ("record
  // count" category) so it can be reviewed alongside other inventory-count
  // discrepancies. Non-blocking — the pick itself is already committed.
  if (quantityAnomaly) {
    const shortfall = Math.max(requestedQuantity - effectiveQuantity, 0);
    await writeSystemLog({
      log_type: "record_count",
      severity: "warning",
      title: `Pick quantity anomaly overridden — task ${task.task_number ?? taskId}`,
      message: `Requested ${requestedQuantity}, but pallet ${pallet.pallet_barcode ?? pallet.id} only had ${effectiveQuantity} available at confirm time. Operator overrode the warning and completed the pick for ${effectiveQuantity}${shortfall > 0 ? ` (short by ${shortfall})` : ""}.`,
      source: "picking",
      table_name: "pick_tasks",
      record_count: effectiveQuantity,
      details: {
        task_id: taskId,
        task_number: task.task_number ?? null,
        pick_list_id: task.pick_list_id ?? null,
        pallet_id: pallet.id,
        pallet_barcode: pallet.pallet_barcode ?? null,
        requested_quantity: requestedQuantity,
        confirmed_quantity: effectiveQuantity,
        shortfall,
      },
    }).catch((err) => console.error("[confirmPickTask] writeSystemLog anomaly failed:", err));
  }

  // Roll up the parent pick list if every sibling task is finished.
  if (task.pick_list_id) {
    const { data: siblings } = await db("pick_tasks")
      .select("id, status")
      .eq("pick_list_id", task.pick_list_id);
    const allDone = (siblings ?? []).every((row: any) =>
      ["completed", "cancelled", "exception"].includes(row.status),
    );
    if (allDone && (siblings ?? []).length > 0) {
      const { data: parent } = await db("pick_lists")
        .select("id, status, warehouse_id, order_id")
        .eq("id", task.pick_list_id)
        .single();
      if (parent && !["completed", "cancelled"].includes(parent.status)) {
        await db("pick_lists")
          .update({ status: "completed" })
          .eq("id", parent.id);
        if (parent.order_id) {
          await db("orders").update({ status: "completed" }).eq("id", parent.order_id);
        }
        const completeAudit = await (supabase.rpc as any)("log_audit_event", {
          in_event_type: "pick_list_completed",
          in_entity_table: "pick_lists",
          in_entity_id: parent.id,
          in_warehouse_id: parent.warehouse_id,
          in_metadata: {} as any,
        });
        if (completeAudit.error) console.error("[confirmPickTask] pick_list rollup audit failed:", completeAudit.error);
      }
    }
  }
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
