import { describe, expect, it } from "vitest";

import {
  bayCodeFromLocationCode,
  buildBayOccupancyGrid,
  buildRackLocationCode,
  createBlankLocationTemplate,
  createBlankWarehouse,
  createBlankZone,
  createDefaultWarehouseSetupPayload,
  displayRackLocationCode,
  expandLocationRange,
  letterToLevel,
  levelToLetter,
  normalizeRackLocationCode,
  parseCsv,
  parseRackLocationCode,
  resolveLocationCapacity,
  validatePutawayAssignment,
} from "@/lib/wms-core";

describe("location capacity", () => {
  it("falls back to depth when a legacy zero max-pallets value masks capacity", () => {
    expect(resolveLocationCapacity(0, 4)).toBe(4);
    expect(resolveLocationCapacity(null, 3)).toBe(3);
  });

  it("prefers a positive max-pallets value", () => {
    expect(resolveLocationCapacity(6, 4)).toBe(6);
  });
});

describe("parseCsv", () => {
  it("maps header names to row values", () => {
    const rows = parseCsv("sku,name\nSKU-1,Test Product\nSKU-2,Cold Item");

    expect(rows).toEqual([
      { sku: "SKU-1", name: "Test Product" },
      { sku: "SKU-2", name: "Cold Item" },
    ]);
  });
});

describe("validatePutawayAssignment", () => {
  it("blocks cool stock in ambient locations", () => {
    const result = validatePutawayAssignment({
      productTemperature: "cool",
      locationTemperature: "ambient",
      locationStatus: "active",
      locationMaxPallets: 1,
      occupiedPallets: 0,
      mixedSkuAllowed: false,
      hasOtherSku: false,
    });

    expect(result).toEqual({
      valid: false,
      reason: "Cool-chain pallet cannot be placed in a non-cool location",
    });
  });

  it("accepts active compatible empty slots", () => {
    const result = validatePutawayAssignment({
      productTemperature: "ambient",
      locationTemperature: "ambient",
      locationStatus: "active",
      locationMaxPallets: 2,
      occupiedPallets: 1,
      mixedSkuAllowed: true,
      hasOtherSku: true,
    });

    expect(result.valid).toBe(true);
  });
});

describe("createDefaultWarehouseSetupPayload", () => {
  it("returns a fully blank payload so the wizard starts from scratch", () => {
    const payload = createDefaultWarehouseSetupPayload();
    expect(payload).toEqual({ warehouses: [], zones: [], locationTemplates: [] });
  });

  it("blank helpers return empty strings and zero counts", () => {
    expect(createBlankWarehouse()).toEqual({ code: "", name: "", city: "", country: "", hasCoolZone: false });
    const zone = createBlankZone();
    expect(zone.code).toBe("");
    expect(zone.warehouseCode).toBe("");
    expect(zone.temperatureClass).toBe("ambient");
    const tpl = createBlankLocationTemplate();
    expect(tpl.aisleCount).toBe(0);
    expect(tpl.baysPerAisle).toBe(0);
    expect(tpl.levels).toBe(0);
    expect(tpl.positionsPerLevel).toBe(0);
    expect(tpl.depth).toBe(0);
    expect(tpl.locationType).toBe("");
  });
});

describe("expandLocationRange", () => {
  it("produces bays × levels × positions rows with depth as capacity", () => {
    const rows = expandLocationRange({
      prefix: "A",
      startBay: 1,
      endBay: 3,
      levels: 5,
      positionsPerLevel: 3,
      depth: 4,
    });
    expect(rows).toHaveLength(45);
    expect(rows[0].localCode).toBe("A-01-L01-P1");
    expect(rows.at(-1)?.localCode).toBe("A-03-L05-P3");
    expect(rows.every((r) => r.maxPallets === 4 && r.depth === 4)).toBe(true);
  });

  it("omits the position segment when each bay-level has one position", () => {
    const rows = expandLocationRange({
      prefix: "A",
      startBay: 1,
      endBay: 1,
      levels: 2,
      positionsPerLevel: 1,
      depth: 2,
    });
    expect(rows.map((r) => r.localCode)).toEqual(["A-01-L01", "A-01-L02"]);
    expect(rows.every((r) => r.position === 1)).toBe(true);
  });

  it("clamps positions to 1–3 and levels to 1–6", () => {
    const rows = expandLocationRange({
      prefix: "B",
      startBay: 1,
      endBay: 1,
      levels: 99,
      positionsPerLevel: 99,
      depth: 99,
    });
    expect(rows).toHaveLength(6 * 3);
    expect(rows[0].depth).toBe(5);
  });

  it("substitutes level numbers for letters when levelStyle is 'letters'", () => {
    const rows = expandLocationRange({
      prefix: "A",
      startBay: 1,
      endBay: 1,
      levels: 3,
      positionsPerLevel: 2,
      depth: 1,
      levelStyle: "letters",
    });
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.localCode)).toEqual([
      "A-01-A-P1",
      "A-01-A-P2",
      "A-01-B-P1",
      "A-01-B-P2",
      "A-01-C-P1",
      "A-01-C-P2",
    ]);
  });
});

