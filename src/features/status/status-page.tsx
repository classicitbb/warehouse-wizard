import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { normalizePalletBarcode } from "@/lib/code-input";

import { useInfiniteRows } from "@/hooks/use-infinite-rows";
import {
  changePalletStatus,
  downloadCsv,
  formatDate,
  formatNumber,
  getDashboardMetrics,
  getReportData,
  listStatusPallets,
  recoverMissingPalletToDraft,
  recoverMissingPalletToPutaway,
  statusChangeSchema,
} from "@/lib/wms-core";
import { BarcodeScanButton } from "@/components/barcode-scan-button";

import { cn } from "@/lib/utils";
import {
  buildCsvReportRows,
  buildEnterpriseDashboard,
} from "@/lib/enterprise-wms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import {
  SelectField,
  WarehouseBrainPanel,
  toneBorder,
} from "@/features/shared/ui-shared";

type StatusStockRow = {
  inventory_balance_id: string;
  pallet_code?: string | null;
  sku?: string | null;
  status: string;
  location_code?: string | null;
};

type ReportOccupancyRow = {
  location_id: string;
  location_code?: string | null;
  temperature_class?: string | null;
  is_full?: boolean | null;
  occupied_pallets?: number | null;
  max_pallets?: number | null;
};

type ReportAuditRow = {
  id: string;
  event_type?: string | null;
  created_at?: string | null;
  entity_table?: string | null;
  entity_id?: string | null;
};

