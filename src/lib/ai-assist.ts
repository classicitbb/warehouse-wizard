/**
 * ai-assist.ts
 *
 * Lightweight learning layer for operator cues.
 * All ML here is plain statistics over the ai_product_hints table —
 * no external service, no training pipeline.
 *
 * Three hint types:
 *   pallet_qty  — learns the usual units-per-pallet for a product from receiving history
 *   placement   — learns which locations a product is routinely put away to
 *   velocity    — A/B/C pick-frequency class (derived from audit_events / inventory_balances)
 *
 * Confidence model
 *   confidence = clamp(sampleCount, 0, 20) / 20  ×  agreement_rate
 *   agreement_rate = mode_count / sampleCount
 *
 * Cues are shown at confidence >= 0.5.
 * Override nudges (placement mismatch) fire only at >= 0.7.
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PalletQtyHintValue = {
  mode_qty: number;
  p50_qty: number;
  samples: number[];
};

export type PlacementHintEntry = {
  location_id: string;
  location_code: string;
  zone_name: string | null;
  frequency: number;
  last_used_at: string;
};

export type PlacementHintValue = PlacementHintEntry[];

export type VelocityHintValue = {
  class: "A" | "B" | "C";
  picks_last_90d: number;
  avg_picks_per_day: number;
};

export type PalletQtyHint = {
  suggestedQty: number;
  confidence: number;
  sampleCount: number;
};

export type PlacementHints = {
  entries: PlacementHintEntry[];
  confidence: number;
  sampleCount: number;
};

export type VelocityHint = {
  class: "A" | "B" | "C";
  picksLast90d: number;
  avgPicksPerDay: number;
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function db(table: string) {
  return (supabase.from as any)(table);
}

/** Clamp-based confidence: rises quickly to 1.0 as samples accumulate and agree. */
function computeConfidence(sampleCount: number, modeCount: number): number {
  const sampleWeight = Math.min(sampleCount, 20) / 20;
  const agreementRate = sampleCount > 0 ? modeCount / sampleCount : 0;
  return Math.round(sampleWeight * agreementRate * 10_000) / 10_000; // 4 dp
}

/** Statistical mode of a number array. Returns [modeValue, modeCount]. */
function mode(values: number[]): [number, number] {
  const freq = new Map<number, number>();
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1);
  let best = values[0];
  let bestCount = 0;
  for (const [val, count] of freq) {
    if (count > bestCount) { best = val; bestCount = count; }
  }
  return [best, bestCount];
}

/** Median of a sorted-or-unsorted number array. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Keep only the most recent N samples in the rolling window. */
const SAMPLE_WINDOW = 50;
function trimSamples(samples: number[]): number[] {
  return samples.length > SAMPLE_WINDOW ? samples.slice(-SAMPLE_WINDOW) : samples;
}

// ─── Pallet Qty ───────────────────────────────────────────────────────────────

/**
 * Returns the learned pallet quantity suggestion for a product in a warehouse.
 * Returns null if there is not yet an observation.
 */
export async function getProductPalletQtyHint(
  productId: string,
  warehouseId: string,
): Promise<PalletQtyHint | null> {
  const { data, error } = await db("ai_product_hints")
    .select("hint_value, sample_count, confidence")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("hint_type", "pallet_qty")
    .maybeSingle();

  if (error) {
    console.error("[ai-assist] getProductPalletQtyHint failed:", error);
    return null;
  }
  if (!data || data.sample_count < 1) return null;

  const value = data.hint_value as PalletQtyHintValue;
  const suggestedQty = Number(value.mode_qty || value.p50_qty || value.samples?.[0] || 0);
  if (!Number.isFinite(suggestedQty) || suggestedQty <= 0) return null;

  return {
    suggestedQty,
    confidence: Number(data.confidence ?? 0),
    sampleCount: data.sample_count,
  };
}

/**
 * Called after a pallet is confirmed in receiving.
 * Upserts the pallet_qty hint with the new observation folded into the rolling window.
 */
export async function recordPalletQtyObservation(
  productId: string,
  warehouseId: string,
  qty: number,
): Promise<void> {
  if (!productId || !warehouseId || qty <= 0) return;

  // Fetch existing hint to update rolling samples
  const { data: existing } = await db("ai_product_hints")
    .select("id, hint_value, sample_count")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("hint_type", "pallet_qty")
    .maybeSingle();

  const prevValue = (existing?.hint_value as PalletQtyHintValue | null) ?? { mode_qty: qty, p50_qty: qty, samples: [] };
  const samples = trimSamples([...(prevValue.samples ?? []), qty]);
  const [modeQty, modeCount] = mode(samples);
  const p50 = median(samples);
  const confidence = computeConfidence(samples.length, modeCount);

  const hint: PalletQtyHintValue = { mode_qty: modeQty, p50_qty: p50, samples };

  const { error } = await db("ai_product_hints").upsert(
    {
      product_id: productId,
      warehouse_id: warehouseId,
      hint_type: "pallet_qty",
      hint_value: hint,
      sample_count: samples.length,
      confidence,
      last_observed_at: new Date().toISOString(),
    },
    { onConflict: "product_id,warehouse_id,hint_type" },
  );

  if (error) {
    console.error("[ai-assist] recordPalletQtyObservation failed:", error);
    if (options?.rethrow) throw error;
    enqueueFailedAiHint({ kind: "pallet_qty", productId, warehouseId, qty }, error);
  }
}


// ─── Product Placement ────────────────────────────────────────────────────────

