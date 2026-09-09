// pallet-pak-designer.tsx — the Packing tab workspace.
//
// Pick a SKU, shape the build, watch the stack, save it as the pack standard.
// Full-bleed rather than a tile grid: the other dashboard modes are curated
// metric boards where reordering is a feature, and `dashboard_tile_visibility`
// carries `check (mode in ('floor','dock','office'))`, so a packing tile would
// raise 23514 the first time anyone hid one.

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { PalletStackPreview } from "@/components/pallet-stack-preview";
import { ProductSearch } from "@/components/product-search";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PackStandardSection } from "@/features/shared/pack-standard-form";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-feature-permission";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { fetchOptions, upsertRecord } from "@/features/admin/admin-core";
import { LENGTH_UNIT_LABELS, formatLength, formatPackCode, type LengthUnit } from "@/lib/measure";
import {
  EMPTY_PACK_STANDARD_DRAFT,
  buildPackStandardPayload,
  packStandardDraftFromProfile,
  resolveDefaultProfileForProduct,
  suggestProfileName,
  type PackStandardDraft,
} from "@/lib/pack-standard-payload";
import {
  describeStackConformance,
  describeStackFit,
  resolvePalletStackMetrics,
  type PalletStackSpec,
} from "@/lib/pallet-geometry";
import { cn } from "@/lib/utils";

const PACKAGE_TYPES = ["case", "carton", "box", "tray", "bag"];

const FIT_TONE = {
  fits: "border-success/50 bg-success/10 text-success",
  tight: "border-warning/50 bg-warning/10 text-warning",
  blocked: "border-destructive/50 bg-destructive/10 text-destructive",
  unknown: "border-border bg-muted/30 text-muted-foreground",
} as const;

const CONFORMANCE_TONE = {
  standard: FIT_TONE.fits,
  short: FIT_TONE.tight,
  overpack: FIT_TONE.blocked,
  unknown: FIT_TONE.unknown,
} as const;

interface SaveDetails {
  profileName: string;
  packageType: string;
  unitsPerPackage: number;
  isPalletStandard: boolean;
}

