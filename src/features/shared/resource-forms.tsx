// Resource create/edit dialogs and the field renderers they share.
import {
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import {
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { useAuth } from "@/hooks/use-auth";
import {
  buildRackLocationCode,
  fetchLocationCreationOptions,
  fetchOptions,
  type FieldDefinition,
  levelToLetter,
  type ResourceDefinition,
  suggestNextRackPosition,
  updateRecord,
  upsertRecord,
} from "@/lib/wms-core";
import { PACK_SECTION_FIELDS, PackStandardFormSection } from "@/features/shared/pack-standard-form";
import { ProductPackStandardNotice } from "@/features/shared/product-pack-standard-notice";
import { PalletStackPreview } from "@/components/pallet-stack-preview";
import { formatPackCode } from "@/lib/measure";
import { packStandardDraftFromProfile } from "@/lib/pack-standard-payload";
import { PackagingProfileQuickStart } from "@/features/shared/packaging-profile-quick-start";
import { fetchProductPackOptions, PRODUCT_PACK_OPTIONS_KEY } from "@/features/shared/product-pack-options";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { ProductSearch, type ProductSearchHandle } from "@/components/product-search";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeScannerText, shouldRestrictToDefaultWarehouse } from "@/lib/scan-input";

const baseFormSchema = z.record(z.any());

export function TableFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("h-[calc(100svh-14rem)] min-h-48 w-full min-w-0 overflow-auto overscroll-contain rounded-t-[7px] [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y] [&_table]:min-w-max", className)}>
      {children}
    </div>
  );
}

