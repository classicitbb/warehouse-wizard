import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDb = vi.hoisted(() => ({
  selects: {} as Record<string, Array<{ data: any; error: any }>>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateResults: {} as Record<string, Array<{ data: any; error: any }>>,
  upserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  function nextSelect(table: string) {
    if (table === "inventory_freezes" || table === "cycle_counts") {
      return mockDb.selects[table]?.shift() ?? { data: null, error: null };
    }
    return mockDb.selects[table]?.shift() ?? { data: null, error: new Error(`No ${table} mock`) };
  }

  function nextUpdateResult(table: string) {
    return mockDb.updateResults[table]?.shift() ?? { data: [{ id: `${table}-row` }], error: null };
  }

  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    return {
      select: () => {
        const chain: any = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          or: (value: string) => {
            filters.push(["or", value]);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: () => nextSelect(table),
          single: () => nextSelect(table),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          const update = { table, payload, filters: [...filters] };
          mockDb.updates.push(update);
          return {
            error: null,
            select: () => nextUpdateResult(table),
            not: (nextColumn: string, operator: string, nextValue: unknown) => {
              update.filters.push([`not:${nextColumn}:${operator}`, nextValue]);
              return {
                error: null,
                select: () => nextUpdateResult(table),
              };
            },
          };
        },
      }),
      upsert: (payload: Record<string, unknown>) => {
        mockDb.upserts.push({ table, payload });
        return {
          select: () => ({
            single: () => ({ data: { id: "move-new" }, error: null }),
          }),
        };
      },
    };
  }

  return {
    supabase: {
      from,
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "assert_location_not_frozen") {
          return { data: null, error: null };
        }
        mockDb.rpcs.push({ name, args });
        return { data: null, error: null };
      },
    },
  };
});

import { cancelMoveTask, completeDirectMove, completeMoveTask, validateMoveDestination } from "@/lib/wms-core";

