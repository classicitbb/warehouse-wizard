import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildKnownCodeIndex, EMPTY_KNOWN_CODE_INDEX, type KnownCodeIndex } from "@/lib/code-input";

/**
 * Loads every location code (with its zone/warehouse prefix variants) so
 * bay/location fields can reject codes that do not exist. Cached for the
 * session — structure changes rarely and the wizard invalidates this key.
 */
export const KNOWN_LOCATION_CODES_KEY = "known-location-codes";

export function useKnownLocationCodes(warehouseId?: string | null): KnownCodeIndex {
  const scope = warehouseId && warehouseId !== "all" ? warehouseId : null;
  const { data } = useQuery({
    queryKey: [KNOWN_LOCATION_CODES_KEY, scope],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows: { code: string | null; zone_code: string | null; warehouse_code: string | null }[] = [];
      const pageSize = 1000;
      for (let page = 0; page < 20; page += 1) {
        let query = supabase
          .from("locations")
          .select("code, zones(code), warehouses(code)")
          .order("code", { ascending: true })
          .range(page * pageSize, page * pageSize + pageSize - 1);
        if (scope) query = query.eq("warehouse_id", scope);
        const { data: pageRows, error } = await query;
        if (error) throw error;
        const list = (pageRows ?? []) as any[];
        for (const row of list) {
          rows.push({
            code: row?.code ?? null,
            zone_code: row?.zones?.code ?? null,
            warehouse_code: row?.warehouses?.code ?? null,
          });
        }
        if (list.length < pageSize) break;
      }
      return buildKnownCodeIndex(rows);
    },
  });
  return data ?? EMPTY_KNOWN_CODE_INDEX;
}
