import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A recording stand-in for the Supabase query builder. Every chained call is
// logged against its table, and awaiting the chain (or calling single /
// maybeSingle) takes the next queued response for that table.
const supa = vi.hoisted(() => {
  type Response = { data?: unknown; error?: unknown };
  const responses = new Map<string, Response[]>();
  const calls: Array<{ table: string; ops: unknown[][] }> = [];
  const take = (table: string) => {
    const next = responses.get(table)?.shift() ?? {};
    return Promise.resolve({ data: null, error: null, ...next });
  };
  const from = (table: string) => {
    const entry = { table, ops: [] as unknown[][] };
    calls.push(entry);
    const builder: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => take(table).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          entry.ops.push([prop, ...args]);
          return prop === "single" || prop === "maybeSingle" ? take(table) : builder;
        };
      },
    });
    return builder;
  };
  return {
    from,
    calls,
    queue(table: string, ...items: Response[]) {
      responses.set(table, [...(responses.get(table) ?? []), ...items]);
    },
    reset() {
      responses.clear();
      calls.length = 0;
    },
    opsFor(table: string) {
      return calls.filter((call) => call.table === table).map((call) => call.ops);
    },
  };
});

const rpc = vi.hoisted(() => vi.fn());
const upsertRecord = vi.hoisted(() => vi.fn());
const createLabelRecord = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: supa.from, rpc } }));
vi.mock("@/features/admin/admin-core", () => ({ upsertRecord }));
vi.mock("@/features/receiving/receiving-core", () => ({ createLabelRecord }));

import {
  allocatePickQuantities,
  cancelPickList,
  confirmPickTask,
  createPickListFlow,
  createPickShortfallTask,
  getPickExecution,
  listPickLists,
  previewPickSourceOverride,
} from "@/features/picking/picking-core";

const WAREHOUSE = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const PRODUCT_A = "33333333-3333-4333-8333-333333333333";
const PRODUCT_B = "44444444-4444-4444-8444-444444444444";

function pickTaskWrites() {
  return upsertRecord.mock.calls.filter(([table]) => table === "pick_tasks").map(([, row]) => row);
}

