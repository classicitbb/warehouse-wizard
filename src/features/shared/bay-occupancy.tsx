// Bay and bin occupancy views used by put-away, moves and the bay browser.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  Camera,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildBayOccupancyGrid,
  checkLocationOccupancy,
  displayRackLocationCode,
  getBayOccupancy,
  getBinOccupancy,
  getWarehouseBayOccupancy,
  type LocationOccupancyFixResult,
  type WarehouseBayGroup,
} from "@/lib/wms-core";
import { requestCopilotReport } from "@/features/copilot/report-request";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { isBaySelectorCode, normalizeScannerText } from "@/lib/scan-input";

export function BinCapacityBar({ locationCode }: { locationCode: string; taskId?: string }) {
  const { data } = useQuery({
    queryKey: ["bin-occupancy", locationCode],
    queryFn: () => getBinOccupancy(locationCode),
    enabled: locationCode.length >= 2,
    staleTime: 0,
  });

  if (!data || !locationCode) return null;

  const { maxPallets, occupiedPallets, status } = data;
  const pct = maxPallets > 0 ? Math.min(100, Math.round((occupiedPallets / maxPallets) * 100)) : 0;
  const isFull = maxPallets > 0 && occupiedPallets >= maxPallets;
  const isNearFull = pct >= 80 && !isFull;
  const isBlocked = status !== "active";

  if (isBlocked) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Location unavailable (status: {status})
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Bin capacity</span>
        <span className={cn(isFull ? "text-red-600 font-semibold" : isNearFull ? "text-amber-600" : "text-green-700")}>
          {occupiedPallets} / {maxPallets} pallets
        </span>
      </div>
      <Progress
        value={pct}
        className={cn(
          "h-2",
          isFull ? "[&>div]:bg-red-500" : isNearFull ? "[&>div]:bg-amber-500" : "[&>div]:bg-green-500",
        )}
      />
      {isFull && (
        <p className="text-xs font-medium text-red-600 dark:text-red-400">
          Location FULL — scan a different location
        </p>
      )}
    </div>
  );
}

/**
 * Bay picker shared by Put-away and Location Moves.
 *
 * `zoneFilter` and `onScanInstead` are optional: Put-away passes both (it knows
 * which zone the operator is working and offers a jump back to the camera),
 * Location Moves passes neither and gets the unfiltered list with no Scan
 * button. Both screens get the same touch targets.
 */
