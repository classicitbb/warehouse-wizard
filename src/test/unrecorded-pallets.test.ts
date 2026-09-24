import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

function query(rows: unknown[], error: unknown = null) {
  const builder: any = {};
  for (const method of ["select", "eq", "is", "not", "limit", "in", "order", "range", "gt"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error });
  return builder;
}

describe("pallets with no stock record", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    fromMock.mockReset();
  });

  it("reports a pallet with no live balance as unrecorded", async () => {
    const { palletHasStockRecord } = await import("@/features/inventory/inventory-core");
    fromMock.mockImplementationOnce(() => query([]));
    expect(await palletHasStockRecord("p1")).toBe(false);

    fromMock.mockImplementationOnce(() => query([{ id: "b1" }]));
    expect(await palletHasStockRecord("p1")).toBe(true);
  });

  it("fails open when the balance lookup errors, so good stock is never blocked", async () => {
    const { palletHasStockRecord } = await import("@/features/inventory/inventory-core");
    fromMock.mockImplementationOnce(() => query([], { message: "timeout" }));
    expect(await palletHasStockRecord("p1")).toBe(true);
  });

  it("lists located pallets that lost their record and those with no provenance", async () => {
    const { listUnrecordedStoredPallets } = await import("@/features/inventory/inventory-core");
    fromMock
      // pallets holding a location
      .mockImplementationOnce(() =>
        query([
          { id: "p1", pallet_barcode: "PLT-1", quantity: 10, receipt_line_id: "r1", current_warehouse_id: "wh1", current_location_id: "l1", products: { sku: "S1", name: "Cups" }, locations: { code: "A-01-A" } },
          { id: "p2", pallet_barcode: "PLT-2", quantity: 4, receipt_line_id: null, current_warehouse_id: "wh1", current_location_id: "l2", products: null, locations: { code: "A-01-B" } },
          { id: "p3", pallet_barcode: "PLT-3", quantity: 6, receipt_line_id: "r3", current_warehouse_id: "wh1", current_location_id: "l3", products: null, locations: { code: "A-01-C" } },
        ]),
      )
      // balances: p1 has none, p2 and p3 do
      .mockImplementationOnce(() => query([{ pallet_id: "p2" }, { pallet_id: "p3" }]))
      // completed putaway tasks for p2 (the only pallet with no receipt line)
      .mockImplementationOnce(() => query([]))
      // completed move tasks
      .mockImplementationOnce(() => query([]))
      // details for flagged pallets
      .mockImplementationOnce(() =>
        query([
          { id: "p1", pallet_barcode: "PLT-1", quantity: 10, current_warehouse_id: "wh1", products: { sku: "S1", name: "Cups" }, locations: { code: "A-01-A" } },
          { id: "p2", pallet_barcode: "PLT-2", quantity: 4, current_warehouse_id: "wh1", products: null, locations: { code: "A-01-B" } },
        ]),
      );

    const rows = await listUnrecordedStoredPallets("wh1");
    expect(rows.map((row) => [row.palletBarcode, row.reason])).toEqual([
      ["PLT-1", "no_stock_record"],
      ["PLT-2", "no_provenance"],
    ]);
  });

  it("releases the location through the guarded database function", async () => {
    const { releaseUnrecordedPalletLocation } = await import("@/features/inventory/inventory-core");
    rpcMock.mockResolvedValueOnce({ data: {}, error: null });
    await releaseUnrecordedPalletLocation("p1", "no record");
    expect(rpcMock).toHaveBeenCalledWith("release_unrecorded_pallet_location", {
      in_pallet_id: "p1",
      in_reason: "no record",
    });
  });
});
