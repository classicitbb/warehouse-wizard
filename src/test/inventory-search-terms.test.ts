import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from },
}));

import { searchInventory } from "@/lib/wms-core";

const base = { status: "available", quantity: 10, available_quantity: 10, warehouse_code: "WH1" };

const ROWS = [
  {
    ...base,
    inventory_balance_id: "b1",
    pallet_id: "p1",
    pallet_code: "PAL-001",
    sku: "AB12",
    product_name: "Blue Light Lens",
    container_number: "MSKU1234567",
    expiry_date: "2026-10-03",
    location_code: "E-18-C-P1",
  },
  {
    ...base,
    inventory_balance_id: "b2",
    pallet_id: "p2",
    pallet_code: "PAL-002",
    sku: "ZZ-99",
    product_name: "Coating Solution",
    container_number: "TGHU7654321",
    expiry_date: "2027-01-15",
    location_code: "B-14-E-P1",
  },
  {
    ...base,
    inventory_balance_id: "b3",
    pallet_id: "p3",
    pallet_code: "PALE-181",
    sku: "QQ1",
    product_name: "Frame",
    location_code: "E-181-A-P1",
  },
];

function mockSupabase() {
  from.mockImplementation((table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      lte: () => builder,
      gte: () => builder,
      ilike: () => builder,
      not: () => builder,
      order: () => builder,
      or: () => builder,
      limit: () => Promise.resolve({ data: [], error: null }),
      range: (start: number) =>
        Promise.resolve({ data: table === "inventory_search_view" && start === 0 ? ROWS : [], error: null }),
    };
    return builder;
  });
}

async function codes(search: string) {
  const rows = await searchInventory({ search, status: "all" });
  return rows.map((row: any) => row.pallet_code);
}

describe("searchInventory terms", () => {
  beforeEach(() => {
    from.mockReset();
    mockSupabase();
  });

  it("finds a SKU that looks like a bay code", async () => {
    expect(await codes("AB12")).toEqual(["PAL-001"]);
  });

  it("finds a pallet number that looks like a bay code, with or without the dash", async () => {
    expect(await codes("PAL-001")).toEqual(["PAL-001"]);
    expect(await codes("PAL 001")).toEqual(["PAL-001"]);
    expect(await codes("pal001")).toEqual(["PAL-001"]);
  });

  it("finds containers and product names", async () => {
    expect(await codes("MSKU1234567")).toEqual(["PAL-001"]);
    expect(await codes("coating")).toEqual(["PAL-002"]);
    expect(await codes("blue lens")).toEqual(["PAL-001"]);
  });

  it("finds expiry dates in several spellings", async () => {
    expect(await codes("2026-10-03")).toEqual(["PAL-001"]);
    expect(await codes("10/03/2026")).toEqual(["PAL-001"]);
    expect(await codes("10/2026")).toEqual(["PAL-001"]);
    expect(await codes("oct 2026")).toEqual(["PAL-001"]);
  });

  it("still matches bay codes on whole location segments only", async () => {
    expect(await codes("E-18")).toEqual(["PAL-001"]);
  });
});
