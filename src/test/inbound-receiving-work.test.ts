import { describe, expect, it, vi } from "vitest";
import { listInboundReceivingWork, matchingReceivingWork, type InboundReceivingWork } from "@/features/receiving/inbound-receiving-work";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
const draft: InboundReceivingWork = { id: "d1", container_number: "SMLU7872173", notes: JSON.stringify({ netsuite: { inboundShipmentId: "5", poId: "10" } }), stage: "draft" };

describe("inbound receiving active work", () => {
  it("blocks a matching container in Receiving drafts", () => {
    expect(matchingReceivingWork([draft], "smlu 787217-3", "5")).toEqual([draft]);
  });
  it("blocks completed dock receipts that still have open Put-Away", () => {
    const putaway = { ...draft, stage: "putaway" as const };
    expect(matchingReceivingWork([putaway], "SMLU7872173", "5")).toEqual([putaway]);
  });
  it("does not block another container carrying the same shipment and PO", () => {
    expect(matchingReceivingWork([draft], "SMLU3120938", "5")).toEqual([]);
  });
  it("matches shipment provenance when its container is absent", () => {
    expect(matchingReceivingWork([{ ...draft, container_number: null }], "SMLU7872173", "5")).toHaveLength(1);
  });
  it("allows receiving when no unfinished work remains", () => {
    expect(matchingReceivingWork([], "SMLU7872173", "5")).toEqual([]);
  });
  it("reads beyond 500 drafts and excludes completed and cancelled Put-Away tasks", async () => {
    const range = vi.fn(async (start: number) => ({ data: start === 0 ? Array.from({ length: 500 }, (_, i) => ({ ...draft, id: `d${i}` })) : [{ ...draft, id: "d501" }], error: null }));
    const statuses = vi.fn();
    mocks.from.mockImplementation((table: string) => {
      const query = { select: () => query, eq: () => query, in: (_: string, values: string[]) => { statuses(table, values); return query; }, order: () => query, range: table === "receipts" ? range : vi.fn(async () => ({ data: [{ id: "t1", pallets: { receipt_lines: { receipts: { ...draft, id: "r1" } } } }], error: null })) };
      return query;
    });
    const work = await listInboundReceivingWork("wh-1");
    expect(work.some((row) => row.id === "d501")).toBe(true);
    expect(work.find((row) => row.id === "r1")?.stage).toBe("putaway");
    expect(range).toHaveBeenCalledWith(500, 999);
    expect(statuses).toHaveBeenCalledWith("putaway_tasks", ["draft", "queued", "assigned", "in_progress", "exception"]);
  });
});