describe("rack location codes", () => {
  it("builds and normalizes four-code rack labels", () => {
    expect(buildRackLocationCode({ rack: "A", aisle: 1, bay: 5, level: 5, position: 1 })).toBe("A-05-L05");
    expect(buildRackLocationCode({ rack: "A", aisle: 1, bay: 5, level: 5, position: 1, hasPosition: true })).toBe("A-05-L05-P1");
    expect(normalizeRackLocationCode("WH3-A-1-05-L05-P1")).toBe("A-05-L05-P1");
  });

  it("shortens rack location display labels without uppercasing non-rack labels", () => {
    expect(displayRackLocationCode("WH3-A-1-01-L05-P2")).toBe("A-01-L05-P2");
    expect(displayRackLocationCode("Receiving")).toBe("Receiving");
  });
});

describe("buildBayOccupancyGrid", () => {
  it("orders levels bottom-up physically with P1/P2/P3 left to right", () => {
    const cells = [
      "A-01-L01-P3",
      "A-01-L03-P2",
      "A-01-L04-P1",
      "A-01-L02-P3",
      "A-01-L01-P1",
      "A-01-L04-P3",
      "A-01-L02-P1",
      "A-01-L03-P1",
      "A-01-L04-P2",
      "A-01-L01-P2",
      "A-01-L02-P2",
      "A-01-L03-P3",
    ].map((locationCode, index) => ({
      locationId: `loc-${index}`,
      locationCode,
      level: locationCode.match(/L(\d+)/)?.[1] ?? null,
      position: null,
      depth: 4,
      maxPallets: 4,
      occupiedPallets: 0,
      status: "active",
      isFull: false,
    }));

    const grid = buildBayOccupancyGrid(cells);
    const renderedCodes = grid.map((row) => row.map((slot) => slot.cell?.locationCode ?? null));

    expect(renderedCodes).toEqual([
      ["A-01-L04-P1", "A-01-L04-P2", "A-01-L04-P3"],
      ["A-01-L03-P1", "A-01-L03-P2", "A-01-L03-P3"],
      ["A-01-L02-P1", "A-01-L02-P2", "A-01-L02-P3"],
      ["A-01-L01-P1", "A-01-L01-P2", "A-01-L01-P3"],
    ]);
  });

  it("uses the configured bay position count without extra unused columns", () => {
    const baseCell = {
      locationId: "loc",
      depth: 2,
      maxPallets: 2,
      occupiedPallets: 0,
      status: "active",
      isFull: false,
    };

    expect(buildBayOccupancyGrid([{ ...baseCell, locationCode: "A-01-L01", level: 1, position: 1 }])[0]).toHaveLength(1);
    expect(buildBayOccupancyGrid([
      { ...baseCell, locationId: "loc-1", locationCode: "A-01-L01-P1", level: 1, position: 1 },
      { ...baseCell, locationId: "loc-2", locationCode: "A-01-L01-P2", level: 1, position: 2 },
    ])[0]).toHaveLength(2);
    expect(buildBayOccupancyGrid([
      { ...baseCell, locationId: "loc-1", locationCode: "A-01-L01-P1", level: 1, position: 1 },
      { ...baseCell, locationId: "loc-2", locationCode: "A-01-L01-P2", level: 1, position: 2 },
      { ...baseCell, locationId: "loc-3", locationCode: "A-01-L01-P3", level: 1, position: 3 },
    ])[0]).toHaveLength(3);
  });
});

describe("level letter helpers", () => {
  it("round-trips level numbers and letters", () => {
    expect(levelToLetter(1)).toBe("A");
    expect(levelToLetter(4)).toBe("D");
    expect(letterToLevel("A")).toBe(1);
    expect(letterToLevel("D")).toBe(4);
    expect(letterToLevel("z")).toBe(26);
    expect(Number.isNaN(letterToLevel("AB"))).toBe(true);
  });
});

describe("parseRackLocationCode across styles", () => {
  it("parses numeric and alpha codes with or without a position segment", () => {
    expect(parseRackLocationCode("A-01-L02-P3")).toMatchObject({ rack: "A", bay: 1, level: 2, position: 3, levelStyle: "numeric", hasPosition: true });
    expect(parseRackLocationCode("A-01-L02")).toMatchObject({ rack: "A", bay: 1, level: 2, position: 1, levelStyle: "numeric", hasPosition: false });
    expect(parseRackLocationCode("A-05-B-P2")).toMatchObject({ rack: "A", bay: 5, level: 2, position: 2, levelStyle: "alpha", hasPosition: true });
    expect(parseRackLocationCode("A-05-B")).toMatchObject({ rack: "A", bay: 5, level: 2, position: 1, levelStyle: "alpha", hasPosition: false });
    expect(parseRackLocationCode("WH3-A-1-05-L05-P1")).toMatchObject({ rack: "A", aisle: 1, bay: 5, level: 5, position: 1, levelStyle: "numeric" });
  });

  it("round-trips alpha and single-position codes through display", () => {
    expect(displayRackLocationCode("A-05-B")).toBe("A-05-B");
    expect(displayRackLocationCode("A-05-C-P2")).toBe("A-05-C-P2");
    expect(displayRackLocationCode("A-05-L02")).toBe("A-05-L02");
  });
});

describe("bayCodeFromLocationCode", () => {
  it("strips to the bay code regardless of level style or position", () => {
    expect(bayCodeFromLocationCode("A-05-L05-P1")).toBe("A-05");
    expect(bayCodeFromLocationCode("A-05-C")).toBe("A-05");
    expect(bayCodeFromLocationCode("A-05-C-P2")).toBe("A-05");
    expect(bayCodeFromLocationCode("A-05-L05")).toBe("A-05");
  });
});
