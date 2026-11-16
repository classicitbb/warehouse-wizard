// Load scan and departure for one trip (outbound picking design, slice F).
// At the truck the loader scans each staged order (order, IF or pick list
// number). WW refuses an order of another trip. When every order with picks
// is loaded, Depart sets the trip off and queues NetSuite Shipped. An order
// with nothing picked stays behind for the office. A short trip needs a
// supervisor to depart.
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Truck } from "lucide-react";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { alertToast, playBarcodeBeep } from "@/lib/floor-feedback";
import { normalizeScannerText } from "@/lib/scan-input";
import { formatDate, formatSupabaseError } from "@/features/shared/core-types";
import { AppShell } from "@/features/shared/app-shell";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TRIPS_QUERY_KEY, fetchTripBoard, groupTrips, orderLabel, tripTitle, type TripBoardRow } from "./trips-core";
import { STAGE_LABELS, departTrip, loadTripScan, tripDispatchState } from "./trip-dispatch-core";

const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";

function OrderRow({ row, tone }: { row: TripBoardRow; tone: "ok" | "wait" | "muted" }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm", tone === "muted" && "opacity-70")}>
      <div className="min-w-0">
        <div className="font-mono font-medium">{orderLabel(row)}</div>
        <div className="truncate text-xs text-muted-foreground">{[row.customer_name, row.document_number, row.staging_lane].filter(Boolean).join(" · ")}</div>
      </div>
      <Badge
        variant="outline"
        className={cn(FLAG_CLASS, tone === "ok" ? "border-emerald-500 text-emerald-700 dark:text-emerald-400" : tone === "wait" ? "border-amber-500 text-amber-700 dark:text-amber-400" : "")}
      >
        {row.ww_stage ? STAGE_LABELS[row.ww_stage] : Number(row.picked_quantity) === 0 ? "Nothing picked" : "Not staged"}
      </Badge>
    </div>
  );
}

export function TripLoadPage() {
  const { fulfillmentId = "" } = useParams();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const [scan, setScan] = useState("");
  const { data: rows = [], isLoading, error } = useQuery({ queryKey: [...TRIPS_QUERY_KEY, "board"], queryFn: fetchTripBoard });
  const trip = useMemo(() => groupTrips(rows).find((t) => t.fulfillments.some((f) => f.fulfillment_id === fulfillmentId)) ?? null, [rows, fulfillmentId]);
  const state = trip ? tripDispatchState(trip) : null;
  const ids = trip?.fulfillments.map((f) => f.fulfillment_id) ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });

  const load = useMutation({
    mutationFn: () => {
      if (!scan.trim()) throw new Error("Scan the order label.");
      return loadTripScan(ids, scan);
    },
    onSuccess: async (result) => {
      alertToast.success(`${result.document_number} loaded`);
      setScan("");
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Load scan failed") || "Load scan failed"),
  });

  const depart = useMutation({
    mutationFn: () => departTrip(ids),
    onSuccess: async (result) => {
      const short = result.ship_short ? " Short lines ship short; the orders stay open for the rest." : "";
      if (result.posting_enabled) alertToast.success(`Trip departed. ${result.queued} fulfillment(s) queued to NetSuite as Shipped.${short}`);
      else alertToast.attention(`Trip departed in WW. NetSuite posting is off, so the office must set the fulfillments to Shipped.${short}`);
      await refresh();
      navigate(toPath("/trips"));
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not depart") || "Could not depart"),
  });

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(toPath("/trips"))}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Trips
          </Button>
        </div>

        {error ? (
          <p className="text-destructive">Could not load the trip: {error instanceof Error ? error.message : String(error)}</p>
        ) : isLoading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : !trip || !state ? (
          <p className="text-muted-foreground">This trip is no longer open. It has left, or the office changed it.</p>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-semibold">Load · {tripTitle(trip)}</h2>
              <p className="text-sm text-muted-foreground">{trip.date ? formatDate(trip.date) : "No date"} · {trip.warehouseCode} · {state.loaded.length} of {state.loaded.length + state.waiting.length} loaded</p>
            </div>

            {state.waiting.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); load.mutate(); }}>
                    <div className="grid gap-1.5">
                      <Label htmlFor="trip-load-scan">Order label</Label>
                      <div className="flex gap-2">
                        <Input id="trip-load-scan" value={scan} onChange={(e) => setScan(e.target.value)} className="h-11 font-mono uppercase" autoComplete="off" autoFocus />
                        <BarcodeScanButton className="h-11 w-20" title="Scan the order label" onScan={(v) => { playBarcodeBeep(); setScan(normalizeScannerText(v)); }} />
                      </div>
                    </div>
                    <Button type="submit" className="h-11" disabled={load.isPending}>
                      {load.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Load
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            <Button type="button" className="h-12" disabled={!state.canDepart || depart.isPending} onClick={() => depart.mutate()}>
              {depart.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
              Depart trip{state.shipsShort ? " (ships short)" : ""}
            </Button>
            {state.shipsShort && <p className="text-xs text-muted-foreground">Some lines are short. A supervisor must depart this trip.</p>}

            <div className="grid gap-2">
              {state.waiting.map((row) => <OrderRow key={row.fulfillment_id} row={row} tone="wait" />)}
              {state.loaded.map((row) => <OrderRow key={row.fulfillment_id} row={row} tone="ok" />)}
              {state.leftBehind.length > 0 && <div className="mt-2 text-xs uppercase text-muted-foreground">Stays behind for the office</div>}
              {state.leftBehind.map((row) => <OrderRow key={row.fulfillment_id} row={row} tone="muted" />)}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
