// measure.ts — length units and pallet pack-standard arithmetic.
//
// Two rules the rest of the app depends on:
//
//   1. Lengths that matter to the height rule are stored as **integer
//      millimetres**. `locations.max_height` / `max_pallet_height_cm` and
//      `pallets.height` remain centimetres for the legacy paths, so every
//      reader goes through the resolvers below rather than reading a column
//      directly. Mixing the two is a silent 10x error.
//   2. Millimetres are displayed in inches rounded to the nearest quarter.
//      A quarter inch is 6.35 mm and integer-mm rounding costs at most
//      0.5 mm, so the round trip is stable:
//      `mmToQuarterInches(quarterInchesToMm(q)) === q` for every q in range.

export const MM_PER_INCH = 25.4;
export const MM_PER_QUARTER_INCH = 6.35;
export const MM_PER_CM = 10;

/** Ratified default: 3 in of clearance is kept free above every pallet. */
export const DEFAULT_CLEARANCE_SAFETY_MARGIN_MM = 76;
/** Deck height of an empty pallet, matching the column default. */
export const DEFAULT_PALLET_BASE_HEIGHT_MM = 145;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A dimension only counts when it is a real, positive measurement. */
function positive(value: unknown): number | null {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

// ── Conversions ──────────────────────────────────────────────────────────────

export function cmToMm(cm: number | null | undefined): number | null {
  const value = finite(cm);
  return value === null ? null : Math.round(value * MM_PER_CM);
}

export function mmToCm(mm: number | null | undefined): number | null {
  const value = finite(mm);
  return value === null ? null : value / MM_PER_CM;
}

/** Millimetres for a whole number of quarter inches, rounded to the nearest mm. */
export function quarterInchesToMm(quarterInches: number): number {
  return Math.round(quarterInches * MM_PER_QUARTER_INCH);
}

/** Nearest whole quarter inch for a millimetre value. */
export function mmToQuarterInches(mm: number): number {
  return Math.round(mm / MM_PER_QUARTER_INCH);
}

/** Exact inches — use `mmToRoundedInches` for anything an operator reads. */
export function mmToInches(mm: number): number {
  return mm / MM_PER_INCH;
}

export function inchesToMm(inches: number): number {
  return Math.round(inches * MM_PER_INCH);
}

/** Inches snapped to the nearest 0.25 in. */
export function roundInchesToQuarter(inches: number): number {
  return Math.round(inches * 4) / 4;
}

/** Millimetres expressed as inches, snapped to the nearest 0.25 in. */
export function mmToRoundedInches(mm: number): number {
  return mmToQuarterInches(mm) / 4;
}

/**
 * Display form for a millimetre length: inches to the nearest quarter.
 * Returns an empty string for a missing value so callers can fall back.
 */
export function formatInches(
  mm: number | null | undefined,
  options: { suffix?: string } = {},
): string {
  const value = finite(mm);
  if (value === null) return "";
  const inches = mmToRoundedInches(value);
  const suffix = options.suffix ?? " in";
  const text = Number.isInteger(inches) ? String(inches) : inches.toFixed(2).replace(/0$/, "");
  return `${text}${suffix}`;
}

/** Display form for a millimetre length in millimetres, e.g. `1905 mm`. */
export function formatMm(mm: number | null | undefined): string {
  const value = finite(mm);
  return value === null ? "" : `${Math.round(value)} mm`;
}

// ── Bin clearance ────────────────────────────────────────────────────────────

export interface LocationClearanceFields {
  max_height_mm?: number | string | null;
  max_height?: number | string | null;
  max_pallet_height_cm?: number | string | null;
}

/**
 * The single reader for a bin's ceiling: the least non-null of the mm column,
 * the legacy cm column, and the older per-pallet cm ceiling. `null` means the
 * bin has no recorded height restriction.
 */
export function resolveLocationClearanceMm(
  location: LocationClearanceFields | null | undefined,
): number | null {
  if (!location) return null;
  const candidates = [
    positive(location.max_height_mm),
    cmToMm(positive(location.max_height)),
    cmToMm(positive(location.max_pallet_height_cm)),
  ].filter((value): value is number => value !== null && value > 0);
  if (candidates.length === 0) return null;
  return Math.min(...candidates);
}

/** The warehouse safety margin, falling back to the ratified 3 in. */
export function resolveClearanceMarginMm(margin?: number | string | null): number {
  const value = finite(margin);
  return value !== null && value >= 0 ? Math.round(value) : DEFAULT_CLEARANCE_SAFETY_MARGIN_MM;
}

/**
 * Usable clearance: the bin ceiling less the warehouse safety margin. This is
 * the number the fit test, the slotting filter, and the put-away block must all
 * compare against, or the three disagree.
 */
export function resolveEffectiveClearanceMm(
  location: LocationClearanceFields | null | undefined,
  margin?: number | string | null,
): number | null {
  const clearance = resolveLocationClearanceMm(location);
  if (clearance === null) return null;
  return Math.max(0, clearance - resolveClearanceMarginMm(margin));
}

export interface PalletHeightFields {
  standard_height_mm?: number | string | null;
  height?: number | string | null;
}

/**
 * A pallet's built height in mm. `standard_height_mm` is the snapshot written
 * at receipt; `height` is the legacy centimetre column, which receiving now
 * keeps in step with it.
 */
export function resolvePalletHeightMm(
  pallet: PalletHeightFields | null | undefined,
): number | null {
  if (!pallet) return null;
  const snapshot = positive(pallet.standard_height_mm);
  if (snapshot !== null) return Math.round(snapshot);
  return cmToMm(positive(pallet.height));
}

export interface ClearanceCheckInput {
  palletHeightMm?: number | null;
  clearanceMm?: number | null;
  marginMm?: number | null;
}

/**
 * The height block message. It quotes raw millimetres on both sides plus the
 * margin deliberately: a quarter-inch display cannot show a 6 mm difference,
 * and an operator who cannot see why they are blocked will work around it.
 */
export function formatClearanceBlockReason(input: ClearanceCheckInput): string {
  const margin = resolveClearanceMarginMm(input.marginMm);
  return (
    `Pallet is too tall for this bin — ${Math.round(input.palletHeightMm ?? 0)} mm pallet, ` +
    `${Math.round(input.clearanceMm ?? 0)} mm bin, ${margin} mm margin`
  );
}

/**
 * True when the pallet does not fit under the margined ceiling. Missing values
 * never block: an unrecorded height is not evidence of a problem.
 */
export function exceedsClearance(input: ClearanceCheckInput): boolean {
  const pallet = positive(input.palletHeightMm);
  const clearance = positive(input.clearanceMm);
  if (pallet === null || clearance === null) return false;
  return pallet > Math.max(0, clearance - resolveClearanceMarginMm(input.marginMm));
}

// ── Pack standard arithmetic ─────────────────────────────────────────────────
//
// Mirrors the generated columns on `product_packaging_profiles` so the client
// can derive the same numbers for a profile it has not re-read, and so the
// receipt path can write a standard height without a round trip.

export interface PackStandardFields {
  units_per_package?: number | string | null;
  packages_per_layer?: number | string | null;
  layers_per_pallet?: number | string | null;
  package_height_mm?: number | string | null;
  pallet_base_height_mm?: number | string | null;
  slip_sheet_height_mm?: number | string | null;
  pallet_tare_kg?: number | string | null;
  weight?: number | string | null;
  standard_height_mm?: number | string | null;
}

/** Cases on a full standard pallet — the 48 in "6 x 8". */
export function resolvePackagesPerPallet(profile: PackStandardFields | null | undefined): number | null {
  if (!profile) return null;
  const perLayer = positive(profile.packages_per_layer);
  const layers = positive(profile.layers_per_pallet);
  if (perLayer === null || layers === null) return null;
  return perLayer * layers;
}

/** Stock units on a full standard pallet — what the receiving form counts in. */
export function resolveUnitsPerPallet(profile: PackStandardFields | null | undefined): number | null {
  const packages = resolvePackagesPerPallet(profile);
  const unitsPerPackage = positive(profile?.units_per_package);
  if (packages === null || unitsPerPackage === null) return null;
  return packages * unitsPerPackage;
}

/**
 * Built height of a standard pallet: deck plus every layer and its slip sheet.
 * Prefers the value the database generated, and derives it otherwise.
 */
export function resolveStandardHeightMm(profile: PackStandardFields | null | undefined): number | null {
  if (!profile) return null;
  const stored = positive(profile.standard_height_mm);
  if (stored !== null) return Math.round(stored);
  const layers = positive(profile.layers_per_pallet);
  const packageHeight = positive(profile.package_height_mm);
  if (layers === null || packageHeight === null) return null;
  // Both columns carry a default in the database, so falling back to the same
  // values reproduces what the generated column would have stored for a
  // profile object that has not been re-read.
  const base = finite(profile.pallet_base_height_mm) ?? DEFAULT_PALLET_BASE_HEIGHT_MM;
  const slipSheet = finite(profile.slip_sheet_height_mm) ?? 0;
  return Math.round(base + layers * (packageHeight + slipSheet));
}

/**
 * Gross weight of a standard pallet, tare included. Mirrors the generated
 * column exactly: `pallet_tare_kg` has no column default, so an unrecorded
 * tare yields null rather than a weight that quietly understates the pallet.
 */
export function resolveStandardGrossWeightKg(profile: PackStandardFields | null | undefined): number | null {
  const packages = resolvePackagesPerPallet(profile);
  const packageWeight = finite(profile?.weight);
  const tare = finite(profile?.pallet_tare_kg);
  if (packages === null || packageWeight === null || tare === null) return null;
  return tare + packageWeight * packages;
}

export interface PackStandard {
  packagesPerLayer: number | null;
  layersPerPallet: number | null;
  packagesPerPallet: number | null;
  unitsPerPallet: number | null;
  standardHeightMm: number | null;
  standardGrossWeightKg: number | null;
}

/** Everything derived from one profile, or all nulls when it carries no layer data. */
export function resolvePackStandard(profile: PackStandardFields | null | undefined): PackStandard {
  return {
    packagesPerLayer: positive(profile?.packages_per_layer),
    layersPerPallet: positive(profile?.layers_per_pallet),
    packagesPerPallet: resolvePackagesPerPallet(profile),
    unitsPerPallet: resolveUnitsPerPallet(profile),
    standardHeightMm: resolveStandardHeightMm(profile),
    standardGrossWeightKg: resolveStandardGrossWeightKg(profile),
  };
}

/** A profile is a usable build standard only once it has both layer numbers. */
export function hasPackLayerData(profile: PackStandardFields | null | undefined): boolean {
  return resolvePackagesPerPallet(profile) !== null;
}

/** Floor shorthand for a build standard, e.g. `6 x 8`. */
export function formatPackCode(profile: PackStandardFields | null | undefined): string {
  const perLayer = positive(profile?.packages_per_layer);
  const layers = positive(profile?.layers_per_pallet);
  if (perLayer === null || layers === null) return "";
  return `${perLayer} × ${layers}`;
}