beforeEach(() => {
  supa.reset();
  rpc.mockReset();
  upsertRecord.mockReset();
  createLabelRecord.mockReset();
  upsertRecord.mockImplementation(async (table: string, row: Record<string, unknown>) => ({
    id: `${table}-id`,
    ...row,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("allocatePickQuantities edges", () => {
  it("skips pallets with no recorded or a non-positive quantity", () => {
    const { allocations, short } = allocatePickQuantities(
      [
        { pallet_id: "p-null", available_quantity: null },
        { pallet_id: "p-zero", available_quantity: 0 },
        { pallet_id: "p-neg", available_quantity: -5 },
        { pallet_id: "p-ok", available_quantity: 10 },
      ],
      10,
    );
    expect(allocations.map((a) => a.pallet_id)).toEqual(["p-ok"]);
    expect(short).toBe(0);
  });

  it("allocates nothing for a zero-quantity request", () => {
    expect(allocatePickQuantities([{ available_quantity: 10 }], 0)).toEqual({ allocations: [], short: 0 });
  });

  it("reports the exact shortfall when stock runs out", () => {
    expect(allocatePickQuantities([{ available_quantity: 4 }, { available_quantity: 3 }], 10).short).toBe(3);
  });
});

describe("createPickListFlow", () => {
  const basePayload = {
    warehouse_id: WAREHOUSE,
    client_id: CLIENT,
    order_number: "SO-100",
    lines: [{ product_id: PRODUCT_A, quantity: 30 }],
  };

  it("creates the order under the typed number when it is free", async () => {
    await createPickListFlow({ ...basePayload, requested_ship_date: "", notes: "" });

    expect(supa.opsFor("orders")[0]).toEqual([
      ["select", "id"],
      ["eq", "order_number", "SO-100"],
      ["maybeSingle"],
    ]);
    expect(upsertRecord).toHaveBeenCalledWith("orders", {
      order_number: "SO-100",
      client_id: CLIENT,
      warehouse_id: WAREHOUSE,
      requested_ship_date: null,
      status: "queued",
      notes: null,
    });
  });

  it("keeps a supplied ship date and notes", async () => {
    await createPickListFlow({ ...basePayload, requested_ship_date: "2026-11-01", notes: "Dock 4" });
    expect(upsertRecord).toHaveBeenCalledWith("orders", expect.objectContaining({
      requested_ship_date: "2026-11-01",
      notes: "Dock 4",
    }));
    expect(upsertRecord).toHaveBeenCalledWith("pick_lists", expect.objectContaining({ notes: "Dock 4" }));
  });

  it("suffixes a re-used order number, then numbers further retries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_123_456);
    supa.queue("orders", { data: { id: "taken" } }, { data: { id: "taken" } }, { data: null });

    await createPickListFlow(basePayload);

    const tried = supa.opsFor("orders").map((ops) => ops[1][2]);
    expect(tried).toEqual(["SO-100", "SO-100-123456", "SO-100-123456-2"]);
    expect(upsertRecord).toHaveBeenCalledWith("orders", expect.objectContaining({ order_number: "SO-100-123456-2" }));
  });

  it("gives up after five collisions rather than looping forever", async () => {
    supa.queue("orders", ...Array.from({ length: 6 }, () => ({ data: { id: "taken" } })));

    await expect(createPickListFlow(basePayload)).rejects.toThrow(
      "Could not allocate a unique order number — try a different one.",
    );
    expect(supa.opsFor("orders")).toHaveLength(6);
    expect(upsertRecord).not.toHaveBeenCalled();
  });

  it("allows a fifth retry to succeed", async () => {
    supa.queue("orders", ...Array.from({ length: 5 }, () => ({ data: { id: "taken" } })), { data: null });
    await expect(createPickListFlow(basePayload)).resolves.toBeTruthy();
  });

  it("opens a queued pick list for the order and prints its label", async () => {
    const pickList = await createPickListFlow(basePayload);

    expect(upsertRecord).toHaveBeenCalledWith("pick_lists", expect.objectContaining({
      warehouse_id: WAREHOUSE,
      client_id: CLIENT,
      order_id: "orders-id",
      consolidated: false,
      status: "queued",
      notes: null,
    }));
    const listRow = upsertRecord.mock.calls.find(([table]) => table === "pick_lists")![1];
    expect(listRow.pick_list_number).toMatch(/^PKL-/);
    expect(typeof listRow.released_at).toBe("string");
    expect(createLabelRecord).toHaveBeenCalledWith("pick_list", "pick_lists-id", listRow.pick_list_number);
    expect(pickList).toMatchObject({ id: "pick_lists-id" });
  });

  it("marks a multi-line list consolidated and writes one order line per line", async () => {
    await createPickListFlow({
      ...basePayload,
      lines: [{ product_id: PRODUCT_A, quantity: 1 }, { product_id: PRODUCT_B, quantity: 2 }],
    });
    expect(upsertRecord).toHaveBeenCalledWith("pick_lists", expect.objectContaining({ consolidated: true }));
    expect(upsertRecord).toHaveBeenCalledWith("order_lines", { order_id: "orders-id", product_id: PRODUCT_A, quantity: 1 });
    expect(upsertRecord).toHaveBeenCalledWith("order_lines", { order_id: "orders-id", product_id: PRODUCT_B, quantity: 2 });
  });

  it("queries only available, positive stock for the line's product in this warehouse", async () => {
    await createPickListFlow(basePayload);

    expect(supa.opsFor("products")[0]).toEqual([["select", "*"], ["eq", "id", PRODUCT_A], ["single"]]);
    expect(supa.opsFor("inventory_balances")[0]).toEqual([
      ["select", "pallet_id, location_id, available_quantity, expiry_date, received_at"],
      ["eq", "product_id", PRODUCT_A],
      ["eq", "warehouse_id", WAREHOUSE],
      ["eq", "status", "available"],
      ["gt", "available_quantity", 0],
    ]);
    expect(supa.opsFor("inventory_freezes")[0]).toEqual([
      ["select", "location_id"],
      ["eq", "warehouse_id", WAREHOUSE],
      ["eq", "status", "active"],
    ]);
  });

  it("picks the earliest expiry first under FEFO, with undated stock last", async () => {
    supa.queue("products", { data: { rotation_method: "fefo" } });
    supa.queue("inventory_balances", {
      data: [
        { pallet_id: "undated", location_id: "L1", available_quantity: 10, expiry_date: null, received_at: "2026-01-01" },
        { pallet_id: "late", location_id: "L2", available_quantity: 10, expiry_date: "2027-06-01", received_at: "2026-01-02" },
        { pallet_id: "early", location_id: "L3", available_quantity: 10, expiry_date: "2026-12-01", received_at: "2026-01-03" },
      ],
    });

    await createPickListFlow({ ...basePayload, lines: [{ product_id: PRODUCT_A, quantity: 25 }] });

    expect(pickTaskWrites().map((row) => row.pallet_id)).toEqual(["early", "late", "undated"]);
  });

  it("picks the oldest receipt first under FIFO, with unknown receipt dates first", async () => {
    supa.queue("products", { data: { rotation_method: "fifo" } });
    supa.queue("inventory_balances", {
      data: [
        { pallet_id: "newer", location_id: "L1", available_quantity: 10, expiry_date: "2026-01-01", received_at: "2026-03-01" },
        { pallet_id: "older", location_id: "L2", available_quantity: 10, expiry_date: "2027-01-01", received_at: "2026-02-01" },
        { pallet_id: "unknown", location_id: "L3", available_quantity: 10, expiry_date: null, received_at: null },
      ],
    });

    await createPickListFlow({ ...basePayload, lines: [{ product_id: PRODUCT_A, quantity: 30 }] });

    expect(pickTaskWrites().map((row) => row.pallet_id)).toEqual(["unknown", "older", "newer"]);
  });

  it("never directs a pick from a frozen location, but keeps unlocated stock", async () => {
    supa.queue("inventory_balances", {
      data: [
        { pallet_id: "frozen", location_id: "L-FROZEN", available_quantity: 10, received_at: "2026-01-01" },
        { pallet_id: "loose", location_id: null, available_quantity: 10, received_at: "2026-01-02" },
        { pallet_id: "open", location_id: "L-OPEN", available_quantity: 10, received_at: "2026-01-03" },
      ],
    });
    supa.queue("inventory_freezes", { data: [{ location_id: "L-FROZEN" }, { location_id: null }] });

    await createPickListFlow({ ...basePayload, lines: [{ product_id: PRODUCT_A, quantity: 20 }] });

    expect(pickTaskWrites().map((row) => [row.pallet_id, row.location_id])).toEqual([
      ["loose", null],
      ["open", "L-OPEN"],
    ]);
  });

  it("writes one queued task per whole pallet when stock covers the line", async () => {
    supa.queue("inventory_balances", {
      data: [
        { pallet_id: "p1", location_id: "L1", available_quantity: 20, received_at: "2026-01-01" },
        { pallet_id: "p2", location_id: "L2", available_quantity: 20, received_at: "2026-01-02" },
      ],
    });

    await createPickListFlow(basePayload);

    const tasks = pickTaskWrites();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      pick_list_id: "pick_lists-id",
      order_line_id: "order_lines-id",
      pallet_id: "p1",
      location_id: "L1",
      requested_quantity: 20,
      status: "queued",
      short_reason: null,
    });
    expect(tasks[0].task_number).toMatch(/^PKT-/);
  });

  it("flags every task as an exception with the shortfall when stock is short", async () => {
    supa.queue("inventory_balances", {
      data: [{ pallet_id: "p1", location_id: "L1", available_quantity: 12, received_at: "2026-01-01" }],
    });

    await createPickListFlow(basePayload);

    expect(pickTaskWrites()).toEqual([
      expect.objectContaining({ pallet_id: "p1", requested_quantity: 12, status: "exception", short_reason: "Short by 18" }),
    ]);
  });

  it("surfaces stock and freeze lookup failures", async () => {
    supa.queue("inventory_balances", { error: new Error("balances down") });
    await expect(createPickListFlow(basePayload)).rejects.toThrow("balances down");

    supa.reset();
    supa.queue("inventory_freezes", { error: new Error("freezes down") });
    await expect(createPickListFlow(basePayload)).rejects.toThrow("freezes down");
  });
});

describe("listPickLists", () => {
  it("lists newest first and scopes to the warehouse when given", async () => {
    supa.queue("pick_lists", { data: [{ id: "a" }] });

    await expect(listPickLists(WAREHOUSE)).resolves.toEqual([{ id: "a" }]);

    const [ops] = supa.opsFor("pick_lists");
    expect(ops[0][0]).toBe("select");
    expect(String(ops[0][1])).toContain("pick_tasks(");
    expect(ops[1]).toEqual(["order", "created_at", { ascending: false }]);
    expect(ops[2]).toEqual(["eq", "warehouse_id", WAREHOUSE]);
  });

  it("lists every warehouse when none is given and copes with no rows", async () => {
    await expect(listPickLists(null)).resolves.toEqual([]);
    expect(supa.opsFor("pick_lists")[0].some(([op]) => op === "eq")).toBe(false);
  });

  it("throws the query error", async () => {
    supa.queue("pick_lists", { error: new Error("nope") });
    await expect(listPickLists()).rejects.toThrow("nope");
  });
});

describe("getPickExecution", () => {
  it("loads the list and its tasks in creation order", async () => {
    supa.queue("pick_lists", { data: { id: "list-1" } });
    supa.queue("pick_tasks", { data: [{ id: "t1", pallet_id: null }] });

    await expect(getPickExecution("list-1")).resolves.toEqual({
      pickList: { id: "list-1" },
      pickTasks: [{ id: "t1", pallet_id: null }],
    });
    expect(supa.opsFor("pick_lists")[0]).toEqual([["select", "*"], ["eq", "id", "list-1"], ["single"]]);
    const [taskOps] = supa.opsFor("pick_tasks");
    expect(taskOps[1]).toEqual(["eq", "pick_list_id", "list-1"]);
    expect(taskOps[2]).toEqual(["order", "created_at", { ascending: true }]);
  });

  it("looks up a live location only for tasks whose pallet has no located task", async () => {
    supa.queue("pick_lists", { data: { id: "list-1" } });
    supa.queue("pick_tasks", {
      data: [
        { id: "located", pallet_id: "p1", locations: { code: "A-01" } },
        { id: "unlocated", pallet_id: "p2", locations: null },
        { id: "no-pallet", pallet_id: null },
      ],
    });
    supa.queue("inventory_balances", { data: { available_quantity: 5, locations: { code: "B-02" } } });

    const { pickTasks } = await getPickExecution("list-1");

    expect(pickTasks).toEqual([
      { id: "located", pallet_id: "p1", locations: { code: "A-01" } },
      {
        id: "unlocated",
        pallet_id: "p2",
        locations: null,
        pick_balance: { available_quantity: 5, locations: { code: "B-02" } },
      },
      { id: "no-pallet", pallet_id: null },
    ]);
    const balanceOps = supa.opsFor("inventory_balances");
    expect(balanceOps).toHaveLength(1);
    expect(balanceOps[0][1]).toEqual(["eq", "pallet_id", "p2"]);
  });

  it("records a missing balance as null rather than dropping the task", async () => {
    supa.queue("pick_tasks", { data: [{ id: "t", pallet_id: "p" }] });
    const { pickTasks } = await getPickExecution("list-1");
    expect(pickTasks).toEqual([{ id: "t", pallet_id: "p", pick_balance: null }]);
  });

  it("throws when either query fails", async () => {
    supa.queue("pick_lists", { error: new Error("list failed") });
    await expect(getPickExecution("x")).rejects.toThrow("list failed");
    supa.reset();
    supa.queue("pick_tasks", { error: new Error("tasks failed") });
    await expect(getPickExecution("x")).rejects.toThrow("tasks failed");
  });
});

describe("pick RPC error messages", () => {
  it("previews an alternate pallet through the database", async () => {
    rpc.mockResolvedValue({ data: { sku: "SKU-1" }, error: null });
    await expect(previewPickSourceOverride("t", "PKL-1", "PBC-2")).resolves.toEqual({ sku: "SKU-1" });
    expect(rpc).toHaveBeenCalledWith("preview_pick_source_override", {
      in_task_id: "t",
      in_pick_list_code: "PKL-1",
      in_scanned_pallet_barcode: "PBC-2",
    });
  });

  it.each([
    [{ message: "msg" }, "msg"],
    [{ details: "detail" }, "detail"],
    [{}, "Could not verify the alternate pallet."],
  ])("explains a failed alternate-pallet preview (%o)", async (error, expected) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(previewPickSourceOverride("t", "PKL-1", "PBC-2")).rejects.toThrow(expected);
  });

  it.each([
    [{ message: "msg" }, "msg"],
    [{ details: "detail" }, "detail"],
    [{}, "Could not create the follow-up pick task."],
  ])("explains a failed shortfall task (%o)", async (error, expected) => {
    rpc.mockResolvedValue({ data: null, error });
    await expect(createPickShortfallTask("t", 3)).rejects.toThrow(expected);
  });

  it.each([
    [{ message: "Task already completed" }, "Task already completed"],
    [{ details: "detail" }, "detail"],
    [{}, "Pick confirmation failed"],
  ])("passes through a non-anomaly confirmation failure (%o)", async (error, expected) => {
    rpc.mockResolvedValue({ data: null, error });
    const rejection = confirmPickTask("t", "PKL-1", "PBC-1", 4).catch((e) => e);
    const thrown = await rejection;
    expect(thrown.message).toBe(expected);
    expect(thrown.name).toBe("Error");
  });

  it("words a quantity anomaly for the operator, including decimals", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom PICK_QTY_ANOMALY: available=2.5;requested=10" } });
    const thrown = await confirmPickTask("t", "PKL-1", "PBC-1", 10).catch((e) => e);
    expect(thrown.message).toBe("PICK_QTY_ANOMALY: Cannot pick 10; only 2.5 available on this pallet.");
    expect(thrown.code).toBe("PICK_QTY_ANOMALY");
    expect(thrown.availableQuantity).toBe(2.5);
    expect(thrown.requestedQuantity).toBe(10);
  });
});

