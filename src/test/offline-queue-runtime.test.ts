import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hooks, auto-replay and edge cases of the legacy offline queue. Each test
// loads a fresh copy of the module, because the queue keeps module-level
// state (its cache, the flushing flag, the installed listeners).

const wmsMocks = vi.hoisted(() => ({
  confirmPutaway: vi.fn(async () => undefined),
  confirmPickTask: vi.fn(async () => undefined),
}));

vi.mock("@/lib/wms-core", () => ({
  confirmPutaway: wmsMocks.confirmPutaway,
  confirmPickTask: wmsMocks.confirmPickTask,
}));

type Queue = typeof import("@/lib/offline-queue");

async function loadQueue(): Promise<Queue> {
  vi.resetModules();
  return import("@/lib/offline-queue");
}

const putaway = { taskId: "task-1", pallet: "PLT-1", location: "A-08-C" };

beforeEach(() => {
  vi.clearAllMocks();
  wmsMocks.confirmPutaway.mockResolvedValue(undefined);
  wmsMocks.confirmPickTask.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("isLikelyNetworkError wording", () => {
  it.each(["network request failed", "The Internet connection appears to be OFFLINE", "NETWORKERROR"])(
    "treats %j as a dropped connection",
    async (message) => {
      const { isLikelyNetworkError } = await loadQueue();
      expect(isLikelyNetworkError(new Error(message))).toBe(true);
    },
  );

  it("reads the message of an Error, not its name", async () => {
    const { isLikelyNetworkError } = await loadQueue();
    const err = new Error("Location is full");
    err.name = "NetworkError";
    expect(isLikelyNetworkError(err)).toBe(false);
  });

  it("does not treat an online browser with a falsy error as offline", async () => {
    const { isLikelyNetworkError } = await loadQueue();
    expect(isLikelyNetworkError(0)).toBe(false);
    expect(isLikelyNetworkError("")).toBe(false);
  });
});

describe("queue items", () => {
  it("stamps each item with an id, its kind, the time and zero attempts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const queue = await loadQueue();

    const item = await queue.enqueueOfflineWork("putaway", putaway);

    expect(item).toEqual({
      id: expect.stringMatching(/^loyw3v28-[a-z0-9]{1,8}$/),
      kind: "putaway",
      payload: putaway,
      createdAt: 1_700_000_000_000,
      attempts: 0,
    });
    expect(queue.getOfflineQueueSnapshot()).toEqual([item]);
  });

  it("keeps the queue sorted oldest first even if the clock steps back", async () => {
    const now = vi.spyOn(Date, "now");
    const queue = await loadQueue();
    now.mockReturnValue(2000);
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "later" });
    now.mockReturnValue(1000);
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "earlier" });

    expect(queue.getOfflineQueueSnapshot().map((i) => (i.payload as { taskId: string }).taskId)).toEqual(["earlier", "later"]);
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const queue = await loadQueue();
    const listener = vi.fn();
    const unsubscribe = queue.subscribeOfflineQueue(listener);
    await queue.enqueueOfflineWork("putaway", putaway);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await queue.enqueueOfflineWork("putaway", putaway);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies and unsubscribes dead-letter listeners", async () => {
    const queue = await loadQueue();
    const listener = vi.fn();
    const unsubscribe = queue.subscribeDeadLetterQueue(listener);
    await queue.enqueueOfflineWork("putaway", putaway);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));
    await queue.flushOfflineQueue({ silent: true });
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    await queue.dismissDeadLetterItem(queue.getDeadLetterSnapshot()[0].id);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("flushing", () => {
  it("passes put-away overrides through to the confirmation", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", { ...putaway, override: true, reason: "Bay damaged" });
    await queue.flushOfflineQueue({ silent: true });
    expect(wmsMocks.confirmPutaway).toHaveBeenCalledWith("task-1", "PLT-1", "A-08-C", {
      override: true,
      overrideReason: "Bay damaged",
    });
  });

  it("confirms a pick without the anomaly flag when no short reason was given", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("pick", { taskId: "p", locationCode: "L", palletBarcode: "B", quantity: 2 });
    await queue.flushOfflineQueue({ silent: true });
    expect(wmsMocks.confirmPickTask).toHaveBeenCalledWith("p", "L", "B", 2, false);
  });

  it("names the unknown kind when it cannot replay an item", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("transfer" as never, putaway);
    await queue.flushOfflineQueue({ silent: true });
    expect(queue.getOfflineQueueSnapshot()[0].lastError).toBe("Unknown offline work kind: transfer");
  });

  // KNOWN BUG: "Unknown offline work kind" contains the word "offline", which
  // isLikelyNetworkError reads as a dropped connection, so the item is retried
  // forever and blocks everything queued behind it. Remove `.fails` once fixed.
  it.fails("dead-letters work of an unknown kind instead of retrying it forever", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("transfer" as never, putaway);
    const result = await queue.flushOfflineQueue({ silent: true });
    expect(result).toEqual({ succeeded: 0, failed: 1, remaining: 0, deadLettered: 1 });
  });

  it("records the attempt count and failure time on a dead letter", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    now.mockReturnValue(5000);
    wmsMocks.confirmPutaway.mockRejectedValue("plain string rejection");

    await queue.flushOfflineQueue({ silent: true });

    expect(queue.getDeadLetterSnapshot()[0]).toMatchObject({
      kind: "putaway",
      createdAt: 1000,
      failedAt: 5000,
      attempts: 1,
      error: "plain string rejection",
    });
  });

  it("stamps a retried item with the time it was tried", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    now.mockReturnValue(7000);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Failed to fetch"));

    const result = await queue.flushOfflineQueue({ silent: true });

    expect(result).toEqual({ succeeded: 0, failed: 1, remaining: 1, deadLettered: 0 });
    expect(queue.getOfflineQueueSnapshot()[0]).toMatchObject({ attempts: 1, lastTriedAt: 7000, lastError: "Failed to fetch" });
  });

  it("lists the newest dead letter first", async () => {
    const now = vi.spyOn(Date, "now");
    const queue = await loadQueue();
    now.mockReturnValue(1000);
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "first" });
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "second" });
    wmsMocks.confirmPutaway.mockImplementation(async () => {
      now.mockReturnValue((now.mock.results.at(-1)?.value as number) + 1000);
      throw new Error("Task already completed");
    });

    await queue.flushOfflineQueue({ silent: true });

    expect(queue.getDeadLetterSnapshot().map((d) => (d.payload as { taskId: string }).taskId)).toEqual(["second", "first"]);
  });

  it("stops part-way if the browser drops offline mid-drain", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "a" });
    await queue.enqueueOfflineWork("putaway", { ...putaway, taskId: "b" });
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    wmsMocks.confirmPutaway.mockImplementation(async () => {
      online.mockReturnValue(false);
      return undefined;
    });

    const result = await queue.flushOfflineQueue({ silent: true });

    expect(result).toEqual({ succeeded: 1, failed: 0, remaining: 1, deadLettered: 0 });
  });

  it("logs a dead letter unless asked to stay silent", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = await loadQueue();
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));

    await queue.enqueueOfflineWork("putaway", putaway);
    await queue.flushOfflineQueue({ silent: true });
    expect(consoleError).not.toHaveBeenCalled();

    await queue.enqueueOfflineWork("putaway", putaway);
    await queue.flushOfflineQueue();
    expect(consoleError).toHaveBeenCalledWith(
      "[offline-queue] item dead-lettered after non-retryable error",
      expect.objectContaining({ kind: "putaway" }),
      expect.any(Error),
    );
  });

  it("reports syncing to flush-state subscribers and clears it afterwards", async () => {
    const queue = await loadQueue();
    const states: boolean[] = [];
    const unsubscribe = queue.subscribeFlushState((syncing) => states.push(syncing));
    expect(states).toEqual([false]);

    await queue.enqueueOfflineWork("putaway", putaway);
    await queue.flushOfflineQueue({ silent: true });
    expect(states).toEqual([false, true, false]);

    unsubscribe();
    await queue.flushOfflineQueue({ silent: true });
    expect(states).toEqual([false, true, false]);
  });

  it("clears the syncing flag even when a confirmation throws unexpectedly", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));
    await queue.flushOfflineQueue({ silent: true });
    const states: boolean[] = [];
    queue.subscribeFlushState((syncing) => states.push(syncing));
    expect(states).toEqual([false]);
  });
});

