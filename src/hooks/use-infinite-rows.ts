import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_PAGE_SIZE = 50;

type SyncInput = {
  /** Rows currently available (may exceed the visible limit by one page probe). */
  loadedCount: number;
  /** Pause auto-loading while a fetch is already in flight. */
  isFetching?: boolean;
  /** Disable paging entirely (e.g. an active search reads the full set). */
  enabled?: boolean;
};

/**
 * Shared "auto-load the next page as you scroll" behaviour for every long list
 * in the app (inventory, locations, products, zones, reports, logs, emails).
 *
 * Usage: call the hook before the query (so `limit` can feed the query), then
 * call `sync()` during render with the loaded row count. `sync` returns whether
 * more rows are available, so the caller can render the manual fallback button.
 * Drop `sentinelRef` on an element at the bottom of the scrollable list.
 */
export function useInfiniteRows(options?: {
  pageSize?: number;
  /** Changing any of these resets back to the first page. */
  resetKeys?: ReadonlyArray<unknown>;
}) {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const [limit, setLimit] = useState(pageSize);

  const resetSignature = JSON.stringify(options?.resetKeys ?? []);
  useEffect(() => {
    setLimit(pageSize);
  }, [resetSignature, pageSize]);

  const loadMore = useCallback(() => setLimit((current) => current + pageSize), [pageSize]);

  const stateRef = useRef<Required<SyncInput>>({ loadedCount: 0, isFetching: false, enabled: true });
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const sync = ({ loadedCount, isFetching = false, enabled = true }: SyncInput) => {
    stateRef.current = { loadedCount, isFetching, enabled };
    return enabled && loadedCount > limit;
  };

  // No dependency array on purpose: the observer is rebuilt after every render
  // so it always reflects the latest row count, fetch state, and sentinel node.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const { loadedCount, isFetching, enabled } = stateRef.current;
    if (!sentinel || !enabled || isFetching || loadedCount <= limit) return;
    let root: HTMLElement | null = sentinel.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) {
      root = root.parentElement;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: "300px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  });

  return { limit, sentinelRef, loadMore, sync, reset: () => setLimit(pageSize) };
}
