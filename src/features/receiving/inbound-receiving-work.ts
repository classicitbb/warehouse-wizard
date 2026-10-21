import { supabase } from "@/integrations/supabase/client";

export type InboundReceivingWork = {
  id: string;
  container_number: string | null;
  notes: string | null;
  stage: "draft" | "putaway";
};

/** All active work, not the limited list of visible receiving drafts. */
export async function listInboundReceivingWork(warehouseId: string): Promise<InboundReceivingWork[]> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    name: string, args: { in_warehouse_id: string },
  ) => PromiseLike<{ data: InboundReceivingWork[] | null; error: { message: string } | null }>;
  const { data, error } = await rpc("inbound_receiving_work", { in_warehouse_id: warehouseId });
  if (error) throw new Error(error.message);
  return data ?? [];
}