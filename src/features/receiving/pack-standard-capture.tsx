// pack-standard-capture.tsx — recording a pack standard from the floor.
//
// Two entry points, one dialog and one write path:
//
//   1. "Create Package Standard" in the receiving packaging section, when an
//      operator already knows how this SKU is built.
//   2. Propose-and-approve after a receipt, when the SKU has no standard and
//      the receipt itself is good evidence of one.
//
// Both go through buildPackStandardPayload, deliberately. A second write path
// here would be the one route that saves a profile with a null
// standard_height_mm — which passes every clearance check silently.

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PalletStackPreview } from "@/components/pallet-stack-preview";
import { upsertRecord } from "@/features/admin/admin-core";
import { formatPackCode } from "@/lib/measure";
import {
  EMPTY_PACK_STANDARD_DRAFT,
  buildPackStandardPayload,
  suggestProfileName,
  type PackStandardDraft,
} from "@/lib/pack-standard-payload";
import { resolvePalletStackMetrics } from "@/lib/pallet-geometry";

const PACKAGE_TYPES = ["case", "carton", "box", "tray", "bag"];

export interface PackStandardCaptureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productLabel?: string | null;
  /** Names already taken for this product, for the unique(product_id, name) index. */
  takenNames: string[];
  /** Seed from a typed pack code, when there is one. */
  packagesPerLayer?: number | null;
  layersPerPallet?: number | null;
  unitsPerPackage?: number | null;
  /** True when the SKU already has a pallet standard. */
  hasExistingStandard?: boolean;
  /** Extra copy explaining why the dialog opened, for the proposal path. */
  rationale?: string;
  onSaved?: (profileId: string) => void;
}

export function PackStandardCaptureDialog({
  open,
  onOpenChange,
  productId,
  productLabel,
  takenNames,
  packagesPerLayer,
  layersPerPallet,
  unitsPerPackage,
  hasExistingStandard,
  rationale,
  onSaved,
}: PackStandardCaptureProps) {
  const queryClient = useQueryClient();
  const [perLayer, setPerLayer] = useState<number | null>(packagesPerLayer ?? null);
  const [layers, setLayers] = useState<number | null>(layersPerPallet ?? null);
  const [cartonHeightMm, setCartonHeightMm] = useState<number | null>(null);
  const [packageType, setPackageType] = useState("case");
  const [perPackage, setPerPackage] = useState<number>(unitsPerPackage && unitsPerPackage > 0 ? unitsPerPackage : 1);
  const [makeStandard, setMakeStandard] = useState(!hasExistingStandard);
  const [name, setName] = useState("");

  const draft: PackStandardDraft = useMemo(() => ({
    ...EMPTY_PACK_STANDARD_DRAFT,
    packagesPerLayer: perLayer,
    layersPerPallet: layers,
    packageHeightMm: cartonHeightMm,
    isPalletStandard: makeStandard,
  }), [perLayer, layers, cartonHeightMm, makeStandard]);

  const packCode = formatPackCode({ packages_per_layer: perLayer, layers_per_pallet: layers });
  const perPallet = (perLayer ?? 0) * (layers ?? 0);
  const suggestedName = useMemo(() => suggestProfileName(draft, takenNames), [draft, takenNames]);
  const effectiveName = name.trim() || suggestedName;
  const metrics = resolvePalletStackMetrics({
    packagesPerLayer: perLayer, layersPerPallet: layers, packageHeightMm: cartonHeightMm,
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...buildPackStandardPayload(draft),
        product_id: productId,
        profile_name: effectiveName,
        package_type: packageType,
        units_per_package: perPackage,
      };
      return upsertRecord("product_packaging_profiles", payload);
    },
    onSuccess: (row: any) => {
      toast.success(`Saved ${effectiveName} for ${productLabel ?? "this SKU"}.`);
      void queryClient.invalidateQueries({ queryKey: ["options"] });
      void queryClient.invalidateQueries({ queryKey: ["product_packaging_profiles"] });
      const id = Array.isArray(row) ? row[0]?.id : row?.id;
      if (id) onSaved?.(String(id));
      onOpenChange(false);
    },
    onError: (error: any) => {
      const message = String(error?.message ?? error);
      if (message.includes("23505")) {
        toast.error("That profile name is already used for this SKU. Try another.");
        return;
      }
      toast.error(`Could not save the pack standard: ${message}`);
    },
  });

  const ready = Boolean(productId) && (perLayer ?? 0) > 0 && (layers ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create package standard</DialogTitle>
          <DialogDescription>
            {rationale ?? `How ${productLabel ?? "this SKU"} is built on a pallet. Receiving will assign it from now on.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="grid content-start gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="capture-per-layer">Cases per layer</Label>
                <Input
                  id="capture-per-layer" type="number" min={1} inputMode="numeric"
                  value={perLayer ?? ""}
                  onChange={(e) => setPerLayer(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="capture-layers">Layers</Label>
                <Input
                  id="capture-layers" type="number" min={1} inputMode="numeric"
                  value={layers ?? ""}
                  onChange={(e) => setLayers(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="capture-name">Profile name</Label>
              <Input
                id="capture-name" placeholder={suggestedName} value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="capture-type">Package type</Label>
                <Select value={packageType} onValueChange={setPackageType}>
                  <SelectTrigger id="capture-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PACKAGE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="capture-units">Units per package</Label>
                <Input
                  id="capture-units" type="number" min={1} inputMode="numeric" value={perPackage}
                  onChange={(e) => setPerPackage(Math.max(1, Number(e.currentTarget.value) || 1))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="capture-carton">Carton height (mm)</Label>
              <Input
                id="capture-carton" type="number" min={1} inputMode="numeric"
                placeholder="Optional — needed for the height rule"
                value={cartonHeightMm ?? ""}
                onChange={(e) => setCartonHeightMm(e.currentTarget.value === "" ? null : Number(e.currentTarget.value))}
              />
              {/* Without a carton height the generated standard_height_mm is
                  null, and a pallet with no height passes every bin check. */}
              {cartonHeightMm === null ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Without a carton height this standard has no pallet height, so bin clearance cannot be checked.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Built pallet height {metrics.stackHeightMm} mm.</p>
              )}
            </div>

            {/* The partial unique index allows one standard per product, so a
                second would fail with an index name nobody can act on. */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="capture-standard" className="cursor-pointer">Pallet standard for this SKU</Label>
                <p className="text-xs text-muted-foreground">
                  {hasExistingStandard
                    ? "This SKU already has one. Edit that profile to change it."
                    : "Receiving will assign it automatically from now on."}
                </p>
              </div>
              <Switch
                id="capture-standard" checked={makeStandard} disabled={hasExistingStandard}
                onCheckedChange={setMakeStandard}
              />
            </div>
          </div>

          <div className="grid content-start gap-2 rounded-md border border-border bg-muted/20 p-3">
            <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
              {packCode ? `${packCode} · ${perPallet}` : "Set the build"}
            </p>
            <PalletStackPreview
              spec={{
                packagesPerLayer: perLayer,
                layersPerPallet: layers,
                packageHeightMm: cartonHeightMm ?? 220,
              }}
              showCeilings={false}
              className="max-h-56"
            />
            <p className="text-xs text-muted-foreground">
              {perPallet > 0 ? `${perPallet} × ${perPackage} = ${(perPallet * perPackage).toLocaleString()} units per pallet.` : ""}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!ready || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save standard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PackStandardCaptureDialog;
