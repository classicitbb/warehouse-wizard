// Warehouse structure tree: edit one location, or a range of locations at once.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { isPartialBatchError, runBatch } from "@/lib/batch-mutation";
import { updateRecord } from "@/lib/wms-core";
import { Textarea } from "@/components/ui/textarea";
import { type LocationRow, type ZoneRow, fetchZoneLocations } from "@/components/warehouse-tree/tree-data";

const locationSchema = z.object({
  code: z.string().min(1, "Required"),
  aisle: z.string().optional(),
  bay: z.string().optional(),
  level: z.coerce.number().nullable().optional(),
  position: z.coerce.number().nullable().optional(),
  depth: z.coerce.number().nullable().optional(),
  location_type: z.string().min(1, "Required"),
  temperature_class: z.string().min(1, "Required"),
  max_pallets: z.coerce.number().min(0),
  pick_sequence: z.coerce.number().nullable().optional(),
  putaway_sequence: z.coerce.number().nullable().optional(),
  mixed_sku_allowed: z.boolean(),
  mixed_lot_allowed: z.boolean(),
  max_height: z.coerce.number().nullable().optional(),
  status: z.string().min(1, "Required"),
  notes: z.string().optional(),
});

type LocationFormValues = z.infer<typeof locationSchema>;

function nullableNumber(value: number | string | null | undefined) {
  return value == null || value === "" ? null : Number(value);
}

