import { describe, expect, it } from "vitest";

import {
  shipmentQuantityFacts,
  shouldRedistributeOnTotal,
  validateShipmentQuantities,
} from "@/features/receiving/receiving-quantity-rules";

const line = (overrides: Partial<Parameters<typeof validateShipmentQuantities>[0]["line"]> = {}) => ({
  total_quantity: 100,
  quantity_per_pallet: 24,
  pallet_count: 4,
  remainder_action: "",
  ...overrides,
});

describe("shipmentQuantityFacts", () => {
  it("splits a total into whole pallets and a remainder", () => {
    expect(shipmentQuantityFacts(line())).toMatchObject({
      allocated: 96,
      remainder: 4,
      overAllocated: 0,
    });
  });

  it("reports units the pallets claim beyond what was received", () => {
    // The old remainder clamped at zero, so this over-allocation was invisible.
    expect(shipmentQuantityFacts(line({ total_quantity: 10, quantity_per_pallet: 24, pallet_count: 1 }))).toMatchObject({
      allocated: 24,
      remainder: 0,
      overAllocated: 14,
    });
  });

  it("treats a blank field as missing rather than as zero", () => {
    expect(shipmentQuantityFacts(line({ total_quantity: "" })).total).toBeNaN();
    expect(shipmentQuantityFacts(line({ total_quantity: "0" })).total).toBe(0);
  });
});

describe("validateShipmentQuantities", () => {
  it("passes a line whose pallets add up", () => {
    const result = validateShipmentQuantities({ line: line(), perPalletSource: "learned" });

    expect(result.blocking).toBe("");
    expect(result.showRemainder).toBe(true);
  });

  it("asks for a qty per pallet when nothing was learned for the SKU", () => {
    // Default of 1 with a total of 100 would otherwise create 100 pallets.
    const result = validateShipmentQuantities({
      line: line({ total_quantity: 100, quantity_per_pallet: 1, pallet_count: 1 }),
      perPalletSource: "unknown",
      productLabel: "FLOUR",
    });

    expect(result.perPallet).toContain("No learned qty per pallet for FLOUR yet");
    expect(result.blocking).toBe(result.perPallet);
    // Nothing to choose about a leftover until the split itself is real.
    expect(result.showRemainder).toBe(false);
  });

  it("leaves an unlearned line alone once the numbers already tie out", () => {
    // A saved draft arrives as one pallet holding the whole quantity.
    const result = validateShipmentQuantities({
      line: line({ total_quantity: 40, quantity_per_pallet: 40, pallet_count: 1 }),
      perPalletSource: "unknown",
    });

    expect(result.blocking).toBe("");
  });

  it("says so when the pallets allocate more than was received", () => {
    const result = validateShipmentQuantities({
      line: line({ total_quantity: 100, quantity_per_pallet: 24, pallet_count: 6 }),
      perPalletSource: "entered",
    });

    expect(result.palletCount).toContain("44 more than the 100 received");
    expect(result.blocking).toBe(result.palletCount);
    expect(result.showRemainder).toBe(false);
  });

  it("catches a qty per pallet larger than the whole receipt", () => {
    const result = validateShipmentQuantities({
      line: line({ total_quantity: 10, quantity_per_pallet: 24, pallet_count: 1 }),
      perPalletSource: "entered",
    });

    expect(result.palletCount).toContain("1 pallet of 24 allocates 24 units");
  });

  it("names the field that is empty", () => {
    expect(
      validateShipmentQuantities({ line: line({ total_quantity: "" }), perPalletSource: "learned" }).total,
    ).toBe("Enter the total received.");
    expect(
      validateShipmentQuantities({ line: line({ quantity_per_pallet: "" }), perPalletSource: "entered" }).perPallet,
    ).toBe("Enter how many units go on one pallet.");
    expect(
      validateShipmentQuantities({ line: line({ pallet_count: "" }), perPalletSource: "learned" }).palletCount,
    ).toBe("Enter how many pallets.");
  });

  it("rejects quantities that are not positive whole counts", () => {
    expect(
      validateShipmentQuantities({ line: line({ total_quantity: 0 }), perPalletSource: "learned" }).total,
    ).toBe("Total received must be at least 1.");
    expect(
      validateShipmentQuantities({ line: line({ quantity_per_pallet: 0 }), perPalletSource: "entered" }).perPallet,
    ).toBe("Qty per pallet must be at least 1.");
    expect(
      validateShipmentQuantities({ line: line({ pallet_count: 2.5 }), perPalletSource: "learned" }).palletCount,
    ).toBe("Pallets must be a whole number.");
  });
});

describe("shouldRedistributeOnTotal", () => {
  it("recalculates the pallets on every change to the total", () => {
    expect(shouldRedistributeOnTotal({ nextTotal: "250", perPalletSource: "learned" })).toBe("total");
    expect(shouldRedistributeOnTotal({ nextTotal: "250", perPalletSource: "entered" })).toBe("total");
  });

  it("holds off while the qty per pallet is still an unconfirmed default", () => {
    expect(shouldRedistributeOnTotal({ nextTotal: "250", perPalletSource: "unknown" })).toBeUndefined();
  });

  it("leaves a half-typed total alone", () => {
    expect(shouldRedistributeOnTotal({ nextTotal: "", perPalletSource: "learned" })).toBeUndefined();
  });
});
