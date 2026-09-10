// pack-standard-payload.ts — turning a pack-standard draft into a row.
//
// Separate from `measure.ts` because this module knows *column names*, which
// is a different concern from unit arithmetic. It is the one place that maps a
// draft onto `product_packaging_profiles`, so the two traps below are contained
// here rather than repeated at every call site.

import {
  DEFAULT_PALLET_BASE_HEIGHT_MM,
  cmToMm,
  formatPackCode,
  formatPackCodeAscii,
  resolvePackagesPerPallet,
  type PackStandardFields,
} from "@/lib/measure";
import {
  PALLET_FOOTPRINT_LENGTH_MM,
  PALLET_FOOTPRINT_WIDTH_MM,
  type LayerPattern,
} from "@/lib/pallet-geometry";

/**
 * Columns the database generates. Sending any of them raises Postgres 428C9,
 * and `cleanPayload` in admin-core does not filter them out, so the guard has
 * to live here.
 */
export const GENERATED_PROFILE_COLUMNS = [
  "packages_per_pallet",
  "units_per_pallet",
  "standard_height_mm",
  "standard_gross_weight_kg",
] as const;

export interface PackStandardDraft {
  packagesPerLayer: number | null;
  layersPerPallet: number | null;
  layerColumns: number | null;
  layerPattern: LayerPattern;
  packageLengthMm: number | null;
  packageWidthMm: number | null;
  packageHeightMm: number | null;
  footprintLengthMm: number;
  footprintWidthMm: number;
  /** Never null — see the null trap in `buildPackStandardPayload`. */
  palletBaseHeightMm: number;
  slipSheetHeightMm: number;
  palletTareKg: number | null;
  maxStackPallets: number;
  quantityTolerance: number;
  isPalletStandard: boolean;
  buildNotes: string;
}

export const EMPTY_PACK_STANDARD_DRAFT: PackStandardDraft = {
  packagesPerLayer: null,
  layersPerPallet: null,
  layerColumns: null,
  layerPattern: "block",
  packageLengthMm: null,
  packageWidthMm: null,
  packageHeightMm: null,
  footprintLengthMm: PALLET_FOOTPRINT_LENGTH_MM,
  footprintWidthMm: PALLET_FOOTPRINT_WIDTH_MM,
  palletBaseHeightMm: DEFAULT_PALLET_BASE_HEIGHT_MM,
  slipSheetHeightMm: 0,
  palletTareKg: null,
  maxStackPallets: 1,
  quantityTolerance: 0,
  isPalletStandard: false,
  buildNotes: "",
};

const LAYER_PATTERNS: readonly LayerPattern[] = ["block", "brick", "pinwheel", "column", "custom"];

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function intOr(value: unknown, fallback: number): number {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 ? Math.round(parsed) : fallback;
}

function asLayerPattern(value: unknown): LayerPattern {
  return LAYER_PATTERNS.includes(value as LayerPattern) ? (value as LayerPattern) : "block";
}

/**
 * Reads an existing profile row into a draft. Prefers the mm columns and falls
 * back to the legacy centimetre ones, so a profile written before the
 * pack-standard migration still opens with its carton dimensions intact.
 */
export function packStandardDraftFromProfile(
  row: Record<string, unknown> | null | undefined,
  defaults?: { footprintLengthMm?: number | null; footprintWidthMm?: number | null },
): PackStandardDraft {
  const fallbackLength = positive(defaults?.footprintLengthMm) ?? PALLET_FOOTPRINT_LENGTH_MM;
  const fallbackWidth = positive(defaults?.footprintWidthMm) ?? PALLET_FOOTPRINT_WIDTH_MM;
  if (!row) {
    return { ...EMPTY_PACK_STANDARD_DRAFT, footprintLengthMm: fallbackLength, footprintWidthMm: fallbackWidth };
  }
  return {
    packagesPerLayer: positive(row.packages_per_layer),
    layersPerPallet: positive(row.layers_per_pallet),
    layerColumns: positive(row.layer_columns),
    layerPattern: asLayerPattern(row.layer_pattern),
    packageLengthMm: positive(row.package_length_mm) ?? cmToMm(positive(row.length)),
    packageWidthMm: positive(row.package_width_mm) ?? cmToMm(positive(row.width)),
    packageHeightMm: positive(row.package_height_mm) ?? cmToMm(positive(row.height)),
    footprintLengthMm: positive(row.pallet_footprint_length_mm) ?? fallbackLength,
    footprintWidthMm: positive(row.pallet_footprint_width_mm) ?? fallbackWidth,
    palletBaseHeightMm: intOr(row.pallet_base_height_mm, DEFAULT_PALLET_BASE_HEIGHT_MM),
    slipSheetHeightMm: intOr(row.slip_sheet_height_mm, 0),
    palletTareKg: num(row.pallet_tare_kg),
    maxStackPallets: intOr(row.max_stack_pallets, 1),
    quantityTolerance: intOr(row.quantity_tolerance, 0),
    isPalletStandard: row.is_pallet_standard === true,
    buildNotes: typeof row.build_notes === "string" ? row.build_notes : "",
  };
}

/**
 * The write payload for the pack-standard half of a profile row.
 *
 * Two traps this function exists to contain:
 *
 * 1. **cm and mm must move together.** The `sync_packaging_profile_package_mm`
 *    trigger mirrors cm into mm on UPDATE unless mm changes in the same
 *    statement. Writing mm alone leaves the legacy `length`/`width`/`height`
 *    columns stale for every cm reader (receiving-core reads them as a pallet
 *    dimension fallback); writing cm alone hands authority back to the trigger.
 *    So this section owns millimetres and *derives* centimetres, always
 *    emitting both. mm is the authority here; cm is derived, never the reverse.
 *
 * 2. **Base and slip-sheet heights must be numbers, never null.** The generated
 *    `standard_height_mm` is `base + layers * (package_height_mm + slip)`, and
 *    one null makes the whole expression null. The standard would then exist
 *    with no height, and `exceedsClearance` treats a missing height as "no
 *    evidence of a problem" — a silent pass with nothing logged anywhere.
 */
