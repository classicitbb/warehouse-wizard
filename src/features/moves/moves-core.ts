import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  getStoredPalletCount,
  validatePutawayAssignment,
  formatSupabaseError,
  DB_RETIRED_INVENTORY_STATUS_FILTER,
  type TemperatureClass,
} from "@/features/shared/core-types";
import { writeSystemLog } from "@/features/system/system-core";
import { upsertRecord } from "@/features/admin/admin-core";
import { normalizeRackLocationCode } from "@/features/setup/setup-core";
import { assertNotFrozen, getActiveFreeze } from "@/features/cycle-counts/freeze-core";

const MOVE_LOCATION_SELECT =
  "id, code, status, max_pallets, temperature_class, mixed_sku_allowed, mixed_lot_allowed, max_height, zone_id, warehouse_id";
const TERMINAL_PALLET_STATUSES = new Set(["shipped", "cancelled", "retired", "missing"]);
const DB_TERMINAL_PALLET_STATUS_FILTER = "(shipped,cancelled,retired,missing)";

function assertPalletCanMove(status: unknown) {
  const normalizedStatus = String(status ?? "").toLowerCase();
  if (TERMINAL_PALLET_STATUSES.has(normalizedStatus)) {
    throw new Error(`Pallet is ${normalizedStatus} and cannot be moved`);
  }
}