export function WarehouseBayBrowserDialog({
  open,
  warehouseId,
  zoneFilter,
  onSelectBay,
  onScanInstead,
  onClose,
}: {
  open: boolean;
  warehouseId: string;
  zoneFilter?: string;
  onSelectBay: (bayCode: string) => void;
  onScanInstead?: () => void;
  onClose: () => void;
}) {
  const { data: bays = [], isLoading, error } = useQuery<WarehouseBayGroup[]>({
    queryKey: ["warehouse-bay-occupancy", warehouseId],
    queryFn: () => getWarehouseBayOccupancy(warehouseId),
    staleTime: 30_000,
    enabled: open && Boolean(warehouseId),
  });

  // Collapsible zone state – all expanded by default
  const [collapsedZones, setCollapsedZones] = useState<Set<string>>(new Set());
  const toggleZone = (zk: string) =>
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zk)) next.delete(zk);
      else next.add(zk);
      return next;
    });

  const normalizedZoneFilter = normalizeScannerText(zoneFilter);

  // Group by zone (ordered by zone name), then by aisle within each zone
  const zoneGroups = useMemo(() => {
    const zoneMap = new Map<string, { zoneName: string; aisles: Map<string, WarehouseBayGroup[]> }>();
    for (const bay of bays) {
      const zk = bay.zoneCode || "__no_zone__";
      if (!zoneMap.has(zk)) zoneMap.set(zk, { zoneName: bay.zoneName || "", aisles: new Map() });
      const zone = zoneMap.get(zk)!;
      const ak = bay.aisle ?? "";
      if (!zone.aisles.has(ak)) zone.aisles.set(ak, []);
      zone.aisles.get(ak)!.push(bay);
    }
    return Array.from(zoneMap.entries())
      .sort(([, a], [, b]) => a.zoneName.localeCompare(b.zoneName))
      .map(([zk, { zoneName, aisles }]) => ({
        zoneKey: zk,
        zoneName,
        aisles: Array.from(aisles.entries())
          .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
          .map(([aisleCode, grpBays]) => ({ aisleCode, bays: grpBays })),
      }));
  }, [bays]);

  // Narrow to the zone the operator is already working in, but never strand
  // them on an empty dialog: an unmatched filter falls back to every zone.
  const visibleZoneGroups = useMemo(() => {
    if (!normalizedZoneFilter) return zoneGroups;
    const matches = zoneGroups.filter((zone) => {
      const zoneKey = normalizeScannerText(zone.zoneKey);
      const zoneName = normalizeScannerText(zone.zoneName);
      return zoneKey === normalizedZoneFilter ||
        zoneKey.startsWith(normalizedZoneFilter) ||
        zoneName.includes(normalizedZoneFilter);
    });
    return matches.length > 0 ? matches : zoneGroups;
  }, [normalizedZoneFilter, zoneGroups]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3 pr-6">
            <div>
              <DialogTitle>Select a bay</DialogTitle>
              <DialogDescription>Tap a bay to load its locations into the scan field.</DialogDescription>
            </div>
            {onScanInstead ? (
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onScanInstead}>
                <Camera className="mr-2 h-4 w-4" />
                Scan
              </Button>
            ) : null}
          </div>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading rack locations…
          </div>
        )}
        {error && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Could not load rack locations.
          </div>
        )}
        {!isLoading && !error && bays.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No rack locations configured for this warehouse.</p>
        )}
        <div className="divide-y divide-border/40">
          {visibleZoneGroups.map((zone) => {
            const collapsed = collapsedZones.has(zone.zoneKey);
            return (
              <div key={zone.zoneKey} className="py-3 first:pt-1">
                {/* Zone header – tap to collapse / expand */}
                <button
                  type="button"
                  onClick={() => toggleZone(zone.zoneKey)}
                  className="flex w-full items-center justify-between gap-2 pb-1 text-left"
                >
                  <span className="text-xs font-semibold uppercase tracking-widest text-foreground/80">
                    {zone.zoneName || "Unassigned"}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
                      collapsed && "-rotate-90",
                    )}
                  />
                </button>

                {/* Aisles within zone */}
                {!collapsed && (
                  <div className="mt-1.5 space-y-3">
                    {zone.aisles.map((aisleGroup) => (
                      <div key={aisleGroup.aisleCode}>
                        {/* Aisle separator line with code on the left */}
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-mono text-[10px] font-semibold text-muted-foreground whitespace-nowrap">
                            {aisleGroup.aisleCode}
                          </span>
                          <div className="h-px flex-1 bg-border/50" />
                        </div>
                        {/* Bay cards – single horizontal flex row, wraps on overflow */}
                        <div className="flex flex-wrap gap-1.5">
                          {aisleGroup.bays.map((bay) => {
                            const pct = bay.totalCapacity > 0 ? bay.totalOccupied / bay.totalCapacity : 0;
                            const isFull = bay.totalCapacity > 0 && bay.totalOccupied >= bay.totalCapacity;
                            const isNearFull = pct >= 0.7;
                            return (
                              <button
                                key={bay.bayCode}
                                type="button"
                                disabled={isFull}
                                onClick={() => { onSelectBay(bay.bayCode); onClose(); }}
                                className={cn(
                                  "flex min-h-[4.25rem] min-w-[3.75rem] flex-col gap-1 rounded-md border p-3 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                  isFull
                                    ? "cursor-not-allowed border-muted bg-muted/40 opacity-60"
                                    : "border-border bg-card hover:bg-secondary/60",
                                )}
                              >
                                <span className="font-mono font-semibold text-foreground leading-none">
                                  {bay.aisle}-{bay.bay}
                                </span>
                                <span className="text-muted-foreground leading-none">
                                  {bay.totalOccupied}/{bay.totalCapacity}
                                </span>
                                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                                  <div
                                    className={cn(
                                      "h-full rounded-full transition-all",
                                      isFull ? "bg-red-500" : isNearFull ? "bg-amber-500" : "bg-green-500",
                                    )}
                                    style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
                                  />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Operator self-service fix for a bay that shows stock with nothing in it.
 * Checks the location first and only clears what it can prove is a leftover
 * record. Cleared stock becomes "missing" (never deleted) so Status > Missing
 * pallets is the undo. Anything it cannot explain is handed to the copilot.
 */
export function LocationOccupancyFixDialog({
  locationCode,
  open,
  onOpenChange,
  onFixed,
}: {
  locationCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFixed?: () => void;
}) {
  const queryClient = useQueryClient();
  const [result, setResult] = useState<LocationOccupancyFixResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    checkLocationOccupancy(locationCode, false)
      .then((res) => { if (!cancelled) setResult(res); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Check failed"); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [open, locationCode]);

  async function applyFix() {
    setBusy(true);
    setError(null);
    try {
      const res = await checkLocationOccupancy(locationCode, true);
      setResult(res);
      toast.success(`${res.cleared} leftover record(s) cleared from ${res.location_code}`, {
        description: "The pallets are listed as missing — recover them from Status if they turn up.",
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["bin-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["pick-bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["warehouse-bay-occupancy"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
        queryClient.invalidateQueries({ queryKey: ["status-pallets"] }),
      ]);
      onFixed?.();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The location could not be cleared");
    } finally {
      setBusy(false);
    }
  }

  const phantoms = [...(result?.phantom_balances ?? []), ...(result?.phantom_pallets ?? [])];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Check {displayRackLocationCode(locationCode)}</DialogTitle>
          <DialogDescription>
            Use this when the bay is empty on the floor but the system still shows pallets in it.
          </DialogDescription>
        </DialogHeader>

        {busy && !result ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking the location…
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {result ? (
          <div className="grid gap-3 text-sm">
            <div className="rounded-md border border-border bg-secondary/20 px-3 py-2">
              <div>Real pallets found: <strong>{result.stored_pallets}</strong></div>
              <div>Records with no pallet behind them: <strong>{result.phantom_count}</strong></div>
            </div>

            {phantoms.length > 0 ? (
              <ul className="grid gap-1">
                {phantoms.map((row, index) => (
                  <li key={`${row.pallet_barcode ?? "row"}-${index}`} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    <span className="font-mono">{row.pallet_barcode ?? "unknown pallet"}</span>
                    {row.quantity != null ? <> · qty {row.quantity}</> : null}
                    {row.reason ? <> · {row.reason}</> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing to clear — every record here has a real pallet behind it. If the bay is empty on the floor,
                report it so it can be looked at.
              </p>
            )}
          </div>
        ) : null}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {result && result.phantom_count === 0 ? (
            <Button
              variant="secondary"
              onClick={() => {
                requestCopilotReport({
                  message: `Location ${displayRackLocationCode(locationCode)} shows ${result.stored_pallets} pallet(s) stored, but the bay is empty on the floor. The location check found nothing to clear. Please help me sort it out.`,
                });
                onOpenChange(false);
              }}
            >
              <Bot className="mr-2 h-4 w-4" /> Ask the copilot
            </Button>
          ) : (
            <Button disabled={busy || !result || result.phantom_count === 0} onClick={applyFix}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Clear {result?.phantom_count ?? 0} record(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Bin grid for one bay, shared by Put-away and Location Moves.
 *
 * `onContentReady` fires once the grid has data (or has failed) so a caller can
 * scroll it into view; Put-away uses it, Location Moves renders in place and
 * omits it. Both screens get the per-cell occupancy-fix affordance.
 */
export function BayOccupancyGrid({
  locationCode,
  selectedLocationCode,
  onSelect,
  onContentReady,
}: {
  locationCode: string;
  selectedLocationCode?: string;
  onSelect: (locationCode: string) => void;
  onContentReady?: () => void;
}) {
  const isBayScan = isBaySelectorCode(locationCode);
  const selectedLocation = selectedLocationCode?.trim().toUpperCase() ?? "";
  const [fixLocation, setFixLocation] = useState<string | null>(null);
  // Held in a ref so an inline arrow from the caller does not re-fire the effect.
  const onContentReadyRef = useRef(onContentReady);
  onContentReadyRef.current = onContentReady;
  const { data, error, isLoading } = useQuery({
    queryKey: ["bay-occupancy", locationCode],
    queryFn: () => getBayOccupancy(locationCode),
    enabled: locationCode.length >= 2,
    staleTime: 0,
  });

  useEffect(() => {
    if (isLoading || (!data && !error)) return;
    const timer = setTimeout(() => onContentReadyRef.current?.(), 0);
    return () => clearTimeout(timer);
  }, [data, error, isLoading, locationCode]);

  if (isLoading && !data) {
    return (
      <div className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
        Loading bay locations…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        Bay locations could not load. Scan again or refresh the page.
      </div>
    );
  }

  if (!data || data.cells.length === 0) {
    return isBayScan ? (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        No active rack locations found for this bay barcode.
      </div>
    ) : null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>Bay {data.aisle ?? "?"}-{data.bay ?? "?"}</span>
        <span>{data.cells.filter((cell) => cell.status === "active" && !cell.isFull).length} open</span>
      </div>
      <div className="grid gap-2">
        {buildBayOccupancyGrid(data.cells).map((row) => (
          <div
            key={`level-${row[0]?.level ?? "unknown"}`}
            className="grid gap-2"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
            {row.map((slot) => {
              const cell = slot.cell;
              if (!cell) {
                return (
                  <div
                    key={`empty-${slot.level}-${slot.position}`}
                    aria-hidden="true"
                    className="min-h-16 rounded-md border border-dashed border-border/60 bg-background/40"
                  />
                );
              }

              const available = cell.status === "active" && !cell.isFull;
              const selected = selectedLocation.length > 0 && cell.locationCode.toUpperCase() === selectedLocation;
              return (
                <div key={cell.locationId} className="relative">
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => onSelect(cell.locationCode)}
                    className={cn(
                      "min-h-16 w-full rounded-md border px-2 py-2 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                      selected
                        ? "animate-pulse border-cyan-400 bg-cyan-50 text-cyan-950 ring-2 ring-cyan-400 dark:bg-cyan-950/50 dark:text-cyan-50"
                        : available
                        ? "border-green-500 bg-green-50 text-green-950 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-100"
                        : "cursor-not-allowed border-muted bg-muted text-muted-foreground opacity-70",
                    )}
                  >
                    <span className="block font-mono font-semibold">{cell.locationCode}</span>
                    <span className="mt-1 block">{cell.occupiedPallets}/{cell.maxPallets} pallets</span>
                    <span className="block">{selected && available ? "Selected" : available ? "Available" : cell.status !== "active" ? cell.status : "Full"}</span>
                  </button>
                  {cell.occupiedPallets > 0 ? (
                    <button
                      type="button"
                      title="Bay looks empty? Check and clear leftover stock records"
                      aria-label={`Check occupancy for ${cell.locationCode}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setFixLocation(cell.locationCode);
                      }}
                      className="absolute right-1 top-1 rounded p-1 text-muted-foreground hover:bg-background/80 hover:text-foreground"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {fixLocation ? (
        <LocationOccupancyFixDialog
          locationCode={fixLocation}
          open={Boolean(fixLocation)}
          onOpenChange={(next) => { if (!next) setFixLocation(null); }}
        />
      ) : null}
    </div>
  );
}
