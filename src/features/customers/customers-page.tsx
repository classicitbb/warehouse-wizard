// Customers page: the ship-to customers mirrored from NetSuite (outbound picking
// design, slice B). Read-only here; rows arrive through the netsuite-customers
// edge function. Separate from Clients, which are the stock owners.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useNetSuiteActive } from "@/hooks/use-netsuite-active";
import { formatDateTime, formatNumber } from "@/features/shared/core-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CustomersSyncButtons } from "./customers-sync-buttons";

export const CUSTOMERS_QUERY_KEY = ["customers"] as const;

const PAGE_SIZE = 100;
const ZONES = ["North", "South", "East", "West", "Central"] as const;
type ZoneFilter = "all" | "none" | (typeof ZONES)[number];
type CreditFilter = "all" | "hold" | "review";

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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? "default" : "outline"} className="h-8 rounded-full" onClick={onClick} aria-pressed={active}>
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

  const resetAnd = (fn: () => void) => {
    fn();
    setLimit(PAGE_SIZE);
  };

  if (!netsuiteActive) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-2xl font-semibold">Customers</h2>
          <p className="text-sm text-muted-foreground">Customers come from NetSuite. Set up the NetSuite connection in Settings &gt; Integrations to use this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Customers</h2>
          <p className="text-sm text-muted-foreground">Ship-to customers mirrored from NetSuite, with delivery zone and credit flags. Clients (stock owners) are managed separately.</p>
        </div>
        {canSync && <CustomersSyncButtons />}
      </div>

      <Card>
        <CardHeader className="gap-3">
          <CardTitle className="text-base">Customer list</CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : `${formatNumber(rows.length)} of ${formatNumber(total)} active customers shown`}
          </CardDescription>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              resetAnd(() => setSearch(searchInput.trim()));
            }}
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search name or customer number"
                className="pl-8"
                aria-label="Search customers"
              />
            </div>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Zone</span>
            <Chip active={zone === "all"} onClick={() => resetAnd(() => setZone("all"))}>All</Chip>
            {ZONES.map((z) => (
              <Chip key={z} active={zone === z} onClick={() => resetAnd(() => setZone(z))}>{z}</Chip>
            ))}
            <Chip active={zone === "none"} onClick={() => resetAnd(() => setZone("none"))}>No zone</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Credit</span>
            <Chip active={credit === "all"} onClick={() => resetAnd(() => setCredit("all"))}>All</Chip>
            <Chip active={credit === "hold"} onClick={() => resetAnd(() => setCredit("hold"))}>On credit hold</Chip>
            <Chip active={credit === "review"} onClick={() => resetAnd(() => setCredit("review"))}>Credit review</Chip>
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-destructive">Could not load customers: {error instanceof Error ? error.message : String(error)}</p>
          ) : !isLoading && rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {total === 0 && !search && zone === "all" && credit === "all"
                ? "No customers yet. An admin can import them from NetSuite."
                : "No customers match these filters."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Credit</TableHead>
                    <TableHead className="hidden md:table-cell">Ship-to</TableHead>
                    <TableHead className="hidden lg:table-cell">Contact</TableHead>
                    <TableHead className="hidden lg:table-cell">Synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono">{row.customer_number}</TableCell>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.ship_complete && <Badge variant="outline" className="ml-2">Ship complete</Badge>}
                      </TableCell>
                      <TableCell>{row.delivery_zone ? <Badge variant="secondary">{row.delivery_zone}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.on_credit_hold && <Badge variant="destructive">Credit hold</Badge>}
                          {row.credit_review_required && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400">Review</Badge>}
                          {!row.on_credit_hold && !row.credit_review_required && <span className="text-muted-foreground">OK</span>}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-xs truncate md:table-cell" title={formatAddress(row.default_ship_address)}>
                        {formatAddress(row.default_ship_address) || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-sm lg:table-cell">
                        {[row.phone, row.email].filter(Boolean).join(" · ") || <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{formatDateTime(row.last_synced_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {rows.length < total && (
            <div className="mt-4 flex justify-center">
              <Button type="button" variant="outline" disabled={isFetching} onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                {isFetching && <Loader2 className={cn("mr-2 h-4 w-4 animate-spin")} />}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
