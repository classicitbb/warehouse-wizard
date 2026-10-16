import { describe, expect, it } from "vitest";

import type { NetSuiteLookupDocument, NetSuiteLookupLine } from "@/features/receiving/netsuite-lookup";
import { buildShipmentLinesFromLookup, lineVariance, mergeLoadedLines } from "@/features/receiving/netsuite-lookup-lines";

const helpers = {
  productExpiryTracked: (id: string) => id === "p-milk",
  defaultExpiryDate: () => "2026-11-01",
  defaultPackagingProfileId: (id: string) => (id === "p-rice" ? "pk-rice" : ""),
};

function line(over: Partial<NetSuiteLookupLine>): NetSuiteLookupLine {
  return {
    lineKey: "k1",
    lineNumber: 1,
    itemId: "77",
    itemName: "RICE",
    description: "",
    quantityOrdered: 100,
    quantityFulfilled: null,
    quantityReceived: 40,
    quantityRemaining: 60,
    unit: null,
    location: null,
    closed: false,
    localProductId: "p-rice",
    ...over,
  };
}

function doc(lines: NetSuiteLookupLine[]): NetSuiteLookupDocument {
  return {
    type: "purchase_order",
    internalId: "1",
    number: "PO1",
    status: { code: "B", label: "Pending Receipt" },
    entity: null,
    location: null,
    tranDate: null,
    memo: "",
    lines,
  };
}

describe("buildShipmentLinesFromLookup", () => {
  it("loads what NetSuite still expects as a single, unsplit pallet and records the source line", () => {
    const { lines, skipped } = buildShipmentLinesFromLookup(doc([line({})]), helpers);
    expect(skipped).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      product_id: "p-rice",
      total_quantity: 60,
      quantity_per_pallet: 60,
      pallet_count: 1,
      packaging_profile_id: "pk-rice",
      expiry_date: "",
      netsuite: { lineKey: "k1", lineNumber: 1, ordered: 100, received: 40, remaining: 60 },
    });
  });

  it("defaults an expiry date only for expiry-tracked products", () => {
    const { lines } = buildShipmentLinesFromLookup(doc([line({ localProductId: "p-milk" })]), helpers);
    expect(lines[0].expiry_date).toBe("2026-11-01");
  });

  it("skips fully received lines and lines whose item is not imported, saying why", () => {
    const { lines, skipped } = buildShipmentLinesFromLookup(
      doc([
        line({ lineNumber: 1, quantityRemaining: 0 }),
        line({ lineNumber: 2, localProductId: null, itemName: "OIL" }),
        line({ lineNumber: 3, lineKey: "k3" }),
      ]),
      helpers,
    );
    expect(lines.map((l) => l.netsuite?.lineNumber)).toEqual([3]);
    expect(skipped).toEqual([
      { lineNumber: 1, itemName: "RICE", reason: "nothing_remaining" },
      { lineNumber: 2, itemName: "OIL", reason: "item_not_imported" },
    ]);
  });
});

describe("mergeLoadedLines", () => {
  const loaded = buildShipmentLinesFromLookup(doc([line({})]), helpers).lines;

  it("drops untouched blank lines", () => {
    const blank = { ...loaded[0], product_id: "", netsuite: undefined };
    expect(mergeLoadedLines([blank], loaded)).toEqual(loaded);
  });

  it("keeps lines the operator filled in", () => {
    const manual = { ...loaded[0], id: "manual", netsuite: undefined, product_id: "p-other" };
    expect(mergeLoadedLines([manual], loaded).map((l) => l.id)).toEqual(["manual", loaded[0].id]);
  });

  it("replaces a line from the same NetSuite line so a second lookup cannot duplicate it", () => {
    const again = buildShipmentLinesFromLookup(doc([line({ quantityRemaining: 55 })]), helpers).lines;
    const merged = mergeLoadedLines(loaded, again);
    expect(merged).toHaveLength(1);
    expect(merged[0].total_quantity).toBe(55);
  });
});

describe("lineVariance", () => {
  const base = buildShipmentLinesFromLookup(doc([line({})]), helpers).lines[0];

  it("is null for a line that did not come from NetSuite", () => {
    expect(lineVariance({ total_quantity: 5, netsuite: undefined })).toBeNull();
  });

  it("reports exact, short and over against the quantity NetSuite expects", () => {
    expect(lineVariance({ ...base, total_quantity: 60 })).toEqual({ kind: "exact" });
    expect(lineVariance({ ...base, total_quantity: 55 })).toEqual({ kind: "short", by: 5 });
    expect(lineVariance({ ...base, total_quantity: "65" })).toEqual({ kind: "over", by: 5 });
  });
});
