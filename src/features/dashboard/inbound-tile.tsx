// Command Center "Inbound" tile: open NetSuite inbound shipments, one row per container.
// Falls back to the plain receipts queue when NetSuite is unavailable or the user may not browse it.

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/features/shared/core-types";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { containersOf } from "@/features/receiving/inbound-shipment-lines";
import { listInboundShipments, type InboundShipmentSummary } from "@/features/receiving/netsuite-inbound";
import { QueueTile, type BoardData } from "./board-tile-content";

const ROWS = 5;
// A dashboard load is not a user search: ask NetSuite once, then reuse it for a few minutes.
const STALE_MS = 5 * 60_000;

type ContainerRow = { key: string; container: string; shipment: string; eta: string | null };

function toRows(shipments: InboundShipmentSummary[]): ContainerRow[] {
  return shipments.flatMap((shipment) => {
    const containers = containersOf(shipment);
    return (containers.length > 0 ? containers : [shipment.number]).map((container) => ({
      key: `${shipment.id}|${container}`,
      container,
      shipment: shipment.number,
      eta: shipment.expectedDeliveryDate,
    }));
  });
}

export function InboundTile({ data }: { data: BoardData }) {
  const to = useTenantPath().toPath;
  const list = useQuery({
    queryKey: ["netsuite-inbound-list", "dashboard"] as const,
    queryFn: () => listInboundShipments({ search: "", status: "open", sort: "expected_delivery", direction: "asc", limit: 25 }),
    staleTime: STALE_MS,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (list.isError || (list.data && list.data.kind !== "ok")) return <QueueTile data={data} label="Inbound" />;

  const rows = list.data?.kind === "ok" ? toRows(list.data.shipments) : [];
  const more = list.data?.kind === "ok" && list.data.hasMore;
  const openReceipts = data.metrics?.openReceipts ?? 0;

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold leading-5 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0">
            <PackageCheck />
            <span>Inbound containers</span>
          </h3>
          <Link to={to("/receiving?inbound=1")} className="shrink-0 rounded-sm text-3xl font-bold leading-none tabular-nums transition hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {list.isLoading ? "…" : `${formatNumber(rows.length)}${more ? "+" : ""}`}
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">Open NetSuite shipments, soonest first</p>
      </div>
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No open containers in NetSuite.</p>
      ) : (
        <ul className="grid gap-1">
          {rows.slice(0, ROWS).map((row) => (
            <li key={row.key}>
              <Link
                to={to(`/receiving?inbound=${encodeURIComponent(row.container)}`)}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-sm transition-colors hover:bg-secondary/60"
              >
                <span className="min-w-0">
                  <span className="block break-words font-medium leading-tight">{row.container}</span>
                  {row.shipment !== row.container ? <span className="block break-words text-xs text-muted-foreground">{row.shipment}</span> : null}
                </span>
                <Badge variant="outline" className="shrink-0 whitespace-nowrap text-xs">{row.eta ? `ETA ${row.eta}` : "No ETA"}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link to={to("/receiving?inbound=1")} className="inline-flex items-center gap-1 self-start rounded-sm text-sm font-medium text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {rows.length > ROWS ? `${formatNumber(rows.length - ROWS)} more — open workflow` : "Open workflow"}
        {openReceipts > 0 ? ` · ${formatNumber(openReceipts)} receipt${openReceipts === 1 ? "" : "s"} in progress` : ""}
      </Link>
    </div>
  );
}
