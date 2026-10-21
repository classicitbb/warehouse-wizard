import { afterEach, describe, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, from: vi.fn() } }));
import { inventoryPickWork } from "@/features/picking/inventory-pick-core";
afterEach(() => { vi.restoreAllMocks(); rpc.mockReset(); });

describe("inventory pick RPC boundary", () => {
  it("deduplicates balance IDs and sends product mode without any quantity allocation", async () => {
    rpc.mockResolvedValue({ data: { token: "review" }, error: null });
    await inventoryPickWork({ warehouseId: "warehouse", balanceIds: ["balance", "balance"], mode: "product" });
    expect(rpc).toHaveBeenCalledWith("inventory_whole_pallet_pick_work", {
      in_warehouse_id: "warehouse", in_balance_ids: ["balance"], in_mode: "product", in_commit: false,
      in_choice: "selected", in_token: null, in_pick_list_id: null, in_order_number: null,
    });
  });
  it("rejects offline work immediately so it cannot be replayed silently on reconnect", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await expect(inventoryPickWork({ warehouseId: "warehouse", balanceIds: ["balance"], mode: "pallet" }, {
      token: "review", choice: "selected", listId: "list", orderNumber: "",
    })).rejects.toThrow(/Reconnect and refresh/);
    expect(rpc).not.toHaveBeenCalled();
  });
});
