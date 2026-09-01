import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Package, PackageX, Truck } from "lucide-react";
import { z } from "zod";

import { useTenantPath } from "@/hooks/use-tenant-path";
import {
  createTransferFlow,
  dispatchTransfer,
  fetchOptions,
  formatDate,
  formatNumber,
  listTransfers,
  receiveTransfer,
  transferSchema,
  cancelTransfer,
} from "@/lib/wms-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SelectField,
  TextField,
  statusBadgeVariant,
  alertToast,
} from "@/features/shared/ui-shared";

type TransferProduct = { name?: string | null; sku?: string | null };
type TransferPallet = {
  id: string;
  pallet_barcode?: string | null;
  pallet_code?: string | null;
  status: string;
  current_warehouse_id?: string | null;
  is_stored?: boolean | null;
  current_location_id?: string | null;
};
type TransferLine = {
  id: string;
  quantity?: number | null;
  pallet_id?: string | null;
  pallets?: { pallet_barcode?: string | null; products?: TransferProduct | null } | null;
};
type TransferRow = {
  id: string;
  status: string;
  transfer_number?: string | null;
  notes?: string | null;
  dispatch_signed_off_at?: string | null;
  transfer_lines?: TransferLine[] | null;
};

export function TransfersPage() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const { data: options } = useQuery({ queryKey: ["options"], queryFn: () => fetchOptions() });
  const { data: transfers = [] } = useQuery({ queryKey: ["transfers"], queryFn: listTransfers });
  const [signoffCodes, setSignoffCodes] = useState<Record<string, string>>({});
  // Per-transfer cancel panel state
  const [cancelState, setCancelState] = useState<Record<string, { open: boolean; reason: string }>>({});
  const form = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
  });

  const sourceWarehouseId = form.watch("source_warehouse_id");

  const inFlightPalletIds = useMemo(() => {
    const ids = new Set<string>();
    const transferRows = (transfers ?? []) as TransferRow[];
    for (const t of transferRows) {
      if (t.status === "completed" || t.status === "cancelled") continue;
      for (const line of (t.transfer_lines ?? [])) {
        if (line.pallet_id) ids.add(line.pallet_id);
      }
    }
    return ids;
  }, [transfers]);

  const transferablePallets = useMemo(() => {
    if (!sourceWarehouseId) return [] as TransferPallet[];
    const allowed = new Set(["available", "quarantine", "hold"]);
    const palletRows = (options?.pallets ?? []) as TransferPallet[];
    return palletRows.filter((p) =>
      p.current_warehouse_id === sourceWarehouseId
      && p.is_stored
      && p.current_location_id
      && allowed.has(String(p.status))
      && !inFlightPalletIds.has(p.id),
    );
  }, [options?.pallets, sourceWarehouseId, inFlightPalletIds]);

  const createMutation = useMutation({
    mutationFn: async (values: z.infer<typeof transferSchema>) => createTransferFlow(values),
    onSuccess: async () => {
      alertToast.success("Transfer request created");
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Create transfer failed"),
  });

  const dispatchMutation = useMutation({
    mutationFn: async (transferId: string) => dispatchTransfer(transferId, signoffCodes[transferId] ?? ""),
    onSuccess: async () => {
      alertToast.success("Driver departure signed off — transfer dispatched");
      await queryClient.invalidateQueries({ queryKey: ["transfers"] });
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Transfer dispatch failed"),
  });

  const receiveMutation = useMutation({
    mutationFn: async (transferId: string) => receiveTransfer(transferId),
    onSuccess: async () => {
      alertToast.success("Transfer received — putaway task created", {
        action: { label: "Go to Put-Away", onClick: () => navigate(toPath("/putaway-tasks")) },
        duration: 8000,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transfers"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Transfer receive failed"),
  });

  const cancelMutation = useMutation({
    mutationFn: async ({ transferId, reason }: { transferId: string; reason: string }) =>
      cancelTransfer(transferId, reason),
    onSuccess: async (_data, variables) => {
      setCancelState((s) => ({ ...s, [variables.transferId]: { open: false, reason: "" } }));
      alertToast.attention("Transfer cancelled — stock returned to receiving", {
        action: { label: "Go to Receiving", onClick: () => navigate(toPath("/receiving")) },
        duration: 8000,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["transfers"] }),
        queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
      ]);
    },
    onError: (error) => alertToast.noGo(error instanceof Error ? error.message : "Cancel failed"),
  });

  const transferRows = (transfers ?? []) as TransferRow[];
  const active = transferRows.filter((t) => !["completed", "cancelled"].includes(t.status));
  const done = transferRows.filter((t) => ["completed", "cancelled"].includes(t.status));

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Create Transfer</CardTitle>
          <CardDescription>Preserve pallet identity, lot data, ownership, and audit history.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
              <SelectField form={form} name="transfer_type" label="Transfer type" options={[
                { label: "Inter-warehouse", value: "inter_warehouse" },
                { label: "Intra-warehouse", value: "intra_warehouse" },
              ]} />
              <SelectField form={form} name="source_warehouse_id" label="Source warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField form={form} name="destination_warehouse_id" label="Destination warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              <SelectField
                form={form}
                name="pallet_id"
                label="Pallet"
                options={transferablePallets.map((pallet) => ({
                  label: `${pallet.pallet_barcode || pallet.pallet_code} · ${pallet.status}`,
                  value: pallet.id,
                }))}
              />
              {sourceWarehouseId && transferablePallets.length === 0 && (
                <p className="text-xs text-muted-foreground">No transferable pallets in this warehouse.</p>
              )}
              {!sourceWarehouseId && (
                <p className="text-xs text-muted-foreground">Select a source warehouse to list available pallets.</p>
              )}
              <TextField form={form} name="quantity" label="Quantity" type="number" />
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button className="w-full sm:w-auto" type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create transfer
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <div className="grid min-w-0 content-start gap-4">
        {active.length === 0 && done.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No transfers yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a transfer to move pallets between warehouses or zones.</p>
          </div>
        )}
        {active.map((transfer) => {
          const lines = transfer.transfer_lines ?? [];
          const cs = cancelState[transfer.id] ?? { open: false, reason: "" };
          const codeEntered = !!(signoffCodes[transfer.id] ?? "").trim();
          return (
            <Card key={transfer.id} className={transfer.status === "exception" ? "border-destructive/60" : ""}>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-mono text-base break-all">{transfer.transfer_number}</span>
                  <Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status}</Badge>
                </CardTitle>
                <CardDescription>
                  {transfer.notes || "Pallet transfer"}
                  {transfer.dispatch_signed_off_at ? ` · departed ${formatDate(transfer.dispatch_signed_off_at)}` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {/* Pallet / product summary */}
                {lines.map((line) => {
                  const product = line.pallets?.products;
                  return (
                    <div key={line.id} className="flex items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2 text-sm">
                      <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{product?.name ?? "—"}</p>
                        {product?.sku && <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>}
                        {line.pallets?.pallet_barcode && (
                          <p className="font-mono text-xs text-muted-foreground">Pallet: {line.pallets.pallet_barcode}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-semibold">Qty {formatNumber(line.quantity)}</span>
                    </div>
                  );
                })}

                {/* Dispatch sign-off */}
                {transfer.status !== "completed" && transfer.status !== "cancelled" && (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <div>
                      <label className="text-sm font-medium" htmlFor={`signoff-${transfer.id}`}>Driver departure code</label>
                      <Input
                        id={`signoff-${transfer.id}`}
                        className="mt-1"
                        placeholder="Scan badge or enter user code"
                        value={signoffCodes[transfer.id] ?? ""}
                        onChange={(event) => setSignoffCodes((current) => ({ ...current, [transfer.id]: event.target.value }))}
                      />
                    </div>
                    <Button
                      className="w-full sm:w-auto"
                      variant="outline"
                      onClick={() => dispatchMutation.mutate(transfer.id)}
                      disabled={!codeEntered || transfer.status === "in_progress"}
                      title={!codeEntered ? "Enter driver code first" : undefined}
                    >
                      Dispatch
                    </Button>
                    <Button
                      className="w-full sm:w-auto"
                      onClick={() => receiveMutation.mutate(transfer.id)}
                      disabled={transfer.status === "queued"}
                      title={transfer.status === "queued" ? "Dispatch before receiving" : undefined}
                    >
                      Receive
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">Departure requires the signed-in driver/admin/manager to scan their badge or enter their user code.</p>

                {/* Cancel / reroute panel */}
                {!["completed", "cancelled"].includes(transfer.status) && !cs.open && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-fit text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setCancelState((s) => ({ ...s, [transfer.id]: { open: true, reason: "" } }))}
                  >
                    <PackageX className="mr-1 h-3.5 w-3.5" />
                    Cancel transfer
                  </Button>
                )}
                {cs.open && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 grid gap-2">
                    <p className="text-sm font-medium text-destructive">Cancel this transfer?</p>
                    <p className="text-xs text-muted-foreground">Stock will be returned to Receiving and a new putaway task created.</p>
                    <Input
                      placeholder="Reason for cancellation (required)"
                      value={cs.reason}
                      onChange={(e) => setCancelState((s) => ({ ...s, [transfer.id]: { ...cs, reason: e.target.value } }))}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!cs.reason.trim() || cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate({ transferId: transfer.id, reason: cs.reason })}
                      >
                        Confirm cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setCancelState((s) => ({ ...s, [transfer.id]: { open: false, reason: "" } }))}
                      >
                        Keep transfer
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {done.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer list-none rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              <span className="group-open:hidden">▶ Show {done.length} completed / cancelled</span>
              <span className="hidden group-open:inline">▼ Hide completed / cancelled</span>
            </summary>
            <div className="mt-2 grid gap-2">
              {done.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm opacity-60">
                  <span className="font-mono text-xs">{t.transfer_number}</span>
                  <Badge variant={statusBadgeVariant(t.status)} className="text-xs">{t.status}</Badge>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