describe("cancelPickList", () => {
  function queueList(list: Record<string, unknown>) {
    supa.queue("pick_lists", { data: { id: "list-1", warehouse_id: WAREHOUSE, ...list } });
  }

  beforeEach(() => {
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it.each(["completed", "cancelled"])("refuses to cancel a %s list", async (status) => {
    queueList({ status });
    await expect(cancelPickList("list-1")).rejects.toThrow("Pick list is already closed.");
    expect(supa.opsFor("pick_lists")).toHaveLength(1);
  });

  it("throws the lookup error", async () => {
    supa.queue("pick_lists", { error: new Error("lookup failed") });
    await expect(cancelPickList("list-1")).rejects.toThrow("lookup failed");
  });

  it("cancels the list, its open tasks and its order, and audits the trimmed reason", async () => {
    queueList({
      status: "in_progress",
      notes: "Rush",
      order_id: "order-1",
      pick_tasks: [
        { id: "t-open", status: "queued" },
        { id: "t-done", status: "completed" },
        { id: "t-cancelled", status: "cancelled" },
        { id: "t-started", status: "in_progress" },
      ],
    });

    await cancelPickList("list-1", "  customer called  ");

    const [lookup, update] = supa.opsFor("pick_lists");
    expect(lookup).toEqual([["select", "*, pick_tasks(id, status)"], ["eq", "id", "list-1"], ["single"]]);
    expect(update).toEqual([
      ["update", { status: "cancelled", notes: "Rush · Cancelled: customer called" }],
      ["eq", "id", "list-1"],
    ]);
    expect(supa.opsFor("pick_tasks")).toEqual([[
      ["update", { status: "cancelled", short_reason: "customer called" }],
      ["in", "id", ["t-open", "t-started"]],
    ]]);
    expect(supa.opsFor("orders")).toEqual([[["update", { status: "cancelled" }], ["eq", "id", "order-1"]]]);
    expect(rpc).toHaveBeenCalledWith("log_audit_event", {
      in_event_type: "pick_list_cancelled",
      in_entity_table: "pick_lists",
      in_entity_id: "list-1",
      in_warehouse_id: WAREHOUSE,
      in_metadata: { reason: "customer called" },
    });
  });

  it("writes a bare note and skips tasks and order when there are none", async () => {
    queueList({ status: "queued", notes: null, order_id: null, pick_tasks: [{ id: "t", status: "completed" }] });

    await cancelPickList("list-1", "   ");

    expect(supa.opsFor("pick_lists")[1][0]).toEqual(["update", { status: "cancelled", notes: "Cancelled" }]);
    expect(supa.opsFor("pick_tasks")).toEqual([]);
    expect(supa.opsFor("orders")).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("log_audit_event", expect.objectContaining({ in_metadata: { reason: null } }));
  });

  it("copes with a list that has no task rows at all", async () => {
    queueList({ status: "queued" });
    await cancelPickList("list-1");
    expect(supa.opsFor("pick_tasks")).toEqual([]);
  });

  it("logs, but does not throw on, a failed audit write", async () => {
    queueList({ status: "queued" });
    rpc.mockResolvedValue({ data: null, error: { message: "audit down" } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(cancelPickList("list-1")).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith("[cancelPickList] log_audit_event failed:", { message: "audit down" });
  });

  it("stays quiet when the audit write succeeds", async () => {
    queueList({ status: "queued" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    await cancelPickList("list-1");
    expect(consoleError).not.toHaveBeenCalled();
  });
});