/**
 * Returns the ranked placement history for a product in a warehouse.
 * Entries are sorted by frequency descending, top 5 returned.
 * Returns null if there is not yet enough data (< 3 observations).
 */
export async function getProductPlacementHints(
  productId: string,
  warehouseId: string,
): Promise<PlacementHints | null> {
  const { data, error } = await db("ai_product_hints")
    .select("hint_value, sample_count, confidence")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("hint_type", "placement")
    .maybeSingle();

  if (error) {
    console.error("[ai-assist] getProductPlacementHints failed:", error);
    return null;
  }
  if (!data || data.sample_count < 3) return null;

  const entries = (data.hint_value as PlacementHintValue).slice(0, 5);
  return {
    entries,
    confidence: Number(data.confidence ?? 0),
    sampleCount: data.sample_count,
  };
}

/**
 * Called after confirmPutaway succeeds.
 * Updates the placement hint for the product with the actual location used.
 */
export async function recordPlacementObservation(
  productId: string,
  warehouseId: string,
  locationId: string,
  locationCode: string,
  zoneName: string | null,
): Promise<void> {
  if (!productId || !warehouseId || !locationId) return;

  // Fetch existing hint
  const { data: existing } = await db("ai_product_hints")
    .select("id, hint_value, sample_count")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("hint_type", "placement")
    .maybeSingle();

  const prevEntries: PlacementHintEntry[] = (existing?.hint_value as PlacementHintValue) ?? [];
  const prevSampleCount: number = existing?.sample_count ?? 0;

  // Upsert this location in the entry list
  const existing_entry = prevEntries.find((e) => e.location_id === locationId);
  let updatedEntries: PlacementHintEntry[];
  if (existing_entry) {
    updatedEntries = prevEntries.map((e) =>
      e.location_id === locationId
        ? { ...e, frequency: e.frequency + 1, last_used_at: new Date().toISOString() }
        : e,
    );
  } else {
    updatedEntries = [
      ...prevEntries,
      {
        location_id: locationId,
        location_code: locationCode,
        zone_name: zoneName,
        frequency: 1,
        last_used_at: new Date().toISOString(),
      },
    ];
  }

  // Sort by frequency desc, keep top 20 unique locations
  updatedEntries = updatedEntries
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 20);

  const newSampleCount = prevSampleCount + 1;
  const topFrequency = updatedEntries[0]?.frequency ?? 1;
  const confidence = computeConfidence(newSampleCount, topFrequency);

  const { error } = await db("ai_product_hints").upsert(
    {
      product_id: productId,
      warehouse_id: warehouseId,
      hint_type: "placement",
      hint_value: updatedEntries,
      sample_count: newSampleCount,
      confidence,
      last_observed_at: new Date().toISOString(),
    },
    { onConflict: "product_id,warehouse_id,hint_type" },
  );

  if (error) console.error("[ai-assist] recordPlacementObservation failed:", error);
}

// ─── Velocity ─────────────────────────────────────────────────────────────────

/**
 * Returns A/B/C velocity class for a product in a warehouse,
 * derived from audit_events pick activity in the last 90 days.
 *
 * A: >= 1 pick/day average
 * B: >= 0.1 picks/day average
 * C: below B threshold
 *
 * Result is cached in ai_product_hints and refreshed if > 24 h stale.
 */
export async function getProductVelocityHint(
  productId: string,
  warehouseId: string,
): Promise<VelocityHint | null> {
  // Check cache first
  const { data: cached } = await db("ai_product_hints")
    .select("hint_value, last_observed_at")
    .eq("product_id", productId)
    .eq("warehouse_id", warehouseId)
    .eq("hint_type", "velocity")
    .maybeSingle();

  const cacheAgeMs = cached?.last_observed_at
    ? Date.now() - new Date(cached.last_observed_at).getTime()
    : Infinity;

  if (cached && cacheAgeMs < 24 * 60 * 60 * 1000) {
    const v = cached.hint_value as VelocityHintValue;
    return { class: v.class, picksLast90d: v.picks_last_90d, avgPicksPerDay: v.avg_picks_per_day };
  }

  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: palletEvents, error: palletError } = await (supabase.from as any)("audit_events")
    .select("id, pallets!inner(product_id)")
    .eq("warehouse_id", warehouseId)
    .eq("event_type", "pick")
    .eq("pallets.product_id", productId)
    .gte("created_at", cutoff);

  if (palletError) {
    console.error("[ai-assist] getProductVelocityHint pallet join failed:", palletError);
    return null;
  }

  const picksLast90d = (palletEvents ?? []).length;
  const avgPicksPerDay = Math.round((picksLast90d / 90) * 1000) / 1000;
  const velocityClass: "A" | "B" | "C" =
    avgPicksPerDay >= 1 ? "A" : avgPicksPerDay >= 0.1 ? "B" : "C";

  const value: VelocityHintValue = {
    class: velocityClass,
    picks_last_90d: picksLast90d,
    avg_picks_per_day: avgPicksPerDay,
  };

  // Cache result (fire-and-forget)
  db("ai_product_hints").upsert(
    {
      product_id: productId,
      warehouse_id: warehouseId,
      hint_type: "velocity",
      hint_value: value,
      sample_count: picksLast90d,
      confidence: Math.min(picksLast90d, 20) / 20,
      last_observed_at: new Date().toISOString(),
    },
    { onConflict: "product_id,warehouse_id,hint_type" },
  ).then(({ error: e }: any) => {
    if (e) console.error("[ai-assist] velocity cache write failed:", e);
  });

  return { class: velocityClass, picksLast90d, avgPicksPerDay };
}
