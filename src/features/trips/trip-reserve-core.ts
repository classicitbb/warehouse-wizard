import { supabase } from "@/integrations/supabase/client";

export type TripReserve = {
  source: {
    pallet_id: string;
    barcode: string;
    bin: string;
    available_quantity: number;
    received_at: string | null;
    expiry_date: string | null;
  } | null;
  destination: string | null;
  replenishment: { id: string; task_number: string; status: string } | null;
};

export async function fetchTripReserve(taskId: string, request = false, expectedPalletId: string | null = null): Promise<TripReserve> {
  const { data, error } = await supabase.rpc("trip_pick_reserve", {
    p_task_id: taskId,
    p_request: request,
    p_expected_pallet_id: expectedPalletId ?? undefined,
  });
  if (error) throw error;
  return data as unknown as TripReserve;
}