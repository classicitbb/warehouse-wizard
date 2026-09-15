import { describe, expect, it, vi } from "vitest";

// 1,097 pickable pallets exist in production; the old unbounded select stopped
// at PostgREST's 1000-row cap, so SKUs on later pallets (e.g. AF226331) simply
// never appeared in the pick-list product picker.
const TOTAL_PALLETS = 1097;

const allRows = vi.hoisted(() =>
  Array.from({ length: 1097 }, (_, index) => ({
    id: `pallet-${String(index).padStart(4, "0")}`,
    pallet_code: `PLT-${index}`,
    pallet_barcode: `PLT-${index}`,
    product_id: `product-${index}`,
    available_quantity: 36,
    created_at: "2026-09-01T00:00:00Z",
    current_location_id: "loc-1",
    locations: { code: "A-01-A" },
    inventory_lots: { expiry_date: null },
  })),
);

function palletStub() {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gt: () => builder,
    not: () => builder,
    order: () => builder,
    range: async (from: number, to: number) => ({
      data: allRows.slice(from, to + 1),
      error: null,
    }),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => palletStub() },
}));

import { getPickableStockSummary } from "@/features/admin/admin-core";

describe("pickable stock summary paging", () => {
  it("reads every pickable pallet past the 1000-row database cap", async () => {
    const summary = await getPickableStockSummary("warehouse-1");

    expect(summary.size).toBe(TOTAL_PALLETS);
    // The SKU sitting beyond the first page must still be summarised.
    expect(summary.has("product-1096")).toBe(true);
  });
});
