import { describe, expect, it } from "vitest";

import { inventoryLifecycleLabel, isStoredPalletStatus } from "@/features/shared/core-types";
import { palletEditBlockedReason } from "@/features/inventory/pallet-edit-rules";

describe("pallet lifecycle statuses", () => {
  it("does not count a draft or awaiting-put-away pallet as stored", () => {
    expect(isStoredPalletStatus("receiving")).toBe(false);
    expect(isStoredPalletStatus("putaway")).toBe(false);
    expect(isStoredPalletStatus("available")).toBe(true);
  });

  it("labels each stage from the stored status", () => {
    expect(inventoryLifecycleLabel({ status: "receiving" })).toBe("Receiving");
    expect(inventoryLifecycleLabel({ status: "putaway" })).toBe("Awaiting Put-Away");
    expect(inventoryLifecycleLabel({ status: "available", location_code: "A-01-A" })).toBe("Put Away");
    expect(inventoryLifecycleLabel({ status: "shipped" })).toBe("shipped");
  });

  it("tells an operator a pallet awaiting put-away is not editable from Inventory", () => {
    expect(
      palletEditBlockedReason({
        hasPallet: true,
        balanceStatus: "putaway",
        availableQuantity: 0,
        reservedQuantity: 0,
        locationCode: null,
        locationType: null,
      }),
    ).toBe("Only a stored pallet can be corrected from Inventory.");
  });
});
