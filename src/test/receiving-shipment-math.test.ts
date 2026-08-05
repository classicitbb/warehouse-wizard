import { describe, expect, it } from "vitest";
import { distributeShipmentLine } from "@/components/wms-ui";

const baseLine = {
  id: "line-1",
  product_id: "product-1",
  packaging_profile_id: "",
  total_quantity: 1000,
  quantity_per_pallet: 83,
  pallet_count: 12,
  expiry_date: "",
  lot_number: "",
  batch_number: "",
  packaging: "",
  remainder_action: "",
} as const;

describe("receiving shipment math", () => {
  it("keeps quantity per pallet when the operator edits pallet count", () => {
    const next = distributeShipmentLine({ ...baseLine, pallet_count: 11 }, "count");

    expect(next.quantity_per_pallet).toBe(83);
    expect(next.pallet_count).toBe(11);
  });

  it("recalculates pallet count when quantity per pallet changes", () => {
    const next = distributeShipmentLine({ ...baseLine, quantity_per_pallet: 125 }, "perPallet");

    expect(next.quantity_per_pallet).toBe(125);
    expect(next.pallet_count).toBe(8);
  });

  it("commits raw typed quantity strings only when distribution runs", () => {
    const next = distributeShipmentLine({ ...baseLine, total_quantity: "100", quantity_per_pallet: "24" }, "total");

    expect(next.total_quantity).toBe(100);
    expect(next.quantity_per_pallet).toBe(24);
    expect(next.pallet_count).toBe(4);
  });
});
