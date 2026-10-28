import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { normalizePalletBarcode } from "@/lib/code-input";

import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import {
  changePalletStatus,
  listStatusPallets,
  recoverMissingPalletToDraft,
  recoverMissingPalletToPutaway,
  statusChangeSchema,
} from "@/lib/wms-core";
import { BarcodeScanButton } from "@/components/barcode-scan-button";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { SelectField } from "@/features/shared/ui-shared";

type StatusStockRow = {
  inventory_balance_id: string;
  pallet_code?: string | null;
  sku?: string | null;
  status: string;
  location_code?: string | null;
};

export function StatusPage() {
  const queryClient = useQueryClient();
  const netsuiteActive = useNetSuiteActive();
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
                <p className="mt-1 font-mono text-xs text-muted-foreground">{row.pallet_code} · {row.location_code ?? "No location"}</p>
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

      {netsuiteActive && <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>NetSuite status posting is not active on this screen. Warehouse Wizard records the pallet state and audit event locally; external status mapping will appear only after the account’s Inventory Status setup is confirmed.</p>
      </div>}

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

export { ReportsPage } from "@/features/reports/reports-page";
