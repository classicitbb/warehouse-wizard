// product-pack-options.ts — the fast SKU picker feed for pack-standard work.
//
// The designer used to pull `select *` for every active product through the
// shared admin option loader. With ~3,700 products that is four wide pages and
// several seconds, long enough that the drop-down simply looked empty. This
// module reads only the four columns a picker shows, plus the profile rows the
// designer needs, so the list is on screen immediately.

import { fetchAllRows } from "@/features/shared/core-types";
import { supabase } from "@/integrations/supabase/client";

export interface PackProductOption {
  id: string;
  sku: string;
  name: string;
  barcode?: string;
  /** True when this SKU already has a saved packaging profile. */
  hasProfile: boolean;
}

export interface ProductPackOptions {
  products: PackProductOption[];
  /** Every visible packaging profile row, keyed nowhere — callers filter. */
  profiles: Array<Record<string, unknown>>;
  warehouses: Array<Record<string, unknown>>;
}

export async function fetchProductPackOptions(): Promise<ProductPackOptions> {
  const [products, profiles, warehouses] = await Promise.all([
    fetchAllRows<any>((from, to) =>
      (supabase.from as any)("products")
        .select("id, sku, name, barcode")
        .eq("active", true)
        .order("sku", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)),
    fetchAllRows<any>((from, to) =>
      (supabase.from as any)("product_packaging_profiles")
        .select("*")
        .or("is_hidden.is.null,is_hidden.eq.false")
        .order("id", { ascending: true })
        .range(from, to)),
    fetchAllRows<any>((from, to) =>
      (supabase.from as any)("warehouses").select("*").order("id", { ascending: true }).range(from, to)),
  ]);

  const withProfiles = new Set(profiles.map((row: any) => String(row.product_id ?? "")));

  return {
    products: products.map((row: any) => ({
      id: String(row.id),
      sku: String(row.sku ?? ""),
      name: String(row.name ?? ""),
      barcode: row.barcode ? String(row.barcode) : undefined,
      hasProfile: withProfiles.has(String(row.id)),
    })),
    profiles,
    warehouses,
  };
}

export const PRODUCT_PACK_OPTIONS_KEY = ["product-pack-options"] as const;
