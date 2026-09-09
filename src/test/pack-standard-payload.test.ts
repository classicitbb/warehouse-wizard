import { describe, expect, it } from "vitest";

import {
  EMPTY_PACK_STANDARD_DRAFT,
  GENERATED_PROFILE_COLUMNS,
  buildPackStandardPayload,
  packStandardDraftFromProfile,
  resolveDefaultProfileForProduct,
  suggestProfileName,
  type PackStandardDraft,
} from "@/lib/pack-standard-payload";

const DRAFT: PackStandardDraft = {
  ...EMPTY_PACK_STANDARD_DRAFT,
  packagesPerLayer: 12,
  layersPerPallet: 7,
  layerColumns: 4,
  packageLengthMm: 400,
  packageWidthMm: 300,
  packageHeightMm: 225,
};

describe("buildPackStandardPayload — the cm/mm pairing", () => {
  it("writes millimetres and the derived centimetres in the same payload", () => {
    // mm alone leaves the legacy cm columns stale for every cm reader; cm alone
    // hands authority back to the sync trigger.
    const payload = buildPackStandardPayload(DRAFT);
    expect(payload.package_height_mm).toBe(225);
    expect(payload.height).toBe(22.5);
    expect(payload.package_length_mm).toBe(400);
    expect(payload.length).toBe(40);
    expect(payload.package_width_mm).toBe(300);
    expect(payload.width).toBe(30);
  });

  it("keeps mm to cm exact for any integer millimetre value", () => {
    for (const mm of [1, 7, 225, 1219, 9999]) {
      const payload = buildPackStandardPayload({ ...DRAFT, packageHeightMm: mm });
      expect(payload.height).toBeCloseTo(mm / 10, 10);
      // numeric(10,2) holds two decimals, which mm/10 never exceeds.
      expect(Number((payload.height as number).toFixed(2))).toBe(payload.height);
    }
  });

  it("nulls both halves together when a dimension is unset", () => {
    const payload = buildPackStandardPayload({ ...DRAFT, packageHeightMm: null });
    expect(payload.package_height_mm).toBeNull();
    expect(payload.height).toBeNull();
  });
});

describe("buildPackStandardPayload — generated columns", () => {
  it.each(GENERATED_PROFILE_COLUMNS)("never sends %s", (column) => {
    // Postgres raises 428C9 on a generated column, and cleanPayload does not
    // filter them out.
    expect(buildPackStandardPayload(DRAFT)).not.toHaveProperty(column);
  });
});

describe("buildPackStandardPayload — the silent null trap", () => {
  it("always sends a numeric base and slip-sheet height", () => {
    // A null in either makes the generated standard_height_mm null, so the
    // standard exists with no height and every clearance check silently passes.
    const payload = buildPackStandardPayload(DRAFT);
    expect(payload.pallet_base_height_mm).toBe(145);
    expect(payload.slip_sheet_height_mm).toBe(0);
  });

  it("restores the column defaults when the draft carries junk", () => {
    const payload = buildPackStandardPayload({
      ...DRAFT,
      palletBaseHeightMm: Number.NaN,
      slipSheetHeightMm: Number.NaN,
      maxStackPallets: Number.NaN,
      quantityTolerance: Number.NaN,
    });
    expect(payload.pallet_base_height_mm).toBe(145);
    expect(payload.slip_sheet_height_mm).toBe(0);
    expect(payload.max_stack_pallets).toBe(1);
    expect(payload.quantity_tolerance).toBe(0);
  });

  it("keeps a deliberate zero slip sheet rather than replacing it", () => {
    expect(buildPackStandardPayload({ ...DRAFT, slipSheetHeightMm: 0 }).slip_sheet_height_mm).toBe(0);
  });

  it("stores an empty build note as null rather than an empty string", () => {
    expect(buildPackStandardPayload({ ...DRAFT, buildNotes: "   " }).build_notes).toBeNull();
    expect(buildPackStandardPayload({ ...DRAFT, buildNotes: " labels out " }).build_notes).toBe("labels out");
  });
});

