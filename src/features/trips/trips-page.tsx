// Trip board (outbound picking design, slice E): the office's open item
// fulfillments, grouped into trips by IF date + truck + trip number (O3). The
// office plans trips in NetSuite (O1); here the floor starts or continues the
// pick of each order. Credit hold blocks a sales order (D8). An order still
// open after the warehouse's demand age is flagged (V22).
//
// Layout follows Replenishment: fixed page height, a compact header, and a
// card whose header stays put while only the rows scroll.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Truck } from "lucide-react";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { alertToast } from "@/lib/floor-feedback";
import { formatDate, formatNumber, formatSupabaseError } from "@/features/shared/core-types";
import { TableFrame } from "@/features/shared/resource-forms";
import { HintButton } from "@/components/hint-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  PICK_STATE_LABELS,
  TRIPS_QUERY_KEY,
  fetchTripBoard,
  filterTrips,
  groupTrips,
  localToday,
  orderLabel,
  pickState,
  startFulfillmentPick,
  tripTitle,
  type PickState,
  type TripBoardRow,
  type TripDateFilter,
} from "./trips-core";
import { STAGE_LABELS, floorStage, tripDispatchState, type FloorStage } from "./trip-dispatch-core";

const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";
const COLUMNS = 6;

const STATE_BADGE: Record<PickState, string> = {
  blocked: "border-destructive text-destructive",
  not_started: "text-muted-foreground",
  picking: "border-sky-500 text-sky-700 dark:text-sky-400",
  exception: "border-amber-500 text-amber-700 dark:text-amber-400",
  short: "border-amber-500 text-amber-700 dark:text-amber-400",
  picked: "border-emerald-500 text-emerald-700 dark:text-emerald-400",
};