export function EditLocationDialog({ location, onClose }: { location: LocationRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<LocationFormValues>({
    resolver: zodResolver(locationSchema),
    defaultValues: {
      code: location.code,
      aisle: location.aisle ?? "",
      bay: location.bay ?? "",
      level: location.level ?? null,
      position: nullableNumber(location.position),
      depth: location.depth ?? null,
      location_type: location.location_type ?? "rack",
      temperature_class: location.temperature_class ?? "ambient",
      max_pallets: location.max_pallets ?? 1,
      pick_sequence: location.pick_sequence ?? null,
      putaway_sequence: location.putaway_sequence ?? null,
      mixed_sku_allowed: location.mixed_sku_allowed ?? false,
      mixed_lot_allowed: location.mixed_lot_allowed ?? false,
      max_height: location.max_height ?? null,
      status: location.status ?? "active",
      notes: location.notes ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: (values: LocationFormValues) => updateRecord("locations", location.id, {
      code: values.code,
      aisle: values.aisle || null,
      bay: values.bay || null,
      level: nullableNumber(values.level),
      position: nullableNumber(values.position),
      depth: nullableNumber(values.depth),
      location_type: values.location_type,
      temperature_class: values.temperature_class,
      max_pallets: Number(values.max_pallets),
      pick_sequence: nullableNumber(values.pick_sequence),
      putaway_sequence: nullableNumber(values.putaway_sequence),
      mixed_sku_allowed: values.mixed_sku_allowed,
      mixed_lot_allowed: values.mixed_lot_allowed,
      max_height: nullableNumber(values.max_height),
      status: values.status,
      notes: values.notes || null,
    }),
    onSuccess: () => {
      toast.success("Location updated");
      void queryClient.invalidateQueries({ queryKey: ["tree", "locations", location.zone_id] });
      void queryClient.invalidateQueries({ queryKey: ["locations"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed"),
  });

  function submit(values: LocationFormValues) {
    if ((values.status === "disabled" || values.status === "maintenance") && !values.notes) {
      toast.error("Add a reason in Notes before marking this location unavailable.");
      return;
    }
    mutation.mutate(values);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit Location</DialogTitle>
          <DialogDescription>{location.code}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(submit)} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Aisle</Label><Input {...form.register("aisle")} /></div>
            <div className="grid gap-1.5"><Label>Bay</Label><Input {...form.register("bay")} /></div>
            <div className="grid gap-1.5"><Label>Level</Label><Input type="number" {...form.register("level")} /></div>
            <div className="grid gap-1.5"><Label>Position</Label><Input type="number" {...form.register("position")} /></div>
            <div className="grid gap-1.5"><Label>Depth</Label><Input type="number" {...form.register("depth")} /></div>
            <div className="grid gap-1.5"><Label>Max pallets</Label><Input type="number" {...form.register("max_pallets")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Select value={form.watch("location_type")} onValueChange={(v) => form.setValue("location_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="rack">Rack</SelectItem>
                  <SelectItem value="staging">Staging</SelectItem>
                  <SelectItem value="quarantine">Quarantine</SelectItem>
                  <SelectItem value="dispatch">Dispatch</SelectItem>
                  <SelectItem value="receiving">Receiving</SelectItem>
                  <SelectItem value="floor">Floor</SelectItem>
                  <SelectItem value="returns">Returns</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Temperature</Label>
              <Select value={form.watch("temperature_class")} onValueChange={(v) => form.setValue("temperature_class", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ambient">Ambient</SelectItem>
                  <SelectItem value="cool">Cool</SelectItem>
                  <SelectItem value="frozen">Frozen</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5"><Label>Pick seq</Label><Input type="number" {...form.register("pick_sequence")} /></div>
            <div className="grid gap-1.5"><Label>Put-Away seq</Label><Input type="number" {...form.register("putaway_sequence")} /></div>
            <div className="grid gap-1.5"><Label>Max height (cm)</Label><Input type="number" {...form.register("max_height")} /></div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch id="loc-mixed-sku" checked={form.watch("mixed_sku_allowed")} onCheckedChange={(v) => form.setValue("mixed_sku_allowed", v)} />
              <Label htmlFor="loc-mixed-sku">Mixed SKU</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="loc-mixed-lot" checked={form.watch("mixed_lot_allowed")} onCheckedChange={(v) => form.setValue("mixed_lot_allowed", v)} />
              <Label htmlFor="loc-mixed-lot">Mixed lot</Label>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea rows={3} {...form.register("notes")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditLocationRangeDialog({ zone, onClose }: { zone: ZoneRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["zone-locations", zone.id],
    queryFn: () => fetchZoneLocations(zone.id),
  });

  const prefixes = useMemo(() => {
    const set = new Set<string>();
    for (const l of locations) if (l.aisle) set.add(l.aisle);
    return [...set].sort();
  }, [locations]);

  const [prefix, setPrefix] = useState<string>("__all__");
  const [updateType, setUpdateType] = useState(false);
  const [locationType, setLocationType] = useState<string>("rack");
  const [updateTemp, setUpdateTemp] = useState(false);
  const [temperatureClass, setTemperatureClass] = useState<string>(zone.temperature_class ?? "ambient");
  const [updateStatus, setUpdateStatus] = useState(false);
  const [statusValue, setStatusValue] = useState<string>("active");
  const [updateDepth, setUpdateDepth] = useState(false);
  const [depth, setDepth] = useState<number>(1);
  const [updateMixedSku, setUpdateMixedSku] = useState(false);
  const [mixedSku, setMixedSku] = useState(false);
  const [updateMixedLot, setUpdateMixedLot] = useState(false);
  const [mixedLot, setMixedLot] = useState(false);

  const targets = useMemo(() => {
    if (prefix === "__all__") return locations;
    return locations.filter((l) => (l.aisle ?? "") === prefix);
  }, [locations, prefix]);

  const mutation = useMutation({
    mutationFn: async () => {
      const patch: Record<string, unknown> = {};
      if (updateType) patch.location_type = locationType;
      if (updateTemp) patch.temperature_class = temperatureClass;
      if (updateStatus) patch.status = statusValue;
      if (updateDepth) { patch.depth = depth; patch.max_pallets = depth; }
      if (updateMixedSku) patch.mixed_sku_allowed = mixedSku;
      if (updateMixedLot) patch.mixed_lot_allowed = mixedLot;
      if (Object.keys(patch).length === 0) {
        throw new Error("Select at least one field to update");
      }
      // Row-at-a-time: a failure part-way through leaves earlier locations
      // already patched, so the batch reports the partial write rather than
      // implying nothing changed.
      const updated = await runBatch(targets, (l) => updateRecord("locations", l.id, patch), {
        itemNoun: "location",
      });
      return updated.length;
    },
    onSuccess: (count) => {
      toast.success(`Updated ${count} location${count !== 1 ? "s" : ""}`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Update failed", {
      duration: isPartialBatchError(e) ? 12_000 : undefined,
    }),
    // Runs for partial writes too — those rows really did change.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["zone-locations", zone.id] }),
        queryClient.invalidateQueries({ queryKey: ["locations"] }),
        queryClient.invalidateQueries({ queryKey: ["tree"] }),
      ]);
    },
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Location Range — {zone.name}</DialogTitle>
          <DialogDescription>
            Bulk-update properties for every location in this zone (or a single rack prefix). Codes themselves are not changed.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="grid gap-2"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Rack prefix</Label>
              <Select value={prefix} onValueChange={setPrefix}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All prefixes ({locations.length})</SelectItem>
                  {prefixes.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p} ({locations.filter((l) => l.aisle === p).length})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Will affect <strong>{targets.length}</strong> location{targets.length !== 1 ? "s" : ""}.
              </p>
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-type" checked={updateType} onCheckedChange={setUpdateType} />
                <Label htmlFor="er-type">Change type</Label>
              </div>
              {updateType && (
                <Select value={locationType} onValueChange={setLocationType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["rack","staging","quarantine","dispatch","receiving","floor","returns"].map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-temp" checked={updateTemp} onCheckedChange={setUpdateTemp} />
                <Label htmlFor="er-temp">Change temperature class</Label>
              </div>
              {updateTemp && (
                <Select value={temperatureClass} onValueChange={setTemperatureClass}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ambient">Ambient</SelectItem>
                    <SelectItem value="cool">Cool</SelectItem>
                    <SelectItem value="frozen">Frozen</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-status" checked={updateStatus} onCheckedChange={setUpdateStatus} />
                <Label htmlFor="er-status">Change status</Label>
              </div>
              {updateStatus && (
                <Select value={statusValue} onValueChange={setStatusValue}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["active","blocked","maintenance","disabled"].map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <Switch id="er-depth" checked={updateDepth} onCheckedChange={setUpdateDepth} />
                <Label htmlFor="er-depth">Change depth / capacity (1–5)</Label>
              </div>
              {updateDepth && (
                <Input type="number" min={1} max={5} value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
              )}
            </div>

            <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <Switch id="er-msku" checked={updateMixedSku} onCheckedChange={setUpdateMixedSku} />
                <Label htmlFor="er-msku">Set mixed SKU</Label>
                {updateMixedSku && (
                  <Switch aria-label="Mixed SKU value" checked={mixedSku} onCheckedChange={setMixedSku} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch id="er-mlot" checked={updateMixedLot} onCheckedChange={setUpdateMixedLot} />
                <Label htmlFor="er-mlot">Set mixed lot</Label>
                {updateMixedLot && (
                  <Switch aria-label="Mixed lot value" checked={mixedLot} onCheckedChange={setMixedLot} />
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || targets.length === 0}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Apply to {targets.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