export function renderField(
  field: FieldDefinition,
  form: ReturnType<typeof useForm<Record<string, unknown>>>,
  options: Array<{ label: string; value: string }> = field.options ?? [],
) {
  const uppercaseInput = shouldUppercaseField(field.name);
  return (
    <FormField
      key={field.name}
      control={form.control}
      name={field.name}
      render={({ field: controllerField }) => (
        <FormItem>
          <FormLabel>
            {field.label}
            {field.required ? <span className="ml-1 text-destructive" aria-hidden="true">*</span> : null}
          </FormLabel>
          <FormControl>
            {field.type === "textarea" ? (
              <Textarea {...controllerField} value={(controllerField.value as string | undefined) ?? ""} />
            ) : field.type === "select" ? (
              <Select
                onValueChange={controllerField.onChange}
                value={(controllerField.value as string | undefined) ?? undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${field.label.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "boolean" ? (
              <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <Checkbox checked={Boolean(controllerField.value)} onCheckedChange={controllerField.onChange} />
                <span className="text-sm text-muted-foreground">Enabled</span>
              </div>
            ) : (
              <Input
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                {...controllerField}
                value={(controllerField.value as string | number | undefined) ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  controllerField.onChange(uppercaseInput ? normalizeScannerText(value) : value);
                }}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function hasMissingRequiredValue(value: unknown) {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function validateRequiredResourceFields(
  resource: ResourceDefinition,
  values: Record<string, unknown>,
  form: ReturnType<typeof useForm<Record<string, unknown>>>,
) {
  const missingFields = resource.fields.filter((field) => field.required && hasMissingRequiredValue(values[field.name]));
  for (const field of resource.fields) {
    if (missingFields.includes(field)) {
      form.setError(field.name, { type: "required", message: `${field.label} is required` });
    } else if (form.getFieldState(field.name).error?.type === "required") {
      form.clearErrors(field.name);
    }
  }
  return missingFields.length === 0;
}

function missingRequiredFieldLabels(resource: ResourceDefinition, values: Record<string, unknown>) {
  return resource.fields
    .filter((field) => field.required && hasMissingRequiredValue(values[field.name]))
    .map((field) => field.label);
}

function RackLocationCodeBuilder({
  form,
  options,
}: {
  form: ReturnType<typeof useForm<Record<string, unknown>>>;
  options: Awaited<ReturnType<typeof fetchOptions>> | undefined;
}) {
  const [rack, setRack] = useState("A");
  const [aisle, setAisle] = useState(1);
  const [bay, setBay] = useState(1);
  const [level, setLevel] = useState(1);
  const [levelStyle, setLevelStyle] = useState<"numeric" | "alpha">("numeric");
  const [position, setPosition] = useState(1);
  const [depth, setDepth] = useState(1);
  const selectedZoneId = String(form.watch("zone_id") ?? "");
  const selectedZone = (options?.zones ?? []).find((zone: any) => String(zone.id) === selectedZoneId) as any;
  const previousZoneId = useRef(selectedZoneId);

  const localCode = buildRackLocationCode({ rack, aisle, bay, level, position, levelStyle });
  const prefixKey = `${rack.toUpperCase()}-${String(bay).padStart(2, "0")}-`;

  const { data: existingAtPrefix = [] } = useQuery({
    queryKey: ["locations-prefix", selectedZoneId, prefixKey],
    queryFn: async () => {
      const { data } = await supabase.from("locations").select("code").eq("zone_id", selectedZoneId).ilike("code", `${prefixKey}%`);
      return (data ?? []).map((r: any) => String(r.code));
    },
    enabled: Boolean(selectedZoneId && rack && aisle && bay && level),
    staleTime: 10_000,
  });

  const isDuplicate = existingAtPrefix.some((code) => {
    const existingCode = code.toUpperCase();
    const candidateCode = localCode.toUpperCase();
    return existingCode === candidateCode || existingCode === `${candidateCode}-P1`;
  });
  const nextSuggestion = suggestNextRackPosition(existingAtPrefix, rack, aisle, bay, level);

  useEffect(() => {
    if (!selectedZoneId || previousZoneId.current === selectedZoneId) return;
    previousZoneId.current = selectedZoneId;
    const zoneCode = String(selectedZone?.code ?? "").trim().toUpperCase();
    if (zoneCode) setRack(zoneCode);
  }, [selectedZone?.code, selectedZoneId]);

  useEffect(() => {
    form.setValue("code", localCode, { shouldValidate: true });
    form.setValue("aisle", `${rack.toUpperCase()}-${aisle}`);
    form.setValue("bay", String(bay).padStart(2, "0"));
    form.setValue("level", level);
    form.setValue("position", position);
    form.setValue("depth", depth);
    form.setValue("location_type", "rack");
    form.setValue("level_style", levelStyle);
    if (isDuplicate) {
      form.setError("code", { type: "manual", message: "This location already exists" });
    } else {
      form.clearErrors("code");
    }
  }, [rack, aisle, bay, level, levelStyle, position, depth, localCode, isDuplicate, form]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <FormItem>
          <FormLabel>Rack</FormLabel>
          <FormControl>
            <Input
              maxLength={8}
              value={rack}
              placeholder="A or BR"
              onChange={(e) => setRack(e.target.value.toUpperCase().replace(/[^A-Z]/g, "") || "A")}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">A–Z, back to front</p>
        </FormItem>
        <FormItem>
          <FormLabel>Aisle</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              value={aisle}
              onChange={(e) => setAisle(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Floor in front of rack</p>
        </FormItem>
        <FormItem>
          <FormLabel>Bay</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={99}
              value={bay}
              onChange={(e) => setBay(Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">01–13, left to right</p>
        </FormItem>
        <FormItem>
          <FormLabel>Level</FormLabel>
          <FormControl>
            <Input
              inputMode="text"
              maxLength={2}
              value={levelStyle === "alpha" ? levelToLetter(level) : String(level)}
              onChange={(e) => {
                const value = e.target.value.trim().toUpperCase();
                if (/^[A-G]$/.test(value)) {
                  setLevelStyle("alpha");
                  setLevel(value.charCodeAt(0) - 64);
                } else if (/^\d{1,2}$/.test(value)) {
                  setLevelStyle("numeric");
                  setLevel(Math.max(1, Math.min(7, parseInt(value, 10))));
                }
              }}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">1–7 or A–G; 1/A = floor, 2+/B+ above</p>
        </FormItem>
        <FormItem>
          <FormLabel>
            Position
            {nextSuggestion > position && (
              <button
                type="button"
                className="ml-2 text-[10px] text-primary underline-offset-2 hover:underline"
                onClick={() => setPosition(nextSuggestion)}
              >
                next: P{String(nextSuggestion).padStart(2, "0")}
              </button>
            )}
          </FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={9}
              value={position}
              onChange={(e) => setPosition(Math.max(1, Math.min(9, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Left to right within bay</p>
        </FormItem>
        <FormItem>
          <FormLabel>Depth</FormLabel>
          <FormControl>
            <Input
              type="number"
              min={1}
              max={5}
              value={depth}
              onChange={(e) => setDepth(Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 1)))}
            />
          </FormControl>
          <p className="text-[11px] text-muted-foreground">Pallets deep, 1–5</p>
        </FormItem>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-sm",
          isDuplicate
            ? "border-destructive bg-destructive/10 text-destructive"
            : "border-border bg-muted/50 text-foreground",
        )}
      >
        <span className="shrink-0 text-xs text-muted-foreground">Code:</span>
        <span className="flex-1 truncate">{localCode}</span>
        {isDuplicate && <span className="shrink-0 text-xs font-medium text-destructive">already exists</span>}
      </div>
    </div>
  );
}

// The Packaging Profile form body — shared verbatim between the create and edit
// dialogs so both read the same: SKU (with scan) first, then the spoken pack
// code, then the derived fields, then the pallet pack standard.
function PackagingProfileFormFields({
  resource,
  form,
  options,
}: {
  resource: ResourceDefinition;
  form: ReturnType<typeof useForm<Record<string, unknown>>>;
  options: Awaited<ReturnType<typeof fetchOptions>> | undefined;
}) {
  const productRef = useRef<ProductSearchHandle | null>(null);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-4">
      {/* SKU first, then the pack code — the two things someone
          knows standing at a container door. */}
      <FormField
        control={form.control}
        name="product_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              Product<span className="ml-1 text-destructive" aria-hidden="true">*</span>
            </FormLabel>
            <FormControl>
              <div className="flex min-w-0 max-w-full flex-wrap gap-2 sm:flex-nowrap">
                <BarcodeScanButton
                  className="h-9 shrink-0 self-start sm:h-10"
                  title="Scan product"
                  onScan={(value) => {
                    const matched = productRef.current?.scanBarcode(value);
                    if (!matched) toast.warning("No product matched that scan. Search results are open.");
                  }}
                />
                <div className="order-3 min-w-0 max-w-full flex-1 basis-full sm:order-none sm:basis-0">
                  <ProductSearch
                    ref={productRef}
                    value={String(field.value ?? "")}
                    options={(options?.products ?? []).map((product: any) => ({
                      id: String(product.id),
                      sku: String(product.sku ?? ""),
                      name: String(product.name ?? ""),
                      barcode: product.barcode ? String(product.barcode) : undefined,
                      packStatus: product.hasProfile ? "saved" as const : "none" as const,
                    }))}
                    placeholder="Select SKU"
                    onChange={field.onChange}
                  />
                </div>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <PackagingProfileQuickStart form={form} />
      {resource.fields
        .filter((field) => !PACK_SECTION_FIELDS.has(field.name) && field.name !== "product_id")
        .map((field) => renderField(field, form, getResourceFieldOptions(field, options)))}
      <div className="border-t border-border pt-4">
        <PackStandardFormSection form={form} />
      </div>
      </div>
      <div className="lg:sticky lg:top-0 lg:self-start">
        <PackagingProfilePreview form={form} />
      </div>
    </div>
  );
}

/**
 * Live isometric preview of the pallet the dialog is currently describing.
 * Reads the same form state `PackStandardFormSection` writes, so it moves as
 * the cases-per-layer and layers fields change and shows what will be saved.
 */
function PackagingProfilePreview({
  form,
}: {
  form: ReturnType<typeof useForm<Record<string, unknown>>>;
}) {
  const values = form.watch();
  const draft = useMemo(
    () => packStandardDraftFromProfile(values as Record<string, unknown>),
    [values],
  );
  const perLayer = draft.packagesPerLayer ?? 0;
  const layers = draft.layersPerPallet ?? 0;
  const perPallet = perLayer * layers;
  const packCode = formatPackCode({
    packages_per_layer: draft.packagesPerLayer,
    layers_per_pallet: draft.layersPerPallet,
  });

  return (
    <div className="grid content-start gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {packCode ? `${packCode} · ${perPallet} case${perPallet === 1 ? "" : "s"} per pallet` : "Pallet preview"}
      </p>
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
        className="max-h-[16rem] sm:max-h-[20rem]"
      />
      <p className="text-xs text-muted-foreground">
        Updates as you set cases per layer, layers, and carton height.
      </p>
    </div>
  );
}

export function ResourceFormDialog({
  resource,
  trigger,
}: {
  resource: ResourceDefinition;
  trigger?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const isZones = resource.table === "zones";
  const isLocations = resource.table === "locations";
  const isPackagingProfiles = resource.table === "product_packaging_profiles";
  const [locationDefaultsOpen, setLocationDefaultsOpen] = useState(false);
  const { data: options } = useQuery({
    queryKey: isPackagingProfiles
      // Same source data, different result shape from the designer's query, so
      // it must not share that cache entry — otherwise the designer reads an
      // empty profile list and calls saved SKUs "not created yet".
      ? [...PRODUCT_PACK_OPTIONS_KEY, "resource-form"]
      : ["options", resource.table, restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: async () => {
      if (isPackagingProfiles) {
        const packOptions = await fetchProductPackOptions();
        return {
          warehouses: packOptions.warehouses,
          zones: [],
          locations: [],
          clients: [],
          products: packOptions.products,
          packagingProfiles: packOptions.profiles,
          pallets: [],
          profiles: [],
          roles: [],
          userRoles: [],
          permissionFeatures: [],
          rolePermissions: [],
          loadErrors: [],
        };
      }
      return isLocations
        ? fetchLocationCreationOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id })
        : fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id });
    },
  });
  // Fields controlled by the location code builder — hidden from the generic loop
  const builderControlledFields = new Set(["code", "aisle", "bay", "level", "position", "depth", "location_type"]);

  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: resource.fields.reduce<Record<string, unknown>>((accumulator, field) => {
      accumulator[field.name] = defaultFieldValue(field);
      return accumulator;
    }, {}),
  });

  // Auto-select warehouse when only one exists
  useEffect(() => {
    if (options?.warehouses?.length === 1) {
      const onlyId = (options.warehouses[0] as any).id as string;
      const current = form.getValues("warehouse_id");
      if (!current) form.setValue("warehouse_id", onlyId, { shouldDirty: false });
    }
  }, [options?.warehouses, form]);

  // Zone duplicate guard
  const watchedWarehouseId = form.watch("warehouse_id");
  const watchedCode = form.watch("code");
  const watchedName = form.watch("name");
  useEffect(() => {
    if (!isZones) return;
    const existing = (options?.zones ?? []).filter((z: any) => z.warehouse_id === watchedWarehouseId);
    const rawCode = String(watchedCode ?? "").trim().toUpperCase();
    const rawName = String(watchedName ?? "").trim().toLowerCase();
    const codeExists = rawCode.length > 0 && existing.some((z: any) => String(z.code).toUpperCase() === rawCode);
    const nameExists = rawName.length > 0 && existing.some((z: any) => String(z.name).toLowerCase() === rawName);
    if (codeExists) {
      form.setError("code", { type: "manual", message: "Zone code already exists in this warehouse" });
    } else {
      form.clearErrors("code");
    }
    if (nameExists) {
      form.setError("name", { type: "manual", message: "Zone name already exists in this warehouse" });
    } else {
      form.clearErrors("name");
    }
  }, [isZones, watchedWarehouseId, watchedCode, watchedName, options?.zones, form]);

  // Set by "Save and add another": profiles are entered in runs of five or ten
  // off one container, and reopening the dialog each time loses that rhythm.
  const keepOpenAfterSaveRef = useRef(false);
  const createMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => upsertRecord(resource.table, normalizeResourceValues(resource, values, options)),
    onSuccess: () => {
      toast.success(`${resource.singular} saved`);
      queryClient.invalidateQueries({ queryKey: [resource.table] });
      form.reset();
      if (keepOpenAfterSaveRef.current) {
        keepOpenAfterSaveRef.current = false;
        return;
      }
      setOpen(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  function handleCreateSubmit(values: Record<string, unknown>) {
    if (!validateRequiredResourceFields(resource, values, form)) {
      toast.error(`Complete the required fields: ${missingRequiredFieldLabels(resource, values).join(", ")}.`);
      return;
    }
    createMutation.mutate(values);
  }

  const createValues = form.watch();
  const createMissingFields = missingRequiredFieldLabels(resource, createValues);
  const canCreate = createMissingFields.length === 0
    && !(isZones && (!!form.formState.errors.code || !!form.formState.errors.name))
    && !(isLocations && !!form.formState.errors.code);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button>
          <Plus data-icon="inline-start" />
          Add {resource.singular}
        </Button>}
      </DialogTrigger>
      <DialogContent className={cn("flex max-h-[90vh] flex-col overflow-hidden p-0", isPackagingProfiles ? "sm:max-w-6xl" : "sm:max-w-2xl")}>
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>Create {resource.singular}</DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(handleCreateSubmit)}>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4 pr-4">
              {isLocations ? (
                <>
                  {resource.fields
                    .filter((field) => field.name === "warehouse_id" || field.name === "zone_id")
                    .map((field) => renderField(field, form, getResourceFieldOptions(field, options)))}
                  <RackLocationCodeBuilder form={form} options={options} />
                  <Collapsible open={locationDefaultsOpen} onOpenChange={setLocationDefaultsOpen} className="rounded-lg border border-border">
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
                      >
                        <span>
                          <span className="block text-sm font-medium">Defaults & advanced options</span>
                          <span className="block text-xs text-muted-foreground">Ambient, 1 pallet, active — expand only to change these.</span>
                        </span>
                        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", locationDefaultsOpen && "rotate-180")} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-t border-border px-4 py-4">
                      <div className="grid gap-4">
                        {resource.fields
                          .filter((field) => !builderControlledFields.has(field.name) && field.name !== "warehouse_id" && field.name !== "zone_id")
                          .map((field) => renderField(field, form, getResourceFieldOptions(field, options)))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              ) : isPackagingProfiles ? (
                <PackagingProfileFormFields resource={resource} form={form} options={options} />
              ) : (
                resource.fields.map((field) => renderField(field, form, getResourceFieldOptions(field, options)))
              )}
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t bg-card px-6 py-3 sm:justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {createMissingFields.length > 0 ? `Required: ${createMissingFields.join(", ")}` : "All required fields are complete."}
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                {isPackagingProfiles ? (
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={createMutation.isPending || !canCreate}
                    onClick={() => { keepOpenAfterSaveRef.current = true; }}
                  >
                    Save and add another
                  </Button>
                ) : null}
                <Button type="submit" disabled={createMutation.isPending || !canCreate}>
                  {createMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                  Save {resource.singular}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function ResourceEditDialog({
  resource,
  editRecord,
  onClose,
}: {
  resource: ResourceDefinition;
  editRecord: Record<string, unknown>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { roles, profile } = useAuth();
  const restrictedToDefaultWarehouse = shouldRestrictToDefaultWarehouse(roles);
  const isEditPackagingProfiles = resource.table === "product_packaging_profiles";
  const { data: options } = useQuery({
    queryKey: isEditPackagingProfiles
      // Shares the create dialog's result shape, not the designer's, so it uses
      // the same "resource-form" cache entry rather than PRODUCT_PACK_OPTIONS_KEY.
      ? [...PRODUCT_PACK_OPTIONS_KEY, "resource-form"]
      : ["options", resource.table, restrictedToDefaultWarehouse, profile?.default_warehouse_id],
    queryFn: async () => {
      if (isEditPackagingProfiles) {
        const packOptions = await fetchProductPackOptions();
        return {
          warehouses: packOptions.warehouses,
          zones: [],
          locations: [],
          clients: [],
          products: packOptions.products,
          packagingProfiles: packOptions.profiles,
          pallets: [],
          profiles: [],
          roles: [],
          userRoles: [],
          permissionFeatures: [],
          rolePermissions: [],
          loadErrors: [],
        };
      }
      return fetchOptions(false, { restrictToWarehouse: restrictedToDefaultWarehouse, warehouseId: profile?.default_warehouse_id });
    },
  });
  const form = useForm<Record<string, unknown>>({
    resolver: zodResolver(baseFormSchema),
    defaultValues: resource.fields.reduce<Record<string, unknown>>((acc, field) => {
      acc[field.name] = editRecord[field.name] ?? defaultFieldValue(field);
      return acc;
    }, {}),
  });

  // For locations: watch status to show disable-reason notice
  const isLocations = resource.table === "locations";
  const watchedStatus = isLocations ? (form.watch("status") as string | undefined) : undefined;
  const isBeingDisabled = watchedStatus === "disabled" || watchedStatus === "maintenance";
  const wasAlreadyDisabled = isLocations && (editRecord.status === "disabled" || editRecord.status === "maintenance");
  const originalLocationCode = isLocations ? String(editRecord.code ?? "") : "";

  const updateMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      const id = String(editRecord.id ?? "");
      if (!id) throw new Error(`Missing ${resource.singular} id.`);
      return updateRecord(resource.table, id, normalizeResourceValues(resource, values, options, { preserveLocationCode: isLocations }));
    },
    onSuccess: (_updated, values) => {
      toast.success(`${resource.singular} updated`);
      if (isLocations && normalizeScannerText(values.code) !== normalizeScannerText(originalLocationCode)) {
        toast.message("Location code changed", {
          description: "Reprint the location label unless this code change was intentional.",
          duration: 8000,
        });
      }
      queryClient.invalidateQueries({ queryKey: [resource.table] });
      onClose();
    },
    onError: (error) => {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message ?? "")
            : "";
      toast.error(detail || "Update failed");
    },
  });

  function handleSubmit(values: Record<string, unknown>) {
    if (!validateRequiredResourceFields(resource, values, form)) {
      toast.error(`Complete the required fields: ${missingRequiredFieldLabels(resource, values).join(", ")}.`);
      return;
    }
    // Locations: require a reason in Notes when disabling or marking maintenance
    if (isLocations && isBeingDisabled && !values.notes) {
      toast.error("Add a reason in the Notes field before marking this location unavailable.");
      return;
    }
    updateMutation.mutate(values);
  }

  const editValues = form.watch();
  const editMissingFields = missingRequiredFieldLabels(resource, editValues);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={cn("flex max-h-[90vh] flex-col overflow-hidden p-0", isEditPackagingProfiles ? "sm:max-w-6xl" : "sm:max-w-2xl")}>
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit {resource.singular}
          </DialogTitle>
          <DialogDescription>{resource.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={form.handleSubmit(handleSubmit)}>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <div className="flex flex-col gap-4 pr-4">
              {isEditPackagingProfiles ? (
                <PackagingProfileFormFields resource={resource} form={form} options={options} />
              ) : (<>
              {resource.table === "products" && editRecord.id ? (
                <ProductPackStandardNotice productId={String(editRecord.id)} />
              ) : null}
              {resource.fields.map((field) => (
                <div key={field.name}>
                  {renderField(field, form, getResourceFieldOptions(field, options))}
                  {/* Disable-with-reason notice for locations status field */}
                  {isLocations && field.name === "status" && isBeingDisabled && !wasAlreadyDisabled && (
                    <p className="mt-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                      This location will be marked as unavailable. Enter the reason in the Notes field below so operators know the cause and when it can return to service.
                    </p>
                  )}
                  {isLocations && field.name === "status" && watchedStatus === "active" && wasAlreadyDisabled && (
                    <p className="mt-1.5 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400">
                      Re-enabling this location will make it available for putaway and picking. Update the Notes field to record the clearance if needed.
                    </p>
                  )}
                </div>
              ))}
              </>)}
              </div>
            </div>
            <DialogFooter className="shrink-0 border-t bg-card px-6 py-3 sm:justify-between">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {editMissingFields.length > 0 ? `Required: ${editMissingFields.join(", ")}` : "All required fields are complete."}
              </p>
              <Button type="submit" disabled={updateMutation.isPending || editMissingFields.length > 0}>
                {updateMutation.isPending ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export function defaultFieldValue(field: FieldDefinition) {
  if (field.type === "boolean") return field.name === "active" || field.name === "lot_tracked";
  if (field.name === "variance_value_floor") return 500;
  if (field.name === "supervisor_approval_cap") return 1000;
  if (field.name === "freeze_default_hours") return 4;
  if (field.name === "max_pallets") return 1;
  // Pack-standard column defaults. pallet_base_height_mm and
  // slip_sheet_height_mm must never reach the database as null: the generated
  // standard_height_mm is base + layers * (height + slip), so one null makes
  // the whole expression null. The standard then exists with no height and
  // every clearance check silently passes.
  if (field.name === "pallet_base_height_mm") return 145;
  if (field.name === "slip_sheet_height_mm") return 0;
  if (field.name === "max_stack_pallets") return 1;
  if (field.name === "quantity_tolerance") return 0;
  if (field.name === "pallet_footprint_length_mm") return 1200;
  if (field.name === "pallet_footprint_width_mm") return 1000;
  if (field.name === "layer_pattern") return "block";
  if (["minimum_stock_level", "maximum_stock_level", "pick_down_to_level", "supplier_lead_time_days"].includes(field.name)) return 0;
  if (field.type === "number") return "";
  if (field.name === "temperature_class" || field.name === "temperature_requirement") return "ambient";
  if (field.name === "rotation_method") return "fifo";
  if (field.name === "status") return "active";
  return "";
}

export function composeLocationCode(
  options: Awaited<ReturnType<typeof fetchOptions>> | undefined,
  warehouseId: unknown,
  zoneId: unknown,
  localCode: unknown,
) {
  const rawCode = String(localCode ?? "").trim();
  void options;
  void warehouseId;
  void zoneId;
  return rawCode;
}

export function normalizeResourceValues(
  resource: ResourceDefinition,
  values: Record<string, unknown>,
  options?: Awaited<ReturnType<typeof fetchOptions>>,
  behavior?: { preserveLocationCode?: boolean },
) {
  const payload = resource.fields.reduce<Record<string, unknown>>((current, field) => {
    const value = values[field.name];
    if (value === "") {
      current[field.name] = field.required ? value : null;
      return current;
    }
    current[field.name] = field.type === "number" && value != null ? Number(value) : value;
    return current;
  }, {});
  if (resource.table === "locations" && !behavior?.preserveLocationCode) {
    payload.code = composeLocationCode(options, payload.warehouse_id, payload.zone_id, payload.code);
    if (values.level_style === "alpha" || values.level_style === "numeric") {
      payload.level_style = values.level_style;
    }
  }
  return payload;
}

export function getResourceFieldOptions(field: FieldDefinition, options?: Awaited<ReturnType<typeof fetchOptions>>) {
  if (field.options) return field.options;
  if (field.name === "warehouse_id") return (options?.warehouses ?? []).map((warehouse: any) => ({ label: `${warehouse.code} - ${warehouse.name}`, value: warehouse.id }));
  if (field.name === "zone_id") return (options?.zones ?? []).map((zone: any) => ({ label: `${zone.code} - ${zone.name}`, value: zone.id }));
  if (field.name === "client_owner_id") return (options?.clients ?? []).map((client: any) => ({ label: client.name, value: client.id }));
  if (field.name === "product_id") return (options?.products ?? []).map((product: any) => ({ label: `${product.sku} - ${product.name}`, value: product.id }));
  return [];
}

function shouldUppercaseField(name: string) {
  const lower = name.toLowerCase();
  return (
    lower === "code" ||
    lower === "sku" ||
    lower.includes("barcode") ||
    lower.includes("container") ||
    lower.includes("po_number") ||
    lower.includes("order_number") ||
    lower.includes("reference_number") ||
    lower.includes("location")
  );
}
