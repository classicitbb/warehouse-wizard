import { cn } from "@/lib/utils";
import { formatNumber } from "@/features/shared/core-types";

type RecordCountProps = {
  /** Rows actually rendered on screen right now. */
  visible: number;
  /**
   * Only for incrementally paged tables: how many rows the operator could reach
   * with the current filters, read from a server-side count. Leave it out on a
   * table whose rows are all in hand — "40 of 40 loaded" says nothing that
   * "40 rows" doesn't.
   */
  total?: number | null;
  /** True while a typed search term narrows the table to matches. */
  isFiltering?: boolean;
  /** Nothing is claimed until the first page has actually arrived. */
  isLoading?: boolean;
  className?: string;
};

/**
 * The "50 of 3,704 loaded" indicator that sits in the search field of every
 * large table. It always describes what is on screen, so an operator hunting
 * one SKU can tell a genuinely short list from a truncated first page.
 */
export function RecordCount({ visible, total, isFiltering, isLoading, className }: RecordCountProps) {
  if (isLoading) return null;
  const plural = visible === 1 ? "" : "s";
  const label = isFiltering
    ? `${formatNumber(visible)} result${plural}`
    : total == null
      ? `${formatNumber(visible)} row${plural}`
      : `${formatNumber(visible)} of ${formatNumber(total)} loaded`;
  return (
    <span className={cn("pointer-events-none select-none whitespace-nowrap text-xs text-muted-foreground", className)}>
      {label}
    </span>
  );
}
