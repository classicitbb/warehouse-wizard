// Receiving > View inbound: browse NetSuite inbound shipments (containers), search by
// shipment, container or PO number, preview every PO and item, and hand one to the
// New Shipment dialog. Read-only: nothing here writes to NetSuite.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, Loader2, PackageSearch, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { resolveContainerScanValue, normalizeScannerText } from "@/lib/scan-input";
import { cn } from "@/lib/utils";
import { InboundShipmentCard } from "@/features/receiving/inbound-shipment-card";
import { containersOf, findShipmentDrafts } from "@/features/receiving/inbound-shipment-lines";
import {
  INBOUND_MAX_ROWS,
  INBOUND_PAGE_SIZE,
  inboundDetailQuery,
  listInboundShipments,
  type InboundShipmentDetail,
  type InboundShipmentSummary,
  type InboundSortDirection,
  type InboundSortKey,
  type InboundStatusFilter,
} from "@/features/receiving/netsuite-inbound";

const STATUS_OPTIONS: { value: InboundStatusFilter; label: string }[] = [
  { value: "open", label: "Ready to receive" },
  { value: "received", label: "Received" },
  { value: "all", label: "All" },
];

const SORT_LABELS: Record<InboundSortKey, string> = {
  expected_delivery: "Expected delivery",
  shipment_number: "Shipment number",
  status: "Status",
};

type DraftLike = { container_number?: string | null; notes?: string | null };

