// Orders inbox (outbound picking design, slice C): open NetSuite sales and
// transfer orders at mapped warehouses, with the office's plan (truck, trip,
// picker) and what blocks each order from the floor. Read-only; rows arrive
// through the netsuite-orders edge function. The office still plans trips on
// the NetSuite Fulfill Orders page (O1).
//
// Layout follows Inventory Search: fixed page height, a compact filter card,
// and a table card whose header stays put while only the rows scroll.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { normalizeScannerText } from "@/lib/scan-input";
import { formatDate, formatDateTime, formatNumber } from "@/features/shared/core-types";
import { TableFrame } from "@/features/shared/resource-forms";
import { BarcodeScanButton } from "@/components/barcode-scan-button";
import { HintButton } from "@/components/hint-button";
import { RecordCount } from "@/components/record-count";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  ORDERS_INBOX_QUERY_KEY,
  blockReasons,
  committedPercent,
  fetchInbox,
  fetchPollState,
  orderPlan,
  type InboxRow,
  type OrderKindFilter,
  type OrderViewFilter,
} from "./orders-inbox-core";
import { OrderDetailSheet } from "./order-detail-sheet";
import { OrdersSyncButton } from "./orders-sync-button";

const PAGE_SIZE = 100;
const COLUMN_COUNT = 11;
const SYNC_ROLES = ["admin", "developer", "warehouse_manager", "warehouse_supervisor"];
const KINDS: { value: OrderKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sales", label: "Sales" },
  { value: "transfer", label: "Transfer" },
];
const VIEWS: { value: OrderViewFilter; label: string }[] = [
  { value: "open", label: "All open" },
  { value: "unplanned", label: "Not planned" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "printed", label: "Printed, no IF" },
];
const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" className="h-7 px-2 text-xs" variant={active ? "default" : "outline"} onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  );
}

