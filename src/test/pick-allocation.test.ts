import { describe, expect, it } from "vitest";

import { allocatePickQuantities } from "@/lib/wms-core";

describe("allocatePickQuantities", () => {
  it("picks a whole pallet even when the requested quantity is less than what's on it", () => {
    // Pallets received at 50 units each. An order for 25 cannot take a
    // partial pallet — the operator must pick the full 50.
    const candidates = [{ pallet_id: "pallet-1", available_quantity: 50 }];

    const { allocations, short } = allocatePickQuantities(candidates, 25);

    expect(short).toBe(0);
    expect(allocations).toEqual([
      { pallet_id: "pallet-1", available_quantity: 50, allocated_quantity: 50 },
    ]);
  });

  it("rolls up to the next full pallet when one pallet isn't enough, even if that overshoots the request", () => {
    // Two pallets of 50 each; an order for 75 doesn't fit on one pallet, so
    // the second full pallet is added too — 100 total is picked, not 75.
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 50 },
      { pallet_id: "pallet-2", available_quantity: 50 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 75);

    expect(short).toBe(0);
    expect(allocations).toEqual([
      { pallet_id: "pallet-1", available_quantity: 50, allocated_quantity: 50 },
      { pallet_id: "pallet-2", available_quantity: 50, allocated_quantity: 50 },
    ]);
  });

  it("never clips a pallet's allocation to the outstanding remainder, even on uneven pallets", () => {
    // Two pallets of 60 each; only 100 units are needed, but pallets are
    // whole-pallet-only, so the second pallet is still taken in full (60),
    // not clipped to the 40 that's technically outstanding. Total picked
    // ends up at 120, more than requested — that's expected.
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 60 },
      { pallet_id: "pallet-2", available_quantity: 60 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 100);

    expect(short).toBe(0);
    expect(allocations).toEqual([
      { pallet_id: "pallet-1", available_quantity: 60, allocated_quantity: 60 },
      { pallet_id: "pallet-2", available_quantity: 60, allocated_quantity: 60 },
    ]);
  });

  it("picks all four pallets when the requested quantity doesn't land exactly on a pallet boundary", () => {
    // Product qty 100 across 4 pallets of 25 each; 80 units requested.
    // 3 pallets (75) isn't enough, so the 4th is added too - full 100 picked.
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 25 },
      { pallet_id: "pallet-2", available_quantity: 25 },
      { pallet_id: "pallet-3", available_quantity: 25 },
      { pallet_id: "pallet-4", available_quantity: 25 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 80);

    expect(short).toBe(0);
    expect(allocations).toHaveLength(4);
    expect(allocations.map((a) => a.allocated_quantity)).toEqual([25, 25, 25, 25]);
    expect(allocations.reduce((sum, a) => sum + a.allocated_quantity, 0)).toBe(100);
  });

  it("produces one pick task per pallet when a product is split across several pallets", () => {
    // 100 units of a product spread across 5 pallets of 20 each; picking
    // 100 should surface all 5 pallets as separate pick tasks.
    const candidates = Array.from({ length: 5 }, (_, i) => ({
      pallet_id: `pallet-${i + 1}`,
      available_quantity: 20,
    }));

    const { allocations, short } = allocatePickQuantities(candidates, 100);

    expect(short).toBe(0);
    expect(allocations).toHaveLength(5);
    expect(allocations.every((a) => a.allocated_quantity === 20)).toBe(true);
  });

  it("stops allocating once a single pallet already covers the full request", () => {
    // A pallet with more than enough stock satisfies the pick on its own;
    // later (e.g. more-expired) pallets should not be touched.
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 100 },
      { pallet_id: "pallet-2", available_quantity: 50 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 60);

    expect(short).toBe(0);
    expect(allocations).toEqual([
      { pallet_id: "pallet-1", available_quantity: 100, allocated_quantity: 100 },
    ]);
  });

  it("reports a genuine shortfall when total stock across all pallets can't cover the request", () => {
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 20 },
      { pallet_id: "pallet-2", available_quantity: 20 },
      { pallet_id: "pallet-3", available_quantity: 20 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 100);

    // All 3 pallets (60 total) get picked, and the remaining 40 is a real
    // shortage — there's no more stock left to roll up to.
    expect(short).toBe(40);
    expect(allocations).toHaveLength(3);
    expect(allocations.reduce((sum, a) => sum + a.allocated_quantity, 0)).toBe(60);
  });

  it("ignores candidates with zero or null available quantity", () => {
    const candidates = [
      { pallet_id: "pallet-1", available_quantity: 0 },
      { pallet_id: "pallet-2", available_quantity: null as unknown as number },
      { pallet_id: "pallet-3", available_quantity: 30 },
    ];

    const { allocations, short } = allocatePickQuantities(candidates, 10);

    expect(short).toBe(0);
    expect(allocations).toEqual([
      { pallet_id: "pallet-3", available_quantity: 30, allocated_quantity: 30 },
    ]);
  });

  it("returns no allocations when the requested quantity is zero or negative", () => {
    const candidates = [{ pallet_id: "pallet-1", available_quantity: 50 }];

    expect(allocatePickQuantities(candidates, 0)).toEqual({ allocations: [], short: 0 });
    expect(allocatePickQuantities(candidates, -5)).toEqual({ allocations: [], short: 0 });
  });
});
