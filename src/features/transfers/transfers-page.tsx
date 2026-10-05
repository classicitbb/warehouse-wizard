import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Loader2, Package, PackageX, Plus, Search, Truck } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SelectField, TextField, statusBadgeVariant } from "@/features/shared/ui-shared";
import { alertToast } from "@/lib/floor-feedback";

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
  transfer_type?: string | null;
  source_warehouse_id?: string | null;
  destination_warehouse_id?: string | null;
  created_at?: string | null;
  received_at?: string | null;
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
  const [createOpen, setCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
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
      setCreateOpen(false);
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
  const warehouseNames = useMemo(
    () => new Map((options?.warehouses ?? []).map((warehouse) => [warehouse.id, warehouse.name])),
    [options?.warehouses],
  );
  const query = search.trim().toLowerCase();
  const visibleTransfers = transferRows.filter((transfer) => {
    if (statusFilter === "active" && ["completed", "cancelled"].includes(transfer.status)) return false;
    if (statusFilter === "completed" && transfer.status !== "completed") return false;
    if (statusFilter === "cancelled" && transfer.status !== "cancelled") return false;
    if (!query) return true;
    const lineValues = (transfer.transfer_lines ?? []).flatMap((line) => [
      line.pallets?.pallet_barcode,
      line.pallets?.products?.sku,
      line.pallets?.products?.name,
    ]);
    return [
      transfer.transfer_number,
      transfer.status,
      transfer.notes,
      warehouseNames.get(transfer.source_warehouse_id ?? ""),
      warehouseNames.get(transfer.destination_warehouse_id ?? ""),
      ...lineValues,
    ].some((value) => String(value ?? "").toLowerCase().includes(query));
  });

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Transfers</h2>
          <p className="text-sm text-muted-foreground">Dispatch and receive pallets with identity, sign-off, and audit history intact.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus data-icon="inline-start" />New transfer</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-l-4 border-l-warning"><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Awaiting dispatch</p><p className="mt-1 font-mono text-2xl font-bold">{active.filter((row) => row.status === "queued").length}</p></CardContent></Card>
        <Card className="border-l-4 border-l-primary"><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">In transit</p><p className="mt-1 font-mono text-2xl font-bold">{active.filter((row) => row.status === "in_progress").length}</p></CardContent></Card>
        <Card className="border-l-4 border-l-success"><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">Completed</p><p className="mt-1 font-mono text-2xl font-bold">{done.filter((row) => row.status === "completed").length}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search transfer, pallet, SKU, or warehouse" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active transfers</SelectItem>
              <SelectItem value="all">All transfers</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid min-w-0 content-start gap-3">
        {visibleTransfers.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Truck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No matching transfers</p>
            <p className="mt-1 text-sm text-muted-foreground">Change the filter or create a new transfer.</p>
          </div>
        )}
        {visibleTransfers.map((transfer) => {
          const lines = transfer.transfer_lines ?? [];
          const cs = cancelState[transfer.id] ?? { open: false, reason: "" };
          const codeEntered = !!(signoffCodes[transfer.id] ?? "").trim();
          const sourceName = warehouseNames.get(transfer.source_warehouse_id ?? "") ?? "Source warehouse";
          const destinationName = warehouseNames.get(transfer.destination_warehouse_id ?? "") ?? "Destination warehouse";
          const isClosed = ["completed", "cancelled"].includes(transfer.status);
          return (
            <Card key={transfer.id} className={transfer.status === "exception" ? "border-l-4 border-l-destructive" : "border-l-4 border-l-primary"}>
              <CardHeader className="pb-3">
                <CardTitle className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0 font-mono text-base break-all">{transfer.transfer_number}</span>
                  <Badge variant={statusBadgeVariant(transfer.status)}>{transfer.status}</Badge>
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                  <span>{sourceName}</span><ArrowRight className="h-4 w-4 text-muted-foreground" /><span>{destinationName}</span>
                </div>
                <CardDescription>{transfer.notes || (transfer.transfer_type === "inter_warehouse" ? "Inter-warehouse transfer" : "Warehouse transfer")}{transfer.dispatch_signed_off_at ? ` · departed ${formatDate(transfer.dispatch_signed_off_at)}` : transfer.created_at ? ` · created ${formatDate(transfer.created_at)}` : ""}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs">
                  <span className="font-semibold uppercase text-muted-foreground">NetSuite</span>
                  <span className="text-muted-foreground">No transfer-order reference linked</span>
                  <Badge variant="outline">Local workflow</Badge>
                </div>
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
                {!isClosed && (
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
                {!isClosed ? <p className="text-xs text-muted-foreground">Departure requires the signed-in driver, admin, or manager to scan their badge or enter their user code.</p> : null}

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
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New transfer</DialogTitle>
            <DialogDescription>Create the local pallet movement. A NetSuite transfer-order reference can be linked when synchronization is released.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField form={form} name="transfer_type" label="Transfer type" options={[{ label: "Inter-warehouse", value: "inter_warehouse" }, { label: "Intra-warehouse", value: "intra_warehouse" }]} />
                <TextField form={form} name="quantity" label="Quantity" type="number" />
                <SelectField form={form} name="source_warehouse_id" label="Source warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
                <SelectField form={form} name="destination_warehouse_id" label="Destination warehouse" options={(options?.warehouses ?? []).map((warehouse) => ({ label: warehouse.name, value: warehouse.id }))} />
              </div>
              <SelectField form={form} name="pallet_id" label="Pallet" options={transferablePallets.map((pallet) => ({ label: `${pallet.pallet_barcode || pallet.pallet_code} · ${pallet.status}`, value: pallet.id }))} />
              <p className="text-xs text-muted-foreground">{sourceWarehouseId ? (transferablePallets.length === 0 ? "No transferable pallets in this warehouse." : `${transferablePallets.length} stored pallet${transferablePallets.length === 1 ? "" : "s"} available.`) : "Select a source warehouse to list available pallets."}</p>
              <FormField control={form.control} name="notes" render={({ field }) => <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea {...field} value={field.value ?? ""} /></FormControl></FormItem>} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Create transfer</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
