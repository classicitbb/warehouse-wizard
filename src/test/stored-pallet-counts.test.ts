import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
  calls: [] as Array<{ table: string; column: string; values: string[] }>,
  rows: {
    inventory_balances: [] as Array<{ location_id: string; status: string }>,
    pallets: [] as Array<{ current_location_id: string; status: string }>,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: "inventory_balances" | "pallets") => ({
      select: () => ({
        in: (column: string, values: string[]) => ({
          not: async () => {
            dbMock.calls.push({ table, column, values: [...values] });
            if (values.length > 100) {
              return { data: null, error: { message: "Bad Request" } };
            }
            const data = dbMock.rows[table].filter((row) =>
              values.includes(String(row[column as keyof typeof row] ?? "")),
            );
            return { data, error: null };
          },
        }),
      }),
    }),
  },
}));

import { getStoredPalletCounts } from "@/lib/wms-core";

describe("getStoredPalletCounts", () => {
  beforeEach(() => {
    dbMock.calls = [];
    dbMock.rows.inventory_balances = [];
    dbMock.rows.pallets = [];
  });

  it("batches large location sets so occupancy queries stay within request limits", async () => {
    const locationIds = Array.from(
      { length: 205 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    dbMock.rows.inventory_balances = [
      { location_id: locationIds[0], status: "available" },
      { location_id: locationIds[0], status: "reserved" },
      { location_id: locationIds[204], status: "picked" },
    ];
    dbMock.rows.pallets = [
      { current_location_id: locationIds[0], status: "available" },
      { current_location_id: locationIds[104], status: "available" },
    ];

    const counts = await getStoredPalletCounts(locationIds);

    expect(Math.max(...dbMock.calls.map((call) => call.values.length))).toBeLessThanOrEqual(100);
    expect(counts.get(locationIds[0])).toBe(2);
    expect(counts.get(locationIds[104])).toBe(1);
    expect(counts.get(locationIds[204])).toBe(0);
    expect(counts.size).toBe(locationIds.length);
  });
});
