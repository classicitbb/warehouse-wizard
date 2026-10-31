// Edit one bin location. Shared by Warehouse Structure (tree) and Setup >
// Bin Locations, so both pages edit a bin the same way. The status is the
// first choice: each status says what it does to put-away and picking, an
// unavailable status needs a reason, and the bin's stock is shown so nobody
// takes a full bin out of service without seeing it.
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Loader2, MapPin, Package } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { updateRecord } from "@/lib/wms-core";
import { normalizeScannerText } from "@/lib/scan-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type LocationStatus = "active" | "pick_face" | "disabled" | "blocked" | "maintenance";

export const LOCATION_STATUSES: { value: LocationStatus; label: string; help: string; tone: string }[] = [
  { value: "active", label: "Active", help: "Bulk storage. Put-away, moves and picks use it.", tone: "border-emerald-500 text-emerald-700 dark:text-emerald-400" },
  { value: "pick_face", label: "Pick face", help: "Forward pick. Put-away skips it; only Replenishment fills it. Its SKU comes with the pallet.", tone: "border-sky-500 text-sky-700 dark:text-sky-400" },
  { value: "disabled", label: "Disabled", help: "Out of use. Nothing goes in or comes out.", tone: "border-destructive text-destructive" },
  { value: "blocked", label: "Blocked", help: "Blocked for now, for example by an obstruction.", tone: "border-destructive text-destructive" },
  { value: "maintenance", label: "Maintenance", help: "Under repair. Returns to service when the work is done.", tone: "border-amber-500 text-amber-700 dark:text-amber-400" },
];

const UNAVAILABLE: string[] = ["disabled", "blocked", "maintenance"];

const LOCATION_TYPES = [
  { value: "rack", label: "Rack" },
  { value: "floor", label: "Floor" },
  { value: "staging", label: "Staging" },
  { value: "dispatch", label: "Dispatch" },
  { value: "quarantine", label: "Quarantine" },
  { value: "dock", label: "Dock" },
  { value: "other", label: "Other" },
];

const TEMPERATURE_CLASSES = [
  { value: "ambient", label: "Ambient" },
  { value: "cool", label: "Cool" },
  { value: "frozen", label: "Frozen" },
];

/** The columns this dialog reads; a tree row or a Bin Locations row both fit. */
export type EditableLocation = {
  id: string;
  code: string;
  warehouse_id?: string | null;
  zone_id?: string | null;
  aisle?: string | null;
  bay?: string | null;
  level?: number | null;
  position?: string | number | null;
  depth?: number | null;
  location_type?: string | null;
  temperature_class?: string | null;
  max_pallets?: number | null;
  pick_sequence?: number | null;
  putaway_sequence?: number | null;
  mixed_sku_allowed?: boolean | null;
  mixed_lot_allowed?: boolean | null;
  max_height?: number | null;
  status?: string | null;
  notes?: string | null;
};

const optionalNumber = z.preprocess((value) => (value === "" || value == null ? null : Number(value)), z.number().nullable());

const locationSchema = z
  .object({
    code: z.string().trim().min(1, "Enter the code"),
    zone_id: z.string().nullable(),
    status: z.string().min(1),
    aisle: z.string(),
    bay: z.string(),
    level: optionalNumber,
    position: optionalNumber,
    depth: optionalNumber,
    location_type: z.string().min(1),
    temperature_class: z.string().min(1),
    max_pallets: z.coerce.number().int("Whole pallets only").min(0, "0 or more"),
    max_height: optionalNumber,
    pick_sequence: optionalNumber,
    putaway_sequence: optionalNumber,
    mixed_sku_allowed: z.boolean(),
    mixed_lot_allowed: z.boolean(),
    notes: z.string(),
  })
  .refine((values) => !UNAVAILABLE.includes(values.status) || values.notes.trim().length > 0, {
    path: ["notes"],
    message: "Give the reason, so operators know why and when it returns to service.",
  });

type LocationFormValues = z.infer<typeof locationSchema>;

