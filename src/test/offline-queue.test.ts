import { beforeEach, describe, expect, it, vi } from "vitest";

const wmsMocks = vi.hoisted(() => ({
  confirmPutaway: vi.fn(async () => undefined),
  confirmPickTask: vi.fn(async () => undefined),
}));

vi.mock("@/lib/wms-core", () => ({
  confirmPutaway: wmsMocks.confirmPutaway,
  confirmPickTask: wmsMocks.confirmPickTask,
}));

import {
  clearOfflineQueue,
  dismissDeadLetterItem,
  enqueueOfflineWork,
  flushOfflineQueue,
  getDeadLetterSnapshot,
  getOfflineQueueSnapshot,
  isLikelyNetworkError,
  subscribeOfflineQueue,
} from "@/lib/offline-queue";

async function resetQueues() {
  await clearOfflineQueue();
  for (const item of getDeadLetterSnapshot()) await dismissDeadLetterItem(item.id);
}

const putawayPayload = { taskId: "task-1", pallet: "PLT-1", location: "A-08-C" };

beforeEach(async () => {
  vi.clearAllMocks();
  wmsMocks.confirmPutaway.mockResolvedValue(undefined);
  wmsMocks.confirmPickTask.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await resetQueues();
});

describe("isLikelyNetworkError", () => {
  it("recognises the wording browsers actually use", () => {
    for (const message of [
      "Failed to fetch",
      "NetworkError when attempting to fetch resource",
      "Load failed",
      "fetch failed",
      "net::ERR_NETWORK_CHANGED",
      "Connection lost. This device is frozen for live commits.",
    ]) {
      expect(isLikelyNetworkError(new Error(message))).toBe(true);
    }
  });

  it("does not mistake a business rule failure for a dropped connection", () => {
    // Getting this wrong is expensive both ways: a rule violation retried
    // forever, or a genuine disconnect dead-lettered as unfixable.
    expect(isLikelyNetworkError(new Error("RULE_VIOLATION: mixed SKUs not allowed"))).toBe(false);
    expect(isLikelyNetworkError(new Error("Location A-08-C is full"))).toBe(false);
    expect(isLikelyNetworkError(new Error("duplicate key value violates unique constraint"))).toBe(false);
  });

  it("treats everything as a network error while the browser reports offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isLikelyNetworkError(new Error("Location is full"))).toBe(true);
    expect(isLikelyNetworkError(null)).toBe(true);
  });

  it("handles a non-Error throw", () => {
    expect(isLikelyNetworkError("Failed to fetch")).toBe(true);
    expect(isLikelyNetworkError({ toString: () => "network down" })).toBe(true);
    expect(isLikelyNetworkError(null)).toBe(false);
    expect(isLikelyNetworkError(undefined)).toBe(false);
  });
});

describe("the queue", () => {
  it("holds queued work in creation order and notifies subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeOfflineQueue(listener);

    await enqueueOfflineWork("putaway", putawayPayload);
    await enqueueOfflineWork("pick", {
      taskId: "task-2",
      locationCode: "A-01-A",
      palletBarcode: "PLT-2",
      quantity: 5,
    });

    expect(listener).toHaveBeenCalled();
    expect(getOfflineQueueSnapshot().map((item) => item.kind)).toEqual(["putaway", "pick"]);
    unsubscribe();
  });

  it("clears the queue on request", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    await clearOfflineQueue();
    expect(getOfflineQueueSnapshot()).toHaveLength(0);
  });
});

describe("flushOfflineQueue", () => {
  it("posts each item and drops it once it lands", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);

    const result = await flushOfflineQueue({ silent: true });

    expect(wmsMocks.confirmPutaway).toHaveBeenCalledWith("task-1", "PLT-1", "A-08-C", {
      override: undefined,
      overrideReason: undefined,
    });
    expect(result).toMatchObject({ succeeded: 1, failed: 0, deadLettered: 0, remaining: 0 });
    expect(getOfflineQueueSnapshot()).toHaveLength(0);
  });

  it("stops at the first dropped connection and keeps the item queued", async () => {
    // Order matters on the floor — draining past a failure would post the
    // second pallet's put-away before the first.
    await enqueueOfflineWork("putaway", putawayPayload);
    await enqueueOfflineWork("putaway", { ...putawayPayload, taskId: "task-2" });
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Failed to fetch"));

    const result = await flushOfflineQueue({ silent: true });

    expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ succeeded: 0, failed: 1, deadLettered: 0 });
    expect(getOfflineQueueSnapshot()).toHaveLength(2);
    expect(getOfflineQueueSnapshot()[0].lastError).toBe("Failed to fetch");
    expect(getOfflineQueueSnapshot()[0].attempts).toBe(1);
  });

  it("dead-letters a business failure instead of retrying it forever", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("RULE_VIOLATION: location is frozen"));

    const result = await flushOfflineQueue({ silent: true });

    expect(result).toMatchObject({ succeeded: 0, failed: 1, deadLettered: 1, remaining: 0 });
    expect(getOfflineQueueSnapshot()).toHaveLength(0);

    const dead = getDeadLetterSnapshot();
    expect(dead).toHaveLength(1);
    expect(dead[0].error).toBe("RULE_VIOLATION: location is frozen");
    expect(dead[0].payload).toMatchObject({ taskId: "task-1" });
  });

  it("keeps draining after a dead-letter, since the rest may be fine", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    await enqueueOfflineWork("putaway", { ...putawayPayload, taskId: "task-2" });
    wmsMocks.confirmPutaway
      .mockRejectedValueOnce(new Error("Task already completed"))
      .mockResolvedValueOnce(undefined);

    const result = await flushOfflineQueue({ silent: true });

    expect(result).toMatchObject({ succeeded: 1, deadLettered: 1, remaining: 0 });
    expect(getDeadLetterSnapshot()).toHaveLength(1);
  });

  it("does nothing while the browser says it is offline", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const result = await flushOfflineQueue({ silent: true });

    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();
    expect(result.remaining).toBe(1);
  });

  it("routes pick work to the pick confirmation, not the put-away one", async () => {
    await enqueueOfflineWork("pick", {
      taskId: "pick-1",
      locationCode: "A-01-A",
      palletBarcode: "PLT-9",
      quantity: 3,
      shortReason: "damaged",
    });

    await flushOfflineQueue({ silent: true });

    expect(wmsMocks.confirmPickTask).toHaveBeenCalledWith("pick-1", "A-01-A", "PLT-9", 3, true);
    expect(wmsMocks.confirmPutaway).not.toHaveBeenCalled();
  });

  it("lets the operator dismiss a reviewed dead letter", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));
    await flushOfflineQueue({ silent: true });

    const [item] = getDeadLetterSnapshot();
    await dismissDeadLetterItem(item.id);

    expect(getDeadLetterSnapshot()).toHaveLength(0);
  });

  it("returns an empty result rather than double-draining a concurrent flush", async () => {
    await enqueueOfflineWork("putaway", putawayPayload);
    let release: () => void = () => {};
    wmsMocks.confirmPutaway.mockImplementation(
      () => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }),
    );

    const first = flushOfflineQueue({ silent: true });
    const second = await flushOfflineQueue({ silent: true });
    expect(second).toMatchObject({ succeeded: 0, failed: 0 });

    release();
    expect(await first).toMatchObject({ succeeded: 1 });
    expect(wmsMocks.confirmPutaway).toHaveBeenCalledTimes(1);
  });
});