export function buildPackStandardPayload(draft: PackStandardDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    packages_per_layer: draft.packagesPerLayer,
    layers_per_pallet: draft.layersPerPallet,
    layer_pattern: draft.layerPattern,
    layer_columns: draft.layerColumns,
    package_length_mm: draft.packageLengthMm,
    package_width_mm: draft.packageWidthMm,
    package_height_mm: draft.packageHeightMm,
    pallet_footprint_length_mm: Math.round(draft.footprintLengthMm),
    pallet_footprint_width_mm: Math.round(draft.footprintWidthMm),
    pallet_base_height_mm: intOr(draft.palletBaseHeightMm, DEFAULT_PALLET_BASE_HEIGHT_MM),
    slip_sheet_height_mm: intOr(draft.slipSheetHeightMm, 0),
    pallet_tare_kg: draft.palletTareKg,
    max_stack_pallets: intOr(draft.maxStackPallets, 1),
    quantity_tolerance: intOr(draft.quantityTolerance, 0),
    is_pallet_standard: draft.isPalletStandard,
    build_notes: draft.buildNotes.trim() || null,
    // Derived centimetres, in the same statement. numeric(10,2) holds mm/10
    // exactly for any integer mm, so this direction never loses precision.
    length: draft.packageLengthMm === null ? null : draft.packageLengthMm / 10,
    width: draft.packageWidthMm === null ? null : draft.packageWidthMm / 10,
    height: draft.packageHeightMm === null ? null : draft.packageHeightMm / 10,
  };
  for (const column of GENERATED_PROFILE_COLUMNS) delete payload[column];
  return payload;
}

/**
 * A profile name defaulting to the pack code, suffixed until it is free.
 * ASCII rather than the typographic display form: the name flows through CSV
 * import/export and scanner keyboards, and `unique (product_id, profile_name)`
 * makes a near-duplicate expensive.
 */
export function suggestProfileName(draft: PackStandardDraft, taken: string[]): string {
  const base = formatPackCodeAscii({
    packages_per_layer: draft.packagesPerLayer,
    layers_per_pallet: draft.layersPerPallet,
  }) || "Pack standard";
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base} (${suffix})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export interface PackStandardSummary {
  /** Saved profile name, e.g. `12x7`. Empty when the row has none. */
  profileName: string;
  /** Display pack code, e.g. `12 × 7`. Empty when layer data is incomplete. */
  packCode: string;
  /** Cases on a full standard pallet, or null when not derivable. */
  casesPerPallet: number | null;
  /** Stock units in one case, or null when not recorded. */
  unitsPerPackage: number | null;
}

/**
 * A one-line reading of a product's pallet build, for the picking list and the
 * Products table. Returns null when the profile carries no usable layer data,
 * so the caller falls back to showing the raw quantity alone.
 */
export function summarizePackStandard(
  profile: Record<string, unknown> | null | undefined,
): PackStandardSummary | null {
  if (!profile) return null;
  const fields = profile as PackStandardFields;
  const casesPerPallet = resolvePackagesPerPallet(fields);
  const packCode = formatPackCode(fields);
  if (!packCode && casesPerPallet === null) return null;
  const unitsPerPackage = Number((profile as Record<string, unknown>).units_per_package);
  return {
    profileName: typeof profile.profile_name === "string" ? profile.profile_name : "",
    packCode,
    casesPerPallet,
    unitsPerPackage: Number.isFinite(unitsPerPackage) && unitsPerPackage > 0 ? unitsPerPackage : null,
  };
}

/**
 * The whole-case count a stock-unit quantity represents under a pack standard,
 * or null when the case size is unknown. Not rounded — the display layer
 * decides whether to show `≈`.
 */
export function casesForQuantity(
  quantity: number | null | undefined,
  summary: PackStandardSummary | null | undefined,
): number | null {
  const qty = Number(quantity);
  if (!summary || !summary.unitsPerPackage || !Number.isFinite(qty) || qty <= 0) return null;
  return qty / summary.unitsPerPackage;
}

/** `12 × 7 · 84 cases/pallet`, or just the pack code, or an empty string. */
export function formatPackStandardLine(summary: PackStandardSummary | null | undefined): string {
  if (!summary) return "";
  if (summary.casesPerPallet !== null) {
    const cases = `${summary.casesPerPallet} case${summary.casesPerPallet === 1 ? "" : "s"}/pallet`;
    return summary.packCode ? `${summary.packCode} · ${cases}` : cases;
  }
  return summary.packCode;
}

/**
 * The profile a SKU should default to on selection. Precedence is deliberate:
 * the declared pallet standard beats the generic default, which beats a lone
 * profile. Hidden rows never win — an archived standard is archived.
 */
export function resolveDefaultProfileForProduct<T extends Record<string, unknown>>(
  profiles: readonly T[] | null | undefined,
  productId: string | null | undefined,
): T | null {
  if (!profiles || !productId) return null;
  const candidates = profiles.filter(
    (profile) => profile.product_id === productId && profile.is_hidden !== true,
  );
  if (candidates.length === 0) return null;
  return (
    candidates.find((profile) => profile.is_pallet_standard === true)
    ?? candidates.find((profile) => profile.is_default === true)
    ?? (candidates.length === 1 ? candidates[0] : null)
  );
}
