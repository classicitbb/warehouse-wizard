// product-pack-standard-notice.tsx — the saved pallet build, shown read-only on
// the Products edit form.
//
// The pack standard lives on `product_packaging_profiles`, not `products`, so
// the generic resource form never surfaces it. This panel reads the SKU's
// pallet-standard profile and shows the same one-line summary the picking list
// and the Products table use, plus the isometric preview, so the standard is
// visible without opening the Packing tab. Editing still happens there or on
// Packaging Profiles — this is a window, not a second write path.

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Boxes } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { PalletStackPreview } from "@/components/pallet-stack-preview";
import { formatPackCode } from "@/lib/measure";
import {
  formatPackStandardLine,
  packStandardDraftFromProfile,
  resolveDefaultProfileForProduct,
  summarizePackStandard,
} from "@/lib/pack-standard-payload";

export function ProductPackStandardNotice({ productId }: { productId: string }) {
  const { toPath } = useTenantPath();
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ["product_packaging_profiles", "product", productId],
    enabled: Boolean(productId),
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("product_packaging_profiles")
        .select("*")
        .eq("product_id", productId)
        .or("is_hidden.is.null,is_hidden.eq.false");
      if (error) throw error;
      return (data ?? []) as Array<Record<string, unknown>>;
    },
  });

  const profile = useMemo(
    () => resolveDefaultProfileForProduct(profiles, productId),
    [profiles, productId],
  );
  const summary = summarizePackStandard(profile);
  const draft = useMemo(
    () => (profile ? packStandardDraftFromProfile(profile) : null),
    [profile],
  );

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          Pack standard
        </span>
        <Link
          to={toPath("/packaging-profiles")}
          className="text-xs text-primary underline-offset-2 hover:underline"
        >
          Edit in Packaging
        </Link>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !summary ? (
        <p className="text-xs text-muted-foreground">
          No pallet build saved for this SKU. Set one in the Packing tab or on Packaging Profiles.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
          <div className="grid gap-1 text-sm">
            <span className="font-mono font-semibold text-primary">{formatPackStandardLine(summary)}</span>
            <span className="text-xs text-muted-foreground">
              {summary.profileName ? `Profile ${summary.profileName}` : "Unnamed profile"}
              {summary.unitsPerPackage
                ? ` · ${summary.unitsPerPackage} unit${summary.unitsPerPackage === 1 ? "" : "s"} per case`
                : ""}
              {summary.casesPerPallet && summary.unitsPerPackage
                ? ` · ${(summary.casesPerPallet * summary.unitsPerPackage).toLocaleString()} units per pallet`
                : ""}
            </span>
          </div>
          {draft ? (
            <PalletStackPreview
              spec={{
                packagesPerLayer: draft.packagesPerLayer,
                layersPerPallet: draft.layersPerPallet,
                packageHeightMm: draft.packageHeightMm ?? 220,
                layerColumns: draft.layerColumns,
                layerPattern: draft.layerPattern,
                footprintLengthMm: draft.footprintLengthMm,
                footprintWidthMm: draft.footprintWidthMm,
                palletBaseHeightMm: draft.palletBaseHeightMm,
                slipSheetHeightMm: draft.slipSheetHeightMm,
              }}
              showCeilings={false}
              showLayerBracket={false}
              className="max-h-40"
              ariaLabel={`Pallet build ${formatPackCode(profile) || "preview"}`}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ProductPackStandardNotice;