function EmptyRow({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return (
    <TableRow>
      <TableCell className={cn("h-24 text-center", tone === "error" ? "text-destructive" : "text-muted-foreground")} colSpan={COLUMNS}>
        {children}
      </TableCell>
    </TableRow>
  );
}

const ACTION_LABELS: Partial<Record<FloorStage, string>> = { pack: "Pack check", stage: "Stage", load: "Load" };

function FulfillmentRow({ row, busy, onPick, onNext }: { row: TripBoardRow; busy: boolean; onPick: () => void; onNext: (stage: FloorStage) => void }) {
  const state = pickState(row);
  const stage = floorStage(row);
  const action = ACTION_LABELS[stage];
  const progress = Number(row.quantity) > 0 ? Math.round((Number(row.picked_quantity) / Number(row.quantity)) * 100) : 0;
  return (
    <TableRow className="even:bg-muted/30">
      <TableCell>
        {/* The order opens the pick too: on a phone the button column is off screen. */}
        <button type="button" className="text-left disabled:cursor-not-allowed" onClick={onPick} disabled={busy || state === "blocked"}>
          <div className="font-mono font-medium underline-offset-2 hover:underline">{orderLabel(row)}</div>
          <div className="text-xs text-muted-foreground">{row.document_number}</div>
        </button>
      </TableCell>
      <TableCell className="max-w-[18rem] truncate" title={row.customer_name ?? undefined}>
        {row.order_type === "transfer" && <Badge variant="outline" className={cn(FLAG_CLASS, "mr-1")}>Transfer</Badge>}
        {row.customer_name ?? "—"}
        {row.delivery_zone && <span className="ml-2 text-xs text-muted-foreground">{row.delivery_zone}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.line_count}
        {row.unmapped_count > 0 && <span className="ml-1 text-xs text-destructive" title="Lines with an item that is not mapped to a WW product">({row.unmapped_count} unmapped)</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {row.pick_list_id ? `${formatNumber(row.picked_quantity)} / ${formatNumber(row.quantity)} (${progress}%)` : formatNumber(row.quantity)}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          {row.ww_stage ? (
            <Badge variant="outline" className={cn(FLAG_CLASS, STATE_BADGE.picked)}>
              {STAGE_LABELS[row.ww_stage]}{row.staging_lane && row.ww_stage === "staged" ? ` · ${row.staging_lane}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline" className={cn(FLAG_CLASS, STATE_BADGE[state])}>{PICK_STATE_LABELS[state]}</Badge>
          )}
          {row.ww_stage === "departed" && (
            <Badge variant="outline" className={cn(FLAG_CLASS, row.ship_sync_status === "dead_letter" ? "border-destructive text-destructive" : "text-muted-foreground")} title={row.ship_sync_error ?? undefined}>
              {row.ship_sync_status === "dead_letter" ? "NetSuite post failed" : row.ship_sync_status ? "Posting to NetSuite" : "Office sets Shipped"}
            </Badge>
          )}
          {row.exception_tasks > 0 && state !== "exception" && (
            <Badge variant="outline" className={cn(FLAG_CLASS, STATE_BADGE.exception)}>{row.exception_tasks} need stock</Badge>
          )}
          {row.is_aged && <Badge variant="outline" className={cn(FLAG_CLASS, "border-destructive text-destructive")}>Aged</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {stage === "pick" || stage === "nothing_picked" ? (
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onPick} disabled={busy || state === "blocked"}>
              {state === "not_started" || state === "blocked" ? "Start pick" : state === "picked" || state === "short" ? "View" : "Continue"}
            </Button>
          ) : action ? (
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => onNext(stage)} disabled={busy}>{action}</Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function TripsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toPath } = useTenantPath();
  const [filter, setFilter] = useState<TripDateFilter>("today");
  const { data: rows = [], isLoading, error, isFetching, refetch } = useQuery({
    queryKey: [...TRIPS_QUERY_KEY, "board"],
    queryFn: fetchTripBoard,
    refetchInterval: 60_000,
  });
  const today = localToday();
  const trips = useMemo(() => filterTrips(groupTrips(rows), filter, today), [rows, filter, today]);

  const start = useMutation({
    mutationFn: (row: TripBoardRow) => startFulfillmentPick(row.fulfillment_id),
    onSuccess: async (pickListId) => {
      await queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });
      navigate(toPath(`/trips/pick/${pickListId}`));
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not start the pick") || "Could not start the pick"),
  });

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">Trips</h2>
          <HintButton label="Trip hints">
            The office plans each trip in NetSuite on the Fulfill Orders page: date, truck, trip number and picker. Each order on a trip
            is one fulfillment. Start the pick of an order, then walk the bins in the order shown. Scan each bin and enter what you take.
            If the bin runs out, press Short: WW closes the line with what you found and asks for an urgent pallet for the pick face.
            Orders on credit hold cannot be picked until the office releases them. An order still open after 3 days is marked Aged.
            After the pick, Pack check counts each line against the pick, then Stage puts the order in a staging lane. At the truck,
            Load &amp; depart scans each order on. When every picked order is on, Depart sets the fulfillments to Shipped in NetSuite.
            A short line ships short and needs a supervisor. An order with nothing picked stays behind for the office.
          </HintButton>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as TripDateFilter)}>
            <TabsList className="h-8">
              <TabsTrigger value="today" className="h-6 px-2 text-xs">Today</TabsTrigger>
              <TabsTrigger value="open" className="h-6 px-2 text-xs">All open</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 min-w-0 flex-1 p-0">
          <TableFrame className="h-full min-w-0 flex-1">
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right" title="Picked / to pick, in base units">Quantity</TableHead>
                  <TableHead>Pick</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <EmptyRow tone="error">Could not load trips: {error instanceof Error ? error.message : String(error)}</EmptyRow>
                ) : isLoading ? (
                  <EmptyRow>Loading…</EmptyRow>
                ) : trips.length === 0 ? (
                  <EmptyRow>
                    {filter === "today" ? "No trips for today. The office plans trips in NetSuite; check All open for earlier trips." : "No open fulfillments."}
                  </EmptyRow>
                ) : (
                  trips.flatMap((trip) => [
                    <TableRow key={trip.key} className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={COLUMNS} className="py-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="font-semibold">{tripTitle(trip)}</span>
                          <span className="text-xs text-muted-foreground">{trip.date ? formatDate(trip.date) : "No date"} · {trip.warehouseCode}</span>
                          <span className="text-xs tabular-nums text-muted-foreground">{trip.picked} of {trip.total} picked</span>
                          {trip.isAged && <Badge variant="outline" className={cn(FLAG_CLASS, "border-destructive text-destructive")}>Aged</Badge>}
                          {tripDispatchState(trip).loaded.length + trip.fulfillments.filter((f) => f.ww_stage === "staged").length > 0 && (
                            <Button type="button" size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={() => navigate(toPath(`/trips/load/${trip.fulfillments[0].fulfillment_id}`))}>
                              <Truck className="mr-1 h-3 w-3" /> Load &amp; depart
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>,
                    ...trip.fulfillments.map((row) => (
                      <FulfillmentRow
                        key={row.fulfillment_id}
                        row={row}
                        busy={start.isPending}
                        onNext={(stage) => navigate(toPath(stage === "load" ? `/trips/load/${row.fulfillment_id}` : `/trips/pack/${row.fulfillment_id}`))}
                        onPick={() => (row.pick_list_status === "completed" && row.pick_list_id
                          ? navigate(toPath(`/trips/pick/${row.pick_list_id}`))
                          // Start also refreshes an open list: lines the office changed, and bins for lines that had no stock.
                          : start.mutate(row))}
                      />
                    )),
                  ])
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}