function assertPalletIsPutAway(pallet: { status?: unknown; current_location_id?: unknown; is_stored?: unknown }) {
  if (String(pallet.status ?? "").toLowerCase() === "receiving" || pallet.is_stored === false || !pallet.current_location_id) {
    throw new Error("This pallet needs to be put away before it can be moved.");
  }
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function getLocationCodeCandidates(locationCode: string) {
  const code = String(locationCode ?? "").trim().toUpperCase();
  const candidates = [code];
  const normalizedRackCode = normalizeRackLocationCode(code);
  if (normalizedRackCode && normalizedRackCode !== code) {
    candidates.push(normalizedRackCode);
  }
  const positionMatch = code.match(/-P(\d+)$/i);
  if (positionMatch) {
    const position = Number(positionMatch[1]);
    if (Number.isFinite(position)) {
      candidates.push(code.replace(/-P\d+$/i, `-P${position}`));
      candidates.push(code.replace(/-P\d+$/i, `-P${String(position).padStart(2, "0")}`));
      candidates.push(code.replace(/-P\d+$/i, ""));
    }
  }
  return uniqueValues(candidates);
}

function parseFullLocationScan(locationCode: string) {
  const parts = String(locationCode ?? "").trim().toUpperCase().split("-").filter(Boolean);
  const positionPart = parts.at(-1);
  const levelPart = parts.at(-2);
  if (!positionPart || !levelPart || !/^P\d+$/i.test(positionPart) || !/^L\d+$/i.test(levelPart) || parts.length < 6) {
    return null;
  }

  const bay = parts.at(-3);
  const aisle = parts.at(-4);
  const zoneCode = parts.at(-5);
  const warehouseCode = parts.slice(0, -5).join("-");
  const level = Number(levelPart.replace(/^L/i, ""));
  const position = Number(positionPart.replace(/^P/i, ""));

  if (!warehouseCode || !zoneCode || !aisle || !bay || !Number.isFinite(level) || !Number.isFinite(position)) {
    return null;
  }

  return { warehouseCode, zoneCode, aisle, bay, level, position };
}

async function resolveMoveLocation(locationCode: string) {
  for (const candidate of getLocationCodeCandidates(locationCode)) {
    const { data, error } = await db("locations")
      .select(MOVE_LOCATION_SELECT)
      .eq("code", candidate)
      .maybeSingle();
    if (error) throw error;
    if (data) return data;
  }

  const parsed = parseFullLocationScan(locationCode);
  if (!parsed) return null;

  const { data: warehouse, error: warehouseError } = await db("warehouses")
    .select("id")
    .eq("code", parsed.warehouseCode)
    .maybeSingle();
  if (warehouseError) throw warehouseError;
  if (!warehouse) return null;

  const { data: zone, error: zoneError } = await db("zones")
    .select("id")
    .eq("warehouse_id", warehouse.id)
    .eq("code", parsed.zoneCode)
    .maybeSingle();
  if (zoneError) throw zoneError;
  if (!zone) return null;

  const baseQuery = () =>
    db("locations")
      .select(MOVE_LOCATION_SELECT)
      .eq("warehouse_id", warehouse.id)
      .eq("zone_id", zone.id)
      .eq("aisle", parsed.aisle)
      .eq("bay", parsed.bay)
      .eq("level", parsed.level);

  const { data: positionedLocation, error: positionedError } = await baseQuery()
    .eq("position", parsed.position)
    .maybeSingle();
  if (positionedError) throw positionedError;
  if (positionedLocation) return positionedLocation;

  if (parsed.position === 1) {
    const { data: unpositionedLocation, error: unpositionedError } = await baseQuery().maybeSingle();
    if (unpositionedError) throw unpositionedError;
    if (unpositionedLocation) return unpositionedLocation;
  }

  return null;
}

function moveError(error: unknown, fallback: string) {
  return new Error(formatSupabaseError(error, fallback) || fallback);
}

function getMoveWarehouseId(
  pallet: { warehouse_id?: string | null },
  location: { warehouse_id?: string | null },
  fallback?: string | null,
) {
  return pallet.warehouse_id ?? location.warehouse_id ?? fallback ?? null;
}

export async function listMoveTasks() {
  const { data, error } = await db("move_tasks")
    .select("*, pallets(pallet_barcode, products(*)), from_location:from_location_id(code, aisle, bay, level, depth), to_location:to_location_id(code, aisle, bay, level, depth)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return attachMovePerformedBy(data ?? []);
}

// move_tasks has no completed_by column, but completion/cancellation both write a
// log_audit_event row (actor_user_id = auth.uid()) — reuse that as the "who" for the
// completed-moves list instead of adding a redundant column.
async function attachMovePerformedBy(rows: any[]) {
  const taskIds = rows.map((row) => row?.id).filter(Boolean);
  if (taskIds.length === 0) return rows;

  const { data: events, error: eventsError } = await db("audit_events")
    .select("entity_id, actor_user_id, created_at")
    .eq("entity_table", "move_tasks")
    .in("entity_id", taskIds)
    .in("event_type", ["move_task_completed", "move_task_cancelled"])
    .order("created_at", { ascending: false });
  if (eventsError) throw eventsError;

  const latestEventByTask = new Map<string, { actor_user_id: string | null; created_at: string }>();
  for (const event of (events ?? []) as any[]) {
    if (!latestEventByTask.has(event.entity_id)) latestEventByTask.set(event.entity_id, event);
  }

  const actorIds = Array.from(
    new Set(
      Array.from(latestEventByTask.values())
        .map((event) => event.actor_user_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  let profilesById = new Map<string, { full_name: string | null; email: string | null }>();
  if (actorIds.length > 0) {
    const { data: profiles, error: profilesError } = await db("profiles").select("id, full_name, email").in("id", actorIds);
    if (profilesError) throw profilesError;
    profilesById = new Map((profiles ?? []).map((profile: any) => [profile.id, profile]));
  }

  return rows.map((row: any) => {
    const event = latestEventByTask.get(row.id);
    const actor = event?.actor_user_id ? profilesById.get(event.actor_user_id) ?? null : null;
    return {
      ...row,
      performed_by: actor ? actor.full_name || actor.email || null : null,
      performed_at: event?.created_at ?? row.completed_at ?? null,
    };
  });
}

export async function createMoveTask(palletBarcode: string, toLocationCode: string, reason?: string): Promise<void> {
  const { data: pallet, error: palletErr } = await db("pallets")
    .select("id, current_location_id, warehouse_id:current_warehouse_id")
    .eq("pallet_barcode", palletBarcode)
    .single();
  if (palletErr) throw new Error(`Pallet not found: ${palletBarcode}`);

  const toLocation = await resolveMoveLocation(toLocationCode);
  if (!toLocation) throw new Error(`Location not found: ${toLocationCode}`);
  await assertNotFrozen(pallet.current_location_id, { palletId: pallet.id });
  await assertNotFrozen(toLocation.id, { palletId: pallet.id });

  await upsertRecord("move_tasks", {
    task_number: buildPalletCode("MOV"),
    pallet_id: pallet.id,
    warehouse_id: pallet.warehouse_id,
    from_location_id: pallet.current_location_id,
    to_location_id: toLocation.id,
    status: "queued",
    reason: reason ?? null,
  });
}


// ── Move destination preflight validation ────────────────────────────────────

export type MoveValidationResult =
  | { valid: true; warnings: string[] }
  | { valid: false; reason: string; warnings: string[]; requiresPutaway?: boolean };

/**
 * Pre-flight check before moving a pallet to a location.
 * Returns `valid: true` (possibly with soft warnings) or `valid: false` with a
 * human-readable `reason` the UI can display to the operator.
 */
export async function validateMoveDestination(
  palletBarcode: string,
  locationCode: string,
): Promise<MoveValidationResult> {
  const warnings: string[] = [];

  const palletKey = String(palletBarcode ?? "").trim();
  const locationKey = String(locationCode ?? "").trim().toUpperCase();
  if (!palletKey) {
    return { valid: false, reason: "Scan a pallet barcode first", warnings };
  }
  if (!locationKey) {
    return { valid: false, reason: "Scan a destination location", warnings };
  }

  // ── Fetch pallet ──────────────────────────────────────────────────────────
  const { data: pallet, error: palletErr } = await db("pallets")
    .select("id, product_id, warehouse_id:current_warehouse_id, current_location_id, status, is_stored")
    .eq("pallet_barcode", palletKey)
    .maybeSingle();
  if (palletErr) {
    console.error("[validateMoveDestination] pallet lookup failed", palletErr);
    return { valid: false, reason: `Pallet lookup failed: ${(palletErr as any)?.message ?? "unknown error"}`, warnings };
  }
  if (!pallet) {
    return { valid: false, reason: `Pallet "${palletKey}" not found`, warnings };
  }
  try {
    assertPalletCanMove(pallet.status);
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "Pallet cannot be moved", warnings };
  }
  try {
    assertPalletIsPutAway(pallet);
  } catch (error) {
    return { valid: false, reason: error instanceof Error ? error.message : "This pallet needs to be put away before it can be moved.", warnings, requiresPutaway: true };
  }

  // ── Fetch location ────────────────────────────────────────────────────────
  const location = await resolveMoveLocation(locationKey);
  if (!location) {
    return { valid: false, reason: `Location "${locationKey}" does not exist`, warnings };
  }
  if (location.status !== "active") {
    return {
      valid: false,
      reason: `Location ${locationCode.toUpperCase()} is ${location.status ?? "inactive"} — moves are not permitted`,
      warnings,
    };
  }

  const [sourceFreeze, destinationFreeze] = await Promise.all([
    pallet.current_location_id ? getActiveFreeze(pallet.current_location_id, { palletId: pallet.id }) : Promise.resolve(null),
    getActiveFreeze(location.id, { palletId: pallet.id }),
  ]);
  if (sourceFreeze || destinationFreeze) {
    const freeze = sourceFreeze ?? destinationFreeze;
    return {
      valid: false,
      reason: `Location is locked by cycle count ${freeze?.cycle_counts?.count_number ?? freeze?.cycle_count_id}. Notify a supervisor before moving this pallet.`,
      warnings,
    };
  }

  // ── Warehouse boundary ────────────────────────────────────────────────────
  if (location.warehouse_id && pallet.warehouse_id && location.warehouse_id !== pallet.warehouse_id) {
    return {
      valid: false,
      reason: "Destination location belongs to a different warehouse than the pallet",
      warnings,
    };
  }

  // ── Capacity ──────────────────────────────────────────────────────────────
  const maxPallets = Number(location.max_pallets ?? 0);
  if (maxPallets > 0) {
    const occupied = await getStoredPalletCount(location.id);
    // Check whether this pallet is already at the location (would be a no-op but not a capacity problem)
    const alreadyHere = pallet.current_location_id === location.id;
    if (!alreadyHere && occupied >= maxPallets) {
      return {
        valid: false,
        reason: `Location ${locationCode.toUpperCase()} is full (${occupied}/${maxPallets} pallets)`,
        warnings,
      };
    }
    if (!alreadyHere && occupied >= maxPallets - 1 && maxPallets > 1) {
      warnings.push(`Location will be at capacity after this move (${occupied + 1}/${maxPallets})`);
    }
  }

  // ── Temperature ───────────────────────────────────────────────────────────
  if (pallet.product_id) {
    const { data: product } = await db("products")
      .select("temperature_requirement, sku, height")
      .eq("id", pallet.product_id)
      .maybeSingle();
    if (product) {
      const productTemp = (product.temperature_requirement ?? "ambient") as TemperatureClass;
      const locTemp = (location.temperature_class ?? "ambient") as TemperatureClass;
      if (productTemp === "cool" && locTemp !== "cool") {
        return {
          valid: false,
          reason: `Cool-chain product (${product.sku}) cannot be placed in an ambient location`,
          warnings,
        };
      }
      if (productTemp === "ambient" && locTemp === "cool") {
        warnings.push(`Moving an ambient product into a cool-chain location — verify this is intentional`);
      }

      // ── Height ─────────────────────────────────────────────────────────────
      const palletH = Number(product.height ?? 0);
      const locH = Number((location as any).max_height ?? (location as any).max_pallet_height_cm ?? 0);
      if (palletH > 0 && locH > 0 && palletH > locH) {
        return {
          valid: false,
          reason: `Pallet height ${palletH} cm exceeds location ceiling of ${locH} cm`,
          warnings,
        };
      }

      // ── Mixed SKU ──────────────────────────────────────────────────────────
      if (location.mixed_sku_allowed === false) {
        // Check if there's already a different SKU in this location
        const { data: existingBalances } = await db("inventory_balances")
          .select("pallets:pallet_id(product_id)")
          .eq("location_id", location.id)
          .not("pallet_id", "eq", pallet.id)
          .not("status", "in", DB_RETIRED_INVENTORY_STATUS_FILTER)
          .limit(1);
        const otherProductId = (existingBalances as any[])?.[0]?.pallets?.product_id;
        if (otherProductId && otherProductId !== pallet.product_id) {
          return {
            valid: false,
            reason: `Location ${locationCode.toUpperCase()} does not allow mixed-SKU storage`,
            warnings,
          };
        }
      }
    }
  }

  // ── Same location (no-op warning) ─────────────────────────────────────────
  if (pallet.current_location_id === location.id) {
    warnings.push("Pallet is already at this location — move will record but not change anything");
  }

  return { valid: true, warnings };
}

export async function completeDirectMove(palletBarcode: string, locationCode: string, reason?: string): Promise<void> {
  const { data: pallet, error: palletErr } = await db("pallets")
    .select("id, current_location_id, warehouse_id:current_warehouse_id, status, is_stored")
    .eq("pallet_barcode", palletBarcode)
    .single();
  if (palletErr) throw new Error(`Pallet not found: ${palletBarcode}`);
  assertPalletCanMove(pallet.status);
  assertPalletIsPutAway(pallet);

  const toLocation = await resolveMoveLocation(locationCode);
  if (!toLocation) throw new Error(`Location not found: ${locationCode}`);
  await assertNotFrozen(pallet.current_location_id, { palletId: pallet.id });
  await assertNotFrozen(toLocation.id, { palletId: pallet.id });
  const warehouseId = getMoveWarehouseId(pallet, toLocation);
  if (!warehouseId) throw new Error("Destination warehouse could not be resolved for this move");

  // Relocate the inventory balance first, and confirm a row actually moved, before
  // touching the pallet or recording the task as completed. A `.update().eq()` that
  // matches zero rows returns no error — updating the pallet first let it silently
  // point at a new location while inventory_balances (what Inventory Search/Detail
  // reads) stayed behind, so a repeat move to the same spot looked like a no-op.
  const { data: balanceUpdRows, error: balanceUpdErr } = await db("inventory_balances")
    .update({ warehouse_id: warehouseId, location_id: toLocation.id, zone_id: toLocation.zone_id ?? null } as any)
    .eq("pallet_id", pallet.id)
    .not("status", "in", DB_TERMINAL_PALLET_STATUS_FILTER)
    .select("id");
  if (balanceUpdErr) throw moveError(balanceUpdErr, "Inventory balance update failed");
  if (!balanceUpdRows?.length) {
    throw new Error("No active inventory balance found for this pallet — move was not completed. Contact a supervisor to reconcile inventory before retrying.");
  }

  const { error: palletUpdErr } = await db("pallets")
    .update({ current_location_id: toLocation.id, current_warehouse_id: warehouseId } as any)
    .eq("id", pallet.id);
  if (palletUpdErr) throw moveError(palletUpdErr, "Pallet location update failed");

  const completedAt = new Date().toISOString();
  let task;
  try {
    task = await upsertRecord("move_tasks", {
      task_number: buildPalletCode("MOV"),
      pallet_id: pallet.id,
      warehouse_id: warehouseId,
      from_location_id: pallet.current_location_id,
      to_location_id: toLocation.id,
      status: "completed",
      reason: reason ?? null,
      completed_at: completedAt,
    });
  } catch (error) {
    throw moveError(error, "Move task creation failed");
  }

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "move_task_completed",
    in_entity_table: "move_tasks",
    in_entity_id: (task as any).id,
    in_warehouse_id: warehouseId,
    in_metadata: {
      task_number: (task as any).task_number,
      pallet_barcode: palletBarcode,
      to_location_code: locationCode,
      reason: reason ?? null,
    },
  });
}

export async function completeMoveTask(taskId: string, scannedPalletBarcode: string, scannedLocationCode: string): Promise<void> {
  const { data: task, error: taskErr } = await db("move_tasks").select("*").eq("id", taskId).single();
  if (taskErr) throw moveError(taskErr, "Move task lookup failed");
  if (["completed", "cancelled"].includes(task.status)) {
    throw new Error("Move task is already closed.");
  }

  const { data: pallet, error: palletErr } = await db("pallets")
    .select("id, pallet_barcode, current_location_id, warehouse_id:current_warehouse_id, status, is_stored")
    .eq("pallet_barcode", scannedPalletBarcode)
    .single();
  if (palletErr) throw new Error(`Pallet not found: ${scannedPalletBarcode}`);
  assertPalletCanMove(pallet.status);
  assertPalletIsPutAway(pallet);
  if (task.pallet_id !== pallet.id) {
    throw new Error("Scanned pallet does not match this move task.");
  }

  const toLocation = await resolveMoveLocation(scannedLocationCode);
  if (!toLocation) throw new Error(`Location not found: ${scannedLocationCode}`);
  await assertNotFrozen(pallet.current_location_id, { palletId: pallet.id });
  await assertNotFrozen(toLocation.id, { palletId: pallet.id });
  const warehouseId = getMoveWarehouseId(pallet, toLocation, task.warehouse_id);
  if (!warehouseId) throw new Error("Destination warehouse could not be resolved for this move");

  // See completeDirectMove: relocate + verify the inventory balance before the
  // pallet or task record, so a silently-unmatched update can't leave pallets
  // and inventory_balances pointing at two different locations.
  const { data: balanceUpdRows, error: balanceUpdErr } = await db("inventory_balances")
    .update({ warehouse_id: warehouseId, location_id: toLocation.id, zone_id: toLocation.zone_id ?? null } as any)
    .eq("pallet_id", pallet.id)
    .not("status", "in", DB_TERMINAL_PALLET_STATUS_FILTER)
    .select("id");
  if (balanceUpdErr) throw moveError(balanceUpdErr, "Inventory balance update failed");
  if (!balanceUpdRows?.length) {
    throw new Error("No active inventory balance found for this pallet — move was not completed. Contact a supervisor to reconcile inventory before retrying.");
  }

  const { error: palletUpdErr } = await db("pallets")
    .update({ current_location_id: toLocation.id, current_warehouse_id: warehouseId } as any)
    .eq("id", pallet.id);
  if (palletUpdErr) throw moveError(palletUpdErr, "Pallet location update failed");

  const { error: taskUpdErr } = await db("move_tasks")
    .update({ status: "completed", to_location_id: toLocation.id, completed_at: new Date().toISOString() } as any)
    .eq("id", taskId);
  if (taskUpdErr) throw moveError(taskUpdErr, "Move task completion update failed");

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "move_task_completed",
    in_entity_table: "move_tasks",
    in_entity_id: taskId,
    in_warehouse_id: warehouseId,
    in_metadata: { pallet_barcode: scannedPalletBarcode, to_location: scannedLocationCode },
  });
}

