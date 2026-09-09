import { describe, expect, it } from "vitest";

import {
  reconcilePackToQuantity,
  shipmentQuantityFacts,
  shouldRedistributeOnTotal,
  validateShipmentQuantities,
} from "@/features/receiving/receiving-quantity-rules";
import { parsePackCode } from "@/lib/measure";

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

describe("reconcilePackToQuantity", () => {
  const pack = parsePackCode("12x7")!;

  describe("the cases-versus-units trap", () => {
    // A pack code counts CASES; quantity_per_pallet counts STOCK UNITS. They
    // coincide only when units_per_package is 1, which is exactly why this is
    // wrong the first time somebody reads the number without checking.
    it("multiplies by units per package when the SKU is packed in multiples", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 12, quantityPerPallet: 1008 })!;
      expect(r.expected).toBe(1008);
      expect(r.conformance).toBe("standard");
      expect(r.countedIn).toBe("units");
    });

    it("calls 84 units short when a case holds 12", () => {
      // 84 would be a full pallet in cases and is a twelfth of one in units.
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 12, quantityPerPallet: 84 })!;
      expect(r.conformance).toBe("short");
      expect(r.difference).toBe(-924);
    });

    it("treats the two as the same only when a case holds one", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 84 })!;
      expect(r.expected).toBe(84);
      expect(r.conformance).toBe("standard");
    });

    it("falls back to counting cases and says so when units per package is unknown", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: null, quantityPerPallet: 84 })!;
      expect(r.countedIn).toBe("packages");
      expect(r.expected).toBe(84);
      expect(r.message).toContain("no units-per-package set");
    });
  });

  describe("conformance", () => {
    it("describes a short pallet in layers plus remainder", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 63 })!;
      expect(r.conformance).toBe("short");
      expect(r.fullLayers).toBe(5);
      expect(r.topCount).toBe(3);
      expect(r.message).toContain("short 21");
      expect(r.message).toContain("5 full layers");
      expect(r.message).toContain("3 of 12 on top");
    });

    it("omits the remainder clause on an exact layer boundary", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 60 })!;
      expect(r.fullLayers).toBe(5);
      expect(r.topCount).toBe(0);
      expect(r.message).not.toContain("on top");
    });

    it("flags an overpack", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 96 })!;
      expect(r.conformance).toBe("overpack");
      expect(r.difference).toBe(12);
    });

    it("counts an empty pallet as short rather than throwing", () => {
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 0 })!;
      expect(r.conformance).toBe("short");
      expect(r.fullLayers).toBe(0);
    });
  });

  describe("absent or unusable input", () => {
    it("returns null without a parsed code", () => {
      expect(reconcilePackToQuantity({ parsed: null, unitsPerPackage: 1, quantityPerPallet: 84 })).toBeNull();
    });

    it("returns null on a blank or non-numeric quantity", () => {
      expect(reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: "" })).toBeNull();
      expect(reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: "abc" })).toBeNull();
    });
  });

  describe("it never blocks a receipt", () => {
    // A short last pallet is normal — the final pallet of a run almost always
    // is. A blocked receipt gets worked around invisibly; a recorded variance
    // is data the fit test and slotting can use.
    it("leaves validateShipmentQuantities().blocking untouched whatever the pack says", () => {
      const shortLine = line({ total_quantity: 63, quantity_per_pallet: 63, pallet_count: 1 });
      const before = validateShipmentQuantities({ line: shortLine, perPalletSource: "entered" }).blocking;
      const r = reconcilePackToQuantity({ parsed: pack, unitsPerPackage: 1, quantityPerPallet: 63 })!;
      expect(r.conformance).toBe("short");
      // Reconciliation is a separate, non-blocking signal.
      expect(validateShipmentQuantities({ line: shortLine, perPalletSource: "entered" }).blocking).toBe(before);
    });
  });
});

describe("perPalletSource: standard", () => {
  it("is accepted by the quantity rules as a settled source", () => {
    // A declared standard must not trip the "qty per pallet not known" guard
    // that holds the pallet count on an unconfirmed default.
    const issues = validateShipmentQuantities({
      line: line({ total_quantity: 168, quantity_per_pallet: 84, pallet_count: 2 }),
      perPalletSource: "standard",
    });
    expect(issues.blocking).toBe("");
    expect(issues.perPallet).toBe("");
  });

  it("redistributes on a retyped total, like any settled source", () => {
    expect(shouldRedistributeOnTotal({ nextTotal: "500", perPalletSource: "standard" })).toBe("total");
  });
});
