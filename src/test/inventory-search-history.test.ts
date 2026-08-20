import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from },
}));

import { searchInventory } from "@/lib/wms-core";

const LIVE_ROW = {
  inventory_balance_id: "bal-live",
  pallet_id: "pal-live",
  pallet_code: "PAL-LIVE",
  sku: "SKU-1",
  status: "available",
  quantity: 40,
  available_quantity: 40,
  warehouse_code: "WH1",
  location_code: "A-01-L01-P1",
};

const SHIPPED_ROW = {
  inventory_balance_id: "bal-shipped",
  pallet_id: "pal-shipped",
  pallet_code: "PAL-SHIPPED",
  sku: "SKU-1",
  status: "shipped",
  quantity: 0,
  available_quantity: 0,
  warehouse_code: "WH1",
  location_code: null,
};

const MISSING_ROW = {
  inventory_balance_id: "bal-missing",
  pallet_id: "pal-missing",
  pallet_code: "PAL-MISSING",
  sku: "SKU-1",
  status: "missing",
  quantity: 12,
  available_quantity: 12,
  warehouse_code: "WH1",
  location_code: "A-02-L01-P1",
};

const EMPTIED_ROW = {
  inventory_balance_id: "bal-emptied",
  pallet_id: "pal-emptied",
  pallet_code: "PAL-EMPTIED",
  sku: "SKU-1",
  status: "available",
  quantity: 0,
  available_quantity: 0,
  warehouse_code: "WH1",
  location_code: "A-03-L01-P1",
};

const PENDING_CORRECTION_ROW = {
  inventory_balance_id: "bal-pending",
  pallet_id: "pal-pending",
  pallet_code: "PAL-PENDING",
  sku: "SKU-1",
  status: "available",
  quantity: 10,
  available_quantity: 10,
  warehouse_code: "WH1",
  correction_state: "pending",
};

const ORPHAN_PALLET = {
  id: "pal-orphan",
  pallet_code: "PAL-ORPHAN",
  pallet_barcode: "PBC-ORPHAN",
  status: "shipped",
  quantity: 0,
  available_quantity: 0,
  created_at: "2026-01-01T00:00:00.000Z",
  current_warehouse_id: "wh-1",
  current_location_id: null,
  correction_state: null,
  products: { sku: "SKU-9", name: "Orphaned Product" },
  warehouses: { code: "WH1", name: "Main" },
  locations: null,
};

const VIEW_ROWS = [LIVE_ROW, SHIPPED_ROW, MISSING_ROW, EMPTIED_ROW, PENDING_CORRECTION_ROW];

function mockSupabase(options: { palletRows?: any[] } = {}) {
  from.mockImplementation((table: string) => {
    const builder: any = {
      select: () => builder,
      eq: () => builder,
      lte: () => builder,
      gte: () => builder,
      ilike: () => builder,
      not: () => builder,
      order: () => builder,
      // The pallets fallback ends in .limit(); the view query ends in .range().
      limit: () => Promise.resolve({ data: options.palletRows ?? [], error: null }),
      or: () => builder,
      range: (start: number) =>
        Promise.resolve({ data: table === "inventory_search_view" && start === 0 ? VIEW_ROWS : [], error: null }),
    };
    return builder;
  });
}

describe("searchInventory history", () => {
  beforeEach(() => {
    from.mockReset();
  });

  it("hides retired and drawn-down pallets while browsing", async () => {
    mockSupabase();

    const rows = await searchInventory({ status: "all", limit: 50 });

    expect(rows.map((row: any) => row.pallet_code)).toEqual(["PAL-LIVE"]);
  });

  it("includes past and missing pallets when history is switched on", async () => {
    mockSupabase();

    const rows = await searchInventory({ status: "all", includeHistoric: true, limit: 50 });

    expect(rows.map((row: any) => row.pallet_code)).toEqual([
      "PAL-LIVE",
      "PAL-SHIPPED",
      "PAL-MISSING",
      "PAL-EMPTIED",
    ]);
    expect(rows.find((row: any) => row.pallet_code === "PAL-SHIPPED")?.is_historic).toBe(true);
    expect(rows.find((row: any) => row.pallet_code === "PAL-EMPTIED")?.is_historic).toBe(true);
    expect(rows.find((row: any) => row.pallet_code === "PAL-LIVE")?.is_historic).toBe(false);
  });

  it("finds a shipped pallet number by search without the history toggle", async () => {
    mockSupabase();

    const rows = await searchInventory({ search: "PAL-SHIPPED", status: "all" });

    expect(rows.map((row: any) => row.pallet_code)).toEqual(["PAL-SHIPPED"]);
  });

  it("finds a missing pallet number by search", async () => {
    mockSupabase();

    const rows = await searchInventory({ search: "PAL-MISSING", status: "all" });

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("missing");
  });

  it("keeps in-flight correction rows hidden even with history on", async () => {
    mockSupabase();

    const rows = await searchInventory({ search: "PAL-PENDING", status: "all", includeHistoric: true });

    expect(rows).toHaveLength(0);
  });

  it("falls back to the pallet record when no inventory balance survives", async () => {
    mockSupabase({ palletRows: [ORPHAN_PALLET] });

    const rows = await searchInventory({ search: "PAL-ORPHAN", status: "all" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pallet_code: "PAL-ORPHAN",
      sku: "SKU-9",
      inventory_balance_id: null,
      is_orphan_pallet: true,
      is_historic: true,
    });
  });

  it("does not duplicate a pallet that already has an inventory row", async () => {
    mockSupabase({
      palletRows: [{ ...ORPHAN_PALLET, id: "pal-shipped", pallet_code: "PAL-SHIPPED" }],
    });

    const rows = await searchInventory({ search: "PAL-SHIPPED", status: "all" });

    expect(rows).toHaveLength(1);
    expect(rows[0].inventory_balance_id).toBe("bal-shipped");
  });
});