export function StatusPage() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["status-pallets"], queryFn: listStatusPallets });
  // A missing pallet that has turned up with no location to go back to.
  const [foundPallet, setFoundPallet] = useState<StatusStockRow | null>(null);
  const form = useForm<z.infer<typeof statusChangeSchema>>({
    resolver: zodResolver(statusChangeSchema),
  });
  const mutation = useMutation({
    mutationFn: changePalletStatus,
    onSuccess: async () => {
      toast.success("Status updated");
      form.reset();
      await queryClient.invalidateQueries({ queryKey: ["status-pallets"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Status update failed"),
  });

  async function refreshAfterRecovery() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["status-pallets"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["draft-receipts"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
    ]);
  }

  const foundToPutawayMutation = useMutation({
    mutationFn: () => recoverMissingPalletToPutaway(foundPallet?.inventory_balance_id ?? ""),
    onSuccess: async (result) => {
      setFoundPallet(null);
      await refreshAfterRecovery();
      toast.success(`${result.palletBarcode} keeps its number and is queued for Put-Away as ${result.putawayTaskNumber ?? "a new task"}.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send the found pallet to Put-Away."),
  });

  const foundToDraftMutation = useMutation({
    mutationFn: () => recoverMissingPalletToDraft(foundPallet?.inventory_balance_id ?? ""),
    onSuccess: async (result) => {
      setFoundPallet(null);
      await refreshAfterRecovery();
      toast.success(`Returned to Drafts as ${result.draftPalletBarcode}. Print its label in Receiving to receive it.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not return the found pallet to Drafts."),
  });

  const recovering = foundToPutawayMutation.isPending || foundToDraftMutation.isPending;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Status Controls</CardTitle>
          <CardDescription>Move pallets into hold, quarantine, damage, available, or missing with audit logging.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <FormField
                control={form.control}
                name="pallet_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pallet barcode or ID</FormLabel>
                    <div className="flex gap-2">
                      <FormControl>
                        <Input
                          {...field}
                          className="min-w-0 flex-1 font-mono"
                          placeholder="Scan or enter pallet barcode"
                          value={field.value ?? ""}
                          onChange={(event) => field.onChange(normalizePalletBarcode(event.target.value))}
                        />
                      </FormControl>
                      <BarcodeScanButton
                        title="Scan pallet barcode"
                        onScan={(value) => {
                          form.setValue("pallet_id", normalizePalletBarcode(value), { shouldDirty: true, shouldValidate: true });
                        }}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <SelectField form={form} name="new_status" label="New status" options={[
                { label: "Hold", value: "hold" },
                { label: "Quarantine", value: "quarantine" },
                { label: "Damaged", value: "damaged" },
                { label: "Missing", value: "missing" },
                { label: "Reserved", value: "reserved" },
                { label: "In transit", value: "in_transit" },
                { label: "Release back to workflow", value: "release" },
              ]} />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason</FormLabel>
                    <FormControl>
                      <Textarea {...field} value={field.value ?? ""} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <Button type="submit">Apply status</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Controlled stock</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.map((row: StatusStockRow) => (
            <div key={row.inventory_balance_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
              <div>
                <p className="font-medium">{row.sku}</p>
                <p className="text-sm text-muted-foreground">{row.pallet_code} · {row.location_code ?? "No location"}</p>
              </div>
              <div className="flex items-center gap-2">
                {row.status === "missing" && !row.location_code && (
                  <Button size="sm" variant="outline" onClick={() => setFoundPallet(row)}>
                    Found
                  </Button>
                )}
                <Badge>{row.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* A found pallet has two honest homes, and they differ on the pallet
          number: put-away keeps the label that is already on the pallet, drafts
          retires it and prints a new one. */}
      <Dialog open={Boolean(foundPallet)} onOpenChange={(open) => { if (!open && !recovering) setFoundPallet(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Found {foundPallet?.pallet_code ?? "pallet"}</DialogTitle>
            <DialogDescription>
              This pallet has no location to go back to. Send it to Put-Away if the pallet and its label are intact —
              it keeps the number {foundPallet?.pallet_code ?? ""}. Save it as a draft if it has to be re-labelled;
              the stock waits in Receiving &gt; Drafts under a new number.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            <Button variant="outline" disabled={recovering} onClick={() => setFoundPallet(null)}>Cancel</Button>
            <Button variant="outline" disabled={recovering} onClick={() => foundToDraftMutation.mutate()}>
              {foundToDraftMutation.isPending ? "Saving…" : "Save as draft"}
            </Button>
            <Button disabled={recovering} onClick={() => foundToPutawayMutation.mutate()}>
              {foundToPutawayMutation.isPending ? "Queueing…" : "Send to Put-Away"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ReportsPage() {
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => getReportData() });
  const { data: metrics } = useQuery({ queryKey: ["dashboard-metrics", "reports"], queryFn: () => getDashboardMetrics() });
  const snapshot = useMemo(() => buildEnterpriseDashboard(metrics, data), [metrics, data]);
  const exportRows = useMemo(() => buildCsvReportRows(data), [data]);

  const occupancyPaging = useInfiniteRows({ pageSize: 12 });
  const auditsPaging = useInfiniteRows();
  const occupancyRows = (data?.occupancy ?? []) as ReportOccupancyRow[];
  const auditRows = (data?.audits ?? []) as ReportAuditRow[];
  const hasMoreOccupancy = occupancyPaging.sync({ loadedCount: occupancyRows.length, isFetching: isLoading });
  const hasMoreAudits = auditsPaging.sync({ loadedCount: auditRows.length, isFetching: isLoading });

  const stockByWarehouse = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.inventory ?? []) {
      map.set(row.warehouse_code, (map.get(row.warehouse_code) ?? 0) + row.available_quantity);
    }
    return Array.from(map.entries());
  }, [data]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Reports & Analytics</h2>
          <p className="text-sm text-muted-foreground">Saved-style operational reporting, CSV export, AI recommendations, and Six Sigma signals.</p>
        </div>
        <Button variant="outline" onClick={() => downloadCsv("enterprise-inventory-report.csv", exportRows)}>
          <Download data-icon="inline-start" />
          Export inventory CSV
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {snapshot.officeWidgets.map((widget) => (
          <Card key={widget.label} className={cn("border-l-4", toneBorder(widget.tone))}>
            <CardHeader>
              <CardDescription>{widget.label}</CardDescription>
              <CardTitle className="text-3xl">{widget.value}</CardTitle>
              <CardDescription>{widget.detail}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Stock by warehouse</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : stockByWarehouse.map(([warehouse, quantity]) => (
              <div key={warehouse} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                <span>{warehouse}</span>
                <span>{formatNumber(quantity)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Occupancy view</CardTitle>
          </CardHeader>
          <CardContent className="grid max-h-[28rem] gap-2 overflow-y-auto">
            {occupancyRows.slice(0, occupancyPaging.limit).map((location: ReportOccupancyRow) => (
              <div key={location.location_id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p>{location.location_code}</p>
                  <p className="text-xs text-muted-foreground">{location.temperature_class}</p>
                </div>
                <Badge variant={location.is_full ? "destructive" : "secondary"}>
                  {location.occupied_pallets}/{location.max_pallets}
                </Badge>
              </div>
            ))}
            <div ref={occupancyPaging.sentinelRef} aria-hidden className="h-px w-full" />
            {hasMoreOccupancy ? (
              <Button variant="secondary" size="sm" onClick={occupancyPaging.loadMore}>Load more locations</Button>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Saved report catalog</CardTitle>
            <CardDescription>Decision-ready report outputs for managers, clerks, and auditors.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {[
              ["Expiration risk", "Lots approaching FEFO cutoff by SKU, warehouse, and customer owner", "CSV"],
              ["Low stock warnings", "Balances at or below replenishment threshold with NetSuite sync status", "CSV"],
              ["Low turn stock", "Slow-moving inventory candidates for slotting or commercial review", "CSV"],
              ["Dock performance", "Staged, loaded, blocked, delayed, and route handoff timings", "CSV"],
              ["Six Sigma variance", "Cycle-count defects, DPMO, root cause, and corrective action fields", "CSV"],
            ].map(([title, description, output]) => (
              <div key={title} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <Badge variant="outline">{output}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <WarehouseBrainPanel recommendations={snapshot.recommendations} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Recent movements</CardTitle>
        </CardHeader>
        <CardContent className="grid max-h-[32rem] gap-2 overflow-y-auto">
          {auditRows.slice(0, auditsPaging.limit).map((audit: ReportAuditRow) => (
            <div key={audit.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{audit.event_type}</span>
                <span className="text-xs text-muted-foreground">{formatDate(audit.created_at)}</span>
              </div>
              <p className="text-xs text-muted-foreground">{audit.entity_table} · {audit.entity_id}</p>
            </div>
          ))}
          <div ref={auditsPaging.sentinelRef} aria-hidden className="h-px w-full" />
          {hasMoreAudits ? (
            <Button variant="secondary" size="sm" onClick={auditsPaging.loadMore}>Load 50 more movements</Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
