// One shipment in the inbound browser: header facts, and a preview of every PO and
// every item on it that loads when the card is opened.
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
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

/** How many containers a card names before it shortens to "first +N more". */
const CONTAINERS_SHOWN = 3;

/** Container text for the card headline: all of them when few, the first plus a count when many. */
function containerText(containers: string[]): string {
  if (containers.length === 0) return "No container number";
  const label = containers.length > 1 ? "Containers" : "Container";
  if (containers.length <= CONTAINERS_SHOWN) return `${label} ${containers.join(", ")}`;
  return `${label} ${containers.slice(0, CONTAINERS_SHOWN).join(", ")} +${containers.length - CONTAINERS_SHOWN} more`;
}

/** Partially received is the state that needs a second look, so it is tinted; received is quiet. */
function statusClasses(code: string | null): string {
  if (code === "partiallyReceived") return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (code === "received") return "border-border bg-transparent text-muted-foreground";
  return "";
}

export function InboundShipmentCard({
  shipment,
  expanded,
  online,
  receiving,
  draftCountFor,
  putawayCountFor = () => 0,
  checkingWork = false,
  onShowPutaway,
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
  putawayCountFor?: (container: string) => number;
  checkingWork?: boolean;
  onShowPutaway?: () => void;
  onToggle: () => void;
  /** `container` is "" when NetSuite holds no container number for the shipment. */
  onReceive: (container: string) => void;
  onShowDrafts: (container: string) => void;
}) {
  const containers = containersOf(shipment);
  const targets = containers.length > 0 ? containers : [""];
  const draftCount = targets.reduce((n, c) => n + draftCountFor(c), 0);
  const putawayCount = targets.reduce((n, c) => n + putawayCountFor(c), 0);
  const multi = containers.length > 1;
  const detail = useQuery({ ...inboundDetailQuery(shipment.id), enabled: expanded && online });
  const result = detail.data;
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li
      className={cn(
        "group overflow-hidden rounded-lg border bg-card transition-colors",
        expanded ? "border-primary/50" : "border-border hover:border-primary/40 hover:bg-secondary/20",
      )}
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
          <span className="grid min-w-0 gap-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-semibold tracking-tight" title={containers.join(", ")}>
                {containerText(containers)}
              </span>
              <Badge variant="secondary" className={cn("shrink-0", statusClasses(shipment.status.code))}>
                {shipment.status.label || "Unknown status"}
              </Badge>
              {draftCount > 0 && <Badge variant="outline" className="shrink-0">Drafts in progress</Badge>}
              {putawayCount > 0 && <Badge variant="outline" className="shrink-0">In Put-Away</Badge>}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/90">{shipment.number || `Shipment ${shipment.id}`}</span>
              <span className="tabular-nums">Expected {formatInboundDate(shipment.expectedDeliveryDate)}</span>
              <span className="tabular-nums">{shipment.poCount} PO{shipment.poCount === 1 ? "" : "s"}</span>
              <span className="tabular-nums">{shipment.lineCount} line{shipment.lineCount === 1 ? "" : "s"}</span>
              <span className="tabular-nums">{shipment.quantityExpected.toLocaleString()} units</span>
            </span>
            {shipment.billOfLading && (
              <span className="truncate text-xs text-muted-foreground" title={`Bill of lading ${shipment.billOfLading}`}>
                BL {shipment.billOfLading}
              </span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          {targets.map((container) => {
            const drafted = draftCountFor(container);
            const label = multi ? `Receive ${container}` : "Receive this shipment";
            return drafted > 0 ? (
              <Button key={container || "none"} type="button" size="sm" variant="outline" className="whitespace-nowrap" onClick={() => onShowDrafts(container)}>
                {multi ? `${container}: ` : ""}Show drafts ({drafted})
              </Button>
            ) : putawayCountFor(container) > 0 ? (
              <Button key={container || "none"} type="button" size="sm" variant="outline" onClick={onShowPutaway} disabled={!onShowPutaway}>
                {multi ? `${container}: ` : ""}Go to Put-Away
              </Button>
            ) : (
              <Button
                key={container || "none"}
                type="button"
                size="sm"
                className="whitespace-nowrap"
                disabled={!online || receiving || checkingWork}
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
        <div className="grid gap-3 border-t border-border bg-secondary/15 p-3 text-sm">
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
                <section key={po.poId} className="grid gap-1 rounded-md border border-border/60 bg-card p-2.5">
                  <h4 className="text-sm font-medium">
                    PO {po.poNumber}
                    {po.vendor ? <span className="font-normal text-muted-foreground"> · {po.vendor}</span> : null}
                  </h4>
                  <ul className="grid gap-0.5">
                    {po.lines.map((line) => (
                      <li
                        key={line.shipmentLineId}
                        className={cn(
                          "flex flex-wrap items-baseline justify-between gap-x-3 text-xs",
                          line.quantityRemaining <= 0 ? "text-foreground/60" : "text-foreground",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <Check className={cn("h-3 w-3 shrink-0", line.quantityRemaining <= 0 ? "text-muted-foreground" : "invisible")} />
                          <span className="min-w-0 truncate">{line.itemName || line.description || "Item"}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-foreground/90">
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
