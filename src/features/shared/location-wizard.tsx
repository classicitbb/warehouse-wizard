// Guided dialog for creating rack locations in bulk.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MapPinned } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import { expandLocationRange, fetchLocationCreationOptions } from "@/lib/wms-core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Form, FormField } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { SelectField, TextField } from "@/features/shared/ui-shared";

const locationWizardSchema = z
  .object({
    warehouse_id: z.string().uuid({ message: "Select a warehouse" }),
    zone_id: z.string().uuid({ message: "Select a zone" }),
    prefix: z.string().trim().min(1, "Prefix required").max(8, "Max 8 chars"),
    start_bay: z.coerce.number().int().min(1),
    end_bay: z.coerce.number().int().min(1),
    levels: z.coerce.number().int().min(1).max(6),
    positions_per_level: z.coerce.number().int().min(1).max(3),
    depth: z.coerce.number().int().min(1).max(5),
    level_letters: z.boolean(),
    location_type: z.enum(["rack", "staging", "quarantine", "dispatch", "receiving", "floor", "returns"]),
    temperature_class: z.enum(["ambient", "cool", "frozen"]),
    mixed_sku_allowed: z.boolean(),
    mixed_lot_allowed: z.boolean(),
    level_style: z.enum(["numeric", "letters"]).default("numeric"),
  })
  .refine((v) => v.end_bay >= v.start_bay, { path: ["end_bay"], message: "End bay must be ≥ start bay" });

export type LocationWizardValues = z.infer<typeof locationWizardSchema>;

export interface LocationWizardDialogProps {
  trigger?: React.ReactNode | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultWarehouseId?: string;
  defaultZoneId?: string;
}

