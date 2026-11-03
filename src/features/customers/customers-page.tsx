// Customers page: the ship-to customers mirrored from NetSuite (outbound picking
// design, slice B). Read-only here; rows arrive through the netsuite-customers
// edge function. Separate from Clients, which are the stock owners.
//
// Layout follows the Products page (ResourcePage), like every Setup page:
// title and description, settings gear, plain search with the record count,
// quick-filter buttons, and a dense table whose header stays pinned.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { formatDateTime } from "@/features/shared/core-types";
import { TableFrame } from "@/features/shared/resource-forms";
import { RecordCount } from "@/components/record-count";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomersSyncButtons } from "./customers-sync-buttons";

export const CUSTOMERS_QUERY_KEY = ["customers"] as const;

const PAGE_SIZE = 50;
const COLUMN_COUNT = 7;
const ZONES = ["North", "South", "East", "West", "Central"] as const;
type ZoneFilter = "all" | "none" | (typeof ZONES)[number];
type CreditFilter = "all" | "hold" | "review";
// Same cell density as the Products table.
const CELL = "px-4 py-1 text-xs leading-tight";

type ShipAddress = { addr1?: string | null; addr2?: string | null; addr3?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string | null };

type CustomerListRow = {
  id: string;
  customer_number: string;
  name: string;
  delivery_zone: string | null;
  default_ship_address: ShipAddress | null;
  email: string | null;
  phone: string | null;
  on_credit_hold: boolean;
  credit_review_required: boolean;
  ship_complete: boolean;
  last_synced_at: string | null;
};

function formatAddress(address: ShipAddress | null): string {
  if (!address) return "";
  return [address.addr1, address.addr2, address.addr3, address.city, address.state, address.zip, address.country]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** PostgREST `or()` treats commas and parentheses as syntax, so they are dropped from the term. */
function cleanSearch(value: string): string {
  return value.replace(/[,()%*\\]/g, " ").trim();
}

async function fetchCustomers(opts: { search: string; zone: ZoneFilter; credit: CreditFilter; limit: number }) {
  let query = supabase
    .from("customers")
    .select("id, customer_number, name, delivery_zone, default_ship_address, email, phone, on_credit_hold, credit_review_required, ship_complete, last_synced_at", { count: "exact" })
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(opts.limit);
  const term = cleanSearch(opts.search);
  if (term) query = query.or(`name.ilike.%${term}%,customer_number.ilike.%${term}%`);
  if (opts.zone === "none") query = query.is("delivery_zone", null);
  else if (opts.zone !== "all") query = query.eq("delivery_zone", opts.zone);
  if (opts.credit === "hold") query = query.eq("on_credit_hold", true);
  if (opts.credit === "review") query = query.eq("credit_review_required", true);
  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: (data ?? []) as unknown as CustomerListRow[], total: count ?? 0 };
}

/** A Products-style quick filter: click to apply, click again to clear. */
function QuickFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="sm" variant={active ? "default" : "outline"} className="h-7 px-2.5 text-xs" onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  );
}

