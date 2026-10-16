// Settings > Integrations: NetSuite units of measure (outbound picking design,
// slice A). Runs the netsuite-units edge function, which mirrors unitstype /
// unitstypeuom into uom_types / uom_units and sets each linked product's unit
// type and stock/sale/purchase units. Shown only once NetSuite is active.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, Ruler } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NetSuiteSection } from "@/features/admin/netsuite-section";
import { formatNumber } from "@/features/shared/core-types";
import { supabase } from "@/integrations/supabase/client";

const UNITS_SUMMARY_KEY = ["settings", "netsuite-units", "summary"] as const;

type ImportResult = {
  ok?: boolean;
  types?: number;
  units?: number;
  unitsSkipped?: number;
  items?: number;
  productsLinked?: number;
  productsUpdated?: number;
  unavailable?: boolean;
  message?: string;
  error?: string;
};

async function countRows(table: "uom_types" | "uom_units" | "products", filter?: (q: any) => any) {
  let query: any = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export function NetSuiteUnitsCard() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const summary = useQuery({
    queryKey: UNITS_SUMMARY_KEY,
    queryFn: async () => {
      const [types, units, unmapped, products] = await Promise.all([
        countRows("uom_types"),
        countRows("uom_units"),
        countRows("uom_units", (q) => q.is("package_type_id", null)),
        countRows("products", (q) => q.not("uom_type_id", "is", null)),
      ]);
      const { data: last } = await supabase
        .from("uom_types")
        .select("last_synced_at")
        .not("last_synced_at", "is", null)
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return { types, units, unmapped, products, lastSyncedAt: last?.last_synced_at ?? null };
    },
  });

  const runImport = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-units", { body: { action: "import" } });
      const result = (data ?? null) as ImportResult | null;
      if (result?.unavailable) throw new Error(result.message ?? "NetSuite is unavailable");
      if (error || !result?.ok) throw new Error(result?.error ?? (error instanceof Error ? error.message : "Unit import failed"));
      toast.success(
        `Imported ${formatNumber(result.types ?? 0)} unit types (${formatNumber(result.units ?? 0)} units); ` +
          `${formatNumber(result.productsUpdated ?? 0)} of ${formatNumber(result.productsLinked ?? 0)} linked products updated`,
      );
      await queryClient.invalidateQueries({ queryKey: UNITS_SUMMARY_KEY });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const s = summary.data;
  return (
    <NetSuiteSection
      value="units"
      icon={<Ruler className="h-4 w-4" />}
      title="NetSuite units"
      description="Unit types (e.g. BL-6BG = bale of 6 bags) and each imported item's stock, sale and purchase units."
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Unit types</dt>
            <dd className="font-semibold">{s ? formatNumber(s.types) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Units</dt>
            <dd className="font-semibold">{s ? formatNumber(s.units) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Units with no package type</dt>
            <dd className="font-semibold">{s ? formatNumber(s.unmapped) : "—"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Products with units</dt>
            <dd className="font-semibold">{s ? formatNumber(s.products) : "—"}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={running} onClick={() => void runImport()}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Import units from NetSuite
          </Button>
          <span className="text-xs text-muted-foreground">
            {s?.lastSyncedAt ? `Last imported ${new Date(s.lastSyncedAt).toLocaleString()}` : "Not imported yet"}.
            Only items already imported into WW get units.
          </span>
        </div>
      </div>
    </NetSuiteSection>
  );
}
