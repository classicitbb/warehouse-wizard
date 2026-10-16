import { describe, expect, it } from "vitest";

import {
  buildItemUnitsPageQuery,
  buildUnitsPageQuery,
  collectUnits,
  mapItemUnitRow,
  mapUnitRow,
} from "../../supabase/functions/_shared/netsuite-units";
import { resolvePackageType, type PackageType } from "@/features/shared/package-types";

// Rows shaped like the Simplex sandbox (9738806-sb1) BL-6BG recipe.
const bag = {
  type_id: "41", type_name: "BL-6BG", type_inactive: "F",
  unit_id: "232", unitname: "BAG", pluralname: "BAGS", abbreviation: "BG", pluralabbreviation: "BG",
  conversionrate: "1", baseunit: "T", inuse: "T",
};
const bale = { ...bag, unit_id: "233", unitname: "BALES", pluralname: "BALES", abbreviation: "BL", conversionrate: "6", baseunit: "F" };

describe("netsuite-units SuiteQL builders", () => {
  it("joins unitstype to unitstypeuom with a unit keyset", () => {
    const q = buildUnitsPageQuery(500);
    expect(q).toContain("FROM unitstype t JOIN unitstypeuom u ON u.unitstype = t.id");
    expect(q).toContain("WHERE u.internalid > 500");
    expect(q).toContain("ORDER BY u.internalid");
  });

  it("reads item unit assignments with an item keyset", () => {
    const q = buildItemUnitsPageQuery(5802);
    expect(q).toContain("i.unitstype, i.stockunit, i.saleunit, i.purchaseunit");
    expect(q).toContain("i.unitstype IS NOT NULL AND i.id > 5802");
  });

  it("never embeds a non-numeric keyset", () => {
    expect(buildUnitsPageQuery(Number.NaN)).toContain("> 0");
    expect(buildItemUnitsPageQuery(-4)).toContain("> 0");
    expect(buildItemUnitsPageQuery(12.7)).toContain("> 12 ");
  });
});

describe("mapUnitRow", () => {
  it("maps the type and unit", () => {
    expect(mapUnitRow(bale)).toEqual({
      type: { ns_internal_id: "41", name: "BL-6BG", is_inactive: false },
      unit: {
        typeExternalId: "41",
        ns_internal_id: "233",
        unit_name: "BALES",
        plural_name: "BALES",
        abbreviation: "BL",
        plural_abbreviation: "BG",
        conversion_rate: 6,
        is_base: false,
        in_use: true,
      },
    });
  });

  it("rejects rows without ids, a name or a positive rate", () => {
    expect(mapUnitRow({ ...bag, unit_id: "" })).toBeNull();
    expect(mapUnitRow({ ...bag, type_id: undefined })).toBeNull();
    expect(mapUnitRow({ ...bag, unitname: "  " })).toBeNull();
    expect(mapUnitRow({ ...bag, conversionrate: "0" })).toBeNull();
    expect(mapUnitRow({ ...bag, conversionrate: "abc" })).toBeNull();
  });

  it("treats a blank inuse as in use and flags inactive types", () => {
    const mapped = mapUnitRow({ ...bag, inuse: "", type_inactive: "T" });
    expect(mapped?.unit.in_use).toBe(true);
    expect(mapped?.type.is_inactive).toBe(true);
    expect(mapUnitRow({ ...bag, inuse: "F" })?.unit.in_use).toBe(false);
  });
});

describe("collectUnits", () => {
  it("de-duplicates types and counts skipped rows", () => {
    const result = collectUnits([bag, bale, { ...bag, unit_id: undefined }]);
    expect(result.types).toHaveLength(1);
    expect(result.units.map((u) => u.ns_internal_id)).toEqual(["232", "233"]);
    expect(result.units.find((u) => u.is_base)?.unit_name).toBe("BAG");
    expect(result.skipped).toBe(1);
  });
});

describe("mapItemUnitRow", () => {
  it("keeps NetSuite unit ids and blanks missing ones", () => {
    expect(mapItemUnitRow({ id: "5802", unitstype: "1", stockunit: "3", saleunit: "", purchaseunit: "3" })).toEqual({
      itemId: "5802", unitstype: "1", stockunit: "3", saleunit: null, purchaseunit: "3",
    });
    expect(mapItemUnitRow({ unitstype: "1" })).toBeNull();
  });
});

describe("resolvePackageType", () => {
  const types: PackageType[] = [
    { id: "bale", code: "BALE", name: "Bale", aliases: ["bale", "bales", "bl"], sort: 10 },
    { id: "case", code: "CASE", name: "Case", aliases: ["case", "cases", "cs"], sort: 20 },
  ];

  it("matches the code or any alias, ignoring case and spaces", () => {
    expect(resolvePackageType(types, "Bale")?.id).toBe("bale");
    expect(resolvePackageType(types, " BALES ")?.id).toBe("bale");
    expect(resolvePackageType(types, "cs")?.id).toBe("case");
    expect(resolvePackageType(types, "CASE")?.id).toBe("case");
  });

  it("returns null for unknown or empty text", () => {
    expect(resolvePackageType(types, "pallet")).toBeNull();
    expect(resolvePackageType(types, "")).toBeNull();
    expect(resolvePackageType(types, null)).toBeNull();
  });
});
