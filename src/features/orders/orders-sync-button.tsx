// Orders inbox header: runs the netsuite-orders poll on demand. "Sync now"
// reads changes since the last run; "Re-read all open" ignores the cursors.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, RotateCcw, Settings } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/features/shared/core-types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ORDERS_INBOX_QUERY_KEY } from "./orders-inbox-core";

type Totals = { inserted?: number; updated?: number; saved?: number; unmappedLines?: number };
type SyncResult = {
  ok?: boolean;
  message?: string;
  orders?: Totals | null;
  fulfillments?: Totals | null;
  unavailable?: boolean;
  error?: string;
};

export function OrdersSyncButton() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const run = async (action: "sync" | "full") => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-orders", { body: { action } });
      const result = (data ?? null) as SyncResult | null;
      if (result?.unavailable) throw new Error(result.message ?? "NetSuite is unavailable");
      if (error || !result?.ok) throw new Error(result?.error ?? (error instanceof Error ? error.message : "Order sync failed"));
      if (!result.orders) {
        toast.warning(result.message ?? "Nothing to sync");
      } else {
        const o = result.orders;
        const f = result.fulfillments ?? {};
        toast.success(
          `Orders: ${formatNumber(o.inserted ?? 0)} new, ${formatNumber(o.updated ?? 0)} updated. Fulfillments: ${formatNumber(f.saved ?? 0)}.` +
            (o.unmappedLines ? ` ${formatNumber(o.unmappedLines)} lines have items not in WW.` : ""),
        );
      }
      await queryClient.invalidateQueries({ queryKey: ORDERS_INBOX_QUERY_KEY });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex shrink-0 gap-2">
      <Button type="button" variant="outline" disabled={running} onClick={() => void run("sync")}>
        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        Sync now
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="outline" aria-label="Order sync options" disabled={running}>
            <Settings className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem disabled={running} onSelect={() => void run("full")}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Re-read all open orders
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