export function PalletPakDesigner() {
  const { profile } = useAuth();
  const permission = useFeaturePermission("pack_designer");
  const { online } = useNetworkStatus();
  const queryClient = useQueryClient();

  const [productId, setProductId] = useState("");
  const [draft, setDraft] = useState<PackStandardDraft>({
    ...EMPTY_PACK_STANDARD_DRAFT,
    packagesPerLayer: 12,
    layersPerPallet: 7,
    layerColumns: 4,
    packageHeightMm: 220,
  });
  const [binClearanceMm, setBinClearanceMm] = useState(2000);
  const [unit, setUnit] = useState<LengthUnit>("mm");
  const [actualPackages, setActualPackages] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [details, setDetails] = useState<SaveDetails>({
    profileName: "", packageType: "case", unitsPerPackage: 1, isPalletStandard: true,
  });

  const { data: options } = useQuery({
    queryKey: ["options", "pack-designer"],
    queryFn: () => fetchOptions(false, undefined, ["products", "packagingProfiles", "warehouses"]),
    staleTime: 60_000,
  });

  const products = (options?.products ?? []) as any[];
  const profiles = (options?.packagingProfiles ?? []) as any[];
  const warehouses = (options?.warehouses ?? []) as any[];

  const warehouse = useMemo(
    () => warehouses.find((row) => row.id === profile?.default_warehouse_id) ?? warehouses[0] ?? null,
    [warehouses, profile?.default_warehouse_id],
  );

  const productOptions = useMemo(
    () => products.map((row) => ({ id: row.id, sku: row.sku, name: row.name, barcode: row.barcode })),
    [products],
  );

  const existingStandard = useMemo(
    () => resolveDefaultProfileForProduct(profiles, productId),
    [profiles, productId],
  );

  const spec: PalletStackSpec = useMemo(() => ({
    packagesPerLayer: draft.packagesPerLayer,
    layersPerPallet: draft.layersPerPallet,
    packageHeightMm: draft.packageHeightMm,
    layerColumns: draft.layerColumns,
    layerPattern: draft.layerPattern,
    actualPackages,
    footprintLengthMm: draft.footprintLengthMm,
    footprintWidthMm: draft.footprintWidthMm,
    allowanceLengthMm: warehouse?.pallet_space_allowance_length_mm ?? null,
    allowanceWidthMm: warehouse?.pallet_space_allowance_width_mm ?? null,
    palletBaseHeightMm: draft.palletBaseHeightMm,
    slipSheetHeightMm: draft.slipSheetHeightMm,
    binClearanceMm,
    clearanceMarginMm: warehouse?.clearance_safety_margin_mm ?? null,
  }), [draft, actualPackages, binClearanceMm, warehouse]);

  const metrics = useMemo(() => resolvePalletStackMetrics(spec), [spec]);
  const packCode = formatPackCode({
    packages_per_layer: draft.packagesPerLayer,
    layers_per_pallet: draft.layersPerPallet,
  });

  const patchDraft = useCallback((patch: Partial<PackStandardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  /** Loads a SKU's existing standard so the designer edits rather than duplicates. */
  const selectProduct = useCallback((id: string) => {
    setProductId(id);
    setActualPackages(null);
    const existing = resolveDefaultProfileForProduct(profiles, id);
    if (existing) {
      setDraft(packStandardDraftFromProfile(existing, {
        footprintLengthMm: warehouse?.pallet_space_allowance_length_mm,
        footprintWidthMm: warehouse?.pallet_space_allowance_width_mm,
      }));
    }
  }, [profiles, warehouse]);

  const openSave = useCallback(() => {
    const taken = profiles
      .filter((row) => row.product_id === productId)
      .map((row) => String(row.profile_name ?? ""));
    setDetails({
      profileName: suggestProfileName(draft, taken),
      packageType: String(existingStandard?.package_type ?? "case"),
      unitsPerPackage: Number(existingStandard?.units_per_package ?? 1) || 1,
      // The partial unique index allows one standard per product, so offering
      // to set a second would fail with an index name the operator cannot read.
      isPalletStandard: !existingStandard,
    });
    setSaveOpen(true);
  }, [draft, profiles, productId, existingStandard]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...buildPackStandardPayload({ ...draft, isPalletStandard: details.isPalletStandard }),
        product_id: productId,
        profile_name: details.profileName.trim(),
        package_type: details.packageType,
        units_per_package: details.unitsPerPackage,
      };
      return upsertRecord("product_packaging_profiles", payload);
    },
    onSuccess: () => {
      toast.success(`Saved ${details.profileName} as a pack standard.`);
      setSaveOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["options"] });
      void queryClient.invalidateQueries({ queryKey: ["product_packaging_profiles"] });
    },
    onError: (error: any) => {
      const message = String(error?.message ?? error);
      if (message.includes("23505")) {
        toast.error("A profile with that name already exists for this SKU. Try another name.");
        return;
      }
      toast.error(`Could not save the pack standard: ${message}`);
    },
  });

  const perPallet = metrics.packagesPerPallet;
  const unitsPerPallet = perPallet * (details.unitsPerPackage || 1);
  const canSave = permission.canEdit && online && Boolean(productId) && perPallet > 0;

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="flex min-w-0 flex-col">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <CardTitle className="text-base">Pallet Pak Designer</CardTitle>
            {!permission.isReleased ? (
              <Badge variant="secondary" className="text-xs">Developer preview</Badge>
            ) : null}
          </div>
          <div className="w-full sm:w-[36rem]">
            <ProductSearch
              value={productId}
              onChange={selectProduct}
              options={productOptions}
              placeholder="Select a SKU to design for…"
            />
          </div>
        </CardHeader>
        <CardContent className="grid min-w-0 gap-4">
          <div className="relative rounded-md border border-border bg-muted/20 p-3">
            {/* The pack code is the thing an operator reads across a room, so it
                lives on the stage at display size rather than in a chip. */}
            <div className="pointer-events-none absolute left-4 top-3 z-10 grid gap-0.5">
              <span className="font-mono text-5xl font-bold leading-none tracking-tight text-primary sm:text-6xl lg:text-7xl">
                {packCode || "—"}
              </span>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {perPallet > 0 ? `${perPallet} cases per pallet` : "Set the build"}
              </span>
            </div>
            <div className="absolute right-3 top-3 z-10 inline-flex overflow-hidden rounded border border-border">
              {(Object.keys(LENGTH_UNIT_LABELS) as LengthUnit[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={unit === option}
                  onClick={() => setUnit(option)}
                  className={cn(
                    "px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                    unit === option
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {LENGTH_UNIT_LABELS[option]}
                </button>
              ))}
            </div>
            <PalletStackPreview spec={spec} className="max-h-[26rem]" />
          </div>
          <PackStandardSection
            draft={draft}
            onChange={patchDraft}
            controls="sliders"
            binClearanceMm={binClearanceMm}
            onBinClearanceChange={setBinClearanceMm}
            actualPackages={actualPackages ?? perPallet}
            onActualPackagesChange={setActualPackages}
            lengthUnit={unit}
          />
        </CardContent>
      </Card>

      <div className="grid content-start gap-3">
        <Card>
          <CardContent className="grid gap-3 pt-6">
            <div className="grid gap-0.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-primary">{perPallet || "—"}</span>
              <span className="text-xs uppercase tracking-wider text-muted-foreground">Cases on pallet</span>
            </div>
            <div className="grid gap-3">
              <div className="grid gap-0.5">
                <span className="font-mono text-xl font-semibold tabular-nums">
                  {metrics.stackHeightMm ? formatLength(metrics.stackHeightMm, unit) : "—"}
                </span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Built height</span>
              </div>
              <div className="grid gap-0.5">
                {/* One unit mark for the pair, or the readout wraps to two lines. */}
                <span className="font-mono text-xl font-semibold tabular-nums">
                  {unit === "mm"
                    ? `${Math.round(draft.footprintLengthMm)} × ${Math.round(draft.footprintWidthMm)} mm`
                    : `${formatLength(draft.footprintLengthMm, unit)} × ${formatLength(draft.footprintWidthMm, unit)}`}
                </span>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Footprint</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className={cn("rounded-md border p-3 text-sm", FIT_TONE[metrics.fit])}>
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">{metrics.fit}</p>
          <p className="mt-1 leading-snug">{describeStackFit(metrics, unit === "mm" ? undefined : (mm) => formatLength(mm, unit))}</p>
        </div>

        <div className={cn("rounded-md border p-3 text-sm", CONFORMANCE_TONE[metrics.conformance])}>
          <p className="font-mono text-xs font-semibold uppercase tracking-wider">{metrics.conformance}</p>
          <p className="mt-1 leading-snug">{describeStackConformance(metrics)}</p>
        </div>

        {existingStandard ? (
          <p className="text-xs text-muted-foreground">
            This SKU already has the standard <span className="font-mono">{String(existingStandard.profile_name)}</span>.
            Saving adds a separate profile.
          </p>
        ) : null}

        <Button className="w-full" disabled={!canSave} onClick={openSave}>
          <Save className="mr-2 h-4 w-4" />
          Save as pack standard
        </Button>
        {!permission.canEdit ? (
          <p className="text-xs text-muted-foreground">
            Saving a pack standard needs the packaging permission.
          </p>
        ) : !online ? (
          <p className="text-xs text-muted-foreground">
            Offline — master data is created online only, so two devices cannot race the same profile name.
          </p>
        ) : null}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save pack standard</DialogTitle>
            <DialogDescription>
              {packCode ? `${packCode} — ${perPallet} cases per pallet.` : "Set the build first."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pack-profile-name">Profile name</Label>
              <Input
                id="pack-profile-name"
                value={details.profileName}
                onChange={(event) => setDetails((d) => ({ ...d, profileName: event.currentTarget.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pack-package-type">Package type</Label>
              <Select
                value={details.packageType}
                onValueChange={(value) => setDetails((d) => ({ ...d, packageType: value }))}
              >
                <SelectTrigger id="pack-package-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PACKAGE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pack-units">Units per package</Label>
              <Input
                id="pack-units"
                type="number"
                min={1}
                value={details.unitsPerPackage}
                onChange={(event) => setDetails((d) => ({
                  ...d, unitsPerPackage: Math.max(1, Number(event.currentTarget.value) || 1),
                }))}
              />
              {/* A pack code counts cases; the receiving form counts stock
                  units. Spelling out the product is the whole reason this
                  field is on the dialog rather than defaulted silently. */}
              <p className="text-xs text-muted-foreground">
                {perPallet} cases × {details.unitsPerPackage} = {unitsPerPallet.toLocaleString()} units per pallet.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="pack-standard-toggle" className="cursor-pointer">
                  Make this the pallet standard for this SKU
                </Label>
                <p className="text-xs text-muted-foreground">
                  {existingStandard
                    ? `Already set to ${String(existingStandard.profile_name)}. Edit that profile to change it.`
                    : "Receiving will assign it automatically."}
                </p>
              </div>
              <Switch
                id="pack-standard-toggle"
                checked={details.isPalletStandard}
                disabled={Boolean(existingStandard)}
                onCheckedChange={(checked) => setDetails((d) => ({ ...d, isPalletStandard: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button
              disabled={save.isPending || !details.profileName.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default PalletPakDesigner;
