// Customers page header: admin/developer buttons that run the netsuite-customers
// edge function. "Import all" reads every active customer; "Sync changes" reads
// only customers modified since the newest one already stored.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/features/shared/core-types";
import { Button } from "@/components/ui/button";

type SyncResult = {
  ok?: boolean;
  mode?: "import" | "delta";
  fetched?: number;
  inserted?: number;
  updated?: number;
  skipped?: number;
  unavailable?: boolean;
  message?: string;
  error?: string;
};

export function CustomersSyncButtons() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState<"import" | "delta" | null>(null);

  const run = async (action: "import" | "delta") => {
    setRunning(action);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-customers", { body: { action } });
      const result = (data ?? null) as SyncResult | null;
      if (result?.unavailable) throw new Error(result.message ?? "NetSuite is unavailable");
      if (error || !result?.ok) throw new Error(result?.error ?? (error instanceof Error ? error.message : "Customer sync failed"));
      toast.success(
        `${result.mode === "delta" ? "Synced changes" : "Imported customers"}: ${formatNumber(result.inserted ?? 0)} new, ${formatNumber(result.updated ?? 0)} updated` +
          (result.skipped ? `, ${formatNumber(result.skipped)} skipped` : ""),
      );
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={running !== null} onClick={() => void run("delta")}>
        {running === "delta" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        Sync changes
      </Button>
      <Button type="button" disabled={running !== null} onClick={() => void run("import")}>
        {running === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
        Import all from NetSuite
      </Button>
    </div>
  );
}
