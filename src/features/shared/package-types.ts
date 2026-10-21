// The curated package_types master (BALE, CASE, BAG, ...), shared by every
// form that records what a product is packed in. product_packaging_profiles
// stores the choice as package_type_id; a database trigger keeps the legacy
// package_type text in step, so nothing here writes the text column.
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export type PackageType = {
  id: string;
  code: string;
  name: string;
  aliases: string[];
  sort: number;
};

export const PACKAGE_TYPES_QUERY_KEY = ["package_types"] as const;
const db = supabase.from.bind(supabase) as (table: string) => any;

export async function fetchPackageTypes(): Promise<PackageType[]> {
  const { data, error } = await db("package_types")
    .select("id, code, name, aliases, sort")
    .order("sort")
    .order("code");
  if (error) throw error;
  return (data ?? []) as PackageType[];
}

export function usePackageTypes() {
  return useQuery({
    queryKey: PACKAGE_TYPES_QUERY_KEY,
    queryFn: fetchPackageTypes,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Mirrors public.resolve_package_type_id(): the code or any alias, any case,
 * surrounding spaces ignored. Returns null when nothing matches.
 */
export function resolvePackageType(types: PackageType[], text: string | null | undefined): PackageType | null {
  const needle = String(text ?? "").trim().toLowerCase();
  if (!needle) return null;
  return (
    types.find((t) => t.code.toLowerCase() === needle || t.aliases.some((a) => a.toLowerCase() === needle)) ?? null
  );
}
