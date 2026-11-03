import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ rows: [] as any[], failInsert: false, seq: 0 }));

vi.mock("@/integrations/supabase/client", () => {
  const from = (_table: string) => {
    const filters: Array<(row: any) => boolean> = [];
    let mode: "select" | "update" | "insert" = "select";
    let patch: any = null;
    let inserted: any[] = [];
    const run = () => {
      if (mode === "insert") {
        if (store.failInsert) return { data: null, error: { message: "insert failed" } };
        inserted = patch.map((row: any) => ({ id: `new-${++store.seq}`, ...row }));
        store.rows.push(...inserted);
        return { data: inserted, error: null };
      }
      const hits = store.rows.filter((row) => filters.every((f) => f(row)));
      if (mode === "update") {
        hits.forEach((row) => Object.assign(row, patch));
        return { data: hits, error: null };
      }
      return { data: hits.map((row) => ({ ...row })), error: null };
    };
    const builder: any = {
      select: () => builder,
      update: (p: any) => { mode = "update"; patch = p; return builder; },
      insert: (p: any) => { mode = "insert"; patch = Array.isArray(p) ? p : [p]; return builder; },
      eq: (col: string, val: any) => { filters.push((row) => row[col] === val); return builder; },
      in: (col: string, vals: any[]) => { filters.push((row) => vals.includes(row[col])); return builder; },
      single: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error ?? (r.data?.length ? null : { message: "not found" }) }); },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { supabase: { from, rpc: vi.fn() } };
});
vi.mock("@/features/system/system-core", () => ({ writeSystemLog: vi.fn(async () => undefined) }));
vi.mock("@/features/admin/admin-core", () => ({ upsertRecord: vi.fn() }));
vi.mock("@/lib/ai-assist", () => ({ recordPalletQtyObservation: vi.fn(async () => undefined) }));

import { updateDraftReceiptSplit } from "@/features/receiving/receiving-core";

const WAREHOUSE = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";

function draftRow(meta: Record<string, any>, extra: Record<string, any> = {}) {
  return {
    id: "draft-1",
    receipt_number: "RCT-1",
    receipt_type: "other",
    reference_number: "REF",
    container_number: null,
    po_number: null,
    warehouse_id: WAREHOUSE,
    client_id: null,
    status: "draft",
    draft_pallet_barcode: "PLT-OLD",
    draft_group_id: null,
    draft_sequence: null,
    draft_count: null,
    notes: JSON.stringify({ _draft: true, draft_pallet_barcode: "PLT-OLD", product_id: PRODUCT, quantity: 100, ...meta }),
    ...extra,
  };
}

const values = (over: Record<string, any> = {}) => ({
  receipt_type: "other" as const,
  warehouse_id: WAREHOUSE,
  product_id: PRODUCT,
  quantity: 100,
  pallet_barcode: "PLT-OLD",
  expiry_date: "2027-01-01",
  lot_number: "L1",
  ...over,
});

const meta = (row: any) => JSON.parse(row.notes);