export function InboundBrowserDialog({
  open,
  onOpenChange,
  online,
  initialSearch,
  drafts,
  onReceive,
  onShowDrafts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  online: boolean;
  /** Pre-fills the search, e.g. the shipment number from the PO lookup. */
  initialSearch: string;
  drafts: DraftLike[];
  /** Loads the shipment into the New Shipment dialog. Returns true when it did, so the browser can close. */
  onReceive: (shipment: InboundShipmentSummary, detail: InboundShipmentDetail, container: string) => boolean;
  onShowDrafts: (shipment: InboundShipmentSummary, container: string) => void;
}) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<InboundStatusFilter>("open");
  const [sort, setSort] = useState<InboundSortKey>("expected_delivery");
  const [direction, setDirection] = useState<InboundSortDirection>("asc");
  const [limit, setLimit] = useState(INBOUND_PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  // Opening the browser starts from the caller's search (or blank) with the default view.
  useEffect(() => {
    if (!open) return;
    setSearchInput(initialSearch);
    setSearch(initialSearch);
    setStatus("open");
    setLimit(INBOUND_PAGE_SIZE);
    setExpandedId(null);
  }, [open, initialSearch]);

  // Search runs after a pause, not on every keystroke: NetSuite's concurrency is shared.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setLimit(INBOUND_PAGE_SIZE);
    }, 400);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const list = useQuery({
    queryKey: ["netsuite-inbound-list", search, status, sort, direction, limit] as const,
    queryFn: () => listInboundShipments({ search, status, sort, direction, limit }),
    enabled: open && online,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const result = list.data;
  const shipments = useMemo(() => (result?.kind === "ok" ? result.shipments : []), [result]);
  // Drafts standing for each container of each shipment, so the card can block exactly the one already started.
  const draftCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shipment of shipments) {
      const containers = containersOf(shipment);
      for (const container of containers.length > 0 ? containers : [""]) {
        counts.set(`${shipment.id}|${container}`, findShipmentDrafts(drafts, shipment, container || undefined).length);
      }
    }
    return counts;
  }, [shipments, drafts]);

  function applyScan(value: unknown) {
    const container = resolveContainerScanValue(value);
    setSearchInput(container.valid ? container.value : normalizeScannerText(value));
  }

  async function receive(shipment: InboundShipmentSummary, container: string) {
    setReceivingId(shipment.id);
    try {
      const detail = await queryClient.fetchQuery(inboundDetailQuery(shipment.id));
      if (detail.kind === "unavailable") {
        toast.error(detail.message);
        return;
      }
      if (onReceive(shipment, detail.detail, container)) onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load this shipment from NetSuite.");
    } finally {
      setReceivingId(null);
    }
  }

  const fetching = list.isFetching;
  const canLoadMore = result?.kind === "ok" && result.hasMore && limit < INBOUND_MAX_ROWS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-0.75rem)] max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-[calc(100vw-0.75rem)] flex-col gap-0 overflow-hidden bg-card p-0 text-card-foreground sm:h-[88vh] sm:max-w-[min(56rem,96vw)]">
        <DialogHeader className="border-b border-border px-3 py-2 sm:px-4 sm:py-3">
          <DialogTitle>Inbound shipments</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            From NetSuite. Pick a container to load its purchase orders and items into a new shipment.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 border-b border-border bg-secondary/25 px-3 py-2.5 sm:px-4">
          <div className="flex min-w-0 gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-9"
                aria-label="Search inbound shipments"
                placeholder="Shipment, container, or PO number"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
              />
            </div>
            <BarcodeScanButton title="Scan container, shipment, or PO" enableTextRecognition onScan={applyScan} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <div className="flex overflow-hidden rounded-md border border-border bg-background" role="group" aria-label="Shipment status">
              {STATUS_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-pressed={status === option.value}
                  className={cn(
                    "h-8 rounded-none border-r border-border px-3 text-xs font-medium last:border-r-0",
                    status === option.value
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => { setStatus(option.value); setLimit(INBOUND_PAGE_SIZE); }}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {result?.kind === "ok" && shipments.length > 0 && (
              <p role="status" className="text-xs tabular-nums text-muted-foreground">
                {shipments.length} shown{result.hasMore ? " · more available" : ""}
              </p>
            )}
            <div className="ml-auto flex items-center gap-1">
              <Select value={sort} onValueChange={(value) => { setSort(value as InboundSortKey); setLimit(INBOUND_PAGE_SIZE); }}>
                <SelectTrigger className="h-8 w-40 text-xs" aria-label="Sort by"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(SORT_LABELS) as InboundSortKey[]).map((key) => <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={direction === "asc" ? "Sorted ascending. Switch to descending" : "Sorted descending. Switch to ascending"}
                title={direction === "asc" ? "Soonest first" : "Latest first"}
                onClick={() => setDirection((d) => (d === "asc" ? "desc" : "asc"))}
              >
                <ArrowDownUp data-icon="inline-start" />
                {direction === "asc" ? "Soonest" : "Latest"}
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
          {!online && (
            <p role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              Connect to the network to browse NetSuite.
            </p>
          )}
          {online && list.isLoading && (
            <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading inbound shipments…
            </p>
          )}
          {online && list.isError && (
            <p role="alert" className="text-sm text-destructive">{list.error instanceof Error ? list.error.message : "The NetSuite lookup failed."}</p>
          )}
          {result?.kind === "unavailable" && <p role="alert" className="text-sm text-destructive">{result.message}</p>}
          {result?.kind === "ok" && shipments.length === 0 && (
            <div className="grid place-items-center gap-2 py-16 text-center">
              <PackageSearch className="h-7 w-7 text-muted-foreground/50" />
              <p role="status" className="text-sm text-muted-foreground">
                {search ? `No inbound shipments match "${search}".` : "No inbound shipments to show."}
                {status === "open" ? " Try All to include shipments that are already received." : ""}
              </p>
            </div>
          )}
          {shipments.length > 0 && (
            <ul className={cn("grid gap-2", fetching && "opacity-70")} aria-busy={fetching}>
              {shipments.map((shipment) => (
                <InboundShipmentCard
                  key={shipment.id}
                  shipment={shipment}
                  expanded={expandedId === shipment.id}
                  online={online}
                  receiving={receivingId === shipment.id}
                  draftCountFor={(container) => draftCounts.get(`${shipment.id}|${container}`) ?? 0}
                  onToggle={() => setExpandedId((current) => (current === shipment.id ? null : shipment.id))}
                  onReceive={(container) => void receive(shipment, container)}
                  onShowDrafts={(container) => onShowDrafts(shipment, container)}
                />
              ))}
            </ul>
          )}
          {canLoadMore && (
            <div className="flex justify-center pt-3">
              <Button type="button" variant="outline" size="sm" disabled={fetching} onClick={() => setLimit((n) => n + INBOUND_PAGE_SIZE)}>
                {fetching && <Loader2 className="animate-spin" data-icon="inline-start" />}
                Load more
              </Button>
            </div>
          )}
          {result?.kind === "ok" && result.hasMore && limit >= INBOUND_MAX_ROWS && (
            <p className="pt-3 text-center text-xs text-muted-foreground">Showing the first {INBOUND_MAX_ROWS}. Search to narrow the list.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
