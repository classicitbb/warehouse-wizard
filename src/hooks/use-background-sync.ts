import { useEffect, useRef } from "react";
import { type QueryClient } from "@tanstack/react-query";
import { flushOfflineQueue } from "@/lib/offline-queue";
import { isActiveWorkInProgress } from "@/lib/active-work";

/** Refresh data after this many ms of being backgrounded. */
const BACKGROUND_STALE_MS = 2 * 60 * 1000;

/**
 * When the PWA returns to the foreground after being backgrounded:
 * - Always flush the offline queue (silent retry).
 * - Invalidate all queries when the app was hidden long enough that data
 *   could be meaningfully stale (default: 2 minutes).
 *
 * This keeps operators seeing fresh task lists and inventory counts after
 * locking their device or switching apps, without any manual refresh.
 */
export function useBackgroundSync(queryClient: QueryClient) {
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenDuration = hiddenAtRef.current != null ? Date.now() - hiddenAtRef.current : 0;
      hiddenAtRef.current = null;

      void flushOfflineQueue({ silent: true });

      if (hiddenDuration >= BACKGROUND_STALE_MS) {
        if (isActiveWorkInProgress()) {
          // Operator is mid put-away/pick/receive — do NOT remount their
          // screen. Mark a curated set of read-only lists as stale so the
          // next navigation gets fresh data, but don't trigger a refetch
          // that could blank the active dialog.
          const safeKeys = [
            ["putaway-tasks"],
            ["putaway-task-history"],
            ["pick-lists"],
            ["warehouse-bay-occupancy"],
            ["dashboard-metrics"],
            ["options"],
          ] as const;
          for (const key of safeKeys) {
            void queryClient.invalidateQueries({ queryKey: key as unknown as string[], refetchType: "none" });
          }
          return;
        }
        void queryClient.invalidateQueries();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [queryClient]);
}
