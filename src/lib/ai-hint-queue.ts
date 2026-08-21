/**
 * ai-hint-queue.ts
 *
 * Retry queue for AI hint writes (ai_product_hints upserts) that fail with a
 * transient backend/RLS error. Hint writes are fire-and-forget signals, so a
 * failure must never block warehouse work — but silently dropping them loses
 * learning data and hides real backend problems.
 *
 * Behaviour:
 *   - Failed hint writes are persisted to localStorage.
 *   - A toast surfaces the exact backend error with a "Retry now" action.
 *   - Retries run automatically with exponential backoff (and on reconnect).
 *   - After MAX_ATTEMPTS the item stays in the queue, flagged, so the operator
 *     can retry manually or report it from the in-app alert.
 */

import { toast } from "sonner";

export type AiHintJobKind = "placement" | "pallet_qty";

export type AiHintPlacementJob = {
  kind: "placement";
  productId: string;
  warehouseId: string;
  locationId: string;
  locationCode: string;
  zoneName: string | null;
};

export type AiHintPalletQtyJob = {
  kind: "pallet_qty";
  productId: string;
  warehouseId: string;
  qty: number;
};

export type AiHintJob = AiHintPlacementJob | AiHintPalletQtyJob;

export interface AiHintQueueItem {
  id: string;
  job: AiHintJob;
  createdAt: number;
  attempts: number;
  lastError: string;
  lastErrorCode?: string | null;
  lastTriedAt: number;
  exhausted: boolean;
}

const STORAGE_KEY = "ww-ai-hint-retry-queue";
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5_000;
const MAX_DELAY_MS = 5 * 60_000;

type Runner = (job: AiHintJob) => Promise<void>;

let runner: Runner | null = null;
let items: AiHintQueueItem[] = [];
let loaded = false;
let flushing = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

/** Registered by ai-assist to avoid a circular import at module load. */
export function registerAiHintRunner(fn: Runner) {
  runner = fn;
}

function load() {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) items = JSON.parse(raw) as AiHintQueueItem[];
  } catch {
    items = [];
  }
}

function persist() {
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage full or unavailable — queue stays in memory */
    }
  }
  listeners.forEach((l) => l());
}

export function describeHintError(error: unknown): { message: string; code?: string | null } {
  if (!error) return { message: "Unknown error" };
  if (typeof error === "string") return { message: error };
  const err = error as { message?: string; code?: string; details?: string; hint?: string };
  const parts = [err.message, err.details, err.hint].filter(Boolean);
  return {
    message: parts.length ? parts.join(" — ") : "Unknown error",
    code: err.code ?? null,
  };
}

export function describeHintJob(job: AiHintJob): string {
  return job.kind === "placement"
    ? `Placement hint for location ${job.locationCode}`
    : `Pallet quantity hint (${job.qty} units)`;
}

function backoffDelay(attempts: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);
}

function scheduleFlush() {
  if (timer) return;
  const pending = items.filter((i) => !i.exhausted);
  if (!pending.length) return;
  const delay = Math.min(...pending.map((i) => backoffDelay(i.attempts)));
  timer = setTimeout(() => {
    timer = null;
    void flushAiHintQueue();
  }, delay);
}

/** Record a failed hint write: persist it, toast the exact error, schedule a retry. */
export function enqueueFailedAiHint(job: AiHintJob, error: unknown, options?: { silent?: boolean }) {
  load();
  const { message, code } = describeHintError(error);
  const item: AiHintQueueItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    job,
    createdAt: Date.now(),
    attempts: 1,
    lastError: message,
    lastErrorCode: code,
    lastTriedAt: Date.now(),
    exhausted: false,
  };
  items = [...items, item];
  persist();

  if (!options?.silent) {
    toast.error("AI hint update failed", {
      description: `${describeHintJob(job)}: ${code ? `[${code}] ` : ""}${message}. Queued for automatic retry.`,
      action: { label: "Retry now", onClick: () => void flushAiHintQueue() },
      duration: 10_000,
    });
  }

  scheduleFlush();
}

export async function flushAiHintQueue(options?: { includeExhausted?: boolean }): Promise<void> {
  load();
  if (flushing || !runner) return;
  const due = items.filter((i) => options?.includeExhausted || !i.exhausted);
  if (!due.length) return;

  flushing = true;
  try {
    for (const item of due) {
      try {
        await runner(item.job);
        items = items.filter((i) => i.id !== item.id);
        persist();
      } catch (err) {
        const { message, code } = describeHintError(err);
        const attempts = item.attempts + 1;
        items = items.map((i) =>
          i.id === item.id
            ? {
                ...i,
                attempts,
                lastError: message,
                lastErrorCode: code,
                lastTriedAt: Date.now(),
                exhausted: attempts >= MAX_ATTEMPTS,
              }
            : i,
        );
        persist();
      }
    }
  } finally {
    flushing = false;
  }
  scheduleFlush();
}

export function retryAiHintItem(id: string): Promise<void> {
  load();
  items = items.map((i) => (i.id === id ? { ...i, exhausted: false } : i));
  persist();
  return flushAiHintQueue();
}

export function dismissAiHintItem(id: string) {
  load();
  items = items.filter((i) => i.id !== id);
  persist();
}

export function clearAiHintQueue() {
  load();
  items = [];
  persist();
}

export function subscribeAiHintQueue(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAiHintQueueSnapshot(): AiHintQueueItem[] {
  load();
  return items;
}

/** Human-readable report text the operator can copy when reporting the failure. */
export function buildAiHintReport(item: AiHintQueueItem): string {
  return [
    `AI hint write failure`,
    `Type: ${describeHintJob(item.job)}`,
    `Job: ${JSON.stringify(item.job)}`,
    `Attempts: ${item.attempts}`,
    `Error code: ${item.lastErrorCode ?? "n/a"}`,
    `Error: ${item.lastError}`,
    `First failed: ${new Date(item.createdAt).toISOString()}`,
    `Last tried: ${new Date(item.lastTriedAt).toISOString()}`,
  ].join("\n");
}

let autoRetryInstalled = false;

/** Retry queued hints when the browser comes back online / tab regains focus. */
export function installAiHintAutoRetry() {
  if (autoRetryInstalled || typeof window === "undefined") return;
  autoRetryInstalled = true;
  load();
  const trigger = () => void flushAiHintQueue();
  window.addEventListener("online", trigger);
  window.addEventListener("focus", trigger);
  scheduleFlush();
}