export async function cancelMoveTask(taskId: string): Promise<void> {
  const { data: task, error: taskErr } = await db("move_tasks").select("*").eq("id", taskId).single();
  if (taskErr) throw taskErr;
  if (!["queued", "in_progress"].includes(task.status)) {
    throw new Error("Only queued or in-progress move tasks can be cancelled.");
  }

  const { error: taskUpdErr } = await db("move_tasks")
    .update({ status: "cancelled" } as any)
    .eq("id", taskId);
  if (taskUpdErr) throw taskUpdErr;

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "move_task_cancelled",
    in_entity_table: "move_tasks",
    in_entity_id: taskId,
    in_warehouse_id: task.warehouse_id,
    in_metadata: { pallet_id: task.pallet_id, from_location_id: task.from_location_id, to_location_id: task.to_location_id },
  });
}

export async function moveToPickingArea(palletBarcode: string): Promise<void> {
  const { data: pallet, error: palletErr } = await db("pallets")
    .select("id, warehouse_id:current_warehouse_id")
    .eq("pallet_barcode", palletBarcode)
    .single();
  if (palletErr) throw new Error(`Pallet not found: ${palletBarcode}`);

  const { data: stagingLoc, error: locErr } = await db("locations")
    .select("id")
    .eq("warehouse_id", pallet.warehouse_id)
    .eq("is_staging", true)
    .limit(1)
    .maybeSingle();
  if (locErr) throw locErr;

  const toLocationId = stagingLoc?.id ?? null;
  const { error: updErr } = await db("pallets")
    .update({ current_location_id: toLocationId } as any)
    .eq("id", pallet.id);
  if (updErr) throw updErr;

  await (supabase.rpc as any)("log_audit_event", {
    in_event_type: "pallet_moved_to_picking_area",
    in_entity_table: "pallets",
    in_entity_id: pallet.id,
    in_warehouse_id: pallet.warehouse_id,
    in_metadata: { pallet_barcode: palletBarcode },
  });
}
