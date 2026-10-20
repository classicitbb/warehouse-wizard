import { describe, expect, it, vi } from "vitest";
import { sortInventoryByRotation } from "@/features/inventory/inventory-rotation";
const from = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from, rpc: vi.fn() } }));
import { loadInventoryRows } from "@/features/inventory/inventory-core";

describe("inventory rotation before display pagination", () => {
  it("groups products and sorts FIFO/FEFO with receipt/id ties and missing dates last", () => {
    const rows = [
      { product_id: "A", pallet_id: "3", received_at: null },
      { product_id: "A", pallet_id: "2", received_at: "2026-01-01", client_id: "A" },
      { product_id: "A", pallet_id: "1", received_at: "2026-01-01", client_id: "Z" },
      { product_id: "B", pallet_id: "6", rotation_method: "fefo", expiry_date: null, received_at: "2025-01-01" },
      { product_id: "B", pallet_id: "5", rotation_method: "fefo", expiry_date: "2027-01-01", received_at: "2026-02-01" },
      { product_id: "B", pallet_id: "4", rotation_method: "fefo", expiry_date: "2027-01-01", received_at: "2026-01-01" },
    ];
    expect(sortInventoryByRotation(rows).map((row) => row.pallet_id)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(rows[0].pallet_id).toBe("3");
  });
  it("uses effective lot/balance expiry when present", () => {
    expect(sortInventoryByRotation([
      { product_id: "A", pallet_id: "2", rotation_method: "fefo", expiry_date: null, rotation_expiry_date: "2026-01-01" },
      { product_id: "A", pallet_id: "1", rotation_method: "fefo", expiry_date: "2026-02-01" },
    ]).map((row) => row.pallet_id)).toEqual(["2", "1"]);
  });
  it("reads past the first database page before choosing the first display page", async () => {
    const rows = Array.from({ length: 1200 }, (_, index) => ({
      product_id: "A", inventory_balance_id: String(index).padStart(4,"0"), pallet_id: String(index).padStart(4,"0"),
      rotation_method: "fefo", received_at: "2026-01-01", expiry_date: index === 1199 ? "2026-01-01" : "2027-01-01",
      quantity: 1, available_quantity: 1, status: "available",
    }));
    const range = vi.fn((start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), error: null }));
    const query = { select: () => query, eq: () => query, order: () => query, range };
    from.mockReturnValue(query);
    const result = await loadInventoryRows({ limit: 50 }, false);
    expect(range).toHaveBeenCalledTimes(2);
    expect(result.slice(0,50)[0].pallet_id).toBe("1199");
    expect(result).toHaveLength(1200);
  });
});
