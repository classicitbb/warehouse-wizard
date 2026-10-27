import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Download, Eye, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { downloadCsv, formatDate, formatNumber, getReportData } from "@/lib/wms-core";
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  buildWarehouseScorecards,
  getReport,
  runReportAcrossWarehouses,
  scopeReportData,
  type ReportData,
  type ReportDefinition,
  type ReportResult,
} from "@/features/reports/reports-catalog";
import {
  deleteReportSubscription,
  isSubscriptionDue,
  listReportSubscriptions,
  saveReportSubscription,
  updateReportSubscription,
  type ReportFrequency,
  type ReportSubscription,
} from "@/features/reports/reports-subscriptions";

const OVERSEER = "__overseer__";
const ROW_DISPLAY_LIMIT = 250;

type Warehouse = { id: string; code: string; name?: string | null };

function ReportTable({ result }: { result: ReportResult }) {
  if (result.rows.length === 0) {
    return <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No rows for this report in the selected scope.</p>;
  }
  return (
    <div className="max-h-[32rem] overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {result.columns.map((column) => (
              <TableHead key={column.key} className={column.numeric ? "text-right" : undefined}>{column.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.rows.slice(0, ROW_DISPLAY_LIMIT).map((row, index) => (
            <TableRow key={index}>
              {result.columns.map((column) => (
                <TableCell key={column.key} className={column.numeric ? "text-right font-mono" : undefined}>
                  {column.numeric ? formatNumber(Number(row[column.key])) : String(row[column.key] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {result.rows.length > ROW_DISPLAY_LIMIT ? (
        <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">
          Showing {ROW_DISPLAY_LIMIT} of {formatNumber(result.rows.length)} rows — download the CSV for the full report.
        </p>
      ) : null}
    </div>
  );
}

function exportReport(report: ReportDefinition, result: ReportResult, scopeLabel: string) {
  const rows = result.rows.map((row) => Object.fromEntries(result.columns.map((column) => [column.label, row[column.key]])));
  downloadCsv(`${report.id}-${scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`, rows);
}

function OverseerScorecards({ data }: { data: ReportData }) {
  const cards = useMemo(() => buildWarehouseScorecards(data), [data]);
  const columns: Array<[string, (c: (typeof cards)[number]) => string]> = [
    ["Units on hand", (c) => formatNumber(c.units)],
    ["Available", (c) => formatNumber(c.available)],
    ["SKUs", (c) => formatNumber(c.skus)],
    ["Pallets", (c) => formatNumber(c.pallets)],
    ["Utilization", (c) => `${c.utilization}%`],
    ["Full bins", (c) => formatNumber(c.fullBins)],
    ["Empty bins", (c) => formatNumber(c.emptyBins)],
    ["Lots expiring ≤30d", (c) => formatNumber(c.expiringLots)],
    ["Below reorder", (c) => formatNumber(c.belowReorder)],
    ["Count variances", (c) => formatNumber(c.countVarianceLines)],
    ["Open replenishments", (c) => formatNumber(c.openReplenishments)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Warehouse comparison</CardTitle>
        <CardDescription>Side-by-side inventory health for every warehouse you can see.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Metric</TableHead>
              {cards.map((c) => <TableHead key={c.warehouseId} className="text-right">{c.code}</TableHead>)}
              <TableHead className="text-right">All</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {columns.map(([label, format], index) => (
              <TableRow key={label}>
                <TableCell className="font-medium">{label}</TableCell>
                {cards.map((c) => <TableCell key={c.warehouseId} className="text-right font-mono">{format(c)}</TableCell>)}
                <TableCell className="text-right font-mono text-muted-foreground">
                  {index === 4 ? "—" : formatNumber(cards.reduce((sum, c) => sum + Number(format(c).replace(/[^0-9.-]/g, "")), 0))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SubscriptionsPanel({
  subscriptions,
  warehouses,
  data,
  onChanged,
}: {
  subscriptions: ReportSubscription[];
  warehouses: Warehouse[];
  data: ReportData;
  onChanged: () => void;
}) {
  const scopeName = (id: string | null) => (id ? warehouses.find((w) => w.id === id)?.code ?? "Warehouse" : "All warehouses");

  const run = async (subscription: ReportSubscription) => {
    const report = getReport(subscription.report_id);
    if (!report) return toast.error("This report is no longer in the catalog.");
    const warehouse = warehouses.find((w) => w.id === subscription.warehouse_id);
    const result = subscription.warehouse_id && warehouse
      ? report.run(scopeReportData(data, warehouse))
      : runReportAcrossWarehouses(report, data);
    exportReport(report, result, scopeName(subscription.warehouse_id));
    await updateReportSubscription(subscription.id, { last_delivered_at: new Date().toISOString() });
    onChanged();
  };

  const guard = (action: () => Promise<unknown>) => () => {
    action().then(onChanged).catch((error: Error) => toast.error(error.message));
  };

  if (subscriptions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My subscriptions</CardTitle>
          <CardDescription>Open any report and choose Subscribe to get it on a schedule — per warehouse, or across all warehouses.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My subscriptions</CardTitle>
        <CardDescription>Due reports are flagged here; download them to mark them delivered.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {subscriptions.map((subscription) => {
          const report = getReport(subscription.report_id);
          const due = isSubscriptionDue(subscription);
          return (
            <div key={subscription.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{report?.title ?? subscription.report_id}</p>
                <p className="text-xs text-muted-foreground">
                  {scopeName(subscription.warehouse_id)} · {subscription.frequency}
                  {subscription.email_delivery ? " · email requested" : ""}
                  {subscription.last_delivered_at ? ` · last ${formatDate(subscription.last_delivered_at)}` : " · never delivered"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {due ? <Badge variant="destructive">Due</Badge> : subscription.active ? <Badge variant="secondary">Scheduled</Badge> : <Badge variant="outline">Paused</Badge>}
                <Select value={subscription.frequency} onValueChange={(value) => guard(() => updateReportSubscription(subscription.id, { frequency: value as ReportFrequency }))()}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
                <Switch aria-label="Active" checked={subscription.active} onCheckedChange={(checked) => guard(() => updateReportSubscription(subscription.id, { active: checked }))()} />
                <Button size="sm" variant="outline" onClick={guard(() => run(subscription))}><Download data-icon="inline-start" />Get now</Button>
                <Button size="icon" variant="ghost" aria-label="Unsubscribe" onClick={guard(() => deleteReportSubscription(subscription.id))}><Trash2 /></Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function ReportsPage() {
  const { user, profile } = useAuth();
  const netsuiteActive = useNetSuiteActive();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["reports"], queryFn: () => getReportData() });
  const subscriptionsQuery = useQuery({
    queryKey: ["report-subscriptions", user?.id],
    queryFn: () => listReportSubscriptions(user!.id),
    enabled: Boolean(user?.id),
  });

  const reportData = data as ReportData | undefined;
  const warehouses = ((reportData?.warehouses ?? []) as Warehouse[]).slice().sort((a, b) => a.code.localeCompare(b.code));
  const canOversee = warehouses.length > 1;
  const [scopeChoice, setScopeChoice] = useState<string | null>(null);
  const defaultScope = profile?.default_warehouse_id && warehouses.some((w) => w.id === profile.default_warehouse_id)
    ? profile.default_warehouse_id
    : canOversee ? OVERSEER : warehouses[0]?.id ?? OVERSEER;
  const scope = scopeChoice && (scopeChoice === OVERSEER ? canOversee : warehouses.some((w) => w.id === scopeChoice)) ? scopeChoice : defaultScope;
  const overseer = scope === OVERSEER;
  const activeWarehouse = overseer ? null : warehouses.find((w) => w.id === scope) ?? null;
  const scopeLabel = overseer ? "All warehouses" : activeWarehouse?.code ?? "Warehouse";

  const [reportId, setReportId] = useState(REPORT_CATALOG[0].id);
  const report = getReport(reportId) ?? REPORT_CATALOG[0];

  const result = useMemo<ReportResult | null>(() => {
    if (!reportData) return null;
    return overseer ? runReportAcrossWarehouses(report, reportData) : report.run(scopeReportData(reportData, activeWarehouse));
  }, [reportData, report, overseer, activeWarehouse]);

  const subscriptions = subscriptionsQuery.data ?? [];
  const existing = subscriptions.find((s) => s.report_id === report.id && s.warehouse_id === (activeWarehouse?.id ?? null));
  const refreshSubscriptions = () => queryClient.invalidateQueries({ queryKey: ["report-subscriptions"] });
  const subscribe = useMutation({
    mutationFn: () => saveReportSubscription({ userId: user!.id, reportId: report.id, warehouseId: activeWarehouse?.id ?? null, frequency: "weekly", emailDelivery: false }),
    onSuccess: () => { toast.success(`Subscribed to ${report.title} (${scopeLabel}, weekly)`); refreshSubscriptions(); },
    onError: (error: Error) => toast.error(error.message),
  });

  const dueCount = subscriptions.filter((s) => isSubscriptionDue(s)).length;
  const integrationJobs = ((data as any)?.integrationJobs ?? []) as Array<{ id: string; job_type?: string; status?: string; error_message?: string; updated_at?: string; created_at?: string }>;
  const failedJobs = integrationJobs.filter((job) => job.status === "failed" || job.status === "dead_letter").length;

  return (
    <div className="grid gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Reports & Analytics</h2>
          <p className="text-sm text-muted-foreground">
            Inventory reports by warehouse, with an overseer view across all of them. Subscribe to any report to receive it on a schedule.
          </p>
        </div>
        {dueCount > 0 ? <Badge variant="destructive"><Bell className="mr-1 size-3" />{dueCount} subscribed report{dueCount === 1 ? "" : "s"} due</Badge> : null}
      </div>

      {warehouses.length > 0 ? (
        <Tabs value={scope} onValueChange={setScopeChoice}>
          <TabsList className="h-auto flex-wrap justify-start">
            {canOversee ? <TabsTrigger value={OVERSEER}><Eye className="mr-1 size-4" />Overseer</TabsTrigger> : null}
            {warehouses.map((warehouse) => (
              <TabsTrigger key={warehouse.id} value={warehouse.id} title={warehouse.name ?? undefined}>{warehouse.code}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      ) : null}

      {isLoading || !reportData ? <p className="text-sm text-muted-foreground">Loading reports…</p> : (
        <>
          {overseer ? <OverseerScorecards data={reportData} /> : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(16rem,0.35fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Report catalog</CardTitle>
                <CardDescription>{REPORT_CATALOG.length} reports · {scopeLabel}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                {REPORT_CATEGORIES.map((category) => (
                  <div key={category.id} className="grid gap-1">
                    <p className="text-xs font-semibold uppercase text-muted-foreground" title={category.description}>{category.label}</p>
                    {REPORT_CATALOG.filter((r) => r.category === category.id).map((r) => {
                      const subscribed = subscriptions.some((s) => s.report_id === r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setReportId(r.id)}
                          className={`flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary ${r.id === report.id ? "bg-secondary font-medium" : ""}`}
                        >
                          <span>{r.title}</span>
                          {subscribed ? <Bell className="size-3.5 text-primary" aria-label="Subscribed" /> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>{report.title}</CardTitle>
                  <CardDescription>{report.description}</CardDescription>
                  <p className="mt-1 text-xs text-muted-foreground">{scopeLabel} · {formatNumber(result?.rows.length ?? 0)} rows</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={existing ? "secondary" : "default"}
                    disabled={subscribe.isPending || Boolean(existing) || !user}
                    onClick={() => subscribe.mutate()}
                  >
                    {existing ? <BellOff data-icon="inline-start" /> : <Bell data-icon="inline-start" />}
                    {existing ? "Subscribed" : "Subscribe"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={!result?.rows.length} onClick={() => result && exportReport(report, result, scopeLabel)}>
                    <Download data-icon="inline-start" />CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>{result ? <ReportTable result={result} /> : null}</CardContent>
            </Card>
          </div>

          <SubscriptionsPanel subscriptions={subscriptions} warehouses={warehouses} data={reportData} onChanged={refreshSubscriptions} />

          {netsuiteActive ? (
            <Card className={failedJobs > 0 ? "border-l-4 border-l-destructive" : "border-l-4 border-l-success"}>
              <CardHeader>
                <CardTitle>NetSuite integration health</CardTitle>
                <CardDescription>Latest {integrationJobs.length} synchronization jobs · {failedJobs} failed or dead-lettered</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {integrationJobs.slice(0, 6).map((job) => (
                  <div key={job.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-mono font-semibold">{job.job_type ?? "Sync job"}</p>
                      <p className="truncate text-xs text-muted-foreground">{job.error_message || formatDate(job.updated_at ?? job.created_at)}</p>
                    </div>
                    <Badge variant={job.status === "failed" || job.status === "dead_letter" ? "destructive" : "secondary"}>{job.status ?? "unknown"}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
