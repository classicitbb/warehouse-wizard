// pack-standard-form.tsx — the pack-standard editor, shared by three surfaces.
//
// One draft-to-payload editor rendered two ways: `fields` for the Packaging
// Profiles dialog, where typing 12 beats dragging to it, and `sliders` for the
// designer, where the point is watching the stack change. Both produce the
// same PackStandardDraft, so there is exactly one write path and the cm/mm
// pairing cannot drift between them.
//
// Imports only src/lib/* and src/components/ui/*, deliberately: no ui-shared
// import, so no cycle with the dialogs that host it.

import { useId, useMemo } from "react";
import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatPackCode } from "@/lib/measure";
import { type LayerPattern, gridFor } from "@/lib/pallet-geometry";
import { packStandardDraftFromProfile, type PackStandardDraft } from "@/lib/pack-standard-payload";
import { cn } from "@/lib/utils";

const LAYER_PATTERNS: Array<{ value: LayerPattern; label: string }> = [
  { value: "block", label: "Block" },
  { value: "brick", label: "Brick (alternate 90°)" },
  { value: "pinwheel", label: "Pinwheel" },
  { value: "column", label: "Column" },
  { value: "custom", label: "Custom" },
];

export interface PackStandardSectionProps {
  draft: PackStandardDraft;
  onChange: (patch: Partial<PackStandardDraft>) => void;
  controls?: "fields" | "sliders";
  disabled?: boolean;
  className?: string;
  /** Shown alongside the layer controls so the operator can see the fit move. */
  binClearanceMm?: number | null;
  onBinClearanceChange?: (mm: number) => void;
  /** Actual cases on this pallet, for the short/overpack preview. */
  actualPackages?: number | null;
  onActualPackagesChange?: (count: number) => void;
}

function numberOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A slider row with its live value in the label, as in the prototype. */
function SliderRow({
  label, value, min, max, step = 1, suffix, disabled, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id} className="flex items-baseline justify-between gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono font-semibold tabular-nums text-primary">
          {value}{suffix ? ` ${suffix}` : ""}
        </span>
      </Label>
      <Slider
        id={id}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={[Math.min(Math.max(value, min), max)]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
  );
}