describe("hooks", () => {
  it("exposes the queue, its count and a retry to components", async () => {
    const queue = await loadQueue();
    const { result } = renderHook(() => queue.useOfflineQueue());
    expect(result.current.count).toBe(0);
    expect(result.current.items).toEqual([]);
    expect(result.current.syncing).toBe(false);

    await act(async () => {
      await queue.enqueueOfflineWork("putaway", putaway);
    });
    expect(result.current.count).toBe(1);
    expect(result.current.items[0].payload).toEqual(putaway);

    let flushResult: Awaited<ReturnType<Queue["flushOfflineQueue"]>> | undefined;
    await act(async () => {
      flushResult = await result.current.retry();
    });
    expect(flushResult).toEqual({ succeeded: 1, failed: 0, remaining: 0, deadLettered: 0 });
    expect(result.current.count).toBe(0);
  });

  it("shows syncing while a retry is in flight", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    let release: () => void = () => {};
    wmsMocks.confirmPutaway.mockImplementation(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    const { result } = renderHook(() => queue.useOfflineQueue());

    let pending: Promise<unknown> = Promise.resolve();
    await act(async () => {
      pending = result.current.retry();
    });
    expect(result.current.syncing).toBe(true);

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.syncing).toBe(false);
  });

  it("returns a stable empty snapshot so React does not re-render in a loop", async () => {
    const queue = await loadQueue();
    const { result, rerender } = renderHook(() => queue.useOfflineQueue().items);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    const deadLetters = renderHook(() => queue.useDeadLetterQueue().items);
    const firstDead = deadLetters.result.current;
    deadLetters.rerender();
    expect(deadLetters.result.current).toBe(firstDead);
  });

  it("lets the operator dismiss one or all dead letters", async () => {
    const queue = await loadQueue();
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));
    for (const taskId of ["a", "b", "c"]) await queue.enqueueOfflineWork("putaway", { ...putaway, taskId });
    await queue.flushOfflineQueue({ silent: true });
    const { result } = renderHook(() => queue.useDeadLetterQueue());
    expect(result.current.count).toBe(3);

    await act(async () => {
      await result.current.dismiss(result.current.items[0].id);
    });
    expect(result.current.count).toBe(2);

    await act(async () => {
      await result.current.dismissAll();
    });
    expect(result.current.count).toBe(0);
    expect(result.current.items).toEqual([]);
  });
});