function OrderRow({ row, onOpen }: { row: InboxRow; onOpen: () => void }) {
  const reasons = blockReasons(row);
  const pct = committedPercent(row);
  const plan = orderPlan(row);
  // A plan that is only on the SO (no fulfillment yet) is shown muted.
  const planClass = plan.source === "order" ? "text-muted-foreground" : undefined;
  const planTitle = plan.source === "order" ? "On the order only. The office has not made a fulfillment yet." : undefined;
  return (
    <TableRow className="cursor-pointer even:bg-muted/30 hover:bg-muted/50" onClick={onOpen}>
      <TableCell className="font-mono font-medium">{row.order_number}</TableCell>
      <TableCell>{row.order_type === "transfer" ? "Transfer" : "Sales"}</TableCell>
      <TableCell className="max-w-[18rem] truncate" title={row.order_type === "transfer" ? undefined : row.customer_name ?? undefined}>
        {row.order_type === "transfer" ? `To ${row.destination_location_name ?? "?"}` : row.customer_name ?? "Unknown customer"}
      </TableCell>
      <TableCell>{row.delivery_zone ?? "—"}</TableCell>
      <TableCell>{formatDate(row.requested_ship_date)}</TableCell>
      <TableCell className="text-right tabular-nums">{formatNumber(row.line_count)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", pct < 100 && "text-amber-700 dark:text-amber-400")}>{pct}%</TableCell>
      <TableCell className={planClass} title={planTitle}>{plan.truck ?? "—"}</TableCell>
      <TableCell className={planClass} title={planTitle}>{plan.trip ?? "—"}</TableCell>
      <TableCell className={planClass} title={planTitle}>{plan.picker ?? "—"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {plan.source === "fulfillment" && (
            <Badge variant="default" className={FLAG_CLASS}>{row.latest_fulfillment_number} Picked</Badge>
          )}
          {reasons.map((r) => (
            <Badge key={r.code} variant={r.tone === "block" ? "destructive" : "outline"} className={FLAG_CLASS}>{r.label}</Badge>
          ))}
          {row.credit_review_required && !row.on_credit_hold && (
            <Badge variant="outline" className={cn(FLAG_CLASS, "border-amber-500 text-amber-700 dark:text-amber-400")}>Credit review</Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function OrdersInboxPage() {
  const netsuiteActive = useNetSuiteActive();
  const { roles } = useAuth();
  const canSync = roles.some((role) => SYNC_ROLES.includes(role));
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<OrderKindFilter>("all");
  const [view, setView] = useState<OrderViewFilter>("open");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<InboxRow | null>(null);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...ORDERS_INBOX_QUERY_KEY, search, kind, view, limit],
    queryFn: () => fetchInbox({ search, kind, view, limit }),
    enabled: netsuiteActive,
    placeholderData: keepPreviousData,
  });
  const { data: pollState } = useQuery({
    queryKey: [...ORDERS_INBOX_QUERY_KEY, "poll-state"],
    queryFn: fetchPollState,
    enabled: netsuiteActive,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastRun = pollState?.find((p) => p.key === "orders")?.last_run_at ?? null;
  const hasFilters = search !== "" || kind !== "all" || view !== "open";

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE_SIZE);
  };
  const runSearch = (value: string) => resetAnd(() => setSearch(value.trim()));
  const clearFilters = () =>
    resetAnd(() => {
      setSearchInput("");
      setSearch("");
      setKind("all");
      setView("open");
    });

  if (!netsuiteActive) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Orders</h2>
        <p className="text-sm text-muted-foreground">Orders come from NetSuite. Set up the NetSuite connection in Settings &gt; Integrations to use this page.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">Orders</h2>
          <HintButton label="Orders hints">
            Open sales and transfer orders from NetSuite for your warehouse. The office plans trucks, trips and pickers on the
            NetSuite Fulfill Orders page; a muted truck or trip is on the order only, with no fulfillment yet. Scan the pick-ticket
            QR to find an order. Click a row for its lines and fulfillments.
          </HintButton>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{lastRun ? `Synced ${formatDateTime(lastRun)}` : "Not synced yet"}</span>
          {canSync && <OrdersSyncButton />}
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 p-3">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch(searchInput);
            }}
          >
            <div className="relative min-w-0 flex-1">
              <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order number, customer, or scan the pick-ticket QR"
                className="h-11 min-w-0 pl-10 pr-20 sm:pr-48"
                aria-label="Search orders"
              />
              <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
                <RecordCount className="hidden sm:inline" isLoading={isLoading} isFiltering={search !== ""} visible={rows.length} total={total} />
                <Button type="button" className="h-8 px-2 text-xs" variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
                  Clear
                </Button>
              </div>
            </div>
            <BarcodeScanButton
              className="h-11 w-20 sm:w-24"
              title="Scan the pick-ticket QR or an order number"
              onScan={(value) => {
                const scanned = normalizeScannerText(value);
                setSearchInput(scanned);
                runSearch(scanned);
              }}
            />
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</span>
            {KINDS.map((k) => (
              <FilterButton key={k.value} active={kind === k.value} onClick={() => resetAnd(() => setKind(k.value))}>{k.label}</FilterButton>
            ))}
            <span className="ml-3 mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Show</span>
            {VIEWS.map((v) => (
              <FilterButton key={v.value} active={view === v.value} onClick={() => resetAnd(() => setView(v.value))}>{v.label}</FilterButton>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 min-w-0 flex-1 p-0">
          <TableFrame className="h-full min-w-0 flex-1">
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Ship to</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Ship date</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Committed</TableHead>
                  <TableHead>Truck</TableHead>
                  <TableHead>Trip</TableHead>
                  <TableHead>Picker</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-destructive" colSpan={COLUMN_COUNT}>
                      Could not load orders: {error instanceof Error ? error.message : String(error)}
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={COLUMN_COUNT}>Loading…</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={COLUMN_COUNT}>
                      {hasFilters ? "No orders match these filters." : "No open orders yet. A manager can sync them from NetSuite."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => <OrderRow key={row.id} row={row} onOpen={() => setSelected(row)} />)
                )}
                {rows.length < total && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={COLUMN_COUNT} className="py-2 text-center">
                      <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                        {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Load more
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableFrame>
        </CardContent>
      </Card>

      <OrderDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