describe("updateDraftReceiptSplit", () => {
  beforeEach(() => {
    store.rows = [];
    store.failInsert = false;
    store.seq = 0;
  });

  it("splits a put-away returned draft into two pallets that keep the source references", async () => {
    store.rows.push(draftRow({
      source_type: "putaway_returned", source_id: "task-9", superseded_pallet_id: "pallet-old", superseded_pallet_barcode: "PLT-ORIG",
      container_number: "MSKU1234565", po_number: "PO-1", expiry_date: "2027-01-01", lot_number: "L1",
    }));

    const { draftIds } = await updateDraftReceiptSplit("draft-1", values(), [50, 50]);

    expect(draftIds).toEqual(["draft-1", "new-1"]);
    const [first, second] = store.rows;
    expect(meta(first).quantity).toBe(50);
    expect(meta(second).quantity).toBe(50);
    expect(first.draft_pallet_barcode).toBe("PLT-OLD");
    expect(second.draft_pallet_barcode).not.toBe("PLT-OLD");
    expect(second.draft_pallet_barcode).toMatch(/^PLT-/);
    expect(first.draft_group_id).toBeTruthy();
    expect(second.draft_group_id).toBe(first.draft_group_id);
    expect([first.draft_sequence, second.draft_sequence]).toEqual([1, 2]);
    expect([first.draft_count, second.draft_count]).toEqual([2, 2]);
    for (const row of [first, second]) {
      expect(meta(row)).toMatchObject({
        source_type: "putaway_returned", source_id: "task-9", superseded_pallet_id: "pallet-old",
        superseded_pallet_barcode: "PLT-ORIG", expiry_date: "2027-01-01", lot_number: "L1",
      });
      expect(row.status).toBe("draft");
    }
    expect(meta(second).split_from_draft_id).toBe("draft-1");
  });

  it("makes three drafts for a 3-way split with unique numbers", async () => {
    store.rows.push(draftRow({}));
    const { draftIds } = await updateDraftReceiptSplit("draft-1", values({ quantity: 90 }), [30, 30, 30]);
    expect(draftIds).toHaveLength(3);
    expect(new Set(store.rows.map((row) => row.draft_pallet_barcode)).size).toBe(3);
    expect(store.rows.map((row) => row.draft_sequence)).toEqual([1, 2, 3]);
    expect(store.rows.every((row) => row.draft_count === 3)).toBe(true);
  });

  it("keeps a legacy returned pallet's identity on the edited draft only", async () => {
    store.rows.push(draftRow({ _returned: true, returned_pallet_id: "pallet-1", reuse_pallet_barcode: "PLT-OLD" }));
    await updateDraftReceiptSplit("draft-1", values(), [50, 50]);
    const [first, second] = store.rows.map(meta);
    expect(first.returned_pallet_id).toBe("pallet-1");
    expect(first.reuse_pallet_barcode).toBe("PLT-OLD");
    expect(second.returned_pallet_id).toBeUndefined();
    expect(second.reuse_pallet_barcode).toBeUndefined();
  });

  it("with a single quantity behaves as a plain draft update and creates nothing", async () => {
    store.rows.push(draftRow({}));
    const { draftIds } = await updateDraftReceiptSplit("draft-1", values({ quantity: 80 }), [80]);
    expect(draftIds).toEqual(["draft-1"]);
    expect(store.rows).toHaveLength(1);
    expect(meta(store.rows[0]).quantity).toBe(80);
  });

  it("restores the original draft when the extra drafts cannot be created", async () => {
    store.rows.push(draftRow({}));
    const original = store.rows[0].notes;
    store.failInsert = true;
    await expect(updateDraftReceiptSplit("draft-1", values(), [50, 50])).rejects.toBeTruthy();
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].notes).toBe(original);
    expect(meta(store.rows[0]).quantity).toBe(100);
  });

  it("extends an existing group without reusing sequence numbers", async () => {
    store.rows.push(draftRow({}, { draft_group_id: "grp-1", draft_sequence: 2, draft_count: 3 }));
    await updateDraftReceiptSplit("draft-1", values(), [50, 50]);
    const [first, second] = store.rows;
    expect(first.draft_group_id).toBe("grp-1");
    expect(second.draft_group_id).toBe("grp-1");
    expect(first.draft_sequence).toBe(2);
    expect(second.draft_sequence).toBe(4);
    expect(second.draft_count).toBe(4);
  });

  it("rejects zero or negative pallet quantities before touching anything", async () => {
    store.rows.push(draftRow({}));
    await expect(updateDraftReceiptSplit("draft-1", values(), [100, 0])).rejects.toThrow(/positive quantity/);
    expect(store.rows).toHaveLength(1);
    expect(meta(store.rows[0]).quantity).toBe(100);
  });

  it("refuses to split a draft that is no longer a draft", async () => {
    store.rows.push(draftRow({}, { status: "received" }));
    await expect(updateDraftReceiptSplit("draft-1", values(), [50, 50])).rejects.toBeTruthy();
    expect(store.rows).toHaveLength(1);
  });
});
