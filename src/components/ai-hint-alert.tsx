import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, Copy, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  buildAiHintReport,
  describeHintJob,
  dismissAiHintItem,
  getAiHintQueueSnapshot,
  installAiHintAutoRetry,
  retryAiHintItem,
  subscribeAiHintQueue,
  type AiHintQueueItem,
} from "@/lib/ai-hint-queue";

const emptySnapshot: AiHintQueueItem[] = [];

/**
 * Floating in-app alert for AI hint (ai_product_hints) write failures.
 * Shows the exact backend error so it can be retried or reported.
 */
export function AiHintFailureAlert() {
  const items = useSyncExternalStore(
    subscribeAiHintQueue,
    getAiHintQueueSnapshot,
    () => emptySnapshot,
  );

  useEffect(() => {
    installAiHintAutoRetry();
  }, []);

  if (!items.length) return null;
  const latest = items[items.length - 1];

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(items.map(buildAiHintReport).join("\n\n"));
      toast.success("Error details copied for reporting");
    } catch {
      toast.error("Could not copy error details");
    }
  };

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 w-[min(24rem,calc(100vw-2rem))]">
      <Alert variant="destructive" className="pointer-events-auto bg-background shadow-lg">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="pr-6">
          AI hint update failed{items.length > 1 ? ` (${items.length} queued)` : ""}
        </AlertTitle>
        <AlertDescription className="space-y-2">
          <p className="text-xs">{describeHintJob(latest.job)}</p>
          <p className="break-words font-mono text-[11px] leading-snug">
            {latest.lastErrorCode ? `[${latest.lastErrorCode}] ` : ""}
            {latest.lastError}
          </p>
          <p className="text-[11px] opacity-80">
            Attempt {latest.attempts}
            {latest.exhausted ? " — automatic retries paused" : " — retrying automatically"}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => void retryAiHintItem(latest.id)}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Retry
            </Button>
            <Button size="sm" variant="outline" onClick={copyReport}>
              <Copy className="mr-1 h-3.5 w-3.5" />
              Copy details
            </Button>
          </div>
        </AlertDescription>
        <button
          type="button"
          aria-label="Dismiss AI hint failure alert"
          className="absolute right-2 top-2 rounded p-1 opacity-70 hover:opacity-100"
          onClick={() => dismissAiHintItem(latest.id)}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Alert>
    </div>
  );
}

export default AiHintFailureAlert;
