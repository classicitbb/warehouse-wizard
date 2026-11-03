// Forward pick and replenishment data and rules (outbound picking design,
// slice D: D4, D5, D10, and the floor practice in §10). A pick face is a bin
// with status "pick_face": same code, same barcode. It has no fixed SKU; the
// SKU comes with the first pallet that a replenishment moves in. The
// evaluate_forward_pick_replenishment engine (cron each 5 minutes, or the
// "Check now" button) asks for full pallets from bulk when the face stock,
// less the open demand, goes down to the trigger level (a % of the fill). WW
// learns the % and the pallets from 30 days of average use
// (replenishment_policy); until then it uses the minimum: 50 % and 1 pallet.
// Starting a task makes a WW move; finishing the move by scan closes the task
// and records the new fill (sync_replenishment_from_move trigger).
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/features/shared/core-types";

export const REPLENISHMENT_QUERY_KEY = ["replenishment"] as const;
export const OPEN_REPLENISHMENT_STATUSES = ["queued", "assigned", "in_progress", "exception"] as const;
export const PICK_FACE_STATUS = "pick_face";
export const MAX_PALLETS_PER_FACE = 10;

export type ReplenishmentPriority = "normal" | "urgent";
/** set = on the product; learned = from 30 days of use; learning = minimum until 30 days of history. */
export type PolicyBasis = "set" | "learned" | "learning";
export type ReplenishmentReason = "min" | "demand" | "short" | "count_variance" | "manual";

export type ReplenishmentTask = {
  id: string;
  task_number: string;
  warehouse_id: string | null;
  status: string;
  priority: ReplenishmentPriority;
  reason: ReplenishmentReason;
  target_quantity: number;
  on_hand_quantity: number;
  demand_quantity: number;
  reorder_point: number;
  notes: string | null;
  created_at: string;
  move_task_id: string | null;
  assigned_user_id: string | null;
  product: { sku: string; name: string } | null;
  to_location: { code: string } | null;
  from_location: { code: string } | null;
  suggested_pallet: { pallet_barcode: string; available_quantity: number } | null;
  move_task: { task_number: string; status: string } | null;
};

/** One row per pick face and SKU in it; an empty face has a row with no SKU. */
export type PickFaceRow = {
  location_id: string;
  warehouse_id: string;
  warehouse_code: string;
  location_code: string;
  zone_code: string | null;
  max_pallets: number | null;
  pallets_in_face: number;
  product_id: string | null;
  sku: string | null;
  product_name: string | null;
  /** Average daily use over the last 30 days; null while WW is learning. */
  daily_use: number | null;
  policy_basis: PolicyBasis | null;
  trigger_pct: number | null;
  reorder_pallets: number | null;
  full_quantity: number | null;
  filled_at: string | null;
  on_hand_quantity: number;
  demand_quantity: number;
  pallets_coming: number;
};

const TASK_COLUMNS =
  "id, task_number, warehouse_id, status, priority, reason, target_quantity, on_hand_quantity, demand_quantity, reorder_point, notes, created_at, move_task_id, assigned_user_id, " +
  "product:products(sku, name), to_location:to_location_id(code), from_location:from_location_id(code), " +
  "suggested_pallet:suggested_pallet_id(pallet_barcode, available_quantity), move_task:move_task_id(task_number, status)";

const REASON_LABELS: Record<ReplenishmentReason, string> = {
  min: "Fill level",
  demand: "Open orders",
  short: "Picker short",
  count_variance: "Count variance",
  manual: "Manual",
};

export function reasonLabel(reason: ReplenishmentReason): string {
  return REASON_LABELS[reason] ?? reason;
}

const POLICY_BASIS_LABELS: Record<PolicyBasis, string> = {
  set: "Set on product",
  learned: "Learned (30 days)",
  learning: "Learning: minimum",
};

export function policyBasisLabel(basis: PolicyBasis | null): string {
  return basis ? POLICY_BASIS_LABELS[basis] ?? basis : "";
}

/** Face stock less the open demand (the office's open, not aged fulfillments, less what WW picked). */
export function projectedQuantity(face: Pick<PickFaceRow, "on_hand_quantity" | "demand_quantity">): number {
  return Number(face.on_hand_quantity) - Number(face.demand_quantity);
}

/** The quantity that triggers a replenishment: the trigger % of the fill. */
export function triggerLevel(face: Pick<PickFaceRow, "full_quantity" | "on_hand_quantity" | "trigger_pct">): number {
  const full = Math.max(Number(face.full_quantity ?? 0), Number(face.on_hand_quantity));
  return (full * Number(face.trigger_pct ?? 50)) / 100;
}

