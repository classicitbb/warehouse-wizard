import { createLabelRecord } from "@/features/receiving/receiving-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  cycleCountSchema,
  formatSupabaseError,
  throwIfSupabaseError,
} from "@/features/shared/core-types";
import { upsertRecord } from "@/features/admin/admin-core";
import { releaseCycleCountFreezes } from "@/features/cycle-counts/freeze-core";

const TERMINAL_LINE_STATUSES = new Set(["adjusted", "reconciled", "exception"]);
const CANCELLED_ARCHIVE_NOTE = "[archived] Cancelled count archived by supervisor.";
const CANCELLABLE_COUNT_STATUSES = new Set(["draft", "frozen", "counting", "review", "approved"]);
const CYCLE_COUNT_NUMBER_TIMESTAMP_DIGITS = 14;

export function canCancelCycleCount(status: unknown) {
  return CANCELLABLE_COUNT_STATUSES.has(String(status ?? "").toLowerCase());
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

async function currentUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user?.id) throw new Error("Sign in is required for cycle-count actions.");
  return data.user.id;
}

function variancePercent(expectedQuantity: number, varianceQuantity: number) {
  if (expectedQuantity === 0) return varianceQuantity === 0 ? 0 : 100;
  return Math.abs((varianceQuantity / expectedQuantity) * 100);
}

function cycleCountTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    pad(date.getDate()),
    pad(date.getMonth() + 1),
    date.getFullYear(),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function cycleCountSequence(countNumber: string | null | undefined) {
  const value = String(countNumber ?? "");
  if (!value.startsWith("CCT-")) return null;
  const body = value.slice("CCT-".length);
  if (body.length <= CYCLE_COUNT_NUMBER_TIMESTAMP_DIGITS) return null;
  const sequence = Number(body.slice(0, -CYCLE_COUNT_NUMBER_TIMESTAMP_DIGITS));
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

async function buildCycleCountNumber() {
  const { data, error } = await db("cycle_counts")
    .select("count_number")
    .like("count_number", "CCT-%");
  if (error) throw new Error(formatSupabaseError(error, "Could not build cycle-count number."));

  const nextSequence = (data ?? [])
    .map((row: any) => cycleCountSequence(row.count_number))
    .filter((sequence: number | null): sequence is number => sequence !== null)
    .reduce((max: number, sequence: number) => Math.max(max, sequence), 0) + 1;

  return `CCT-${nextSequence}${cycleCountTimestamp()}`;
}

function isReviewRequired(input: {
  varianceQuantity: number;
  variancePercent: number;
  thresholdPercent: number;
  unitCost?: number | null;
  valueFloor?: number | null;
}) {
  const percentHit = Math.abs(input.variancePercent) > Number(input.thresholdPercent ?? 0);
  const varianceValue = Math.abs(input.varianceQuantity) * Number(input.unitCost ?? 0);
  const valueHit = Number(input.unitCost ?? 0) > 0 && varianceValue >= Number(input.valueFloor ?? 0);
  return { reviewRequired: percentHit || valueHit, varianceValue };
}

async function holdLocationStock(locationId: string) {
  const { data: balances, error } = await db("inventory_balances")
    .select("id, pallet_id, available_quantity, held_quantity")
    .eq("location_id", locationId)
    .eq("status", "available")
    .gt("available_quantity", 0);
  if (error) throw new Error(formatSupabaseError(error, "Could not load stock to freeze."));

  for (const balance of balances ?? []) {
    const availableQuantity = Number(balance.available_quantity ?? 0);
    if (availableQuantity <= 0) continue;

    const balanceUpdate = await db("inventory_balances")
      .update({
        available_quantity: 0,
        held_quantity: Number(balance.held_quantity ?? 0) + availableQuantity,
      } as any)
      .eq("id", balance.id);
    throwIfSupabaseError(balanceUpdate, "Could not freeze inventory balance.");

    if (balance.pallet_id) {
      const { data: pallet, error: palletError } = await db("pallets")
        .select("available_quantity, held_quantity")
        .eq("id", balance.pallet_id)
        .maybeSingle();
      if (palletError) throw new Error(formatSupabaseError(palletError, "Could not load pallet to freeze."));
      if (pallet) {
        const palletAvailable = Number(pallet.available_quantity ?? 0);
        const palletUpdate = await db("pallets")
          .update({
            available_quantity: 0,
            held_quantity: Number(pallet.held_quantity ?? 0) + palletAvailable,
          } as any)
          .eq("id", balance.pallet_id);
        throwIfSupabaseError(palletUpdate, "Could not freeze pallet.");
      }
    }
  }
}

function isMissingColumn(error: any, column: string) {
  return error?.code === "42703" && String(error?.message ?? "").includes(column);
}

const COUNTING_ROLE_CODES = new Set(["developer", "admin", "warehouse_manager", "warehouse_supervisor", "inventory_clerk", "warehouse_operator"]);

export async function listCycleCountProductIds(input: { warehouseId: string; zoneIds?: string[]; locationIds?: string[] }) {
  let query = db("inventory_balances")
    .select("product_id")
    .eq("warehouse_id", input.warehouseId)
    .eq("status", "available")
    .gt("available_quantity", 0)
    .not("location_id", "is", null);
  if (input.locationIds?.length) query = query.in("location_id", input.locationIds);
  else if (input.zoneIds?.length) query = query.in("zone_id", input.zoneIds);
  const { data, error } = await query;
  if (error) throw new Error(formatSupabaseError(error, "Could not load countable products."));
  return Array.from(new Set((data ?? []).map((row: any) => row.product_id).filter(Boolean)));
}

export async function listCycleCountAssignees(warehouseId: string) {
  const { data: roleRows, error: roleError } = await db("user_roles")
    .select("user_id, roles(code)")
    .eq("warehouse_id", warehouseId)
    .eq("is_hidden", false);
  if (roleError) throw new Error(formatSupabaseError(roleError, "Could not load warehouse count permissions."));

  const eligibleUserIds = Array.from(new Set((roleRows ?? [])
    .filter((row: any) => {
      const roles = Array.isArray(row.roles) ? row.roles : [row.roles];
      return roles.some((role: any) => COUNTING_ROLE_CODES.has(role?.code));
    })
    .map((row: any) => row.user_id)
    .filter(Boolean)));
  if (eligibleUserIds.length === 0) return [];

  const { data: profiles, error: profileError } = await db("profiles")
    .select("id, full_name")
    .in("id", eligibleUserIds)
    .eq("approved", true)
    .eq("active", true)
    .order("full_name", { ascending: true });
  if (profileError) throw new Error(formatSupabaseError(profileError, "Could not load approved counters."));
  return profiles ?? [];
}

export async function createCycleCountFlow(input: z.infer<typeof cycleCountSchema>) {
  const payload = cycleCountSchema.parse(input);
  const userId = await currentUserId();
  const selectedZoneIds = Array.from(new Set([
    ...payload.zone_ids,
    ...(payload.zone_id ? [payload.zone_id] : []),
  ]));
  const selectedLocationIds = Array.from(new Set([
    ...payload.location_ids,
    ...(payload.location_id ? [payload.location_id] : []),
  ]));
  const selectedProductIds = Array.from(new Set([
    ...payload.product_ids,
    ...(payload.product_id ? [payload.product_id] : []),
  ]));
  const selectedAssigneeIds = Array.from(new Set([
    ...payload.assigned_user_ids,
    ...(payload.assigned_user_id ? [payload.assigned_user_id] : []),
  ]));

  const { data: warehouse, error: warehouseError } = await db("warehouses")
    .select("freeze_default_hours")
    .eq("id", payload.warehouse_id)
    .maybeSingle();
  if (warehouseError) throw new Error(formatSupabaseError(warehouseError, "Could not load warehouse settings."));

  if (selectedZoneIds.length > 0) {
    const { data: selectedZones, error: zoneError } = await db("zones")
      .select("id")
      .eq("warehouse_id", payload.warehouse_id)
      .in("id", selectedZoneIds);
    if (zoneError) throw new Error(formatSupabaseError(zoneError, "Could not validate the selected zones."));
    if ((selectedZones ?? []).length !== selectedZoneIds.length) {
      throw new Error("Every selected zone must belong to the active warehouse.");
    }
  }

  if (selectedLocationIds.length > 0) {
    const { data: selectedLocations, error: locationError } = await db("locations")
      .select("id, zone_id")
      .eq("warehouse_id", payload.warehouse_id)
      .in("id", selectedLocationIds);
    if (locationError) throw new Error(formatSupabaseError(locationError, "Could not validate the selected locations."));
    if ((selectedLocations ?? []).length !== selectedLocationIds.length || (selectedZoneIds.length > 0 && (selectedLocations ?? []).some((location: any) => !selectedZoneIds.includes(location.zone_id)))) {
      throw new Error("Every selected location must belong to the active warehouse and selected zones.");
    }
  }

  if (selectedProductIds.length > 0) {
    const countableProductIds = await listCycleCountProductIds({
      warehouseId: payload.warehouse_id,
      zoneIds: selectedZoneIds,
      locationIds: selectedLocationIds,
    });
    if (selectedProductIds.some((productId) => !countableProductIds.includes(productId))) {
      throw new Error("Every selected product must have available stock in the current warehouse scope.");
    }
  }

  if (selectedAssigneeIds.length > 0) {
    const eligibleAssigneeIds = new Set((await listCycleCountAssignees(payload.warehouse_id)).map((profile: any) => profile.id));
    if (selectedAssigneeIds.some((userId) => !eligibleAssigneeIds.has(userId))) {
      throw new Error("Every assigned counter must be approved, authorized, and assigned to the active warehouse.");
    }
  }

  const now = new Date();
  const freezeHours = Number(payload.freeze_hours ?? warehouse?.freeze_default_hours ?? 4);
  const freezeExpiresAt = addHours(now, Number.isFinite(freezeHours) && freezeHours > 0 ? freezeHours : 4).toISOString();

  const count = await upsertRecord("cycle_counts", {
    count_number: await buildCycleCountNumber(),
    warehouse_id: payload.warehouse_id,
    zone_id: selectedZoneIds.length === 1 ? selectedZoneIds[0] : null,
    zone_ids: selectedZoneIds.length > 0 ? selectedZoneIds : null,
    location_id: selectedLocationIds.length === 1 ? selectedLocationIds[0] : null,
    location_ids: selectedLocationIds.length > 0 ? selectedLocationIds : null,
    product_ids: selectedProductIds.length > 0 ? selectedProductIds : null,
    scope: payload.scope,
    status: "frozen",
    variance_threshold_percent: payload.variance_threshold_percent,
    snapshot_at: now.toISOString(),
    freeze_expires_at: freezeExpiresAt,
    initiated_by: userId,
  });

  if (selectedAssigneeIds.length > 0) {
    const teamInsert = await db("cycle_count_assignees").insert(selectedAssigneeIds.map((assignedUserId) => ({
      cycle_count_id: count.id,
      user_id: assignedUserId,
      assigned_by: userId,
    })) as any);
    throwIfSupabaseError(teamInsert, "Could not assign the cycle-count team.");
  }

  let balanceQuery = db("inventory_balances")
    .select("*, products(unit_cost, velocity_class)")
    .eq("warehouse_id", payload.warehouse_id)
    .eq("status", "available")
    .gt("available_quantity", 0)
    .not("location_id", "is", null);

  if (selectedLocationIds.length > 0) balanceQuery = balanceQuery.in("location_id", selectedLocationIds);
  if (selectedZoneIds.length > 0) balanceQuery = balanceQuery.in("zone_id", selectedZoneIds);
  if (selectedProductIds.length > 0) balanceQuery = balanceQuery.in("product_id", selectedProductIds);

  const { data: balances, error } = await balanceQuery;
  if (error) throw new Error(formatSupabaseError(error, "Could not snapshot count balances."));

  const filteredBalances = payload.scope === "abc"
    ? (balances ?? []).filter((balance: any) => ["A", "B", "C"].includes(balance.products?.velocity_class ?? "C"))
    : (balances ?? []);

  const locationIds = selectedLocationIds.length > 0
    ? selectedLocationIds
    : Array.from(new Set(filteredBalances.map((balance: any) => balance.location_id).filter(Boolean))) as string[];
  const claimedLocationIds = new Set<string>();
  const skippedLocations: string[] = [];

  for (const locationId of locationIds) {
    const { error: freezeError } = await db("inventory_freezes").insert({
      cycle_count_id: count.id,
      warehouse_id: payload.warehouse_id,
      location_id: locationId,
      status: "active",
      expires_at: freezeExpiresAt,
      created_by: userId,
    } as any);

    if (freezeError) {
      skippedLocations.push(locationId);
      continue;
    }

    claimedLocationIds.add(locationId);
    await holdLocationStock(locationId);
  }

  let lineCount = 0;
  for (const balance of filteredBalances) {
    if (!balance.location_id || !claimedLocationIds.has(balance.location_id)) continue;
    await upsertRecord("cycle_count_lines", {
      cycle_count_id: count.id,
      location_id: balance.location_id,
      product_id: balance.product_id,
      pallet_id: balance.pallet_id,
      assigned_user_id: selectedAssigneeIds.length === 1 ? selectedAssigneeIds[0] : null,
      expected_quantity: balance.quantity,
      variance_quantity: 0,
      variance_percent: 0,
      line_status: "queued",
      status: "queued",
    });
    lineCount += 1;
  }

  if (selectedLocationIds.length > 0 && selectedProductIds.length === 0) {
    const locationsWithStock = new Set(filteredBalances.map((balance: any) => balance.location_id).filter(Boolean));
    for (const locationId of selectedLocationIds) {
      if (locationsWithStock.has(locationId) || !claimedLocationIds.has(locationId)) continue;
      await upsertRecord("cycle_count_lines", {
        cycle_count_id: count.id,
        location_id: locationId,
        assigned_user_id: selectedAssigneeIds.length === 1 ? selectedAssigneeIds[0] : null,
        expected_quantity: 0,
        variance_quantity: 0,
        variance_percent: 0,
        line_status: "queued",
        status: "queued",
        notes: "Confirm empty location.",
      });
      lineCount += 1;
    }
  }

  if (lineCount === 0) {
    await db("cycle_counts").update({ status: "cancelled", notes: "No eligible bins were claimed for this count." } as any).eq("id", count.id);
    await releaseCycleCountFreezes(count.id);
    throw new Error(skippedLocations.length > 0
      ? "No bins were claimed. Every matching bin is already frozen in another open count."
      : "No available stock matched this count scope.");
  }

  const activateCount = await db("cycle_counts")
    .update({
      status: "counting",
      notes: skippedLocations.length > 0 ? `${skippedLocations.length} frozen bin(s) skipped because another count already claimed them.` : null,
    } as any)
    .eq("id", count.id)
    .eq("status", "frozen")
    .select("id")
    .maybeSingle();
  throwIfSupabaseError(activateCount, "Could not activate cycle count.");
  if (!activateCount.data) throw new Error("This cycle count was cancelled while it was being created.");

  await createLabelRecord("count_sheet", count.id, count.count_number);
  return { ...count, status: "counting", claimed_line_count: lineCount, skipped_location_count: skippedLocations.length };
}

export async function listCycleCounts() {
  const { data: counts, error } = await db("cycle_counts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(formatSupabaseError(error, "Failed to load cycle counts."));

  const countRows = counts ?? [];
  const countIds = countRows.map((count: any) => count.id).filter(Boolean);
  if (countIds.length === 0) return [];

  const [{ data: freezes, error: freezeError }, { data: lines, error: lineError }] = await Promise.all([
    db("inventory_freezes")
      .select("*")
      .in("cycle_count_id", countIds),
    db("cycle_count_lines")
      .select("*, products(*), locations(code, aisle, bay, level, position)")
      .in("cycle_count_id", countIds),
  ]);
  if (freezeError) throw new Error(formatSupabaseError(freezeError, "Failed to load cycle count freezes."));
  if (lineError) throw new Error(formatSupabaseError(lineError, "Failed to load cycle count lines."));

  const freezesByCount = new Map<string, any[]>();
  for (const freeze of freezes ?? []) {
    const rows = freezesByCount.get(freeze.cycle_count_id) ?? [];
    rows.push(freeze);
    freezesByCount.set(freeze.cycle_count_id, rows);
  }

  const linesByCount = new Map<string, any[]>();
  for (const line of lines ?? []) {
    const rows = linesByCount.get(line.cycle_count_id) ?? [];
    rows.push(line);
    linesByCount.set(line.cycle_count_id, rows);
  }

  return countRows.map((count: any) => ({
    ...count,
    inventory_freezes: freezesByCount.get(count.id) ?? [],
    cycle_count_lines: linesByCount.get(count.id) ?? [],
  }));
}

export async function listMyCycleCountLines() {
  const claimedLineColumns = "id, cycle_count_id, location_id, product_id, pallet_id, assigned_user_id, claimed_by_user_id, claim_expires_at, line_status, first_count_qty, first_counted_at, recount_qty, recounted_at, variance_quantity, variance_percent, exception_reason, notes, cycle_counts(count_number, scope, status), products(sku, name), locations(code, aisle, bay, level, position)";
  const { data, error } = await db("cycle_count_lines")
    .select(claimedLineColumns)
    .in("line_status", ["queued", "recount"])
    .order("created_at", { ascending: true });
  if (error && isMissingColumn(error, "claimed_by_user_id")) {
    const { data: legacyData, error: legacyError } = await db("cycle_count_lines")
      .select(claimedLineColumns.replace("claimed_by_user_id, claim_expires_at, ", ""))
      .in("line_status", ["queued", "recount"])
      .order("created_at", { ascending: true });
    if (legacyError) throw new Error(formatSupabaseError(legacyError, "Failed to load assigned count lines."));
    return (legacyData ?? [])
      .filter(hasActiveCycleCountHeader)
      .map((line: any) => ({ ...line, claim_support_unavailable: true }));
  }
  if (error) throw new Error(formatSupabaseError(error, "Failed to load assigned count lines."));
  return (data ?? []).filter(hasActiveCycleCountHeader);
}

function hasActiveCycleCountHeader(line: unknown) {
  const record = line as { cycle_counts?: { status?: unknown } | Array<{ status?: unknown }> };
  const count = Array.isArray(record.cycle_counts) ? record.cycle_counts[0] : record.cycle_counts;
  return !["closed", "cancelled"].includes(String(count?.status ?? "").toLowerCase());
}

export async function claimCycleCountLine(lineId: string) {
  const { error } = await supabase.rpc("claim_cycle_count_line", { p_line_id: lineId });
  if (error) throw new Error(formatSupabaseError(error, "Could not claim this count line."));
}

export async function releaseCycleCountLineClaim(lineId: string) {
  const { error } = await supabase.rpc("release_cycle_count_line_claim", { p_line_id: lineId });
  if (error) throw new Error(formatSupabaseError(error, "Could not release this count-line claim."));
}

export async function submitCycleCountLine(lineId: string, countedQuantity: number) {
  const userId = await currentUserId();
  if (!Number.isFinite(Number(countedQuantity)) || Number(countedQuantity) < 0) {
    throw new Error("Count quantity must be zero or greater.");
  }

  const { data: line, error: lineError } = await db("cycle_count_lines")
    .select("*, cycle_counts(variance_threshold_percent, warehouse_id), products(unit_cost)")
    .eq("id", lineId)
    .single();
  if (lineError) throw new Error(formatSupabaseError(lineError, "Could not load count line."));

  if (line.assigned_user_id && line.assigned_user_id !== userId) {
    throw new Error("This count line is assigned to another user.");
  }
  if ("claimed_by_user_id" in line && (line.claimed_by_user_id !== userId || !line.claim_expires_at || new Date(line.claim_expires_at).getTime() <= Date.now())) {
    throw new Error("Claim this count line before entering a quantity. Expired claims return to the team.");
  }
  if (!["queued", "recount"].includes(line.line_status ?? line.status)) {
    throw new Error("This count line is no longer open for entry. Refresh the count.");
  }

  const { data: warehouse } = await db("warehouses")
    .select("variance_value_floor")
    .eq("id", line.cycle_counts?.warehouse_id)
    .maybeSingle();

  const expectedQuantity = Number(line.expected_quantity ?? 0);
  const finalQuantity = Number(countedQuantity);
  const varianceQuantity = finalQuantity - expectedQuantity;
  const percent = variancePercent(expectedQuantity, varianceQuantity);
  const thresholdPercent = Number(line.cycle_counts?.variance_threshold_percent ?? 5);
  const { reviewRequired } = isReviewRequired({
    varianceQuantity,
    variancePercent: percent,
    thresholdPercent,
    unitCost: line.products?.unit_cost,
    valueFloor: warehouse?.variance_value_floor,
  });

  if ((line.line_status ?? line.status) === "recount") {
    if (line.first_counted_by === userId) {
      throw new Error("Recount must be performed by a different user than the first count.");
    }

    const nextStatus = reviewRequired ? "variance_hold" : "reconciled";
    const update = await db("cycle_count_lines")
      .update({
        assigned_user_id: userId,
        recount_qty: finalQuantity,
        recounted_by: userId,
        recounted_at: new Date().toISOString(),
        variance_quantity: varianceQuantity,
        variance_percent: percent,
        line_status: nextStatus,
        status: nextStatus === "reconciled" ? "completed" : "exception",
      } as any)
      .eq("id", lineId)
      .eq("line_status", "recount");
    throwIfSupabaseError(update, "Could not submit recount.");
  } else {
    const nextStatus = reviewRequired ? "recount" : "reconciled";
    const update = await db("cycle_count_lines")
      .update({
        assigned_user_id: nextStatus === "recount" ? null : (line.assigned_user_id ?? userId),
        first_count_qty: finalQuantity,
        first_counted_by: userId,
        first_counted_at: new Date().toISOString(),
        variance_quantity: varianceQuantity,
        variance_percent: percent,
        line_status: nextStatus,
        status: nextStatus === "reconciled" ? "completed" : "assigned",
        ...(nextStatus === "recount" ? { claimed_by_user_id: null, claimed_at: null, claim_expires_at: null } : {}),
      } as any)
      .eq("id", lineId)
      .eq("line_status", "queued");
    throwIfSupabaseError(update, "Could not submit count.");
  }

  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function approveCycleCountLine(lineId: string, reason: string) {
  const userId = await currentUserId();
  if (!reason.trim()) throw new Error("Approval reason is required.");

  const { data: line, error } = await db("cycle_count_lines")
    .select("*, cycle_counts(warehouse_id)")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load count line for approval."));
  if (line.line_status !== "variance_hold") throw new Error("Only variance-hold lines can be approved.");
  if ([line.first_counted_by, line.recounted_by].filter(Boolean).includes(userId)) {
    throw new Error("You cannot approve a variance on a line you counted.");
  }

  const adjustment = await upsertRecord("stock_adjustments", {
    adjustment_number: buildPalletCode("ADJ"),
    pallet_id: line.pallet_id,
    inventory_balance_id: null,
    adjustment_type: "cycle_count",
    quantity_delta: line.variance_quantity,
    reason,
  });

  const finalQuantity = Number(line.recount_qty ?? line.first_count_qty ?? line.expected_quantity ?? 0);
  if (line.pallet_id) {
    const palletUpdate = await db("pallets")
      .update({ quantity: finalQuantity, held_quantity: finalQuantity, last_counted_at: new Date().toISOString() } as any)
      .eq("id", line.pallet_id);
    throwIfSupabaseError(palletUpdate, "Could not post approved pallet adjustment.");

    const balanceUpdate = await db("inventory_balances")
      .update({ quantity: finalQuantity, held_quantity: finalQuantity } as any)
      .eq("pallet_id", line.pallet_id);
    throwIfSupabaseError(balanceUpdate, "Could not post approved balance adjustment.");
  }

  const lineUpdate = await db("cycle_count_lines")
    .update({
      approved_by: userId,
      approved_at: new Date().toISOString(),
      adjustment_id: adjustment.id,
      exception_reason: reason,
      line_status: "adjusted",
      status: "completed",
    } as any)
    .eq("id", lineId);
  throwIfSupabaseError(lineUpdate, "Could not mark count line approved.");

  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function rejectCycleCountLine(lineId: string, reason: string) {
  if (!reason.trim()) throw new Error("Rejection reason is required.");
  const { data: line, error } = await db("cycle_count_lines")
    .select("cycle_count_id")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load count line."));

  const update = await db("cycle_count_lines")
    .update({
      recount_qty: null,
      recounted_by: null,
      recounted_at: null,
      exception_reason: reason,
      line_status: "recount",
      status: "assigned",
    } as any)
    .eq("id", lineId)
    .eq("line_status", "variance_hold");
  throwIfSupabaseError(update, "Could not reject variance line.");
  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function acceptCycleCountExceptionLine(lineId: string, reason: string) {
  const userId = await currentUserId();
  if (!reason.trim()) throw new Error("Exception review note is required.");

  const { data: line, error } = await db("cycle_count_lines")
    .select("cycle_count_id, line_status")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load exception line."));
  if (line.line_status !== "exception") throw new Error("Only exception lines can be accepted.");

  const update = await db("cycle_count_lines")
    .update({
      approved_by: userId,
      approved_at: new Date().toISOString(),
      status: "completed",
      notes: reason,
    } as any)
    .eq("id", lineId)
    .eq("line_status", "exception");
  throwIfSupabaseError(update, "Could not accept exception line.");
  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function returnCycleCountExceptionLine(lineId: string, reason: string) {
  if (!reason.trim()) throw new Error("Return reason is required.");

  const { data: line, error } = await db("cycle_count_lines")
    .select("cycle_count_id, line_status")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load exception line."));
  if (line.line_status !== "exception") throw new Error("Only exception lines can be returned.");

  const update = await db("cycle_count_lines")
    .update({
      assigned_user_id: null,
      approved_by: null,
      approved_at: null,
      exception_reason: reason,
      notes: reason,
      line_status: "queued",
      status: "queued",
    } as any)
    .eq("id", lineId)
    .eq("line_status", "exception");
  throwIfSupabaseError(update, "Could not return exception line to blind entry.");
  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function flagCycleCountLineException(lineId: string, reason: string) {
  if (!reason.trim()) throw new Error("A reason is required to flag a count exception.");
  const { data: line, error } = await db("cycle_count_lines")
    .select("cycle_count_id")
    .eq("id", lineId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load count line."));

  const update = await db("cycle_count_lines")
    .update({ line_status: "exception", status: "exception", exception_reason: reason, notes: reason } as any)
    .eq("id", lineId);
  throwIfSupabaseError(update, "Could not flag count exception.");
  await updateCountHeaderStatus(line.cycle_count_id);
}

export async function closeCycleCount(countId: string) {
  const { data: lines, error } = await db("cycle_count_lines")
    .select("id, line_status, pallet_id")
    .eq("cycle_count_id", countId);
  if (error) throw new Error(formatSupabaseError(error, "Could not load count lines."));

  const openLine = (lines ?? []).find((line: any) => !TERMINAL_LINE_STATUSES.has(line.line_status));
  if (openLine) throw new Error("Every count line must be reconciled, adjusted, or marked exception before closing.");

  await releaseCycleCountFreezes(countId);

  const palletIds = (lines ?? []).map((line: any) => line.pallet_id).filter(Boolean);
  if (palletIds.length > 0) {
    await db("pallets").update({ last_counted_at: new Date().toISOString() } as any).in("id", palletIds);
  }

  const update = await db("cycle_counts")
    .update({ status: "closed" } as any)
    .eq("id", countId);
  throwIfSupabaseError(update, "Could not close cycle count.");
}

export async function discardDraftCycleCount(countId: string) {
  await currentUserId();
  const { data: count, error } = await db("cycle_counts")
    .select("id, status")
    .eq("id", countId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load draft count."));
  if (count.status !== "draft") throw new Error("Only draft cycle counts can be discarded.");

  await releaseCycleCountFreezes(countId);

  const update = await db("cycle_counts")
    .update({
      status: "cancelled",
      notes: "Draft count discarded by supervisor.",
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", countId)
    .eq("status", "draft");
  throwIfSupabaseError(update, "Could not discard draft count.");
}

export async function cancelCycleCount(countId: string, reason: string) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 4) {
    throw new Error("A cancellation reason of at least 4 characters is required.");
  }
  if (normalizedReason.length > 500) {
    throw new Error("Cancellation reason must be 500 characters or fewer.");
  }

  const { data, error } = await supabase.rpc("cancel_cycle_count" as never, {
    p_count_id: countId,
    p_reason: normalizedReason,
  } as never);
  if (error) throw new Error(formatSupabaseError(error, "Could not cancel cycle count."));
  return data as {
    count_id: string;
    previous_status: string;
    status: "cancelled";
    freezes_released: number;
    claims_cleared: number;
    adjustments_retained: number;
    cancelled_at: string;
  };
}

export async function archiveCancelledCycleCount(countId: string) {
  const userId = await currentUserId();
  const { data: count, error } = await db("cycle_counts")
    .select("id, status, notes")
    .eq("id", countId)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not load cancelled count."));
  if (count.status !== "cancelled") throw new Error("Only cancelled cycle counts can be archived.");
  if (String(count.notes ?? "").includes(CANCELLED_ARCHIVE_NOTE)) return;

  await releaseCycleCountFreezes(countId);

  const archivedAt = new Date().toISOString();
  const update = await db("cycle_counts")
    .update({
      archived_at: archivedAt,
      archived_by: userId,
      updated_at: archivedAt,
    } as any)
    .eq("id", countId)
    .eq("status", "cancelled");
  if (!update.error) return;

  const message = formatSupabaseError(update.error, "Could not archive cancelled count.");
  if (!message.includes("archived_at") && !message.includes("archived_by") && !message.includes("42703")) {
    throw new Error(message);
  }

  const fallbackNote = [count.notes, CANCELLED_ARCHIVE_NOTE].filter(Boolean).join("\n");
  const fallback = await db("cycle_counts")
    .update({ notes: fallbackNote, updated_at: archivedAt } as any)
    .eq("id", countId)
    .eq("status", "cancelled");
  throwIfSupabaseError(fallback, "Could not archive cancelled count.");
}

async function updateCountHeaderStatus(countId: string) {
  const { data: lines, error } = await db("cycle_count_lines")
    .select("line_status, approved_at")
    .eq("cycle_count_id", countId);
  if (error) {
    console.warn("[cycle-counts] status refresh skipped:", formatSupabaseError(error, "Could not refresh count status."));
    return;
  }

  const rows = lines ?? [];
  const statuses = rows.map((line: any) => line.line_status);
  const needsReview = rows.some((line: any) => line.line_status === "variance_hold" || (line.line_status === "exception" && !line.approved_at));
  const nextStatus = needsReview
    ? "review"
    : statuses.every((status: string) => TERMINAL_LINE_STATUSES.has(status))
      ? "approved"
      : "counting";

  const update = await db("cycle_counts")
    .update({ status: nextStatus } as any)
    .eq("id", countId)
    .not("status", "in", "(closed,cancelled)");
  if (update.error) {
    console.warn("[cycle-counts] header status update skipped:", formatSupabaseError(update.error, "Could not update count header status."));
  }
}
