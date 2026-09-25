// Warehouse structure tree: add/edit warehouse and zone, and confirm-delete dialogs.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Switch } from "@/components/ui/switch";
import { type CascadeDeleteResult, upsertRecord } from "@/lib/wms-core";
import { type WarehouseRow, type ZoneRow } from "@/components/warehouse-tree/tree-data";

// ─── Form dialogs ─────────────────────────────────────────────────────────────

const warehouseSchema = z.object({
  code: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  city: z.string().optional(),
  country: z.string().optional(),
  has_cool_zone: z.boolean().optional(),
  active: z.boolean().optional(),
});

type WarehouseFormValues = z.infer<typeof warehouseSchema>;

export function AddEditWarehouseDialog({ warehouse, onClose }: { warehouse?: WarehouseRow; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
    defaultValues: {
      code: warehouse?.code ?? "",
      name: warehouse?.name ?? "",
      city: warehouse?.city ?? "",
      country: warehouse?.country ?? "",
      has_cool_zone: warehouse?.has_cool_zone ?? false,
      active: warehouse?.active !== false,
    },
  });
  const mutation = useMutation({
    mutationFn: (v: WarehouseFormValues) => upsertRecord("warehouses", { ...(warehouse ? { id: warehouse.id } : {}), ...v }),
    onSuccess: () => {
      toast.success(warehouse ? "Warehouse updated" : "Warehouse created");
      void queryClient.invalidateQueries({ queryKey: ["tree", "warehouses"] });
      void queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      void queryClient.invalidateQueries({ queryKey: ["options", "floor"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{warehouse ? "Edit Warehouse" : "Add Warehouse"}</DialogTitle>
          <DialogDescription>
            {warehouse ? "Update warehouse details and availability." : "Create a warehouse record for zones and locations."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>City</Label>
              <Input {...form.register("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label>Country</Label>
              <Input {...form.register("country")} />
            </div>
          </div>
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Switch id="wh-cool" checked={form.watch("has_cool_zone") ?? false} onCheckedChange={(v) => form.setValue("has_cool_zone", v)} />
              <Label htmlFor="wh-cool">Has cool zone</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="wh-active" checked={form.watch("active") ?? true} onCheckedChange={(v) => form.setValue("active", v)} />
              <Label htmlFor="wh-active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {warehouse ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const zoneSchema = z.object({
  code: z.string().min(1, "Required"),
  name: z.string().min(1, "Required"),
  temperature_class: z.string().min(1, "Required"),
  is_staging: z.boolean(),
  is_dispatch: z.boolean(),
  is_quarantine: z.boolean(),
});

type ZoneFormValues = z.infer<typeof zoneSchema>;

export function AddEditZoneDialog({
  warehouseId, warehouseName, zone, onClose,
}: {
  warehouseId: string; warehouseName: string; zone?: ZoneRow; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const form = useForm<ZoneFormValues>({
    resolver: zodResolver(zoneSchema),
    defaultValues: zone
      ? { code: zone.code, name: zone.name, temperature_class: zone.temperature_class, is_staging: zone.is_staging ?? false, is_dispatch: zone.is_dispatch ?? false, is_quarantine: zone.is_quarantine ?? false }
      : { code: "", name: "", temperature_class: "ambient", is_staging: false, is_dispatch: false, is_quarantine: false },
  });
  const mutation = useMutation({
    mutationFn: (v: ZoneFormValues) =>
      upsertRecord("zones", { ...(zone ? { id: zone.id } : {}), warehouse_id: warehouseId, ...v }),
    onSuccess: () => {
      toast.success(zone ? "Zone updated" : "Zone created");
      void queryClient.invalidateQueries({ queryKey: ["tree", "zones"] });
      void queryClient.invalidateQueries({ queryKey: ["zones"] });
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{zone ? "Edit Zone" : "Add Zone"}</DialogTitle>
          <DialogDescription>Warehouse: {warehouseName}</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Code *</Label>
              <Input {...form.register("code")} />
              {form.formState.errors.code && <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>}
            </div>
            <div className="grid gap-1.5">
              <Label>Name *</Label>
              <Input {...form.register("name")} />
              {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Temperature</Label>
            <Select value={form.watch("temperature_class")} onValueChange={(v) => form.setValue("temperature_class", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ambient">Ambient</SelectItem>
                <SelectItem value="cool">Cool (2–8 °C)</SelectItem>
                <SelectItem value="frozen">Frozen (−20 °C)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-6">
            {(["is_staging", "is_dispatch", "is_quarantine"] as const).map((field) => (
              <div key={field} className="flex items-center gap-2">
                <Switch id={`z-${field}`} checked={form.watch(field)} onCheckedChange={(v) => form.setValue(field, v)} />
                <Label htmlFor={`z-${field}`}>
                  {field === "is_staging" ? "Staging" : field === "is_dispatch" ? "Dispatch" : "Quarantine"}
                </Label>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {zone ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDeleteDialog({
  label, deleteFn, onClose,
}: {
  label: string;
  deleteFn: () => Promise<CascadeDeleteResult>;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [blockers, setBlockers] = useState<Array<{ table: string; count: number }> | null>(null);
  const mutation = useMutation({
    mutationFn: deleteFn,
    onSuccess: async (result) => {
      if (result.ok) {
        toast.success("Deleted");
        await queryClient.invalidateQueries({ queryKey: ["tree"] });
        await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
        await queryClient.invalidateQueries({ queryKey: ["zones"] });
        await queryClient.invalidateQueries({ queryKey: ["locations"] });
        onClose();
      } else {
        setBlockers(result.blocked_by);
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !mutation.isPending) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>This action cannot be undone. All child records will be permanently deleted.</DialogDescription>
        </DialogHeader>
        {blockers && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <p className="mb-1 font-medium">Cannot delete — records still reference this:</p>
            <ul className="list-disc pl-4">
              {blockers.map((b) => (
                <li key={b.table}>{b.count} record{b.count !== 1 ? "s" : ""} in {b.table}</li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          {!blockers && (
            <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}Delete
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