describe("auto-replay", () => {
  async function settle() {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  }

  it("drains a stale queue on boot when online", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    queue.installOfflineAutoReplay();
    await vi.waitFor(() => expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1));
  });

  it("waits for the network on boot when offline, then drains on reconnect", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    queue.installOfflineAutoReplay();
    await settle();
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1));
  });

  it("does nothing on reconnect or boot with an empty queue", async () => {
    const queue = await loadQueue();
    const listener = vi.fn();
    queue.subscribeFlushState(listener);
    listener.mockClear();

    queue.installOfflineAutoReplay();
    window.dispatchEvent(new Event("online"));
    await settle();

    expect(listener).not.toHaveBeenCalled();
  });

  it("installs its listeners only once", async () => {
    const queue = await loadQueue();
    const addEventListener = vi.spyOn(window, "addEventListener");
    queue.installOfflineAutoReplay();
    queue.installOfflineAutoReplay();
    expect(addEventListener.mock.calls.filter(([type]) => type === "online")).toHaveLength(1);
  });

  it("installs through the hook as well", async () => {
    const queue = await loadQueue();
    const addEventListener = vi.spyOn(window, "addEventListener");
    renderHook(() => queue.useInstallOfflineAutoReplay());
    expect(addEventListener).toHaveBeenCalledWith("online", expect.any(Function));
  });

  it("retries every five minutes while online and not already syncing", async () => {
    vi.useFakeTimers();
    const queue = await loadQueue();
    queue.installOfflineAutoReplay();
    await vi.advanceTimersByTimeAsync(0);

    await queue.enqueueOfflineWork("putaway", putaway);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 - 1);
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1);
  });

  it("skips the periodic retry while offline or already syncing", async () => {
    vi.useFakeTimers();
    const queue = await loadQueue();
    queue.installOfflineAutoReplay();
    await vi.advanceTimersByTimeAsync(0);
    await queue.enqueueOfflineWork("putaway", putaway);

    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    wmsMocks.confirmPutaway.mockImplementation(() => new Promise(() => {}));
    void queue.flushOfflineQueue({ silent: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1);

    const flushStates: boolean[] = [];
    queue.subscribeFlushState((syncing) => flushStates.push(syncing));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1);
    expect(flushStates).toEqual([true]);
  });
});