function NumberRow({
  label, value, onChange, disabled, description, min,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  description?: string;
  min?: number;
}) {
  const id = useId();
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        disabled={disabled}
        value={value ?? ""}
        onChange={(event) => onChange(numberOrNull(event.currentTarget.value))}
      />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function PackStandardSection({
  draft,
  onChange,
  controls = "fields",
  disabled,
  className,
  binClearanceMm,
  onBinClearanceChange,
  actualPackages,
  onActualPackagesChange,
}: PackStandardSectionProps) {
  const perLayer = draft.packagesPerLayer ?? 0;
  const layers = draft.layersPerPallet ?? 0;
  const perPallet = perLayer * layers;
  const packCode = formatPackCode({
    packages_per_layer: draft.packagesPerLayer,
    layers_per_pallet: draft.layersPerPallet,
  });
  const grid = perLayer > 0 ? gridFor(perLayer, draft.layerColumns) : null;

  const summary = packCode
    ? `${packCode} · ${perPallet} case${perPallet === 1 ? "" : "s"} per pallet`
    : "Set cases per layer and layers to define the build";

  if (controls === "sliders") {
    const standard = perPallet > 0 ? perPallet : 1;
    return (
      <div className={cn("grid gap-4", className)}>
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{summary}</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <SliderRow
            label="Cases per layer" value={perLayer || 1} min={1} max={40} disabled={disabled}
            onChange={(value) => onChange({ packagesPerLayer: value })}
          />
          <SliderRow
            label="Grid across" value={grid?.cols ?? 1} min={1} max={Math.max(1, perLayer || 1)} disabled={disabled}
            onChange={(value) => onChange({ layerColumns: value })}
          />
          <SliderRow
            label="Layers" value={layers || 1} min={1} max={30} disabled={disabled}
            onChange={(value) => onChange({ layersPerPallet: value })}
          />
          <SliderRow
            label="Carton height" value={draft.packageHeightMm ?? 220} min={40} max={800} step={5}
            suffix="mm" disabled={disabled}
            onChange={(value) => onChange({ packageHeightMm: value })}
          />
          {onActualPackagesChange ? (
            <SliderRow
              label="Actual on pallet" value={actualPackages ?? standard} min={0} max={Math.round(standard * 1.25)}
              disabled={disabled} onChange={onActualPackagesChange}
            />
          ) : null}
          {onBinClearanceChange ? (
            <SliderRow
              label="Bin clearance" value={binClearanceMm ?? 2000} min={800} max={3200} step={10}
              suffix="mm" disabled={disabled} onChange={onBinClearanceChange}
            />
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Layer pattern</Label>
            <Select
              value={draft.layerPattern}
              disabled={disabled}
              onValueChange={(value) => onChange({ layerPattern: value as LayerPattern })}
            >
              <SelectTrigger aria-label="Layer pattern"><SelectValue /></SelectTrigger>
              <SelectContent>
                {LAYER_PATTERNS.map((pattern) => (
                  <SelectItem key={pattern.value} value={pattern.value}>{pattern.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SliderRow
            label="Slip sheet" value={draft.slipSheetHeightMm} min={0} max={60} disabled={disabled}
            suffix="mm" onChange={(value) => onChange({ slipSheetHeightMm: value })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4", className)}>
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{summary}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberRow
          label="Packages per layer" min={1} disabled={disabled}
          value={draft.packagesPerLayer}
          description={packCode ? `The ${perLayer} in ${packCode}.` : "Cases in one layer."}
          onChange={(value) => onChange({ packagesPerLayer: value })}
        />
        <NumberRow
          label="Layers per pallet" min={1} disabled={disabled}
          value={draft.layersPerPallet}
          description={packCode ? `The ${layers} in ${packCode}.` : "Layers in a full pallet."}
          onChange={(value) => onChange({ layersPerPallet: value })}
        />
        <div className="grid min-w-0 gap-1.5">
          <Label>Layer pattern</Label>
          <Select
            value={draft.layerPattern}
            disabled={disabled}
            onValueChange={(value) => onChange({ layerPattern: value as LayerPattern })}
          >
            <SelectTrigger aria-label="Layer pattern"><SelectValue /></SelectTrigger>
            <SelectContent>
              {LAYER_PATTERNS.map((pattern) => (
                <SelectItem key={pattern.value} value={pattern.value}>{pattern.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NumberRow
          label="Grid across" min={1} disabled={disabled}
          value={draft.layerColumns}
          description="Cases along the long side. Leave blank for a near-square grid."
          onChange={(value) => onChange({ layerColumns: value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberRow
          label="Package length (mm)" min={0} disabled={disabled} value={draft.packageLengthMm}
          onChange={(value) => onChange({ packageLengthMm: value })}
        />
        <NumberRow
          label="Package width (mm)" min={0} disabled={disabled} value={draft.packageWidthMm}
          onChange={(value) => onChange({ packageWidthMm: value })}
        />
        <NumberRow
          label="Package height (mm)" min={0} disabled={disabled} value={draft.packageHeightMm}
          description="Drives the built pallet height."
          onChange={(value) => onChange({ packageHeightMm: value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <NumberRow
          label="Pallet length (mm)" min={0} disabled={disabled} value={draft.footprintLengthMm}
          onChange={(value) => onChange({ footprintLengthMm: value ?? 0 })}
        />
        <NumberRow
          label="Pallet width (mm)" min={0} disabled={disabled} value={draft.footprintWidthMm}
          onChange={(value) => onChange({ footprintWidthMm: value ?? 0 })}
        />
        <NumberRow
          label="Deck height (mm)" min={0} disabled={disabled} value={draft.palletBaseHeightMm}
          description="Empty pallet. Blank restores 145."
          // A null here would make the generated standard_height_mm null, so the
          // standard would exist with no height and every clearance check would
          // silently pass. Coerce back to the column default instead.
          onChange={(value) => onChange({ palletBaseHeightMm: value ?? 145 })}
        />
        <NumberRow
          label="Slip sheet (mm)" min={0} disabled={disabled} value={draft.slipSheetHeightMm}
          description="Blank restores 0."
          onChange={(value) => onChange({ slipSheetHeightMm: value ?? 0 })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <NumberRow
          label="Pallet tare (kg)" min={0} disabled={disabled} value={draft.palletTareKg}
          onChange={(value) => onChange({ palletTareKg: value })}
        />
        <NumberRow
          label="Max stacked pallets" min={1} disabled={disabled} value={draft.maxStackPallets}
          onChange={(value) => onChange({ maxStackPallets: value ?? 1 })}
        />
        <NumberRow
          label="Quantity tolerance" min={0} disabled={disabled} value={draft.quantityTolerance}
          description="Units of slack before a receipt is flagged."
          onChange={(value) => onChange({ quantityTolerance: value ?? 0 })}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="pack-build-notes">Build notes</Label>
        <Textarea
          id="pack-build-notes"
          rows={2}
          disabled={disabled}
          placeholder="Labels face out, corner posts on the top layer…"
          value={draft.buildNotes}
          onChange={(event) => onChange({ buildNotes: event.currentTarget.value })}
        />
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div className="grid gap-0.5">
          <Label htmlFor="pack-is-standard" className="cursor-pointer">Pallet standard for this SKU</Label>
          <p className="text-xs text-muted-foreground">
            Receiving assigns this profile automatically. Only one per product.
          </p>
        </div>
        <Switch
          id="pack-is-standard"
          checked={draft.isPalletStandard}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ isPalletStandard: checked })}
        />
      </div>
    </div>
  );
}

/**
 * The columns the pack section owns. The dialogs hide these from the generic
 * field loop and render this section instead.
 */
export const PACK_SECTION_FIELDS: ReadonlySet<string> = new Set([
  "packages_per_layer", "layers_per_pallet", "layer_pattern", "layer_columns",
  "package_length_mm", "package_width_mm", "package_height_mm",
  "pallet_footprint_length_mm", "pallet_footprint_width_mm",
  "pallet_base_height_mm", "slip_sheet_height_mm", "pallet_tare_kg",
  "max_stack_pallets", "quantity_tolerance", "is_pallet_standard", "build_notes",
]);

const DRAFT_TO_COLUMN: Record<keyof PackStandardDraft, string> = {
  packagesPerLayer: "packages_per_layer",
  layersPerPallet: "layers_per_pallet",
  layerColumns: "layer_columns",
  layerPattern: "layer_pattern",
  packageLengthMm: "package_length_mm",
  packageWidthMm: "package_width_mm",
  packageHeightMm: "package_height_mm",
  footprintLengthMm: "pallet_footprint_length_mm",
  footprintWidthMm: "pallet_footprint_width_mm",
  palletBaseHeightMm: "pallet_base_height_mm",
  slipSheetHeightMm: "slip_sheet_height_mm",
  palletTareKg: "pallet_tare_kg",
  maxStackPallets: "max_stack_pallets",
  quantityTolerance: "quantity_tolerance",
  isPalletStandard: "is_pallet_standard",
  buildNotes: "build_notes",
};

/** mm column -> the legacy centimetre column it must stay in step with. */
const MM_TO_CM_COLUMN: Record<string, string> = {
  package_length_mm: "length",
  package_width_mm: "width",
  package_height_mm: "height",
};

/**
 * Adapter between the react-hook-form dialogs and the draft-shaped section.
 *
 * The one thing it must not get wrong: a carton dimension written in
 * millimetres also writes its centimetre twin in the same form state, so the
 * generic submit path emits both. mm alone leaves the legacy cm columns stale
 * for every reader that still uses them; the sync trigger would then overwrite
 * our mm from a stale cm on the next update.
 */
export function PackStandardFormSection({
  form,
  className,
  disabled,
}: {
  form: UseFormReturn<Record<string, unknown>>;
  className?: string;
  disabled?: boolean;
}) {
  const values = form.watch();

  const draft = useMemo(
    () => packStandardDraftFromProfile(values as Record<string, unknown>),
    [values],
  );

  const handleChange = (patch: Partial<PackStandardDraft>) => {
    for (const [key, value] of Object.entries(patch)) {
      const column = DRAFT_TO_COLUMN[key as keyof PackStandardDraft];
      if (!column) continue;
      form.setValue(column, value as never, { shouldDirty: true });
      const cmColumn = MM_TO_CM_COLUMN[column];
      if (cmColumn) {
        form.setValue(cmColumn, (value === null ? null : Number(value) / 10) as never, { shouldDirty: true });
      }
    }
  };

  return (
    <PackStandardSection
      draft={draft}
      onChange={handleChange}
      controls="fields"
      disabled={disabled}
      className={className}
    />
  );
}

export default PackStandardSection;
