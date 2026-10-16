// Whether NetSuite is configured and switched on (Settings > Integrations).
// Every NetSuite feature outside Settings renders only when this is true; the
// connection settings themselves are always shown so it can be set up.
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export const NETSUITE_ACTIVE_QUERY_KEY = ["netsuite-integration-active"] as const;

export function useNetSuiteActive(): boolean {
  const { data } = useQuery({
    queryKey: NETSUITE_ACTIVE_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("netsuite_integration_active");
      if (error) throw error;
      return data === true;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  // Hidden while loading or on error, so an unconfigured install never flashes NetSuite UI.
  return data === true;
}