describe("location move helpers", () => {
  beforeEach(() => {
    mockDb.selects = {};
    mockDb.updates = [];
    mockDb.updateResults = {};
    mockDb.upserts = [];
    mockDb.rpcs = [];
  });

  it("creates a completed direct move and updates the pallet location", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", current_location_id: "loc-old", warehouse_id: "wh-1" }, error: null }],
      locations: [{ data: { id: "loc-new" }, error: null }],
    };

    await completeDirectMove("PBC-1", "A-01-01", "slot cleanup");

    expect(mockDb.upserts).toHaveLength(1);
    expect(mockDb.upserts[0]).toMatchObject({
      table: "move_tasks",
      payload: {
        pallet_id: "pallet-1",
        warehouse_id: "wh-1",
        from_location_id: "loc-old",
        to_location_id: "loc-new",
        status: "completed",
        reason: "slot cleanup",
      },
    });
    expect(mockDb.updates).toEqual([
      {
        table: "inventory_balances",
        payload: { warehouse_id: "wh-1", location_id: "loc-new", zone_id: null },
        filters: [["pallet_id", "pallet-1"], ["not:status:in", "(shipped,in_transit,missing)"]],
      },
      {
        table: "pallets",
        payload: { current_location_id: "loc-new", current_warehouse_id: "wh-1" },
        filters: [["id", "pallet-1"]],
      },
    ]);
    expect(mockDb.rpcs[0]).toMatchObject({
      name: "log_audit_event",
      args: { in_event_type: "move_task_completed", in_entity_table: "move_tasks", in_entity_id: "move-new" },
    });
  });

  it("throws and leaves the pallet untouched when no inventory balance row matches the move", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", current_location_id: "loc-old", warehouse_id: "wh-1" }, error: null }],
      locations: [{ data: { id: "loc-new" }, error: null }],
    };
    mockDb.updateResults = {
      inventory_balances: [{ data: [], error: null }],
    };

    await expect(completeDirectMove("PBC-1", "A-01-01")).rejects.toThrow("No active inventory balance found");

    expect(mockDb.updates).toEqual([
      {
        table: "inventory_balances",
        payload: { warehouse_id: "wh-1", location_id: "loc-new", zone_id: null },
        filters: [["pallet_id", "pallet-1"], ["not:status:in", "(shipped,in_transit,missing)"]],
      },
    ]);
    expect(mockDb.updates.some((update) => update.table === "pallets")).toBe(false);
    expect(mockDb.upserts).toEqual([]);
    expect(mockDb.rpcs).toEqual([]);
  });

  it("requires a receiving pallet to be put away before it can be moved", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", current_location_id: null, warehouse_id: "wh-1", status: "receiving" }, error: null }],
      locations: [{ data: { id: "loc-new", warehouse_id: "wh-1", zone_id: "zone-a" }, error: null }],
    };

    await expect(completeDirectMove("PBC-1", "A-01-01")).rejects.toThrow("needs to be put away");
    expect(mockDb.updates).toEqual([]);
  });

  it("requires a receiving pallet to be put away before completing a queued move", async () => {
    mockDb.selects = {
      move_tasks: [{ data: { id: "move-1", pallet_id: "pallet-1", status: "queued", warehouse_id: "wh-1" }, error: null }],
      pallets: [{ data: { id: "pallet-1", pallet_barcode: "PBC-1", current_location_id: null, warehouse_id: "wh-1", status: "receiving" }, error: null }],
      locations: [{ data: { id: "loc-new", warehouse_id: "wh-1", zone_id: "zone-a" }, error: null }],
    };

    await expect(completeMoveTask("move-1", "PBC-1", "A-01-01")).rejects.toThrow("needs to be put away");
    expect(mockDb.updates).toEqual([]);
  });

  it("rejects a terminal pallet before recording a direct move", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", current_location_id: "loc-old", warehouse_id: "wh-1", status: "shipped" }, error: null }],
    };

    await expect(completeDirectMove("PBC-1", "A-01-01")).rejects.toThrow("Pallet is shipped and cannot be moved");
    expect(mockDb.updates).toEqual([]);
    expect(mockDb.upserts).toEqual([]);
  });

  it("resolves legacy full hierarchy location labels to the short rack location code", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", product_id: null, current_location_id: "loc-old", warehouse_id: "wh-1", status: "available" }, error: null }],
      locations: [
        { data: null, error: null },
        { data: { id: "loc-new", code: "A-06-L03-P1", status: "active", max_pallets: 0, warehouse_id: "wh-1", zone_id: "zone-a" }, error: null },
      ],
    };

    const result = await validateMoveDestination("PBC-1", "WH3-A-1-06-L03-P1");

    expect(result).toEqual({ valid: true, warnings: [] });
  });

  it("uses the destination warehouse when completing a move for a legacy pallet without a warehouse", async () => {
    mockDb.selects = {
      pallets: [{ data: { id: "pallet-1", current_location_id: "loc-old", warehouse_id: null }, error: null }],
      locations: [
        { data: null, error: null },
        { data: { id: "loc-new", code: "A-13-L05-P1", warehouse_id: "wh-1", zone_id: "zone-a" }, error: null },
      ],
    };
    mockDb.upserts = [{ table: "move_tasks", payload: { id: "move-new", task_number: "MOV-1" } }];

    await completeDirectMove("PBC-1", "WH3-A-1-13-L05-P1");

    expect(mockDb.upserts[1]).toMatchObject({
      table: "move_tasks",
      payload: expect.objectContaining({ warehouse_id: "wh-1", to_location_id: "loc-new" }),
    });
    expect(mockDb.updates).toEqual([
      {
        table: "inventory_balances",
        payload: { warehouse_id: "wh-1", location_id: "loc-new", zone_id: "zone-a" },
        filters: [["pallet_id", "pallet-1"], ["not:status:in", "(shipped,in_transit,missing)"]],
      },
      {
        table: "pallets",
        payload: { current_location_id: "loc-new", current_warehouse_id: "wh-1" },
        filters: [["id", "pallet-1"]],
      },
    ]);
  });

  it("throws and leaves the task queued when no inventory balance row matches a queued move", async () => {
    mockDb.selects = {
      move_tasks: [{ data: { id: "move-1", pallet_id: "pallet-1", status: "queued", warehouse_id: "wh-1" }, error: null }],
      pallets: [{ data: { id: "pallet-1", pallet_barcode: "PBC-1", current_location_id: "loc-old", warehouse_id: "wh-1", status: "available" }, error: null }],
      locations: [{ data: { id: "loc-new", warehouse_id: "wh-1", zone_id: "zone-a" }, error: null }],
    };
    mockDb.updateResults = {
      inventory_balances: [{ data: [], error: null }],
    };

    await expect(completeMoveTask("move-1", "PBC-1", "A-01-01")).rejects.toThrow("No active inventory balance found");

    expect(mockDb.updates.some((update) => update.table === "pallets")).toBe(false);
    expect(mockDb.updates.some((update) => update.table === "move_tasks")).toBe(false);
    expect(mockDb.rpcs).toEqual([]);
  });

  it("rejects queued completion when the scanned pallet does not match the task", async () => {
    mockDb.selects = {
      move_tasks: [{ data: { id: "move-1", pallet_id: "pallet-expected", status: "queued", warehouse_id: "wh-1" }, error: null }],
      pallets: [{ data: { id: "pallet-other", pallet_barcode: "PBC-2", current_location_id: "loc-old", warehouse_id: "wh-1" }, error: null }],
    };

    await expect(completeMoveTask("move-1", "PBC-2", "A-01-01")).rejects.toThrow("Scanned pallet does not match this move task.");
    expect(mockDb.updates).toEqual([]);
    expect(mockDb.rpcs).toEqual([]);
  });

  it("cancels an in-progress move without moving the pallet", async () => {
    mockDb.selects = {
      move_tasks: [{ data: { id: "move-1", pallet_id: "pallet-1", from_location_id: "loc-old", to_location_id: "loc-new", status: "in_progress", warehouse_id: "wh-1" }, error: null }],
    };

    await cancelMoveTask("move-1");

    expect(mockDb.updates).toEqual([
      { table: "move_tasks", payload: { status: "cancelled" }, filters: [["id", "move-1"]] },
    ]);
    expect(mockDb.updates.some((update) => update.table === "pallets")).toBe(false);
    expect(mockDb.rpcs[0]).toMatchObject({
      name: "log_audit_event",
      args: { in_event_type: "move_task_cancelled", in_entity_table: "move_tasks", in_entity_id: "move-1" },
    });
  });
});
