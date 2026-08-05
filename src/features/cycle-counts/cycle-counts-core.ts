import { createLabelRecord } from "@/features/receiving/receiving-core";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import {
  db,
  buildPalletCode,
  cycleCountSchema,
} from "@/features/shared/core-types";
import { upsertRecord } from "@/features/admin/admin-core";

export async function createCycleCountFlow(input: z.infer<typeof cycleCountSchema>) {
  const payload = cycleCountSchema.parse(input);
  const count = await upsertRecord("cycle_counts", {
    count_number: buildPalletCode("CNT"),
    warehouse_id: payload.warehouse_id,
    zone_id: payload.zone_id || null,
    location_id: payload.location_id || null,
    scope: payload.scope,
    status: "queued",
    variance_threshold_percent: payload.variance_threshold_percent,
  });

  let balanceQuery = db("inventory_balances").select("*").eq("warehouse_id", payload.warehouse_id);
  if (payload.location_id) balanceQuery = balanceQuery.eq("location_id", payload.location_id);
  if (payload.zone_id) balanceQuery = balanceQuery.eq("zone_id", payload.zone_id);
  if (payload.product_id) balanceQuery = balanceQuery.eq("product_id", payload.product_id);

  const { data: balances, error } = await balanceQuery;
  if (error) throw error;

  for (const balance of balances ?? []) {
    await upsertRecord("cycle_count_lines", {
      cycle_count_id: count.id,
      location_id: balance.location_id,
      product_id: balance.product_id,
      pallet_id: balance.pallet_id,
      expected_quantity: balance.quantity,
      counted_quantity: balance.quantity,
      variance_quantity: 0,
      variance_percent: 0,
      status: "queued",
    });
  }

  await createLabelRecord("count_sheet", count.id, count.count_number);
  return count;
}

export async function listCycleCounts() {
  const { data, error } = await db("cycle_counts")
    .select("*, cycle_count_lines(*, products(*), locations(code, aisle, bay, level))")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function submitCycleCountLine(lineId: string, countedQuantity: number) {
  const { data: line, error: lineError } = await db("cycle_count_lines").select("*").eq("id", lineId).single();
  if (lineError) throw lineError;

  const varianceQuantity = countedQuantity - line.expected_quantity;
  const variancePercent = line.expected_quantity === 0 ? 0 : Math.abs((varianceQuantity / line.expected_quantity) * 100);

  await db("cycle_count_lines")
    .update({
      counted_quantity: countedQuantity,
      variance_quantity: varianceQuantity,
      variance_percent: variancePercent,
      status: varianceQuantity === 0 ? "completed" : "exception",
    })
    .eq("id", lineId);

  if (line.pallet_id) {
    await Promise.all([
      db("pallets").update({ quantity: countedQuantity, available_quantity: countedQuantity }).eq("id", line.pallet_id),
      db("inventory_balances").update({ quantity: countedQuantity, available_quantity: countedQuantity }).eq("pallet_id", line.pallet_id),
      upsertRecord("stock_adjustments", {
        adjustment_number: buildPalletCode("ADJ"),
        pallet_id: line.pallet_id,
        adjustment_type: "cycle_count",
        quantity_delta: varianceQuantity,
        reason: `Cycle count variance ${varianceQuantity}`,
      }),
    ]);
  }
}
