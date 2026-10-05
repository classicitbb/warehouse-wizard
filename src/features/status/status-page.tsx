import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Download, Search, ShieldCheck } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SelectField, WarehouseBrainPanel, toneBorder } from "@/features/shared/ui-shared";

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

type IntegrationJobRow = {
  id: string;
  job_type?: string | null;
  status?: string | null;
  attempts?: number | null;
  error_message?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export function StatusPage() {
  const queryClient = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["status-pallets"], queryFn: listStatusPallets });
  // A missing pallet that has turned up with no location to go back to.
  const [foundPallet, setFoundPallet] = useState<StatusStockRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
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
  const statusRows = data as StatusStockRow[];
  const query = search.trim().toLowerCase();
  const visibleRows = statusRows.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    if (!query) return true;
    return [row.sku, row.pallet_code, row.location_code, row.status]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
  const statusCount = (status: string) => statusRows.filter((row) => row.status === status).length;

  return (
    <div className="grid min-w-0 gap-4">
      <div>
        <h2 className="text-2xl font-semibold">Inventory Status</h2>
        <p className="text-sm text-muted-foreground">Scan, isolate, release, and recover controlled pallets with a required audit reason.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {[{ label: "Missing", value: "missing", tone: "border-l-destructive" }, { label: "Quarantine", value: "quarantine", tone: "border-l-warning" }, { label: "On hold", value: "hold", tone: "border-l-info" }, { label: "Damaged", value: "damaged", tone: "border-l-destructive" }].map((item) => (
          <Card key={item.value} className={cn("border-l-4", item.tone)}><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{item.label}</p><p className="mt-1 font-mono text-2xl font-bold">{statusCount(item.value)}</p></CardContent></Card>
        ))}
      </div>
      <Card className="border-l-4 border-l-primary">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" />Change pallet status</CardTitle>
          <CardDescription>Identify the pallet, choose its controlled state, and record why it changed.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="grid gap-4 lg:grid-cols-[minmax(16rem,1.2fr)_minmax(12rem,0.8fr)_minmax(18rem,1.5fr)_auto] lg:items-end" onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
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
              <Button type="submit" disabled={mutation.isPending}>Apply status</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div><CardTitle>Controlled stock</CardTitle><CardDescription>{visibleRows.length} of {statusRows.length} pallets shown</CardDescription></div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 sm:w-72"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search pallet, SKU, or location" /></div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All controlled statuses</SelectItem><SelectItem value="missing">Missing</SelectItem><SelectItem value="quarantine">Quarantine</SelectItem><SelectItem value="hold">Hold</SelectItem><SelectItem value="damaged">Damaged</SelectItem><SelectItem value="reserved">Reserved</SelectItem><SelectItem value="in_transit">In transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid max-h-[36rem] gap-2 overflow-y-auto">
          {visibleRows.length === 0 ? <p className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No controlled pallets match this filter.</p> : null}
          {visibleRows.map((row: StatusStockRow) => (
            <div key={row.inventory_balance_id} className={cn("grid gap-3 rounded-r-md border border-l-4 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center", row.status === "missing" || row.status === "damaged" ? "border-l-destructive" : row.status === "quarantine" ? "border-l-warning" : "border-l-info")}>
              <div className="min-w-0">
                <p className="font-semibold">{row.sku}</p>
                <p className="mt-1 font-mono text-xs text-foreground">{row.pallet_code}</p>
                <p className="text-xs text-muted-foreground">{row.location_code ?? "No recorded location"}</p>
              </div>
              <div className="flex items-center gap-2">
                {row.status === "missing" && !row.location_code && (
                  <Button size="sm" variant="outline" onClick={() => setFoundPallet(row)}>
                    Found
                  </Button>
                )}
                <Badge variant={row.status === "missing" || row.status === "damaged" ? "destructive" : "secondary"}>{row.status}</Badge>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>NetSuite status posting is not active on this screen. Warehouse Wizard records the pallet state and audit event locally; external status mapping will appear only after the account’s Inventory Status setup is confirmed.</p>
      </div>

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

  const operationalStats = useMemo(() => {
    const inventory = data?.inventory ?? [];
    const occupancy = data?.occupancy ?? [];
    const cycleCounts = data?.cycleCounts ?? [];
    const printJobs = data?.printJobs ?? [];
    const availableQuantity = inventory.reduce((sum: number, row: any) => sum + Number(row.available_quantity ?? 0), 0);
    const fullLocations = occupancy.filter((row: any) => row.is_full).length;
    const freeLocations = occupancy.filter((row: any) => Number(row.occupied_pallets ?? 0) === 0).length;
    const countExceptions = cycleCounts.filter((row: any) => Number(row.variance_quantity ?? 0) !== 0 || row.status === "exception").length;
    const failedPrintJobs = printJobs.filter((row: any) => ["failed", "error"].includes(String(row.status))).length;
    return { availableQuantity, fullLocations, freeLocations, countExceptions, failedPrintJobs };
  }, [data]);

  const integrationJobs = (data?.integrationJobs ?? []) as IntegrationJobRow[];
  const integrationStats = useMemo(() => {
    const queued = integrationJobs.filter((job) => job.status === "queued").length;
    const failed = integrationJobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length;
    const succeeded = integrationJobs.filter((job) => job.status === "succeeded").length;
    const finished = succeeded + failed;
    return { queued, failed, succeeded, successRate: finished > 0 ? Math.round((succeeded / finished) * 100) : null };
  }, [integrationJobs]);

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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Available units", formatNumber(operationalStats.availableQuantity), "Live pickable stock"],
          ["Full locations", formatNumber(operationalStats.fullLocations), `${formatNumber(operationalStats.freeLocations)} empty locations`],
          ["Count exceptions", formatNumber(operationalStats.countExceptions), "Recent variance lines"],
          ["Print failures", formatNumber(operationalStats.failedPrintJobs), "Recent label jobs"],
          ["NetSuite queue", formatNumber(integrationStats.queued), integrationStats.successRate === null ? "No completed jobs" : `${integrationStats.successRate}% recent success`],
        ].map(([label, value, detail]) => (
          <Card key={label} className="border-l-4 border-l-primary"><CardContent className="p-4"><p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p><p className="mt-1 font-mono text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{detail}</p></CardContent></Card>
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
      <Card className={integrationStats.failed > 0 ? "border-l-4 border-l-destructive" : "border-l-4 border-l-success"}>
        <CardHeader>
          <CardTitle>NetSuite integration health</CardTitle>
          <CardDescription>Latest {integrationJobs.length} real synchronization jobs · {integrationStats.succeeded} succeeded · {integrationStats.failed} failed or dead-lettered · {integrationStats.queued} queued</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {integrationJobs.length === 0 ? <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No synchronization jobs recorded.</p> : null}
          {integrationJobs.slice(0, 8).map((job) => (
            <div key={job.id} className="grid gap-2 rounded-md border border-border px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0"><p className="font-mono font-semibold">{job.job_type ?? "Sync job"}</p><p className="truncate text-xs text-muted-foreground">{job.error_message || `${job.attempts ?? 0} attempt${job.attempts === 1 ? "" : "s"}`}</p></div>
              <div className="flex items-center gap-2 sm:justify-end"><span className="text-xs text-muted-foreground">{formatDate(job.updated_at ?? job.created_at)}</span><Badge variant={job.status === "failed" || job.status === "dead_letter" ? "destructive" : job.status === "succeeded" ? "default" : "secondary"}>{job.status ?? "unknown"}</Badge></div>
            </div>
          ))}
        </CardContent>
      </Card>
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
