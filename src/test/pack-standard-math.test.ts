import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  formatPackCode,
  hasPackLayerData,
  resolveEffectiveClearanceMm,
  resolveLocationClearanceMm,
  resolvePackStandard,
  resolvePackagesPerPallet,
  resolvePalletHeightMm,
  resolveStandardGrossWeightKg,
  resolveStandardHeightMm,
  resolveUnitsPerPallet,
  validatePutawayAssignment,
} from "@/lib/wms-core";

const packStandardsMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260829120000_pallet_pack_standards.sql"),
  "utf8",
);
const slottingMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260829120200_directed_putaway_clearance_mm.sql"),
  "utf8",
);
const correctionMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260829120100_pallet_correction_standard_height.sql"),
  "utf8",
);

// A 6 x 8 standard: six cases per layer, eight layers, forty-eight cases.
// 145 mm deck, 220 mm cases, no slip sheet — 1905 mm built.
const sixByEight = {
  units_per_package: 12,
  packages_per_layer: 6,
  layers_per_pallet: 8,
  package_height_mm: 220,
  pallet_base_height_mm: 145,
  slip_sheet_height_mm: 0,
  pallet_tare_kg: 25,
  weight: 9.5,
};

describe("derived pallet quantities", () => {
  it("counts cases and stock units on a full standard pallet", () => {
    expect(resolvePackagesPerPallet(sixByEight)).toBe(48);
    expect(resolveUnitsPerPallet(sixByEight)).toBe(576);
  });

  it("keeps packages and units distinct — the floor counts cases, the form counts units", () => {
    const singles = { ...sixByEight, units_per_package: 1 };
    expect(resolvePackagesPerPallet(singles)).toBe(48);
    expect(resolveUnitsPerPallet(singles)).toBe(48);
  });

  it("resolves to null for a profile with no layer data, so nothing is guessed", () => {
    const legacy = { units_per_package: 12, height: 22, weight: 9.5 };
    expect(resolvePackagesPerPallet(legacy)).toBeNull();
    expect(resolveUnitsPerPallet(legacy)).toBeNull();
    expect(resolveStandardHeightMm(legacy)).toBeNull();
    expect(resolveStandardGrossWeightKg(legacy)).toBeNull();
    expect(hasPackLayerData(legacy)).toBe(false);
    expect(resolvePackStandard(legacy)).toEqual({
      packagesPerLayer: null,
      layersPerPallet: null,
      packagesPerPallet: null,
      unitsPerPallet: null,
      standardHeightMm: null,
      standardGrossWeightKg: null,
    });
  });

  it("renders the floor shorthand", () => {
    expect(formatPackCode(sixByEight)).toBe("6 × 8");
    expect(formatPackCode({ packages_per_layer: 6 })).toBe("");
  });
});

describe("standard height", () => {
  it("stacks the deck, the layers, and the slip sheets", () => {
    expect(resolveStandardHeightMm(sixByEight)).toBe(1905);
  });

  it("counts a slip sheet on every layer", () => {
    expect(resolveStandardHeightMm({ ...sixByEight, slip_sheet_height_mm: 3 })).toBe(1929);
  });

  it("is built from the millimetre package height, never the legacy centimetre column", () => {
    // The cm column says 22, the mm column says 220. Reading the cm column
    // here would be a silent 10x error: 145 + 8 * 22 = 321 mm.
    const mixed = { ...sixByEight, height: 22 };
    expect(resolveStandardHeightMm(mixed)).toBe(1905);
  });

  it("prefers the value the database generated", () => {
    expect(resolveStandardHeightMm({ ...sixByEight, standard_height_mm: 1880 })).toBe(1880);
  });

  it("adds the tare to the case weight for gross weight", () => {
    expect(resolveStandardGrossWeightKg(sixByEight)).toBe(25 + 9.5 * 48);
    // Mirrors the generated column: no tare recorded, no gross weight claimed.
    expect(resolveStandardGrossWeightKg({ ...sixByEight, pallet_tare_kg: null })).toBeNull();
  });
});

