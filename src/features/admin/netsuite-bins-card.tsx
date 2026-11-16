// Settings > Integrations: NetSuite bins (Phase 1 task W5). Runs the
// netsuite-bins edge function, which matches each WW location to a NetSuite bin
// with the same number at the warehouse's mapped NetSuite location, links the
// ones that exist and creates the rest in batches. Shown only once NetSuite is active.
import { useState } from "react";
import { Boxes, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NetSuiteSection } from "@/features/admin/netsuite-section";
import { formatNumber } from "@/features/shared/core-types";
import { supabase } from "@/integrations/supabase/client";

type PlanWarehouse = {
  warehouseId: string;
  warehouseName: string;
  netsuiteLocationName: string | null;
  usesBins: boolean;
  locations: number;
  linked: number;
  toLink: number;
  toCreate: number;
  inactiveMatches: number;
};

type BinsResult = {
  ok?: boolean;
  warehouses?: PlanWarehouse[];
  unmappedWarehouses?: string[];
  linked?: number;
  created?: number;
  failed?: number;
  errors?: { code: string; error: string }[];
  remaining?: number;
  unavailable?: boolean;
  message?: string;
  error?: string;
};

// Safety cap on automatic follow-up batches in one click.
const MAX_ROUNDS = 30;

async function callBins(action: "preview" | "sync"): Promise<BinsResult> {
  const { data, error } = await supabase.functions.invoke("netsuite-bins", { body: { action } });
  const result = (data ?? null) as BinsResult | null;
  if (result?.unavailable) throw new Error(result.message ?? "NetSuite is unavailable");
  if (error || !result?.ok) throw new Error(result?.error ?? (error instanceof Error ? error.message : "Bin sync failed"));
  return result;
}

export function NetSuiteBinsCard() {
  const [plan, setPlan] = useState<BinsResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "sync" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ code: string; error: string }[]>([]);

  const preview = async () => {
    setBusy("preview");
    try {
      setPlan(await callBins("preview"));
      setErrors([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy("sync");
    let linked = 0;
    let created = 0;
    const failures: { code: string; error: string }[] = [];
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const result = await callBins("sync");
        linked += result.linked ?? 0;
        created += result.created ?? 0;
        failures.push(...(result.errors ?? []));
        setPlan(result);
        setProgress(`Created ${formatNumber(created)} bins, ${formatNumber(result.remaining ?? 0)} to go…`);
        // Stop when done, or when a batch made no progress (errors repeat).
        if (!result.remaining || !result.created) break;
      }
      setErrors(failures.slice(0, 20));
      if (failures.length) toast.error(`${formatNumber(failures.length)} bins failed. See the list below.`);
      else toast.success(`Linked ${formatNumber(linked)} and created ${formatNumber(created)} NetSuite bins`);
      setPlan(await callBins("preview"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const rows = plan?.warehouses ?? [];
  const pending = rows.reduce((n, w) => n + w.toLink + (w.usesBins ? w.toCreate : 0), 0);

  return (
    <NetSuiteSection
      value="bins"
      icon={<Boxes className="h-4 w-4" />}
      title="NetSuite bins"
      description="Mirror each WW location as a NetSuite bin with the same code, so pallets show in the same bin in both systems."
    >
      <div className="space-y-4">
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">Warehouse</th>
                  <th className="py-1 pr-3 font-normal">NetSuite location</th>
                  <th className="py-1 pr-3 text-right font-normal">Locations</th>
                  <th className="py-1 pr-3 text-right font-normal">Linked</th>
                  <th className="py-1 pr-3 text-right font-normal">To link</th>
                  <th className="py-1 text-right font-normal">To create</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.warehouseId} className="border-t">
                    <td className="py-1 pr-3">{w.warehouseName}</td>
                    <td className="py-1 pr-3">
                      {w.netsuiteLocationName ?? "Not found"}
                      {!w.usesBins && <span className="ml-1 text-xs text-destructive">(Use Bins is off)</span>}
                    </td>
                    <td className="py-1 pr-3 text-right">{formatNumber(w.locations)}</td>
                    <td className="py-1 pr-3 text-right">{formatNumber(w.linked)}</td>
                    <td className="py-1 pr-3 text-right">
                      {formatNumber(w.toLink)}
                      {w.inactiveMatches > 0 && <span className="text-xs text-muted-foreground"> ({w.inactiveMatches} inactive)</span>}
                    </td>
                    <td className="py-1 text-right">{formatNumber(w.toCreate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {plan && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No warehouse is mapped to a NetSuite location yet. Map one under NetSuite warehouses first.</p>
        )}
        {plan?.unmappedWarehouses?.length ? (
          <p className="text-sm text-destructive">Not mapped to a NetSuite location, so skipped: {plan.unmappedWarehouses.join(", ")}.</p>
        ) : null}
        {errors.length > 0 && (
          <ul className="space-y-1 text-xs text-destructive">
            {errors.map((e, i) => (
              <li key={`${e.code}-${i}`}>
                <span className="font-mono">{e.code}</span>: {e.error}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void preview()}>
            {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Check bins
          </Button>
          <Button type="button" disabled={busy !== null || !plan || pending === 0} onClick={() => void sync()}>
            {busy === "sync" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync {plan ? formatNumber(pending) : ""} bins to NetSuite
          </Button>
          <span className="text-xs text-muted-foreground">
            {progress ?? "Check first: nothing is written until you sync. Hidden locations are skipped; bins are never deleted."}
          </span>
        </div>
      </div>
    </NetSuiteSection>
  );
}
