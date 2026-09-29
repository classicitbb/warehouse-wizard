// "Look up in NetSuite" under the PO number on the New Shipment dialog: fetches
// the document the operator scanned or typed, shows what NetSuite still
// expects, and loads those lines into the shipment.
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  lookupNetSuiteDocument,
  type NetSuiteLookupCandidate,
  type NetSuiteLookupDocument,
} from "@/features/receiving/netsuite-lookup";
import { documentTypeForReceipt, lineVariance, type SkippedNetSuiteLine } from "@/features/receiving/netsuite-lookup-lines";
import type { ReceivingShipmentLineState } from "@/features/receiving/receiving-form-state";

type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "message"; tone: "info" | "error"; text: string; candidates?: NetSuiteLookupCandidate[] }
  | { kind: "found"; document: NetSuiteLookupDocument };

const SKIP_REASON: Record<SkippedNetSuiteLine["reason"], string> = {
  item_not_imported: "item not imported into Warehouse Wizard yet",
  nothing_remaining: "nothing left to receive",
};

/** Returns the lines that could not be loaded, so the panel can say why. */
export type LoadDocument = (document: NetSuiteLookupDocument) => SkippedNetSuiteLine[];

export function NetSuiteLookupPanel({
  receiptType,
  documentNumber,
  online,
  onLoadDocument,
}: {
  receiptType: string;
  documentNumber: string;
  online: boolean;
  onLoadDocument: LoadDocument;
}) {
  const documentType = documentTypeForReceipt(receiptType);
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  const [skipped, setSkipped] = useState<SkippedNetSuiteLine[]>([]);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);

  // A different number or receipt type makes any previous result stale.
  useEffect(() => {
    setState({ kind: "idle" });
    setSkipped([]);
    setLoadedCount(null);
  }, [documentNumber, documentType]);

  if (!documentType) return null;
  const label = documentType === "purchase_order" ? "purchase order" : "transfer order";
  const number = documentNumber.trim();

  async function lookup() {
    if (!documentType) return;
    setState({ kind: "loading" });
    setSkipped([]);
    setLoadedCount(null);
    try {
      const result = await lookupNetSuiteDocument(documentType, number);
      if (result.kind === "found") setState({ kind: "found", document: result.document });
      else if (result.kind === "not_found") setState({ kind: "message", tone: "info", text: `NetSuite has no ${label} numbered ${number}.` });
      else if (result.kind === "ambiguous") {
        setState({
          kind: "message",
          tone: "error",
          text: `More than one NetSuite ${label} is numbered ${number}. Ask the office which one this is.`,
          candidates: result.candidates,
        });
      } else setState({ kind: "message", tone: "error", text: result.message });
    } catch (err) {
      setState({ kind: "message", tone: "error", text: err instanceof Error ? err.message : "The NetSuite lookup failed." });
    }
  }

  function load(document: NetSuiteLookupDocument) {
    const notLoaded = onLoadDocument(document);
    setSkipped(notLoaded);
    setLoadedCount(document.lines.length - notLoaded.length);
  }

  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={!online || !number || state.kind === "loading"}
        title={!online ? "Connect to the network to look up NetSuite" : undefined}
        onClick={lookup}
      >
        {state.kind === "loading" ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Search data-icon="inline-start" />}
        Look up {label} in NetSuite
      </Button>

      {state.kind === "message" && (
        <div role={state.tone === "error" ? "alert" : "status"} className={state.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          <p>{state.text}</p>
          {state.candidates?.length ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
              {state.candidates.map((c) => (
                <li key={c.internalId}>{[c.number, c.entity, c.status, c.tranDate].filter(Boolean).join(" · ")}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      {state.kind === "found" && (
        <div className="grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-sm">
          <p className="font-medium">
            {state.document.number}
            {state.document.status.label ? ` · ${state.document.status.label}` : ""}
            {state.document.entity ? ` · ${state.document.entity.name}` : ""}
          </p>
          <ul className="grid gap-1">
            {state.document.lines.map((line, i) => (
              <li key={line.lineKey ?? `${line.lineNumber}-${i}`} className="flex flex-wrap justify-between gap-x-3 text-xs text-foreground/80">
                <span className="min-w-0 truncate">{line.itemName || line.description || "Item"}</span>
                <span>ordered {line.quantityOrdered} · received {line.quantityReceived} · remaining {line.quantityRemaining}</span>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" className="w-fit" onClick={() => load(state.document)}>
            Load lines into shipment
          </Button>
        </div>
      )}

      {loadedCount !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          Loaded {loadedCount} line{loadedCount === 1 ? "" : "s"} from NetSuite.
        </p>
      )}
      {skipped.length > 0 && (
        <ul role="alert" className="list-disc pl-5 text-xs text-amber-600 dark:text-amber-400">
          {skipped.map((s, i) => (
            <li key={`${s.lineNumber}-${i}`}>
              Line {s.lineNumber ?? "?"} {s.itemName ? `(${s.itemName}) ` : ""}skipped: {SKIP_REASON[s.reason]}.
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Under a shipment line that came from NetSuite: what it expected, and how this differs. */
export function NetSuiteLineNote({ line }: { line: ReceivingShipmentLineState }) {
  if (!line.netsuite) return null;
  const variance = lineVariance(line);
  const { lineNumber, ordered, received, remaining } = line.netsuite;
  return (
    <p className="text-xs text-muted-foreground">
      NetSuite line {lineNumber ?? "?"} · ordered {ordered} · already received {received} · expecting {remaining}
      {variance && variance.kind !== "exact" ? (
        <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">
          · {variance.kind === "short" ? `short by ${variance.by}` : `over by ${variance.by}`}
        </span>
      ) : null}
    </p>
  );
}
