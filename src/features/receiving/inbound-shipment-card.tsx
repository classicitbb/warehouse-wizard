// One shipment in the inbound browser: header facts, and a preview of every PO and
// every item on it that loads when the card is opened.
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { inboundDetailQuery, type InboundShipmentSummary } from "@/features/receiving/netsuite-inbound";
import { containersOf } from "@/features/receiving/inbound-shipment-lines";

/** yyyy-mm-dd → a local, readable date, without the time-zone shift `new Date("2026-10-04")` causes. */
function formatInboundDate(iso: string | null): string {
  if (!iso) return "No date";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function InboundShipmentCard({
  shipment,
  expanded,
  online,
  receiving,
  draftCountFor,
  onToggle,
  onReceive,
  onShowDrafts,
}: {
  shipment: InboundShipmentSummary;
  expanded: boolean;
  online: boolean;
  receiving: boolean;
  /** Pallet drafts already standing for this container. When set, receiving it again is blocked. */
  draftCountFor: (container: string) => number;
  onToggle: () => void;
  /** `container` is "" when NetSuite holds no container number for the shipment. */
  onReceive: (container: string) => void;
  onShowDrafts: (container: string) => void;
}) {
  const containers = containersOf(shipment);
  const targets = containers.length > 0 ? containers : [""];
  const draftCount = targets.reduce((n, c) => n + draftCountFor(c), 0);
  const multi = containers.length > 1;
  const detail = useQuery({ ...inboundDetailQuery(shipment.id), enabled: expanded && online });
  const result = detail.data;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="grid min-w-0 gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{shipment.number || `Shipment ${shipment.id}`}</span>
              <Badge variant="secondary">{shipment.status.label || "Unknown status"}</Badge>
              {draftCount > 0 && <Badge variant="outline">Drafts in progress</Badge>}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {containers.length > 0 ? `${multi ? "Containers" : "Container"} ${containers.join(", ")}` : "No container number"}
              {shipment.billOfLading ? ` · BL ${shipment.billOfLading}` : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              Expected {formatInboundDate(shipment.expectedDeliveryDate)} · {shipment.poCount} PO{shipment.poCount === 1 ? "" : "s"} · {shipment.lineCount} line{shipment.lineCount === 1 ? "" : "s"} · {shipment.quantityExpected.toLocaleString()} units
            </span>
          </span>
        </button>
        <div className="flex flex-wrap gap-2">
          {targets.map((container) => {
            const drafted = draftCountFor(container);
            const label = multi ? `Receive ${container}` : "Receive this shipment";
            return drafted > 0 ? (
              <Button key={container || "none"} type="button" size="sm" variant="outline" onClick={() => onShowDrafts(container)}>
                {multi ? `${container}: ` : ""}Show drafts ({drafted})
              </Button>
            ) : (
              <Button
                key={container || "none"}
                type="button"
                size="sm"
                disabled={!online || receiving}
                title={!online ? "Connect to the network to load this shipment" : undefined}
                onClick={() => onReceive(container)}
              >
                {receiving && <Loader2 className="animate-spin" data-icon="inline-start" />}
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      {draftCount > 0 && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Pallet drafts for {multi ? "some of these containers are" : "this shipment are"} already in Receiving. Open or print those instead of starting again.
        </p>
      )}
      {multi && (
        <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          This shipment has {containers.length} containers. NetSuite does not say which PO lines are in which container, so receiving one loads every
          line: set each quantity to what is in that container.
        </p>
      )}

      {expanded && (
        <div className="grid gap-3 border-t border-border bg-secondary/10 p-3 text-sm">
          {detail.isLoading && (
            <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading purchase orders…</p>
          )}
          {detail.isError && (
            <p role="alert" className="text-destructive">{detail.error instanceof Error ? detail.error.message : "Could not load this shipment."}</p>
          )}
          {result?.kind === "unavailable" && <p role="alert" className="text-destructive">{result.message}</p>}
          {result?.kind === "ok" && (
            <>
              {!result.detail.receivedKnown && shipment.status.code !== "inTransit" && (
                <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
                  NetSuite did not report received quantities, so "expected" may include goods already received. Check before saving.
                </p>
              )}
              {result.detail.pos.length === 0 && <p className="text-muted-foreground">This shipment has no lines.</p>}
              {result.detail.pos.map((po) => (
                <section key={po.poId} className="grid gap-1">
                  <h4 className="text-sm font-medium">
                    PO {po.poNumber}
                    {po.vendor ? <span className="font-normal text-muted-foreground"> · {po.vendor}</span> : null}
                  </h4>
                  <ul className="grid gap-1">
                    {po.lines.map((line) => (
                      <li
                        key={line.shipmentLineId}
                        className={cn("flex flex-wrap justify-between gap-x-3 text-xs", line.quantityRemaining <= 0 ? "text-muted-foreground line-through" : "text-foreground/80")}
                      >
                        <span className="min-w-0 truncate">{line.itemName || line.description || "Item"}</span>
                        <span>
                          expected {line.quantityExpected}
                          {line.quantityReceived !== null ? ` · received ${line.quantityReceived}` : ""}
                          {line.unit ? ` ${line.unit}` : ""}
                          {!line.localProductId ? <span className="ml-1 text-amber-600 dark:text-amber-400">· item not imported</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      )}
    </li>
  );
}
