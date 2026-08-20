/**
 * batch-mutation.ts
 *
 * Sequential batch runner for mutations that write one row per item.
 *
 * The problem this solves: a `for (const item of items) await write(item)` loop
 * inside a `mutationFn` throws on the first failure, which sends React Query
 * down the `onError` path. Everything the loop already committed is real and
 * durable in Postgres, but `onSuccess` never runs — so the caches are never
 * invalidated and the screen still lists those rows as un-actioned. On the
 * warehouse floor that reads as "nothing happened", the operator runs the batch
 * again, and the already-committed items get written a second time (duplicate
 * pallets, duplicate put-away tasks).
 *
 * `runBatch` keeps the partial work visible: whatever completed before the
 * failure is carried on the thrown error, so the caller can report it honestly
 * and refresh the caches from `onSettled` instead of `onSuccess`.
 */

/** Thrown when a batch committed at least one item and then failed. */
export class PartialBatchError<TResult = unknown> extends Error {
  /** Results of the items that committed before the failure. */
  readonly completed: TResult[];
  /** Index of the item that failed. */
  readonly failedIndex: number;
  /** Items never attempted, because the batch stopped at `failedIndex`. */
  readonly remaining: number;
  /** The error the failing item threw. */
  readonly reason: unknown;

  constructor(params: {
    completed: TResult[];
    failedIndex: number;
    remaining: number;
    reason: unknown;
    message: string;
  }) {
    super(params.message);
    this.name = "PartialBatchError";
    this.completed = params.completed;
    this.failedIndex = params.failedIndex;
    this.remaining = params.remaining;
    this.reason = params.reason;
  }
}

export function isPartialBatchError<TResult = unknown>(
  error: unknown,
): error is PartialBatchError<TResult> {
  return error instanceof PartialBatchError;
}

/** Results committed before a failure, or `[]` for any other error. */
export function completedFromBatchError<TResult>(error: unknown): TResult[] {
  return isPartialBatchError<TResult>(error) ? error.completed : [];
}

function messageOf(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return fallback;
}

export type RunBatchOptions = {
  /** Called after each successful item with (completed, total). */
  onProgress?: (completed: number, total: number) => void;
  /** Noun used in the partial-failure message, e.g. "pallet". */
  itemNoun?: string;
};

/**
 * Run `write` over `items` in order, stopping at the first failure.
 *
 * Resolves with every result when the whole batch commits. Throws when it does
 * not:
 *  - nothing committed → the original error, unchanged, so callers keep their
 *    existing messages (offline text, `RULE_VIOLATION:` prefixes, and so on);
 *  - something committed → a {@link PartialBatchError} carrying those results.
 */
export async function runBatch<TItem, TResult>(
  items: readonly TItem[],
  write: (item: TItem, index: number) => Promise<TResult>,
  options: RunBatchOptions = {},
): Promise<TResult[]> {
  const { onProgress, itemNoun = "item" } = options;
  const completed: TResult[] = [];

  onProgress?.(0, items.length);

  for (let index = 0; index < items.length; index++) {
    try {
      completed.push(await write(items[index], index));
      onProgress?.(completed.length, items.length);
    } catch (reason) {
      if (completed.length === 0) throw reason;
      const remaining = items.length - completed.length;
      const plural = completed.length === 1 ? "" : "s";
      throw new PartialBatchError<TResult>({
        completed,
        failedIndex: index,
        remaining,
        reason,
        message:
          `${completed.length} ${itemNoun}${plural} completed, then the batch stopped: ` +
          `${messageOf(reason, "the next item failed")} ` +
          `Do not repeat the ${completed.length} that already completed — ${remaining} still to do.`,
      });
    }
  }

  return completed;
}
