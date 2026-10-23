import { describe, expect, it } from "vitest";
import { allocatePickQuantities, excludeBusyPallets } from "@/features/picking/picking-core";

// Rule: a pallet already directed onto another open pick task must never be
// allocated to a new list — the database allows only one open task per pallet.
// The FIFO/FEFO-oldest busy pallet must be skipped in favour of the next
// eligible pallet instead of failing the whole pick-list creation.
describe("excludeBusyPallets", () => {
  const oldest = { pallet_id: "pallet-oldest", available_quantity: 50 };
  const next = { pallet_id: "pallet-next", available_quantity: 40 };

  it("skips the FIFO-oldest pallet when it already has open pick work", () => {
    const candidates = excludeBusyPallets([oldest, next], new Set(["pallet-oldest"]));
    expect(candidates.map((c) => c.pallet_id)).toEqual(["pallet-next"]);
    const { allocations, short } = allocatePickQuantities(candidates, 25);
    expect(allocations).toEqual([{ ...next, allocated_quantity: 40 }]);
    expect(short).toBe(0);
  });

  it("marks the line short when every pallet has open pick work", () => {
    const candidates = excludeBusyPallets([oldest], new Set(["pallet-oldest"]));
    const { allocations, short } = allocatePickQuantities(candidates, 25);
    expect(allocations).toEqual([]);
    expect(short).toBe(25);
  });

  it("keeps candidates with no pallet or no open task untouched", () => {
    const locationOnly = { pallet_id: null, available_quantity: 10 };
    expect(excludeBusyPallets([oldest, locationOnly], new Set(["pallet-other"])))
      .toEqual([oldest, locationOnly]);
  });
});
