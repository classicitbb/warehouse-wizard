import { IDBDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The IndexedDB side of the legacy offline queue: what is persisted, what is
// removed, and how rows left behind by older builds are migrated into the
// dead-letter store instead of being replayed. Each test gets an empty
// in-memory IndexedDB and a fresh copy of the module.

const wmsMocks = vi.hoisted(() => ({
  confirmPutaway: vi.fn(async () => undefined),
  confirmPickTask: vi.fn(async () => undefined),
}));

vi.mock("@/lib/wms-core", () => ({
  confirmPutaway: wmsMocks.confirmPutaway,
  confirmPickTask: wmsMocks.confirmPickTask,
}));

const DB_NAME = "ww-offline-queue";
const LEGACY_MESSAGE =
  "Offline replay was disabled for safety. Reopen this task online and re-validate against live warehouse state before posting.";
const putaway = { taskId: "task-1", pallet: "PLT-1", location: "A-08-C" };

type Queue = typeof import("@/lib/offline-queue");

async function loadQueue(): Promise<Queue> {
  vi.resetModules();
  return import("@/lib/offline-queue");
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openRaw(version: number, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function seed(version: number, stores: string[], rows: Record<string, unknown[]>) {
  const db = await openRaw(version, (raw) => {
    for (const store of stores) raw.createObjectStore(store, { keyPath: "id" });
  });
  for (const [store, items] of Object.entries(rows)) {
    const t = db.transaction(store, "readwrite");
    for (const item of items) t.objectStore(store).put(item);
    await new Promise((resolve) => { t.oncomplete = resolve; });
  }
  db.close();
}

async function readStore(store: string): Promise<Array<Record<string, unknown>>> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  try {
    return await request(db.transaction(store, "readonly").objectStore(store).getAll());
  } finally {
    db.close();
  }
}

async function initialised(queue: Queue) {
  const listener = vi.fn();
  const unsubscribe = queue.subscribeDeadLetterQueue(listener);
  // Any enqueue/flush awaits the same init promise, so a no-op flush settles it.
  await queue.flushOfflineQueue({ silent: true });
  unsubscribe();
}

beforeEach(() => {
  vi.clearAllMocks();
  wmsMocks.confirmPutaway.mockResolvedValue(undefined);
  wmsMocks.confirmPickTask.mockResolvedValue(undefined);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("persistence", () => {
  it("writes queued work to IndexedDB and removes it once it lands", async () => {
    const queue = await loadQueue();
    const item = await queue.enqueueOfflineWork("putaway", putaway);

    expect(await readStore("work")).toEqual([item]);

    await queue.flushOfflineQueue({ silent: true });
    expect(await readStore("work")).toEqual([]);
  });

  it("persists the attempt and error of a retried item", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Failed to fetch"));

    await queue.flushOfflineQueue({ silent: true });

    const [stored] = await readStore("work");
    expect(stored).toMatchObject({ attempts: 1, lastError: "Failed to fetch" });
  });

  it("moves a rejected item from the work store to the dead-letter store, and dismisses it", async () => {
    const queue = await loadQueue();
    const item = await queue.enqueueOfflineWork("putaway", putaway);
    wmsMocks.confirmPutaway.mockRejectedValue(new Error("Task already completed"));

    await queue.flushOfflineQueue({ silent: true });

    expect(await readStore("work")).toEqual([]);
    expect(await readStore("dead-letter")).toEqual([
      expect.objectContaining({ id: item.id, error: "Task already completed", attempts: 1 }),
    ]);

    await queue.dismissDeadLetterItem(item.id);
    expect(await readStore("dead-letter")).toEqual([]);
  });

  it("clears the stored queue", async () => {
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    await queue.enqueueOfflineWork("putaway", putaway);
    await queue.clearOfflineQueue();
    expect(await readStore("work")).toEqual([]);
  });

  it("reloads surviving dead letters on the next boot, newest first", async () => {
    await seed(3, ["work", "dead-letter"], {
      "dead-letter": [
        { id: "old", kind: "putaway", payload: putaway, createdAt: 1, failedAt: 100, error: "x", attempts: 1 },
        { id: "new", kind: "putaway", payload: putaway, createdAt: 2, failedAt: 200, error: "y", attempts: 1 },
      ],
    });
    const queue = await loadQueue();
    await initialised(queue);

    expect(queue.getDeadLetterSnapshot().map((d) => d.id)).toEqual(["new", "old"]);
    expect(queue.getOfflineQueueSnapshot()).toEqual([]);
  });
});

describe("legacy queue migration", () => {
  it("dead-letters work an older build left queued instead of replaying it", async () => {
    vi.spyOn(Date, "now").mockReturnValue(9000);
    await seed(3, ["work", "dead-letter"], {
      work: [{ id: "legacy-1", kind: "pick", payload: { taskId: "p" }, createdAt: 10, attempts: 2, lastError: "Failed to fetch" }],
      "dead-letter": [{ id: "kept", kind: "putaway", payload: putaway, createdAt: 1, failedAt: 50, error: "x", attempts: 1 }],
    });

    const queue = await loadQueue();
    await initialised(queue);

    expect(wmsMocks.confirmPickTask).not.toHaveBeenCalled();
    expect(queue.getOfflineQueueSnapshot()).toEqual([]);
    expect(queue.getDeadLetterSnapshot()).toEqual([
      { id: "legacy-1", kind: "pick", payload: { taskId: "p" }, createdAt: 10, failedAt: 9000, error: LEGACY_MESSAGE, attempts: 2 },
      { id: "kept", kind: "putaway", payload: putaway, createdAt: 1, failedAt: 50, error: "x", attempts: 1 },
    ]);
    expect(await readStore("work")).toEqual([]);
    expect((await readStore("dead-letter")).map((d) => d.id).sort()).toEqual(["kept", "legacy-1"]);
  });

  it("adds the dead-letter store when upgrading a version-1 database", async () => {
    await seed(1, ["work"], { work: [{ id: "v1", kind: "putaway", payload: putaway, createdAt: 1, attempts: 0 }] });

    const queue = await loadQueue();
    await initialised(queue);

    expect(queue.getDeadLetterSnapshot().map((d) => d.id)).toEqual(["v1"]);
    expect((await readStore("dead-letter")).map((d) => d.id)).toEqual(["v1"]);
  });

  it("creates both stores on a brand-new device", async () => {
    const queue = await loadQueue();
    await initialised(queue);
    expect(await readStore("work")).toEqual([]);
    expect(await readStore("dead-letter")).toEqual([]);
  });

  it("initialises once even when several subscribers arrive together", async () => {
    await seed(3, ["work", "dead-letter"], {
      work: [{ id: "legacy", kind: "putaway", payload: putaway, createdAt: 1, attempts: 0 }],
    });
    const queue = await loadQueue();
    queue.subscribeOfflineQueue(() => {});
    queue.subscribeDeadLetterQueue(() => {});
    await initialised(queue);
    await initialised(queue);
    expect(queue.getDeadLetterSnapshot()).toHaveLength(1);
  });
});

describe("storage failures", () => {
  function brokenIndexedDB() {
    return {
      open() {
        const req: Record<string, unknown> = { error: new Error("quota exceeded") };
        setTimeout(() => (req.onerror as () => void)?.(), 0);
        return req;
      },
    };
  }

  it("keeps working in memory and logs when IndexedDB cannot open", async () => {
    vi.stubGlobal("indexedDB", brokenIndexedDB());
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = await loadQueue();

    const item = await queue.enqueueOfflineWork("putaway", putaway);
    expect(queue.getOfflineQueueSnapshot()).toEqual([item]);
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] init failed", expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] enqueue persist failed", expect.any(Error));

    wmsMocks.confirmPutaway.mockRejectedValueOnce(new Error("Failed to fetch"));
    await queue.flushOfflineQueue({ silent: true });
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] update failed", expect.any(Error));

    wmsMocks.confirmPutaway.mockRejectedValueOnce(new Error("Task already completed"));
    await queue.flushOfflineQueue({ silent: true });
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] delete failed", expect.any(Error));
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] dead-letter persist failed", expect.any(Error));
    expect(queue.getDeadLetterSnapshot()).toHaveLength(1);

    await queue.dismissDeadLetterItem(item.id);
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] dead-letter dismiss failed", expect.any(Error));
    expect(queue.getDeadLetterSnapshot()).toEqual([]);

    await queue.clearOfflineQueue();
    expect(consoleError).toHaveBeenCalledWith("[offline-queue] clear failed", expect.any(Error));
  });

  it("reports a generic error when IndexedDB fails without saying why", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        const req: Record<string, unknown> = { error: null };
        setTimeout(() => (req.onerror as () => void)?.(), 0);
        return req;
      },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = await loadQueue();
    await queue.enqueueOfflineWork("putaway", putaway);
    expect(consoleError).toHaveBeenCalledWith(
      "[offline-queue] init failed",
      expect.objectContaining({ message: "IndexedDB open failed" }),
    );
  });

  it("logs and keeps the queue in memory when the legacy migration cannot write", async () => {
    await seed(3, ["work", "dead-letter"], {
      work: [{ id: "legacy", kind: "putaway", payload: putaway, createdAt: 1, attempts: 0 }],
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const realTransaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, store, mode, ...rest) {
      if (mode === "readwrite") throw new Error("read-only device");
      return realTransaction.call(this, store, mode, ...rest);
    });

    const queue = await loadQueue();
    await initialised(queue);

    expect(consoleError).toHaveBeenCalledWith("[offline-queue] legacy queue migration failed", expect.any(Error));
    expect(queue.getOfflineQueueSnapshot()).toEqual([]);
    expect(queue.getDeadLetterSnapshot().map((d) => d.id)).toEqual(["legacy"]);
  });
});