describe("clearance resolution and margin arithmetic", () => {
  const bay = { max_height_mm: 2000, max_height: 200 };

  it("gives the fit test, the slotting filter, and the block the same number", () => {
    expect(resolveLocationClearanceMm(bay)).toBe(2000);
    expect(resolveEffectiveClearanceMm(bay, 76)).toBe(1924);
  });

  it("budgets for the count dropping — a 1905 mm pallet needs a 1981 mm bay", () => {
    const standardHeightMm = resolveStandardHeightMm(sixByEight)!;
    expect(resolveEffectiveClearanceMm({ max_height_mm: 1981 }, 76)).toBe(1905);
    expect(resolveEffectiveClearanceMm({ max_height_mm: 1980 }, 76)).toBeLessThan(standardHeightMm);
  });

  it("reads a pallet's built height from the snapshot, not the carton column", () => {
    const pallet = { standard_height_mm: 1905, height: 190.5 };
    expect(resolvePalletHeightMm(pallet)).toBe(1905);
    // The pre-Phase-1 bug: pallets.height held the ~22 cm carton height, so a
    // 190 cm bin looked comfortable.
    expect(resolvePalletHeightMm({ height: 22 })).toBe(220);
  });
});

describe("validatePutawayAssignment height rule", () => {
  const base = {
    productTemperature: "ambient",
    locationTemperature: "ambient",
    locationStatus: "active",
    locationMaxPallets: 2,
    occupiedPallets: 0,
    mixedSkuAllowed: true,
    hasOtherSku: false,
  };

  it("blocks a pallet that does not fit under the margined ceiling", () => {
    const result = validatePutawayAssignment({
      ...base,
      palletHeightMm: 1905,
      locationClearanceMm: 1900,
      clearanceMarginMm: 76,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("1905 mm pallet");
    expect(result.reason).toContain("1900 mm bin");
    expect(result.reason).toContain("76 mm margin");
  });

  it("marks a height failure as a hard block with no override path", () => {
    const result = validatePutawayAssignment({
      ...base,
      palletHeightMm: 1905,
      locationClearanceMm: 1900,
    });
    expect(result.overridable).toBe(false);
  });

  it("leaves every other rule overridable", () => {
    const full = validatePutawayAssignment({ ...base, occupiedPallets: 2 });
    expect(full.valid).toBe(false);
    expect(full.overridable).toBeUndefined();
  });

  it("applies the margin to the legacy centimetre inputs too", () => {
    // 190 cm bin, 76 mm margin => 1824 mm usable, so a 185 cm pallet is out.
    const result = validatePutawayAssignment({
      ...base,
      palletHeightCm: 185,
      locationMaxPalletHeightCm: 190,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("1850 mm pallet");
  });

  it("passes a pallet that clears the margin", () => {
    const result = validatePutawayAssignment({
      ...base,
      palletHeightMm: 1905,
      locationClearanceMm: 2000,
      clearanceMarginMm: 76,
    });
    expect(result.valid).toBe(true);
  });

  it("never blocks when a height is unrecorded", () => {
    expect(validatePutawayAssignment({ ...base, locationClearanceMm: 1900 }).valid).toBe(true);
    expect(validatePutawayAssignment({ ...base, palletHeightMm: 2400 }).valid).toBe(true);
  });
});

describe("pallet pack standards migration", () => {
  it("adds the build-standard columns additively", () => {
    for (const column of [
      "packages_per_layer",
      "layers_per_pallet",
      "layer_pattern",
      "layer_columns",
      "package_length_mm",
      "package_width_mm",
      "package_height_mm",
      "pallet_footprint_length_mm",
      "pallet_footprint_width_mm",
      "pallet_base_height_mm",
      "slip_sheet_height_mm",
      "pallet_tare_kg",
      "max_stack_pallets",
      "quantity_tolerance",
      "is_pallet_standard",
      "build_notes",
      "revision",
      "superseded_by_id",
      "effective_from",
      "fit_status",
      "fit_checked_at",
      "fit_summary",
    ]) {
      expect(packStandardsMigration).toContain(`add column if not exists ${column}`);
    }
  });

  it("backfills the package millimetre columns from the legacy centimetre columns", () => {
    expect(packStandardsMigration).toContain("set package_length_mm = round(length * 10)::int");
    expect(packStandardsMigration).toContain("set package_width_mm = round(width * 10)::int");
    expect(packStandardsMigration).toContain("set package_height_mm = round(height * 10)::int");
  });

  it("generates the standard height from the millimetre package column", () => {
    expect(packStandardsMigration).toContain(
      "pallet_base_height_mm + layers_per_pallet * (package_height_mm + slip_sheet_height_mm)",
    );
    // Never from the centimetre column, which would mix units.
    expect(packStandardsMigration).not.toContain("layers_per_pallet * (height +");
  });

  it("writes the derived quantities out in full, since a generated column cannot reference another", () => {
    expect(packStandardsMigration).toContain(
      "generated always as (packages_per_layer * layers_per_pallet) stored",
    );
    expect(packStandardsMigration).toContain(
      "generated always as (units_per_package * packages_per_layer * layers_per_pallet) stored",
    );
    expect(packStandardsMigration).toContain(
      "pallet_tare_kg + weight * (packages_per_layer * layers_per_pallet)",
    );
  });

  it("allows one build standard per product", () => {
    expect(packStandardsMigration).toContain(
      "create unique index if not exists product_packaging_profiles_one_standard_per_product",
    );
    expect(packStandardsMigration).toContain("where is_pallet_standard and not is_hidden");
  });

  it("moves bin clearances to millimetres and adds the warehouse margin", () => {
    expect(packStandardsMigration).toContain("add column if not exists max_height_mm integer");
    expect(packStandardsMigration).toContain("set max_height_mm = round(max_height * 10)::int");
    expect(packStandardsMigration).toContain(
      "add column if not exists clearance_safety_margin_mm integer not null default 76",
    );
  });

  it("snapshots the standard on the pallet", () => {
    expect(packStandardsMigration).toContain("add column if not exists standard_packages_per_layer integer");
    expect(packStandardsMigration).toContain("add column if not exists standard_layers_per_pallet  integer");
    expect(packStandardsMigration).toContain("add column if not exists standard_height_mm          integer");
  });

  it("keeps the legacy centimetre columns written through to millimetres", () => {
    // Neither form writes millimetres until Phase 2, so a profile or bin
    // created after the one-shot backfill would keep a null mm column.
    expect(packStandardsMigration).toContain("create or replace function public.sync_packaging_profile_package_mm");
    expect(packStandardsMigration).toContain("create trigger product_packaging_profiles_package_mm_sync");
    expect(packStandardsMigration).toContain("create or replace function public.sync_location_max_height_mm");
    expect(packStandardsMigration).toContain("create trigger locations_max_height_mm_sync");
  });

  it("ships one clearance expression for the SQL callers", () => {
    expect(packStandardsMigration).toContain("create or replace function public.location_clearance_mm");
    expect(packStandardsMigration).toContain("create or replace function public.effective_clearance_mm");
    expect(packStandardsMigration).toContain("create or replace function public.pallet_height_mm");
  });
});

describe("slotting and correction migrations", () => {
  it("filters put-away candidates on the effective millimetre clearance", () => {
    expect(slottingMigration).toContain("create or replace function public.directed_putaway_candidates");
    expect(slottingMigration).toContain("public.effective_clearance_mm(");
    expect(slottingMigration).toContain("public.pallet_height_mm(pc.standard_height_mm, pc.height)");
    // The old centimetre filter is gone.
    expect(slottingMigration).not.toContain("l.max_height >= pc.height");
  });

  it("leaves the Phase 5 scoring alone", () => {
    expect(slottingMigration).not.toContain("height_band");
    expect(slottingMigration).not.toContain("headroom_mm");
  });

  it("carries the build standard across a cloned pallet row", () => {
    expect(correctionMigration).toContain(
      "create or replace function public.complete_inventory_pallet_correction",
    );
    expect(correctionMigration).toContain(
      "standard_packages_per_layer, standard_layers_per_pallet, standard_height_mm",
    );
    expect(correctionMigration).toContain(
      "v_replacement_height_cm := coalesce(v_standard_height_mm / 10.0, old_pallet.height);",
    );
  });
});