describe("packStandardDraftFromProfile", () => {
  it("prefers the millimetre columns", () => {
    const draft = packStandardDraftFromProfile({
      package_height_mm: 225, height: 99, packages_per_layer: 12, layers_per_pallet: 7,
    });
    expect(draft.packageHeightMm).toBe(225);
  });

  it("falls back to the legacy centimetres for a pre-migration row", () => {
    // Profiles written before the pack-standard migration have cm only.
    const draft = packStandardDraftFromProfile({ height: 22.5, length: 40, width: 30 });
    expect(draft.packageHeightMm).toBe(225);
    expect(draft.packageLengthMm).toBe(400);
    expect(draft.packageWidthMm).toBe(300);
  });

  it("round-trips a draft through a payload unchanged", () => {
    const payload = buildPackStandardPayload(DRAFT);
    expect(packStandardDraftFromProfile(payload)).toEqual(DRAFT);
  });

  it("defaults an unknown layer pattern to block", () => {
    expect(packStandardDraftFromProfile({ layer_pattern: "spiral" }).layerPattern).toBe("block");
    expect(packStandardDraftFromProfile({ layer_pattern: "brick" }).layerPattern).toBe("brick");
  });

  it("takes the footprint from the warehouse allowance when the profile has none", () => {
    const draft = packStandardDraftFromProfile({}, { footprintLengthMm: 1219, footprintWidthMm: 1016 });
    expect(draft.footprintLengthMm).toBe(1219);
    expect(draft.footprintWidthMm).toBe(1016);
  });

  it("returns an empty draft for a missing row without throwing", () => {
    expect(packStandardDraftFromProfile(null)).toEqual(EMPTY_PACK_STANDARD_DRAFT);
  });
});

describe("suggestProfileName", () => {
  it("defaults to the ASCII pack code, not the typographic one", () => {
    // The name flows through CSV import/export and scanner keyboards.
    expect(suggestProfileName(DRAFT, [])).toBe("12x7");
  });

  it("suffixes until the name is free", () => {
    expect(suggestProfileName(DRAFT, ["12x7"])).toBe("12x7 (2)");
    expect(suggestProfileName(DRAFT, ["12x7", "12x7 (2)"])).toBe("12x7 (3)");
  });

  it("compares names case-insensitively", () => {
    expect(suggestProfileName(DRAFT, ["12X7"])).toBe("12x7 (2)");
  });

  it("falls back to a readable name when the draft has no layer data", () => {
    expect(suggestProfileName(EMPTY_PACK_STANDARD_DRAFT, [])).toBe("Pack standard");
  });
});

describe("resolveDefaultProfileForProduct", () => {
  const rows = [
    { id: "a", product_id: "p1", is_default: true },
    { id: "b", product_id: "p1", is_pallet_standard: true },
    { id: "c", product_id: "p2" },
  ];

  it("prefers the declared pallet standard over the generic default", () => {
    expect(resolveDefaultProfileForProduct(rows, "p1")?.id).toBe("b");
  });

  it("falls back to the generic default", () => {
    const withoutStandard = rows.filter((row) => row.id !== "b");
    expect(resolveDefaultProfileForProduct(withoutStandard, "p1")?.id).toBe("a");
  });

  it("takes a lone profile for the product", () => {
    expect(resolveDefaultProfileForProduct(rows, "p2")?.id).toBe("c");
  });

  it("picks nothing when several profiles compete with no marker", () => {
    // Guessing here would silently attach the wrong standard to a receipt.
    const ambiguous = [
      { id: "x", product_id: "p3" },
      { id: "y", product_id: "p3" },
    ];
    expect(resolveDefaultProfileForProduct(ambiguous, "p3")).toBeNull();
  });

  it("never returns a hidden profile, even a hidden standard", () => {
    const hidden = [
      { id: "h", product_id: "p4", is_pallet_standard: true, is_hidden: true },
      { id: "v", product_id: "p4", is_default: true },
    ];
    expect(resolveDefaultProfileForProduct(hidden, "p4")?.id).toBe("v");
    expect(resolveDefaultProfileForProduct([hidden[0]], "p4")).toBeNull();
  });

  it("returns null for a missing product or empty list", () => {
    expect(resolveDefaultProfileForProduct(rows, null)).toBeNull();
    expect(resolveDefaultProfileForProduct([], "p1")).toBeNull();
    expect(resolveDefaultProfileForProduct(null, "p1")).toBeNull();
  });
});
