// Orders inbox (outbound picking design, slice C): open NetSuite sales and
// transfer orders at mapped warehouses, with the office's plan (truck, trip,
// picker) and what blocks each order from the floor. Read-only; rows arrive
// through the netsuite-orders edge function. The office still plans trips on
// the NetSuite Fulfill Orders page (O1).
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { formatDate, formatDateTime, formatNumber } from "@/features/shared/core-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
const SYNC_ROLES = ["admin", "developer", "warehouse_manager", "warehouse_supervisor"];
const VIEWS: { value: OrderViewFilter; label: string }[] = [
  { value: "open", label: "All open" },
  { value: "unplanned", label: "Not planned" },
  { value: "planned", label: "Planned" },
  { value: "blocked", label: "Blocked" },
  { value: "printed", label: "Printed, no fulfillment" },
];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} className="h-8 rounded-full" onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  );
}

function PlanCell({ row }: { row: InboxRow }) {
  const plan = orderPlan(row);
  if (!plan.source) return <span className="text-muted-foreground">Not planned</span>;
  return (
    <div className="text-sm">
      <div>{plan.truck ?? "No truck"}{plan.trip ? ` · Trip ${plan.trip}` : ""}</div>
      <div className="text-xs text-muted-foreground">
        {plan.source === "fulfillment" ? `${row.latest_fulfillment_number} · Picked` : "On the order only"}
        {plan.picker ? ` · ${plan.picker}` : ""}
      </div>
    </div>
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

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE_SIZE);
  };

  if (!netsuiteActive) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold">Orders</h2>
          <p className="text-sm text-muted-foreground">Orders come from NetSuite. Set up the NetSuite connection in Settings &gt; Integrations to use this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">Orders</h2>
          <p className="text-sm text-muted-foreground">
            Open sales and transfer orders from NetSuite. The office plans trucks and trips on the Fulfill Orders page.
            {lastRun ? ` Last sync ${formatDateTime(lastRun)}.` : " Not synced yet."}
          </p>
        </div>
        {canSync && <OrdersSyncButton />}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Order inbox</CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : `${formatNumber(rows.length)} of ${formatNumber(total)} orders shown`}
          </CardDescription>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              resetAnd(() => setSearch(searchInput.trim()));
            }}
          >
            <div className="relative flex-1">
              <ScanLine className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Order number, customer, or scan the pick-ticket QR"
                className="pl-8"
                aria-label="Search orders"
              />
            </div>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Type</span>
            <Chip active={kind === "all"} onClick={() => resetAnd(() => setKind("all"))}>All</Chip>
            <Chip active={kind === "sales"} onClick={() => resetAnd(() => setKind("sales"))}>Sales</Chip>
            <Chip active={kind === "transfer"} onClick={() => resetAnd(() => setKind("transfer"))}>Transfer</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Show</span>
            {VIEWS.map((v) => (
              <Chip key={v.value} active={view === v.value} onClick={() => resetAnd(() => setView(v.value))}>{v.label}</Chip>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">Could not load orders: {error instanceof Error ? error.message : String(error)}</p>
          ) : !isLoading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {total === 0 && !search && kind === "all" && view === "open"
                ? "No open orders yet. A manager can sync them from NetSuite."
                : "No orders match these filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Ship to</TableHead>
                    <TableHead className="hidden md:table-cell">Ship date</TableHead>
                    <TableHead className="hidden md:table-cell">Committed</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Flags</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const reasons = blockReasons(row);
                    const pct = committedPercent(row);
                    return (
                      <TableRow key={row.id} className="cursor-pointer" onClick={() => setSelected(row)}>
                        <TableCell>
                          <div className="font-mono">{row.order_number}</div>
                          <div className="text-xs text-muted-foreground">
                            {row.order_type === "transfer" ? "Transfer" : "Sales"} · {formatNumber(row.line_count)} line{row.line_count === 1 ? "" : "s"}
                            {row.fulfillment_count > 1 ? ` · ${row.fulfillment_count} fulfillments` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.order_type === "transfer" ? (
                            <span className="font-medium">To {row.destination_location_name ?? "unknown location"}</span>
                          ) : (
                            <div>
                              <div className="font-medium">{row.customer_name ?? "Unknown customer"}</div>
                              {row.delivery_zone && <Badge variant="secondary" className="mt-1">{row.delivery_zone}</Badge>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="hidden whitespace-nowrap md:table-cell">{formatDate(row.requested_ship_date)}</TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className={cn(pct < 100 && "text-amber-700 dark:text-amber-400")}>{pct}%</span>
                        </TableCell>
                        <TableCell><PlanCell row={row} /></TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {reasons.map((r) => (
                              <Badge key={r.code} variant={r.tone === "block" ? "destructive" : "outline"}>{r.label}</Badge>
                            ))}
                            {row.credit_review_required && !row.on_credit_hold && (
                              <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Credit review</Badge>
                            )}
                            {reasons.length === 0 && !row.credit_review_required && <span className="text-muted-foreground">OK</span>}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          {rows.length < total && (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" disabled={isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {isFetching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <OrderDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
