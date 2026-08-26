import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { CONNECTION_RESTORED_EVENT } from "@/hooks/use-network-status";
import { isActiveWorkInProgress } from "@/lib/active-work";

/**
 * Heals the app in place when a dropped connection comes back: refreshes the
 * auth session (so a rotated token doesn't 401) and refetches live data.
 * No page reload, so nothing the operator typed is lost.
 */
export function ConnectionRecovery() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handleRestored = () => {
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session) await supabase.auth.refreshSession();
        } catch {
          // A failed refresh just means the next request re-authenticates.
        }
        await queryClient.refetchQueries({ type: "active" });
        toast.success("Back online", {
          id: "connection-restored",
          description: "Connection recovered and live data refreshed.",
        });
      })();
    };
    window.addEventListener(CONNECTION_RESTORED_EVENT, handleRestored);
    return () => window.removeEventListener(CONNECTION_RESTORED_EVENT, handleRestored);
  }, [queryClient]);

  return null;
}

const SEEN_VERSION_KEY = "warehouseWizard.whatsNew.seenVersion";

export type ReleaseSummary = { version: string; date: string; changes: string[] };

/**
 * Shows the release summary once per version, after the app reloads onto a
 * newer build. Never interrupts an active scan/confirm flow.
 */
export function WhatsNewOnUpdate({ release }: { release: ReleaseSummary }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = window.localStorage.getItem(SEEN_VERSION_KEY);
    } catch {
      return;
    }
    if (seen === release.version) return;
    if (!seen) {
      // First run in this browser — record silently, no popup.
      try {
        window.localStorage.setItem(SEEN_VERSION_KEY, release.version);
      } catch {
        /* no-op */
      }
      return;
    }

    const show = () => {
      if (isActiveWorkInProgress()) return false;
      setOpen(true);
      try {
        window.localStorage.setItem(SEEN_VERSION_KEY, release.version);
      } catch {
        /* no-op */
      }
      return true;
    };

    if (show()) return;
    // Busy on the floor: wait and retry until the flow is finished.
    const interval = window.setInterval(() => {
      if (show()) window.clearInterval(interval);
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [release.version]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[86vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            What's new in v{release.version}
          </DialogTitle>
          <DialogDescription>Warehouse Wizard just updated on this device. Here's what changed.</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[58vh] pr-4">
          <div className="grid gap-2 text-sm">
            {release.changes.map((change) => (
              <div key={change} className="rounded-md border border-border px-3 py-2">
                {change}
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
