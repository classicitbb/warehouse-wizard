import { beforeEach, describe, expect, it, vi } from "vitest";

const pickDb = vi.hoisted(() => ({
  selects: {} as Record<string, Array<{ data: any; error: any }>>,
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateErrors: {} as Record<string, Error | undefined>,
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  function nextSelect(table: string) {
    return pickDb.selects[table]?.shift() ?? { data: null, error: new Error(`No ${table} mock`) };
  }

  function from(table: string) {
    return {
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const chain: any = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          single: () => nextSelect(table),
          maybeSingle: () => nextSelect(table),
          then: (resolve: (value: any) => unknown) => resolve(nextSelect(table)),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = [];
        const chain: any = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            pickDb.updates.push({ table, payload, filters: [...filters] });
            return chain;
          },
          then: (resolve: (value: any) => unknown) => resolve({ data: null, error: pickDb.updateErrors[table] ?? null }),
        };
        return chain;
      },
    };
  }

  return {
    supabase: {
      from,
      rpc: (name: string, args: Record<string, unknown>) => {
        pickDb.rpcs.push({ name, args });
        return { data: null, error: null };
      },
    },
  };
});

import { confirmPickTask, PickQuantityAnomalyError } from "@/lib/wms-core";

function seedPick({
  task = {},
  pallet = {},
  balance = {},
  location = {},
  siblings = [{ id: "pick-task-1", status: "completed" }],
  parent = { id: "pick-list-1", status: "released", warehouse_id: "wh-1", order_id: null },
}: {
  task?: Record<string, unknown>;
  pallet?: Record<string, unknown>;
  balance?: Record<string, unknown>;
  location?: Record<string, unknown>;
  siblings?: Array<Record<string, unknown>>;
  parent?: Record<string, unknown> | null;
} = {}) {
  pickDb.selects = {
    pick_tasks: [
      { data: { id: "pick-task-1", pallet_id: "pallet-1", pick_list_id: "pick-list-1", status: "queued", requested_quantity: 10, ...task }, error: null },
      { data: siblings, error: null },
    ],
    pallets: [
      { data: { id: "pallet-1", pallet_barcode: "PBC-1", quantity: 10, available_quantity: 10, ...pallet }, error: null },
    ],
    inventory_balances: [
      { data: { id: "bal-1", pallet_id: "pallet-1", location_id: "loc-1", warehouse_id: "wh-1", quantity: 10, available_quantity: 10, ...balance }, error: null },
    ],
    locations: [
      { data: { id: "loc-1", code: "A-01-L01-P1", ...location }, error: null },
    ],
    pick_lists: parent ? [{ data: parent, error: null }] : [],
  };
}

