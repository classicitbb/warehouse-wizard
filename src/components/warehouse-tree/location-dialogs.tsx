// Warehouse structure tree: edit one location, or a range of locations at once.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { type ZoneRow, fetchZoneLocations } from "@/components/warehouse-tree/tree-data";

// The single-location editor is shared with Setup > Bin Locations.
export { EditLocationDialog } from "@/features/shared/edit-location-dialog";

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
                    {["rack","floor","staging","dispatch","quarantine","dock","other"].map((v) => (
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
                    {["active","blocked","maintenance","disabled","pick_face"].map((v) => (
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
