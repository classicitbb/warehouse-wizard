// Pack check and staging for one fulfillment on a trip (outbound picking
// design, slice F). The packer scans the item of each picked line and counts
// it; the count must match the pick. Then the packer scans a staging lane.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { alertToast, playBarcodeBeep } from "@/lib/floor-feedback";
import { normalizeScannerText } from "@/lib/scan-input";
import { formatSupabaseError } from "@/features/shared/core-types";
import { formatLineQuantity } from "@/features/orders/orders-inbox-core";
import { AppShell } from "@/features/shared/app-shell";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { TRIPS_QUERY_KEY, toBaseUnits } from "./trips-core";
import { confirmPackLine, fetchPackCheck, needsPackCount, scanMatchesLine, stageFulfillment, type PackLine } from "./trip-dispatch-core";

const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";

function ScanField({ id, label, value, onChange, title }: { id: string; label: string; value: string; onChange: (v: string) => void; title: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 font-mono uppercase" autoComplete="off" autoFocus />
        <BarcodeScanButton
          className="h-11 w-20"
          title={title}
          onScan={(v) => {
            playBarcodeBeep();
            onChange(normalizeScannerText(v));
          }}
        />
      </div>
    </div>
  );
}

function LineRow({ line, active, onSelect }: { line: PackLine; active: boolean; onSelect: () => void }) {
  const unit = line.order_line?.unit ?? null;
  const open = needsPackCount(line);
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!open}
      className={cn("flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm", active ? "border-primary bg-primary/5" : "border-border", !open && "opacity-70")}
    >
      <div className="min-w-0">
        <div className="truncate font-mono font-medium">{line.product?.sku ?? "Unmapped item"}</div>
        <div className="truncate text-xs text-muted-foreground">{line.product?.name}</div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="tabular-nums">{formatLineQuantity(line.picked, unit)} picked</span>
        {line.picked === 0 ? (
          <Badge variant="outline" className={cn(FLAG_CLASS, "border-amber-500 text-amber-700 dark:text-amber-400")}>Nothing picked</Badge>
        ) : !open ? (
          <Badge variant="outline" className={cn(FLAG_CLASS, "border-emerald-500 text-emerald-700 dark:text-emerald-400")}>Counted</Badge>
        ) : null}
      </div>
    </button>
  );
}

export function TripPackPage() {
  const { fulfillmentId = "" } = useParams();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const queryClient = useQueryClient();
  const queryKey = [...TRIPS_QUERY_KEY, "pack", fulfillmentId];
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: () => fetchPackCheck(fulfillmentId), enabled: Boolean(fulfillmentId) });
  const lines = useMemo(() => data?.lines ?? [], [data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scan, setScan] = useState("");
  const [count, setCount] = useState("");
  const [lane, setLane] = useState("");

  const current = lines.find((l) => l.id === selectedId && needsPackCount(l)) ?? lines.find(needsPackCount) ?? null;

  useEffect(() => {
    setScan("");
    setCount("");
  }, [current?.id]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: TRIPS_QUERY_KEY });

  const pack = useMutation({
    mutationFn: () => {
      if (!current) throw new Error("No line to count.");
      if (!scanMatchesLine(scan, current)) throw new Error(`Wrong item. This line is ${current.product?.sku ?? "an unmapped item"}.`);
      const entered = Number(count);
      if (count.trim() === "" || !Number.isFinite(entered) || entered < 0) throw new Error("Enter the count.");
      return confirmPackLine(current.id, scan, toBaseUnits(entered, current.order_line?.unit ?? null));
    },
    onSuccess: async (result) => {
      if (result.packed) alertToast.success("Order packed. Scan a staging lane.");
      else alertToast.success("Line counted");
      setSelectedId(null);
      await refresh();
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Pack check failed") || "Pack check failed"),
  });

  const stage = useMutation({
    mutationFn: () => {
      if (!lane.trim()) throw new Error("Scan the staging lane.");
      return stageFulfillment(fulfillmentId, lane);
    },
    onSuccess: async (result) => {
      alertToast.success(`Staged in ${result.lane}`);
      await refresh();
      navigate(toPath("/trips"));
    },
    onError: (e) => alertToast.noGo(formatSupabaseError(e, "Could not stage") || "Could not stage"),
  });

  const ful = data?.fulfillment;
  const packed = ful?.ww_stage === "packed" || (lines.some((l) => l.picked > 0) && !lines.some(needsPackCount));
  const unit = current?.order_line?.unit ?? null;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => navigate(toPath("/trips"))}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Trips
          </Button>
        </div>

        {error ? (
          <p className="text-destructive">Could not load the pack check: {error instanceof Error ? error.message : String(error)}</p>
        ) : isLoading || !ful ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div>
              <h2 className="text-xl font-semibold">Pack check · {ful.order?.order_number ?? ful.document_number}</h2>
              <p className="text-sm text-muted-foreground">
                {[ful.order?.customer_name, ful.trip_number ? `Trip ${ful.trip_number}` : null, ful.truck_name, ful.document_number].filter(Boolean).join(" · ")}
              </p>
            </div>

            {ful.ww_stage === "staged" || ful.ww_stage === "loaded" || ful.ww_stage === "departed" ? (
              <Card>
                <CardContent className="flex items-center gap-3 p-4">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                  <div className="font-medium">This order is {ful.ww_stage}.</div>
                </CardContent>
              </Card>
            ) : packed ? (
              <Card>
                <CardContent className="grid gap-4 p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                    <div className="font-medium">Every picked line is counted. Put the order in a staging lane.</div>
                  </div>
                  <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); stage.mutate(); }}>
                    <ScanField id="trip-stage-lane" label="Staging lane" value={lane} onChange={setLane} title="Scan the lane label" />
                    <Button type="submit" className="h-11" disabled={stage.isPending}>
                      {stage.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Stage order
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : current ? (
              <Card>
                <CardContent className="grid gap-4 p-4">
                  <div>
                    <div className="font-mono text-2xl font-bold">{current.product?.sku}</div>
                    <div className="text-sm text-muted-foreground">{current.product?.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">Count what is on the pallet for this line.</div>
                  </div>
                  <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); pack.mutate(); }}>
                    <ScanField id="trip-pack-item" label="Item" value={scan} onChange={setScan} title="Scan the item barcode" />
                    <div className="grid gap-1.5">
                      <Label htmlFor="trip-pack-count">Count ({unit?.abbreviation || unit?.unit_name || "units"})</Label>
                      <Input id="trip-pack-count" type="number" inputMode="decimal" min={0} step="any" value={count} onChange={(e) => setCount(e.target.value)} className="h-11 w-40 tabular-nums" />
                    </div>
                    <Button type="submit" className="h-11" disabled={pack.isPending}>
                      {pack.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Confirm count
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-400">{ful.source === "ww"
                  ? "Nothing was picked for this order. The office can take it off the trip from the Orders page."
                  : "Nothing was picked for this order. The office must ship or delete it in NetSuite."}</p>
            )}

            <div className="grid gap-2">
              {lines.map((line) => (
                <LineRow key={line.id} line={line} active={line.id === current?.id} onSelect={() => setSelectedId(line.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