describe("confirmPickTask", () => {
  beforeEach(() => {
    pickDb.selects = {};
    pickDb.updates = [];
    pickDb.updateErrors = {};
    pickDb.rpcs = [];
  });

  it("fully depletes picked stock and clears the location", async () => {
    seedPick();

    await confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 10);

    expect(pickDb.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "pick_tasks", payload: expect.objectContaining({ status: "completed", confirmed_quantity: 10 }) }),
      expect.objectContaining({ table: "pallets", payload: expect.objectContaining({ quantity: 0, available_quantity: 0, current_location_id: null, is_stored: false, status: "shipped" }) }),
      expect.objectContaining({ table: "inventory_balances", payload: expect.objectContaining({ quantity: 0, available_quantity: 0, location_id: null, zone_id: null, status: "shipped" }) }),
    ]));
    expect(pickDb.rpcs[0]).toMatchObject({
      name: "log_audit_event",
      args: {
        in_event_type: "pick",
        in_metadata: expect.objectContaining({ confirmed_quantity: 10, remaining_quantity: 0, location_cleared: true }),
      },
    });
  });

  it("rejects partial pick confirmation", async () => {
    seedPick({
      siblings: [{ id: "pick-task-1", status: "completed" }, { id: "pick-task-2", status: "queued" }],
      parent: null,
    });

    await expect(confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 4)).rejects.toThrow("Partial picks are disabled");

    expect(pickDb.updates).toEqual([]);
    expect(pickDb.rpcs).toEqual([]);
  });

  it("accepts legacy full location scans for migrated short location codes", async () => {
    seedPick();

    await confirmPickTask("pick-task-1", "WH3-A-1-01-L01-P1", "PBC-1", 10);

    expect(pickDb.updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "pick_tasks", payload: expect.objectContaining({ status: "completed", confirmed_quantity: 10 }) }),
    ]));
  });

  it("rejects already closed pick tasks", async () => {
    seedPick({ task: { status: "completed" } });

    await expect(confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 1)).rejects.toThrow("already closed");
    expect(pickDb.updates).toEqual([]);
    expect(pickDb.rpcs).toEqual([]);
  });

  it("rejects over-picking available stock", async () => {
    seedPick({ balance: { quantity: 5, available_quantity: 5 }, pallet: { quantity: 5, available_quantity: 5 } });

    await expect(confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 6)).rejects.toThrow("only 5 available");
    expect(pickDb.updates).toEqual([]);
    expect(pickDb.rpcs).toEqual([]);
  });

  it("does not close the pick task if the pallet debit fails", async () => {
    seedPick();
    pickDb.updateErrors.pallets = new Error("pallet update denied");

    await expect(confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 10)).rejects.toThrow("pallet update denied");

    expect(pickDb.updates.some((update) => update.table === "pick_tasks")).toBe(false);
    expect(pickDb.rpcs).toEqual([]);
  });

  describe("pick quantity anomaly override", () => {
    it("throws a typed PickQuantityAnomalyError (not a generic error) when the pallet can't fulfil the pick and no override is given", async () => {
      seedPick({ balance: { quantity: 5, available_quantity: 5 }, pallet: { quantity: 5, available_quantity: 5 } });

      let caught: unknown;
      try {
        await confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 6);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(PickQuantityAnomalyError);
      const error = caught as PickQuantityAnomalyError;
      expect(error.availableQuantity).toBe(5);
      expect(error.requestedQuantity).toBe(10); // task.requested_quantity from the default seed
      expect(pickDb.updates).toEqual([]);
      expect(pickDb.rpcs).toEqual([]);
    });

    it("lets the operator override a depleted pallet, completes the pick at the true available quantity, and logs a record-count warning for admins", async () => {
      // Task originally requested 10, but by the time the operator scans it
      // the pallet has already been debited down to 6 (e.g. by another pick
      // or adjustment). The operator re-checks the physical pallet and
      // overrides to complete the pick for the 6 that's actually there.
      seedPick({
        task: { requested_quantity: 10 },
        balance: { quantity: 6, available_quantity: 6 },
        pallet: { quantity: 6, available_quantity: 6 },
      });

      await confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 10, undefined, true);

      expect(pickDb.updates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          table: "pick_tasks",
          payload: expect.objectContaining({
            confirmed_quantity: 6,
            status: "exception",
            short_reason: expect.stringContaining("6"),
          }),
        }),
        expect.objectContaining({
          table: "pallets",
          payload: expect.objectContaining({ quantity: 0, available_quantity: 0 }),
        }),
        expect.objectContaining({
          table: "inventory_balances",
          payload: expect.objectContaining({ quantity: 0, available_quantity: 0 }),
        }),
      ]));

      const auditCall = pickDb.rpcs.find((call) => call.name === "log_audit_event");
      expect(auditCall).toMatchObject({
        args: {
          in_event_type: "pick",
          in_metadata: expect.objectContaining({
            confirmed_quantity: 6,
            requested_quantity: 10,
            override: true,
          }),
        },
      });

      const systemLogCall = pickDb.rpcs.find((call) => call.name === "write_system_log");
      expect(systemLogCall).toBeDefined();
      expect(systemLogCall?.args).toMatchObject({
        in_log_type: "record_count",
        in_severity: "warning",
        in_record_count: 6,
        in_details: expect.objectContaining({
          requested_quantity: 10,
          confirmed_quantity: 6,
          shortfall: 4,
        }),
      });
    });

    it("rejects the override too when the pallet has no remaining stock at all", async () => {
      seedPick({
        task: { requested_quantity: 10 },
        balance: { quantity: 0, available_quantity: 0 },
        pallet: { quantity: 0, available_quantity: 0 },
      });

      await expect(
        confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 10, undefined, true),
      ).rejects.toThrow("no remaining stock");

      expect(pickDb.updates).toEqual([]);
      expect(pickDb.rpcs).toEqual([]);
    });

    it("does not log an anomaly or mark an exception when the confirmed quantity matches the full pallet", async () => {
      seedPick();

      await confirmPickTask("pick-task-1", "A-01-L01-P1", "PBC-1", 10, undefined, true);

      expect(pickDb.rpcs.some((call) => call.name === "write_system_log")).toBe(false);
      expect(pickDb.updates).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: "pick_tasks", payload: expect.objectContaining({ status: "completed", short_reason: null }) }),
      ]));
    });
  });
});