export function CustomersPage() {
  const netsuiteActive = useNetSuiteActive();
  const { roles } = useAuth();
  const canSync = roles.some((role) => role === "admin" || role === "developer");
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [credit, setCredit] = useState<CreditFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...CUSTOMERS_QUERY_KEY, search.trim(), zone, credit, limit],
    queryFn: () => fetchCustomers({ search, zone, credit, limit }),
    enabled: netsuiteActive,
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasQuickFilters = zone !== "all" || credit !== "all";

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE_SIZE);
  };
  const toggleZone = (value: ZoneFilter) => resetAnd(() => setZone((current) => (current === value ? "all" : value)));
  const toggleCredit = (value: CreditFilter) => resetAnd(() => setCredit((current) => (current === value ? "all" : value)));

  if (!netsuiteActive) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Customers</h2>
        <p className="text-sm text-muted-foreground">Customers come from NetSuite. Set up the NetSuite connection in Settings &gt; Integrations to use this page.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-3 md:items-end">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold">Customers</h2>
          <p className="text-sm text-muted-foreground">Ship-to customers mirrored from NetSuite, with delivery zone and credit flags. Edit them in NetSuite. Clients (stock owners) are managed separately.</p>
        </div>
        {canSync && <CustomersSyncButtons />}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 bg-muted pl-9 pr-20"
          placeholder="Search customers…"
          value={search}
          onChange={(event) => resetAnd(() => setSearch(event.target.value))}
          aria-label="Search customers"
        />
        <RecordCount className="absolute right-3 top-1/2 -translate-y-1/2" isLoading={isLoading} isFiltering={Boolean(search.trim())} visible={rows.length} total={total} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ZONES.map((z) => (
          <QuickFilter key={z} active={zone === z} onClick={() => toggleZone(z)}>{z}</QuickFilter>
        ))}
        <QuickFilter active={zone === "none"} onClick={() => toggleZone("none")}>No zone</QuickFilter>
        <QuickFilter active={credit === "hold"} onClick={() => toggleCredit("hold")}>Credit hold</QuickFilter>
        <QuickFilter active={credit === "review"} onClick={() => toggleCredit("review")}>Credit review</QuickFilter>
        {hasQuickFilters ? (
          <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs text-muted-foreground" onClick={() => resetAnd(() => { setZone("all"); setCredit("all"); })}>
            Clear all
          </Button>
        ) : null}
      </div>

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          <TableFrame className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Zone</TableHead>
                  <TableHead>Credit</TableHead>
                  <TableHead>Ship-to</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Synced</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {error ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-destructive" colSpan={COLUMN_COUNT}>
                      Could not load customers: {error instanceof Error ? error.message : String(error)}
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={COLUMN_COUNT}>Loading…</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-24 text-center text-muted-foreground" colSpan={COLUMN_COUNT}>
                      {search.trim() || hasQuickFilters ? "No customers match these filters." : "No customers yet. An admin can import them from NetSuite."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const address = formatAddress(row.default_ship_address);
                    const contact = [row.phone, row.email].filter(Boolean).join(" · ");
                    return (
                      <TableRow key={row.id} className="even:bg-muted/30">
                        <TableCell className={`${CELL} font-mono`}>{row.customer_number}</TableCell>
                        <TableCell className={CELL}>
                          {row.name}
                          {row.ship_complete && <Badge variant="outline" className="ml-2">Ship complete</Badge>}
                        </TableCell>
                        <TableCell className={CELL}>{row.delivery_zone ?? <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className={CELL}>
                          <div className="flex items-center gap-1">
                            {row.on_credit_hold && <Badge variant="destructive">Credit hold</Badge>}
                            {row.credit_review_required && <Badge variant="outline" className="border-amber-400 text-amber-600">Review</Badge>}
                            {!row.on_credit_hold && !row.credit_review_required && <span className="text-muted-foreground">OK</span>}
                          </div>
                        </TableCell>
                        <TableCell className={`${CELL} max-w-[22rem] truncate`} title={address}>{address || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className={`${CELL} max-w-[16rem] truncate`} title={contact}>{contact || <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className={`${CELL} text-muted-foreground`}>{formatDateTime(row.last_synced_at)}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
            {rows.length < total ? (
              <div className="pointer-events-none sticky bottom-3 left-0 flex w-full justify-center">
                <Button type="button" variant="secondary" className="pointer-events-auto shadow-md" onClick={() => setLimit((current) => current + PAGE_SIZE)} disabled={isFetching}>
                  {isFetching ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Loading more…
                    </>
                  ) : (
                    "Load 50 more"
                  )}
                </Button>
              </div>
            ) : null}
          </TableFrame>
        </CardContent>
      </Card>
    </div>
  );
}
