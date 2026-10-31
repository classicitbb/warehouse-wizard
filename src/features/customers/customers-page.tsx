// Customers page: the ship-to customers mirrored from NetSuite (outbound picking
// design, slice B). Read-only here; rows arrive through the netsuite-customers
// edge function. Separate from Clients, which are the stock owners.
//
// Layout follows Inventory Search: fixed page height, a compact filter card,
// and a table card whose header stays put while only the rows scroll.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { formatDateTime } from "@/features/shared/core-types";
import { TableFrame } from "@/features/shared/resource-forms";
import { HintButton } from "@/components/hint-button";
import { RecordCount } from "@/components/record-count";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CustomersSyncButtons } from "./customers-sync-buttons";

export const CUSTOMERS_QUERY_KEY = ["customers"] as const;

const PAGE_SIZE = 100;
const COLUMN_COUNT = 7;
const ZONES = ["North", "South", "East", "West", "Central"] as const;
type ZoneFilter = "all" | "none" | (typeof ZONES)[number];
type CreditFilter = "all" | "hold" | "review";
const FLAG_CLASS = "px-1.5 py-0 text-[11px] font-medium";

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

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" className="h-7 px-2 text-xs" variant={active ? "default" : "outline"} onClick={onClick} aria-pressed={active}>
      {children}
    </Button>
  );
}

export function CustomersPage() {
  const netsuiteActive = useNetSuiteActive();
  const { roles } = useAuth();
  const canSync = roles.some((role) => role === "admin" || role === "developer");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [zone, setZone] = useState<ZoneFilter>("all");
  const [credit, setCredit] = useState<CreditFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: [...CUSTOMERS_QUERY_KEY, search, zone, credit, limit],
    queryFn: () => fetchCustomers({ search, zone, credit, limit }),
    enabled: netsuiteActive,
    placeholderData: keepPreviousData,
  });
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasFilters = search !== "" || zone !== "all" || credit !== "all";

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE_SIZE);
  };
  const clearFilters = () =>
    resetAnd(() => {
      setSearchInput("");
      setSearch("");
      setZone("all");
      setCredit("all");
    });

  if (!netsuiteActive) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">Customers</h2>
        <p className="text-sm text-muted-foreground">Customers come from NetSuite. Set up the NetSuite connection in Settings &gt; Integrations to use this page.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-semibold">Customers</h2>
          <HintButton label="Customers hints">
            Ship-to customers mirrored from NetSuite, with delivery zone and credit flags. Edit customers in NetSuite, not here.
            Clients (stock owners) are managed separately.
          </HintButton>
        </div>
        {canSync && <CustomersSyncButtons />}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 p-3">
          <form
            className="relative min-w-0"
            onSubmit={(event) => {
              event.preventDefault();
              resetAnd(() => setSearch(searchInput.trim()));
            }}
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search name or customer number"
              className="h-11 min-w-0 pl-10 pr-20 sm:pr-48"
              aria-label="Search customers"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2">
              <RecordCount className="hidden sm:inline" isLoading={isLoading} isFiltering={search !== ""} visible={rows.length} total={total} />
              <Button type="button" className="h-8 px-2 text-xs" variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
                Clear
              </Button>
            </div>
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone</span>
            <FilterButton active={zone === "all"} onClick={() => resetAnd(() => setZone("all"))}>All</FilterButton>
            {ZONES.map((z) => (
              <FilterButton key={z} active={zone === z} onClick={() => resetAnd(() => setZone(z))}>{z}</FilterButton>
            ))}
            <FilterButton active={zone === "none"} onClick={() => resetAnd(() => setZone("none"))}>No zone</FilterButton>
            <span className="ml-3 mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Credit</span>
            <FilterButton active={credit === "all"} onClick={() => resetAnd(() => setCredit("all"))}>All</FilterButton>
            <FilterButton active={credit === "hold"} onClick={() => resetAnd(() => setCredit("hold"))}>On hold</FilterButton>
            <FilterButton active={credit === "review"} onClick={() => resetAnd(() => setCredit("review"))}>Review</FilterButton>
          </div>
        </CardContent>
      </Card>

      <Card className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 min-w-0 flex-1 p-0">
          <TableFrame className="h-full min-w-0 flex-1">
            <Table className="[&_td]:whitespace-nowrap [&_th]:whitespace-nowrap">
              <TableHeader className="sticky top-0 z-20 bg-card shadow-sm">
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
                      {hasFilters ? "No customers match these filters." : "No customers yet. An admin can import them from NetSuite."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const address = formatAddress(row.default_ship_address);
                    const contact = [row.phone, row.email].filter(Boolean).join(" · ");
                    return (
                      <TableRow key={row.id} className="even:bg-muted/30 hover:bg-muted/50">
                        <TableCell className="font-mono">{row.customer_number}</TableCell>
                        <TableCell className="max-w-[18rem] truncate font-medium" title={row.name}>
                          {row.name}
                          {row.ship_complete && <Badge variant="outline" className={cn(FLAG_CLASS, "ml-2")}>Ship complete</Badge>}
                        </TableCell>
                        <TableCell>{row.delivery_zone ?? "—"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {row.on_credit_hold && <Badge variant="destructive" className={FLAG_CLASS}>Credit hold</Badge>}
                            {row.credit_review_required && (
                              <Badge variant="outline" className={cn(FLAG_CLASS, "border-amber-500 text-amber-700 dark:text-amber-400")}>Review</Badge>
                            )}
                            {!row.on_credit_hold && !row.credit_review_required && <span className="text-muted-foreground">OK</span>}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[22rem] truncate" title={address}>{address || "—"}</TableCell>
                        <TableCell className="max-w-[16rem] truncate" title={contact}>{contact || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatDateTime(row.last_synced_at)}</TableCell>
                      </TableRow>
                    );
                  })
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
    </div>
  );
}
