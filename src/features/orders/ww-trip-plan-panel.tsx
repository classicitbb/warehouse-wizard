// Order sheet, WW orders only: put the open quantity on a trip (date + truck +
// trip number, the same key the Trips board groups by), take a trip that has
// not been picked off again, or cancel the order. NetSuite orders are planned
// in NetSuite and never show this panel.
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { alertToast } from "@/lib/floor-feedback";
import { formatSupabaseError } from "@/features/shared/core-types";
import { localToday, TRIPS_QUERY_KEY } from "@/features/trips/trips-core";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ORDERS_INBOX_QUERY_KEY, type DetailFulfillment, type DetailLine, type InboxRow } from "./orders-inbox-core";
import { cancelWwOrder, openToPlan, planWwTrip, removeWwTrip } from "./ww-orders-core";

const CANCEL_ROLES = ["developer", "admin", "warehouse_manager", "warehouse_supervisor"];

export function WwTripPlanPanel({ row, lines, fulfillments, onClosed }: { row: InboxRow; lines: DetailLine[]; fulfillments: DetailFulfillment[]; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const [date, setDate] = useState(localToday());
  const [truck, setTruck] = useState(row.truck_name ?? "");
  const [trip, setTrip] = useState(row.trip_number ?? "");
  const [picker, setPicker] = useState(row.picker_name ?? "");

  useEffect(() => {
    setTruck(row.truck_name ?? "");
    setTrip(row.trip_number ?? "");
    setPicker(row.picker_name ?? "");
  }, [row.id, row.truck_name, row.trip_number, row.picker_name]);

  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ORDERS_INBOX_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY }),
  ]);
  const open = openToPlan(lines, fulfillments);
  const closed = row.external_status === "H" || row.external_status === "C";
  const hasOpenTrip = fulfillments.some((f) => f.external_status !== "C");

  const plan = useMutation({
    mutationFn: () => planWwTrip({ order_id: row.id, fulfillment_date: date, truck_name: truck, trip_number: trip, picker_name: picker }),
    onSuccess: async () => {
      alertToast.success(`${row.order_number} is on the trip. The floor picks it from Trips.`);
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not plan the trip") || "Could not plan the trip"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeWwTrip(id),
    onSuccess: async () => {
      alertToast.success("Removed from the trip.");
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not remove it from the trip") || "Could not remove it from the trip"),
  });
  const cancel = useMutation({
    mutationFn: () => cancelWwOrder(row.id),
    onSuccess: async () => {
      alertToast.success(`${row.order_number} cancelled.`);
      await refresh();
      onClosed();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not cancel the order") || "Could not cancel the order"),
  });

  if (closed) return null;
  const removable = fulfillments.filter((f) => f.source === "ww" && f.external_status !== "C" && !f.ww_stage);

  return (
    <section className="rounded-md border p-3">
      <h3 className="mb-2 text-sm font-semibold">Plan trip</h3>
      {open > 0 ? (
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            plan.mutate();
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="ww-trip-date" className="text-xs">Date</Label>
            <Input id="ww-trip-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ww-trip-truck" className="text-xs">Truck</Label>
            <Input id="ww-trip-truck" value={truck} onChange={(e) => setTruck(e.target.value)} placeholder="Truck or driver" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ww-trip-number" className="text-xs">Trip number</Label>
            <Input id="ww-trip-number" value={trip} onChange={(e) => setTrip(e.target.value)} placeholder="1" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ww-trip-picker" className="text-xs">Picker</Label>
            <Input id="ww-trip-picker" value={picker} onChange={(e) => setPicker(e.target.value)} placeholder="Optional" />
          </div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={plan.isPending || !date || !truck.trim()}>
              {plan.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Put {hasOpenTrip ? "the rest " : ""}on trip
            </Button>
            <span className="text-xs text-muted-foreground">Orders with the same date, truck and trip number are one trip.</span>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">Every open line is on a trip.</p>
      )}

      {(removable.length > 0 || (!hasOpenTrip && roles.some((r) => CANCEL_ROLES.includes(r)))) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          {removable.map((f) => (
            <Button key={f.id} type="button" size="sm" variant="outline" disabled={remove.isPending} onClick={() => remove.mutate(f.id)}>
              Take {f.document_number} off the trip
            </Button>
          ))}
          {!hasOpenTrip && roles.some((r) => CANCEL_ROLES.includes(r)) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={cancel.isPending}>Cancel order</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel {row.order_number}?</AlertDialogTitle>
                  <AlertDialogDescription>Lines that have not shipped are closed. Shipped lines stay shipped.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep order</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancel.mutate()}>Cancel order</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      )}
    </section>
  );
}
