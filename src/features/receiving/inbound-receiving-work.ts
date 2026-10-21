import { supabase } from "@/integrations/supabase/client";
import { normalizeContainerNumber } from "@/lib/container-number";
import { parseDraftMeta } from "@/features/receiving/receiving-form-state";

export type InboundReceivingWork = {
  id: string;
  container_number: string | null;
  notes: string | null;
  stage: "draft" | "putaway";
};

type WorkRow = { id: string; container_number: string | null; notes: string | null };
const db = supabase.from.bind(supabase) as (table: string) => any;

/** Paginate every active row; the visible draft list is intentionally limited. */
export async function listInboundReceivingWork(warehouseId: string): Promise<InboundReceivingWork[]> {
  async function pages(query: () => any): Promise<any[]> {
    const rows: any[] = [];
    for (let start = 0; ; start += 500) {
      const { data, error } = await query().order("id").range(start, start + 499);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 500) return rows;
    }
  }
  const [drafts, tasks] = await Promise.all([
    pages(() => db("receipts").select("id,container_number,notes").eq("warehouse_id", warehouseId).in("status", ["draft", "queued"])),
    pages(() => db("putaway_tasks").select("id,pallets(receipt_lines(receipts(id,container_number,notes)))").eq("warehouse_id", warehouseId).in("status", ["draft", "queued", "assigned", "in_progress", "exception"])),
  ]);
  const work = new Map<string, InboundReceivingWork>();
  for (const draft of drafts) work.set(draft.id, { ...draft, stage: "draft" });
  for (const task of tasks) {
    const receipt = task.pallets?.receipt_lines?.receipts as WorkRow | undefined;
    if (receipt && !work.has(receipt.id)) work.set(receipt.id, { ...receipt, stage: "putaway" });
  }
  return [...work.values()];
}

export function matchingReceivingWork(work: InboundReceivingWork[], container: string, shipmentId?: string): InboundReceivingWork[] {
  const wanted = normalizeContainerNumber(container);
  return work.filter((row) => {
    const meta = parseDraftMeta(row.notes);
    const stored = normalizeContainerNumber(row.container_number || String(meta.container_number ?? ""));
    if (wanted && stored) return wanted === stored;
    return Boolean(shipmentId && meta.netsuite?.inboundShipmentId === shipmentId);
  });
}

export function receivingWorkMessage(work: InboundReceivingWork[]): string {
  return work.some((row) => row.stage === "putaway")
    ? "This container/shipment is already in Put-Away. Finish that work instead of receiving it again."
    : "This container/shipment already has Receiving drafts. Open those instead of receiving it again.";
}