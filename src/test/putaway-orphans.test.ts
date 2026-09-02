import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

function palletsQuery(rows: unknown[]) {
  const builder: any = {};
  for (const method of ["select", "eq", "is", "limit", "in", "order"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
  return builder;
}

describe("orphaned Put-Away pallets", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("lists pallets marked for Put-Away that have no open task", async () => {
    const { listOrphanPutawayPallets } = await import("@/features/putaway/putaway-core");
    fromMock
      .mockImplementationOnce(() =>
        palletsQuery([
          { id: "p1", pallet_barcode: "PLT-1", quantity: 10, products: { name: "Cups", sku: "SKU1" } },
          { id: "p2", pallet_barcode: "PLT-2", quantity: 5, products: null },
        ]),
      )
      .mockImplementationOnce(() => palletsQuery([{ pallet_id: "p2" }]));

    const orphans = await listOrphanPutawayPallets("wh1");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ palletId: "p1", palletBarcode: "PLT-1", sku: "SKU1", quantity: 10 });
  });

  it("queues a task through the ensure RPC and reports whether it was created", async () => {
    const { queuePutawayTaskForPallet } = await import("@/features/putaway/putaway-core");
    rpcMock.mockResolvedValueOnce({
      data: [{ putaway_task_id: "t1", putaway_task_number: "PTA-1", created: true }],
      error: null,
    });

    const result = await queuePutawayTaskForPallet("p1");
    expect(rpcMock).toHaveBeenCalledWith("ensure_putaway_task_for_pallet", { in_pallet_id: "p1" });
    expect(result).toEqual({ taskNumber: "PTA-1", created: true });
  });
});