export function LocationWizardDialog({
  trigger,
  open: openProp,
  onOpenChange,
  defaultWarehouseId,
  defaultZoneId,
}: LocationWizardDialogProps = {}) {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { data: options } = useQuery({ queryKey: ["options", "location-wizard"], queryFn: () => fetchLocationCreationOptions() });
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? !!openProp : internalOpen;
  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const resolvedDefaultWarehouseId = useMemo(() => {
    const warehouses = options?.warehouses ?? [];
    if (defaultWarehouseId && warehouses.some((warehouse: any) => warehouse.id === defaultWarehouseId)) {
      return defaultWarehouseId;
    }
    const profileWarehouseId = profile?.default_warehouse_id;
    if (profileWarehouseId && warehouses.some((warehouse: any) => warehouse.id === profileWarehouseId)) {
      return profileWarehouseId;
    }
    return warehouses.length === 1 ? String((warehouses[0] as any).id ?? "") : "";
  }, [defaultWarehouseId, options?.warehouses, profile?.default_warehouse_id]);

  const resolvedDefaultZoneId = useMemo(() => {
    if (!resolvedDefaultWarehouseId) return "";
    const zones = (options?.zones ?? []).filter((zone: any) => zone.warehouse_id === resolvedDefaultWarehouseId);
    if (defaultZoneId && zones.some((zone: any) => zone.id === defaultZoneId)) {
      return defaultZoneId;
    }
    return zones.length > 0 ? String((zones[0] as any).id ?? "") : "";
  }, [defaultZoneId, options?.zones, resolvedDefaultWarehouseId]);

  const buildDefaults = useCallback(
    (): LocationWizardValues => ({
      warehouse_id: resolvedDefaultWarehouseId,
      zone_id: resolvedDefaultZoneId,
      prefix: String((options?.zones ?? []).find((zone: any) => zone.id === resolvedDefaultZoneId)?.code ?? "A").toUpperCase(),
      start_bay: 1,
      end_bay: 10,
      levels: 3,
      positions_per_level: 1,
      depth: 1,
      level_letters: false,
      location_type: "rack",
      temperature_class: "ambient",
      mixed_sku_allowed: false,
      mixed_lot_allowed: false,
      level_style: "numeric",
    }),
    [resolvedDefaultWarehouseId, resolvedDefaultZoneId],
  );

  const form = useForm<LocationWizardValues>({
    resolver: zodResolver(locationWizardSchema),
    defaultValues: buildDefaults(),
  });

  const selectedWarehouseId = form.watch("warehouse_id");
  const selectedZoneId = form.watch("zone_id");
  const prevWarehouseRef = useRef(selectedWarehouseId);
  const prevZoneRef = useRef(selectedZoneId);

  // Reset form to prefilled defaults whenever the dialog opens.
  useEffect(() => {
    if (open) {
      const next = buildDefaults();
      form.reset(next);
      prevWarehouseRef.current = next.warehouse_id;
      prevZoneRef.current = next.zone_id;
    }
  }, [open, buildDefaults, form]);

  // Clear zone only when the user actually changes the warehouse (not on prefill).
  useEffect(() => {
    if (prevWarehouseRef.current !== selectedWarehouseId) {
      if (prevWarehouseRef.current !== "") {
        form.setValue("zone_id", "");
      }
      prevWarehouseRef.current = selectedWarehouseId;
    }
  }, [selectedWarehouseId, form]);

  const filteredZones = (options?.zones ?? []).filter(
    (zone: any) => zone.warehouse_id === selectedWarehouseId,
  );

  useEffect(() => {
    if (!open || !selectedWarehouseId || form.getValues("zone_id") || filteredZones.length === 0) return;
    const fallbackZoneId = resolvedDefaultZoneId || String((filteredZones[0] as any).id ?? "");
    if (fallbackZoneId) {
      form.setValue("zone_id", fallbackZoneId, { shouldValidate: true });
    }
  }, [filteredZones, form, open, resolvedDefaultZoneId, selectedWarehouseId]);

  useEffect(() => {
    if (!open || !selectedZoneId || prevZoneRef.current === selectedZoneId) return;
    prevZoneRef.current = selectedZoneId;
    const zoneCode = String((options?.zones ?? []).find((zone: any) => zone.id === selectedZoneId)?.code ?? "").trim().toUpperCase();
    if (zoneCode) form.setValue("prefix", zoneCode, { shouldValidate: true });
  }, [form, open, options?.zones, selectedZoneId]);

  const locationCount =
    Math.max((form.watch("end_bay") ?? 1) - (form.watch("start_bay") ?? 1) + 1, 0) *
    Math.max(form.watch("levels") ?? 1, 1) *
    Math.max(form.watch("positions_per_level") ?? 1, 1);

  // Representative code (level 2) reflecting the current style + position settings.
  const samplePositions = Math.max(form.watch("positions_per_level") ?? 1, 1);
  const samplePrefix = (form.watch("prefix") || "A").toUpperCase();
  const sampleBay = String(Math.max(form.watch("start_bay") ?? 1, 1)).padStart(2, "0");
  const sampleLevelSeg = form.watch("level_style") === "letters" ? "B" : "L02";

  const mutation = useMutation({
    mutationFn: async (values: LocationWizardValues) => {
      const levelStyle: "numeric" | "alpha" = values.level_style === "letters" ? "alpha" : "numeric";
      let hasLevelStyleColumn = true;

      // Guard: a zone (and therefore each bay within it) must use a single level
      // style. Different zones in the same warehouse may differ. The DB trigger is
      // authoritative; this pre-check gives a clean message before any rows are written.
      const { data: existing, error: existingError } = await (supabase.from as any)("locations")
        .select("level_style, aisle, bay")
        .eq("zone_id", values.zone_id);
      if (existingError) {
        const missingLevelStyleColumn =
          (existingError as { code?: string; message?: string }).code === "42703" &&
          String((existingError as { message?: string }).message ?? "").includes("level_style");
        if (!missingLevelStyleColumn) throw existingError;
        hasLevelStyleColumn = false;
      } else {
        const styleOf = (row: any): "numeric" | "alpha" => (row?.level_style === "alpha" ? "alpha" : "numeric");
        const zoneConflict = (existing ?? []).some((row: any) => styleOf(row) !== levelStyle);
        if (zoneConflict) {
          const existingLabel = levelStyle === "alpha" ? "numbered (L01, L02\u2026)" : "lettered (A, B, C\u2026)";
          throw new Error(
            `This zone already uses ${existingLabel} levels. A zone and its bays must use one level style. ` +
              `Turn the level-letters switch the other way, or pick a different zone.`,
          );
        }
      }

      const expanded = expandLocationRange({
        prefix: values.prefix,
        startBay: values.start_bay,
        endBay: values.end_bay,
        positionsPerLevel: values.positions_per_level,
        levels: values.levels,
        depth: values.depth,
        levelStyle: values.level_style,
      });
      const rows = expanded.map((row) => ({
        warehouse_id: values.warehouse_id,
        zone_id: values.zone_id,
        code: row.localCode,
        aisle: row.aisle,
        bay: row.bay,
        level: row.level,
        position: row.position,
        depth: row.depth,
        max_pallets: row.maxPallets,
        location_type: values.location_type,
        temperature_class: values.temperature_class,
        mixed_sku_allowed: values.mixed_sku_allowed,
        mixed_lot_allowed: values.mixed_lot_allowed,
        status: "active",
        ...(hasLevelStyleColumn ? { level_style: row.levelStyle } : {}),
      }));

      // Skip rows whose code already exists (unique constraint on locations.code).
      const candidateCodes = Array.from(new Set(rows.flatMap((row) => (
        row.position === 1 && !String(row.code).match(/-P\d+$/i)
          ? [row.code, `${row.code}-P1`]
          : [row.code]
      ))));
      const { data: existingRows } = await supabase
        .from("locations")
        .select("code")
        .in("code", candidateCodes);
      const existingCodes = new Set((existingRows ?? []).map((r: any) => String(r.code).toUpperCase()));
      const toInsert = rows.filter((row) => {
        const code = String(row.code).toUpperCase();
        const legacyP1 = row.position === 1 && !code.match(/-P\d+$/i) ? `${code}-P1` : "";
        return !existingCodes.has(code) && (!legacyP1 || !existingCodes.has(legacyP1));
      });

      let created = 0;
      if (toInsert.length > 0) {
        const { error, count } = await (supabase.from("locations") as any)
          .insert(toInsert, { count: "exact" });
        if (error) throw error;
        created = count ?? toInsert.length;
      }
      return { created, skipped: existingCodes.size, total: rows.length };
    },
    onSuccess: async ({ created, skipped, total }) => {
      if (created > 0 && skipped === 0) {
        toast.success(`Created ${created} location${created !== 1 ? "s" : ""}`);
      } else if (created > 0 && skipped > 0) {
        toast.success(
          `Created ${created} location${created !== 1 ? "s" : ""} (skipped ${skipped} duplicate${skipped !== 1 ? "s" : ""} of ${total})`,
        );
      } else {
        toast.message(`No new locations created — all ${total} codes already exist`);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["tree"] }),
        queryClient.invalidateQueries({ queryKey: ["zone-locations"] }),
      ]);
      setOpen(false);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Location wizard failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger === null ? null : (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button variant="outline">
              <MapPinned data-icon="inline-start" />
              Location wizard
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create locations by range</DialogTitle>
          <DialogDescription>Each bay-level splits into 1–3 side-by-side positions. Total = bays × levels × positions. Depth = pallet capacity per slot.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[72vh] overflow-y-auto pr-4">
          <Form {...form}>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <SelectField
                form={form}
                name="warehouse_id"
                label="Warehouse"
                hint="All locations are scoped to one warehouse."
                options={(options?.warehouses ?? []).map((warehouse: any) => ({ label: warehouse.name, value: warehouse.id }))}
              />
              <SelectField
                form={form}
                name="zone_id"
                label="Zone"
                hint={selectedWarehouseId ? "Zones for the selected warehouse." : "Select a warehouse first."}
                options={filteredZones.map((zone: any) => ({ label: `${zone.code} – ${zone.name}`, value: zone.id }))}
              />
              <TextField form={form} name="prefix" label="Rack prefix" hint="Letter or short code, e.g. A or BR." />
              <TextField form={form} name="start_bay" label="Start bay" type="number" hint="First bay number in the range (≥ 1)." />
              <TextField form={form} name="end_bay" label="End bay" type="number" hint="Must be ≥ start bay." />
              <TextField form={form} name="levels" label="Levels" type="number" hint="Vertical levels per bay (1–6)." />
              <TextField form={form} name="positions_per_level" label="Positions per level" type="number" hint="Side-by-side slots in each bay-level (1–3)." />
              <TextField form={form} name="depth" label="Depth (capacity)" type="number" hint="Pallets deep per slot = capacity (1–5)." />
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-level-style-label" className="text-sm font-medium">Substitute level numbers for letters (A, B, C, D...)</span>
                  <span className="text-xs text-muted-foreground">Writes the level as a letter instead of L01/L02 in the code (e.g. A-01-B). One style per zone and bay; different zones in a warehouse can differ.</span>
                </div>
                <FormField control={form.control} name="level_style" render={({ field }) => (
                  <Switch
                    aria-labelledby="lw-level-style-label"
                    checked={field.value === "letters"}
                    onCheckedChange={(checked) => field.onChange(checked ? "letters" : "numeric")}
                  />
                )} />
              </div>
              <SelectField form={form} name="location_type" label="Type" hint="Used by directed putaway rules." options={[
                { label: "Rack", value: "rack" },
                { label: "Staging", value: "staging" },
                { label: "Quarantine", value: "quarantine" },
                { label: "Dispatch", value: "dispatch" },
                { label: "Receiving", value: "receiving" },
                { label: "Floor", value: "floor" },
                { label: "Returns", value: "returns" },
              ]} />
              <SelectField form={form} name="temperature_class" label="Temperature" hint="Must match the zone’s temperature class." options={[
                { label: "Ambient", value: "ambient" },
                { label: "Cool", value: "cool" },
                { label: "Frozen", value: "frozen" },
              ]} />
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-mixed-sku-label" className="text-sm font-medium">Mixed SKU allowed</span>
                  <span className="text-xs text-muted-foreground">Permit different products in the same location.</span>
                </div>
                <FormField control={form.control} name="mixed_sku_allowed" render={({ field }) => (
                  <Switch aria-labelledby="lw-mixed-sku-label" checked={field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 sm:col-span-2">
                <div className="grid gap-0.5 pr-3">
                  <span id="lw-mixed-lot-label" className="text-sm font-medium">Mixed lot allowed</span>
                  <span className="text-xs text-muted-foreground">Permit different lot numbers in the same location.</span>
                </div>
                <FormField control={form.control} name="mixed_lot_allowed" render={({ field }) => (
                  <Switch aria-labelledby="lw-mixed-lot-label" checked={field.value} onCheckedChange={field.onChange} />
                )} />
              </div>
              {locationCount > 0 ? (
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  This will generate <strong>{locationCount}</strong> location{locationCount !== 1 ? "s" : ""}.
                </p>
              ) : null}
              <Button className="sm:col-span-2" disabled={mutation.isPending || !selectedWarehouseId || !form.watch("zone_id")} type="submit" aria-busy={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Create location range
              </Button>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