function toFormValues(location: EditableLocation): LocationFormValues {
  const position = location.position == null || location.position === "" ? null : Number(location.position);
  return {
    code: location.code,
    zone_id: location.zone_id ?? null,
    status: location.status ?? "active",
    aisle: location.aisle ?? "",
    bay: location.bay ?? "",
    level: location.level ?? null,
    position: Number.isFinite(position) ? position : null,
    depth: location.depth ?? null,
    location_type: location.location_type ?? "rack",
    temperature_class: location.temperature_class ?? "ambient",
    max_pallets: location.max_pallets ?? 1,
    max_height: location.max_height ?? null,
    pick_sequence: location.pick_sequence ?? null,
    putaway_sequence: location.putaway_sequence ?? null,
    mixed_sku_allowed: location.mixed_sku_allowed ?? false,
    mixed_lot_allowed: location.mixed_lot_allowed ?? false,
    notes: location.notes ?? "",
  };
}

async function fetchBinContext(location: EditableLocation) {
  const [zones, stock] = await Promise.all([
    location.warehouse_id
      ? supabase.from("zones").select("id, code, name").eq("warehouse_id", location.warehouse_id).order("code")
      : Promise.resolve({ data: [], error: null }),
    (supabase as any)
      .from("inventory_balances")
      .select("pallet_id, quantity, product:products(sku)")
      .eq("location_id", location.id)
      .gt("quantity", 0)
      .not("status", "in", "(shipped,in_transit,missing)")
      .limit(50),
  ]);
  if (zones.error) throw zones.error;
  if (stock.error) throw stock.error;
  const rows = (stock.data ?? []) as Array<{ pallet_id: string | null; quantity: number; product: { sku: string } | null }>;
  return {
    zones: (zones.data ?? []) as Array<{ id: string; code: string; name: string }>,
    pallets: new Set(rows.map((row) => row.pallet_id).filter(Boolean)).size,
    skus: [...new Set(rows.map((row) => row.product?.sku).filter(Boolean))] as string[],
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, error, children, className }: { label: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-xs">{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

export function EditLocationDialog({ location, onClose }: { location: EditableLocation; onClose: () => void }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => toFormValues(location), [location]);
  const form = useForm<LocationFormValues>({ resolver: zodResolver(locationSchema), defaultValues: initial });
  const { data: context } = useQuery({
    queryKey: ["edit-location-context", location.id],
    queryFn: () => fetchBinContext(location),
  });

  const status = form.watch("status");
  const statusInfo = LOCATION_STATUSES.find((s) => s.value === status);
  const wasUnavailable = UNAVAILABLE.includes(initial.status);
  const goingUnavailable = UNAVAILABLE.includes(status) && !wasUnavailable;
  const pallets = context?.pallets ?? 0;
  const maxPallets = Number(form.watch("max_pallets") ?? 0);
  const errors = form.formState.errors;

  const setStatus = (value: LocationStatus) => {
    form.setValue("status", value, { shouldDirty: true });
    // A pick face holds pallets of more than one SKU (§10 F2).
    if (value === "pick_face") form.setValue("mixed_sku_allowed", true, { shouldDirty: true });
  };

  const mutation = useMutation({
    mutationFn: (values: LocationFormValues) =>
      updateRecord("locations", location.id, {
        code: values.code.trim().toUpperCase(),
        zone_id: values.zone_id,
        status: values.status,
        aisle: values.aisle.trim() || null,
        bay: values.bay.trim() || null,
        level: values.level,
        position: values.position,
        depth: values.depth,
        location_type: values.location_type,
        temperature_class: values.temperature_class,
        max_pallets: values.max_pallets,
        max_height: values.max_height,
        pick_sequence: values.pick_sequence,
        putaway_sequence: values.putaway_sequence,
        mixed_sku_allowed: values.mixed_sku_allowed,
        mixed_lot_allowed: values.mixed_lot_allowed,
        notes: values.notes.trim() || null,
      }),
    onSuccess: (_updated, values) => {
      toast.success(`Location ${values.code.trim().toUpperCase()} saved`);
      if (normalizeScannerText(values.code) !== normalizeScannerText(location.code)) {
        toast.message("Location code changed", { description: "Reprint the bay label so scans match the new code.", duration: 8000 });
      }
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      void queryClient.invalidateQueries({ queryKey: ["tree"] });
      void queryClient.invalidateQueries({ queryKey: ["zone-locations"] });
      void queryClient.invalidateQueries({ queryKey: ["replenishment"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  const zoneLabel = context?.zones.find((z) => z.id === initial.zone_id);

  return (
    <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            <span className="font-mono">{location.code}</span>
            {statusInfo ? <Badge variant="outline" className={cn("px-1.5 py-0 text-[11px]", statusInfo.tone)}>{statusInfo.label}</Badge> : null}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {zoneLabel ? <span>Zone {zoneLabel.code}</span> : null}
            <span className="flex items-center gap-1">
              <Package className="h-3.5 w-3.5" />
              {context == null
                ? "Checking stock…"
                : pallets === 0
                  ? "Empty"
                  : `${pallets} of ${maxPallets || "?"} pallet places used${context.skus.length ? ` · ${context.skus.slice(0, 3).join(", ")}${context.skus.length > 3 ? ` +${context.skus.length - 3}` : ""}` : ""}`}
            </span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4">
            <div className="grid gap-2">
              <Label className="text-xs">Status</Label>
              <div role="radiogroup" aria-label="Status" className="flex flex-wrap gap-1.5">
                {LOCATION_STATUSES.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={status === option.value}
                    size="sm"
                    variant={status === option.value ? "default" : "outline"}
                    className="h-8 px-3 text-xs"
                    onClick={() => setStatus(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {statusInfo ? <p className="text-xs text-muted-foreground">{statusInfo.help}</p> : null}
              {goingUnavailable && pallets > 0 ? (
                <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {pallets} pallet{pallets === 1 ? " is" : "s are"} still in this bin. Move {pallets === 1 ? "it" : "them"} out first, or the stock is held in a bin nobody can pick from.
                </p>
              ) : null}
              {status === "active" && wasUnavailable ? (
                <p className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-700 dark:bg-green-950/40 dark:text-green-400">
                  The bin comes back into service for put-away and picking. Update the notes to record the clearance.
                </p>
              ) : null}
            </div>

            <Section title="Place">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Code *" error={errors.code?.message}>
                  <Input className="font-mono uppercase" {...form.register("code")} />
                </Field>
                <Field label="Zone">
                  <Select value={form.watch("zone_id") ?? ""} onValueChange={(v) => form.setValue("zone_id", v, { shouldDirty: true })}>
                    <SelectTrigger><SelectValue placeholder="Choose a zone" /></SelectTrigger>
                    <SelectContent>
                      {(context?.zones ?? []).map((z) => <SelectItem key={z.id} value={z.id}>{z.code} · {z.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="Aisle"><Input {...form.register("aisle")} /></Field>
                <Field label="Bay"><Input {...form.register("bay")} /></Field>
                <Field label="Level"><Input type="number" {...form.register("level")} /></Field>
                <Field label="Position"><Input type="number" {...form.register("position")} /></Field>
                <Field label="Depth"><Input type="number" {...form.register("depth")} /></Field>
              </div>
            </Section>

            <Section title="Capacity and storage">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Max pallets" error={errors.max_pallets?.message}><Input type="number" min={0} {...form.register("max_pallets")} /></Field>
                <Field label="Max height (cm)"><Input type="number" placeholder="No limit" {...form.register("max_height")} /></Field>
                <Field label="Type">
                  <Select value={form.watch("location_type")} onValueChange={(v) => form.setValue("location_type", v, { shouldDirty: true })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{LOCATION_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                <Field label="Temperature">
                  <Select value={form.watch("temperature_class")} onValueChange={(v) => form.setValue("temperature_class", v, { shouldDirty: true })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TEMPERATURE_CLASSES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.watch("mixed_sku_allowed")} onCheckedChange={(v) => form.setValue("mixed_sku_allowed", v, { shouldDirty: true })} />
                  Mixed SKU
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={form.watch("mixed_lot_allowed")} onCheckedChange={(v) => form.setValue("mixed_lot_allowed", v, { shouldDirty: true })} />
                  Mixed lot
                </label>
              </div>
            </Section>

            <Section title="Sequence">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Pick sequence"><Input type="number" {...form.register("pick_sequence")} /></Field>
                <Field label="Put-away sequence"><Input type="number" {...form.register("putaway_sequence")} /></Field>
              </div>
            </Section>

            <Field label={UNAVAILABLE.includes(status) ? "Reason *" : "Notes"} error={errors.notes?.message}>
              <Textarea
                rows={3}
                placeholder={UNAVAILABLE.includes(status) ? "Why is the bin out of service, and when does it come back?" : "Special constraints, beam clearance…"}
                {...form.register("notes")}
              />
            </Field>
          </div>

          <DialogFooter className="shrink-0 border-t px-6 py-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
