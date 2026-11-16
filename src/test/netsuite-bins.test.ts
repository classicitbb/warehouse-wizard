import { describe, expect, it } from "vitest";

import {
  binKey,
  buildBinCreateBody,
  buildBinsPageQuery,
  planBins,
  type WwLocation,
} from "../../supabase/functions/_shared/netsuite-bins";

// Shaped like the Simplex sandbox (9738806-sb1): LOC-01 Lower Estate is id 3.
const nsLocations = [
  { id: "3", name: "LOC-01 Lower Estate", usebins: "T", isinactive: "F" },
  { id: "4", name: "LOC-02 Pine Showroom", usebins: "F", isinactive: "F" },
];
const warehouses = [
  { warehouseId: "wh-le", warehouseName: "Lower Estate 1", netsuiteLocationId: "3" },
  { warehouseId: "wh-pine", warehouseName: "Pine", netsuiteLocationId: "4" },
];
const loc = (id: string, code: string, warehouseId = "wh-le"): WwLocation => ({ id, code, warehouseId, status: "active" });

describe("netsuite-bins", () => {
  it("pages bins by id", () => {
    expect(buildBinsPageQuery(0)).toBe("SELECT id, binnumber, location, isinactive FROM bin WHERE id > 0 ORDER BY id");
    expect(buildBinsPageQuery(42.7)).toContain("id > 42");
    expect(buildBinsPageQuery(-1)).toContain("id > 0");
  });

  it("matches bin numbers case-insensitively per location", () => {
    expect(binKey("3", " a01a ")).toBe(binKey("3", "A01A"));
    expect(binKey("3", "A01A")).not.toBe(binKey("4", "A01A"));
  });

  it("links existing bins, creates missing ones and skips linked ones", () => {
    const plan = planBins({
      warehouses: [warehouses[0]],
      locations: [loc("l1", "A01A"), loc("l2", "A01B"), loc("l3", "A01C")],
      netsuiteLocations: nsLocations,
      netsuiteBins: [
        { id: "10", binnumber: "a01a", location: "3", isinactive: "F" },
        { id: "11", binnumber: "A01C", location: "3", isinactive: "F" },
        { id: "12", binnumber: "A01B", location: "4", isinactive: "F" },
      ],
      existingLinks: new Map([["l3", "11"]]),
    });
    expect(plan.actions).toEqual([
      { kind: "link", locationId: "l1", code: "A01A", netsuiteBinId: "10", netsuiteLocationId: "3" },
      { kind: "create", locationId: "l2", code: "A01B", netsuiteLocationId: "3" },
    ]);
    expect(plan.warehouses[0]).toMatchObject({ usesBins: true, locations: 3, linked: 1, toLink: 1, toCreate: 1 });
  });

  it("recreates a bin whose link points at a bin that no longer exists", () => {
    const plan = planBins({
      warehouses: [warehouses[0]],
      locations: [loc("l1", "A01A")],
      netsuiteLocations: nsLocations,
      netsuiteBins: [],
      existingLinks: new Map([["l1", "999"]]),
    });
    expect(plan.actions).toEqual([{ kind: "create", locationId: "l1", code: "A01A", netsuiteLocationId: "3" }]);
  });

  it("counts but does not create bins where Use Bins is off", () => {
    const plan = planBins({
      warehouses: [warehouses[1]],
      locations: [loc("p1", "P01", "wh-pine")],
      netsuiteLocations: nsLocations,
      netsuiteBins: [],
      existingLinks: new Map(),
    });
    expect(plan.actions).toEqual([]);
    expect(plan.warehouses[0]).toMatchObject({ usesBins: false, toCreate: 1 });
  });

  it("flags inactive matches and ignores duplicate or blank codes", () => {
    const plan = planBins({
      warehouses: [warehouses[0]],
      locations: [loc("l1", "A01A"), loc("l2", "a01a"), loc("l3", "  ")],
      netsuiteLocations: nsLocations,
      netsuiteBins: [{ id: "10", binnumber: "A01A", location: "3", isinactive: "T" }],
      existingLinks: new Map(),
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.warehouses[0]).toMatchObject({ locations: 1, toLink: 1, inactiveMatches: 1 });
  });

  it("builds the REST create body", () => {
    expect(buildBinCreateBody({ kind: "create", locationId: "l1", code: "A01A", netsuiteLocationId: "3" })).toEqual({
      binNumber: "A01A",
      location: { id: "3" },
    });
  });
});
