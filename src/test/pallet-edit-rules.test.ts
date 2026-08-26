import { describe, expect, it } from "vitest";

import {
  palletEditBlockedReason,
  palletOutsideStaging,
  STAGING_EDIT_HINT,
} from "@/features/inventory/pallet-edit-rules";

const editable = {
  hasPallet: true,
  balanceStatus: "available",
  reservedQuantity: 0,
  availableQuantity: 40,
  locationCode: "STG-01-A",
  locationType: "staging",
};

describe("palletEditBlockedReason", () => {
  it("allows a stored pallet in a staging location", () => {
    expect(palletEditBlockedReason(editable)).toBe("");
  });

  it("blocks a pallet stored in a rack location with the staging hint", () => {
    expect(palletEditBlockedReason({ ...editable, locationCode: "A-01-A", locationType: "rack" })).toBe(STAGING_EDIT_HINT);
  });

  it("keeps the existing blocks ahead of the staging rule", () => {
    expect(palletEditBlockedReason({ ...editable, hasPallet: false, locationType: "rack" })).toBe(
      "This inventory record has no pallet.",
    );
    expect(palletEditBlockedReason({ ...editable, balanceCorrectionState: "superseded" as const })).toContain("superseded");
    expect(palletEditBlockedReason({ ...editable, reservedQuantity: 5 })).toContain("reserved");
    expect(palletEditBlockedReason({ ...editable, locationCode: null })).toBe(
      "Only a stored pallet can be corrected from Inventory.",
    );
  });

  it("a pending edit stays resumable even outside staging", () => {
    expect(palletEditBlockedReason({ ...editable, balanceCorrectionState: "pending" as const, locationType: "rack" })).toBe("");
  });

  it("allows a receiving pallet with nothing available", () => {
    expect(
      palletEditBlockedReason({ ...editable, balanceStatus: "receiving", availableQuantity: 0 }),
    ).toBe("");
  });
});

describe("palletOutsideStaging", () => {
  it("flags the stored-outside-staging case for the hint and Location Moves shortcut", () => {
    expect(palletOutsideStaging({ locationCode: "A-01-A", locationType: "rack" })).toBe(true);
    expect(palletOutsideStaging({ locationCode: "STG-01-A", locationType: "staging" })).toBe(false);
    expect(palletOutsideStaging({ locationCode: null, locationType: null })).toBe(false);
  });
});