/** Face stock as a % of the fill. */
export function fillPercent(face: Pick<PickFaceRow, "full_quantity" | "on_hand_quantity">): number | null {
  const full = Math.max(Number(face.full_quantity ?? 0), Number(face.on_hand_quantity));
  return full > 0 ? Math.round((Number(face.on_hand_quantity) / full) * 100) : null;
}

export type FaceState = "empty" | "short" | "refill" | "ok";

/** short = the face cannot cover the open demand (picking goes on); refill = at or below the trigger level. */
export function faceState(face: Pick<PickFaceRow, "product_id" | "on_hand_quantity" | "demand_quantity" | "full_quantity" | "trigger_pct">): FaceState {
  if (!face.product_id) return "empty";
  const projected = projectedQuantity(face);
  if (projected < 0) return "short";
  if ((Number(face.on_hand_quantity) > 0 || Number(face.demand_quantity) > 0) && projected <= triggerLevel(face)) return "refill";
  return "ok";
}

/** Urgent first, then oldest first: the floor clears shorts before fill top-ups. */
export function sortTasks<T extends Pick<ReplenishmentTask, "priority" | "created_at">>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === "urgent" ? -1 : 1;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
}

export function validateMaxPallets(value: number): string | null {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PALLETS_PER_FACE) return `Pallets per face must be 1 to ${MAX_PALLETS_PER_FACE}.`;
  return null;
}

export async function fetchOpenTasks(): Promise<ReplenishmentTask[]> {
  const { data, error } = await db("replenishment_tasks")
    .select(TASK_COLUMNS)
    .in("status", [...OPEN_REPLENISHMENT_STATUSES])
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return sortTasks((data ?? []) as ReplenishmentTask[]);
}

export async function fetchPickFaces(): Promise<PickFaceRow[]> {
  const { data, error } = await db("pick_face_status")
    .select("*")
    .order("warehouse_code", { ascending: true })
    .order("pick_sequence", { ascending: true })
    .order("location_code", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PickFaceRow[];
}

export async function fetchWarehouses(): Promise<{ id: string; code: string; name: string }[]> {
  const { data, error } = await db("warehouses").select("id, code, name").order("code");
  if (error) throw error;
  return data ?? [];
}

/** Makes a bin a pick face in place, by its code (the bay barcode). */
export async function makePickFace(warehouseId: string, locationCode: string, maxPallets: number): Promise<void> {
  const code = locationCode.trim().toUpperCase();
  if (!code) throw new Error("Scan or enter the bin.");
  const problem = validateMaxPallets(maxPallets);
  if (problem) throw new Error(problem);
  const { data: location, error: locErr } = await db("locations")
    .select("id, code, status")
    .eq("warehouse_id", warehouseId)
    .eq("code", code)
    .maybeSingle();
  if (locErr) throw locErr;
  if (!location) throw new Error(`Bin ${code} is not in this warehouse.`);
  if (location.status === PICK_FACE_STATUS) throw new Error(`Bin ${code} is already a pick face.`);
  const { error } = await (supabase.rpc as any)("make_pick_face", { p_location_id: location.id, p_max_pallets: maxPallets });
  if (error) throw error;
}

/** Makes a pick face a normal bin again. Its stock becomes bulk stock. */
export async function releasePickFace(locationId: string, status: "active" | "disabled"): Promise<void> {
  const { error } = await (supabase.rpc as any)("release_pick_face", { p_location_id: locationId, p_status: status });
  if (error) throw error;
}

export async function evaluateReplenishment(warehouseId: string | null = null): Promise<{ created: number; updated: number; cancelled: number; released: number }> {
  const { data, error } = await (supabase.rpc as any)("evaluate_forward_pick_replenishment", { p_warehouse_id: warehouseId });
  if (error) throw error;
  return data;
}

export async function startReplenishment(taskId: string): Promise<{ move_task_id: string; move_task_number: string }> {
  const { data, error } = await (supabase.rpc as any)("start_replenishment_task", { p_task_id: taskId });
  if (error) throw error;
  // No stock or no room: the task is now an exception, and the RPC says why.
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function cancelReplenishment(taskId: string): Promise<void> {
  const { error } = await (supabase.rpc as any)("cancel_replenishment_task", { p_task_id: taskId });
  if (error) throw error;
}

/** Short pick (D10) or a count variance on a face (C6). Slice E calls this from the handset. */
export async function requestUrgentReplenishment(locationId: string, productId: string, reason: "short" | "count_variance" | "manual" = "short"): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("request_urgent_replenishment", {
    p_location_id: locationId,
    p_product_id: productId,
    p_reason: reason,
  });
  if (error) throw error;
  return data;
}
