import { describe, expect, it, vi } from "vitest";

import {
  PartialBatchError,
  completedFromBatchError,
  isPartialBatchError,
  runBatch,
} from "@/lib/batch-mutation";

describe("runBatch", () => {
  it("returns every result in order when the whole batch commits", async () => {
    const results = await runBatch(["a", "b", "c"], async (item, index) => `${item}${index}`);
    expect(results).toEqual(["a0", "b1", "c2"]);
  });

  it("runs strictly in order, never concurrently", async () => {
    const order: string[] = [];
    await runBatch(["a", "b", "c"], async (item) => {
      order.push(`start:${item}`);
      await Promise.resolve();
      order.push(`end:${item}`);
      return item;
    });
    expect(order).toEqual([
      "start:a",
      "end:a",
      "start:b",
      "end:b",
      "start:c",
      "end:c",
    ]);
  });

  it("reports progress before the first item and after each commit", async () => {
    const onProgress = vi.fn();
    await runBatch(["a", "b"], async (item) => item, { onProgress });
    expect(onProgress.mock.calls).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
  });

  it("stops at the first failure and does not attempt the rest", async () => {
    const attempted: string[] = [];
    const write = vi.fn(async (item: string) => {
      attempted.push(item);
      if (item === "b") throw new Error("boom");
      return item;
    });

    await expect(runBatch(["a", "b", "c"], write)).rejects.toBeInstanceOf(PartialBatchError);
    expect(attempted).toEqual(["a", "b"]);
  });

  it("rethrows the original error untouched when nothing committed", async () => {
    // Callers depend on exact messages — `RULE_VIOLATION:` prefixes and the
    // offline copy are matched by string in the pages that use them.
    const original = new Error("RULE_VIOLATION: mixed SKUs not allowed here");
    await expect(
      runBatch(["a", "b"], async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });

  it("carries the committed results when the batch fails part-way", async () => {
    let error: unknown;
    try {
      await runBatch(
        ["a", "b", "c", "d"],
        async (item) => {
          if (item === "c") throw new Error("connection lost");
          return `saved-${item}`;
        },
        { itemNoun: "pallet" },
      );
    } catch (caught) {
      error = caught;
    }

    expect(isPartialBatchError(error)).toBe(true);
    const partial = error as PartialBatchError<string>;
    expect(partial.completed).toEqual(["saved-a", "saved-b"]);
    expect(partial.failedIndex).toBe(2);
    expect(partial.remaining).toBe(2);
    expect(partial.reason).toBeInstanceOf(Error);
    expect((partial.reason as Error).message).toBe("connection lost");
  });

  it("tells the operator what stuck, so they do not repeat committed work", async () => {
    // This is the whole point of the type: a bare "Receiving failed" makes an
    // operator re-run the batch and receive the first pallets twice.
    const error = await runBatch(
      ["a", "b", "c"],
      async (item) => {
        if (item === "c") throw new Error("Location is full");
        return item;
      },
      { itemNoun: "pallet" },
    ).then(
      () => {
        throw new Error("expected the batch to fail");
      },
      (caught: unknown) => caught as PartialBatchError,
    );

    expect(error.message).toContain("2 pallets completed");
    expect(error.message).toContain("Location is full");
    expect(error.message).toContain("Do not repeat");
    expect(error.message).toContain("1 still to do");
  });

  it("uses the singular noun for a single committed item", async () => {
    const error = await runBatch(
      ["a", "b"],
      async (item) => {
        if (item === "b") throw new Error("nope");
        return item;
      },
      { itemNoun: "location" },
    ).then(
      () => {
        throw new Error("expected the batch to fail");
      },
      (caught: unknown) => caught as PartialBatchError,
    );

    expect(error.message).toContain("1 location completed");
    expect(error.message).not.toContain("1 locations");
  });

  it("survives a non-Error rejection", async () => {
    const error = await runBatch(["a", "b"], async (item) => {
      if (item === "b") throw "just a string";
      return item;
    }).then(
      () => {
        throw new Error("expected the batch to fail");
      },
      (caught: unknown) => caught as PartialBatchError,
    );

    expect(isPartialBatchError(error)).toBe(true);
    expect(error.message).toContain("just a string");
    expect(error.reason).toBe("just a string");
  });

  it("handles an empty batch without calling the writer", async () => {
    const write = vi.fn();
    const onProgress = vi.fn();
    await expect(runBatch([], write, { onProgress })).resolves.toEqual([]);
    expect(write).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenCalledWith(0, 0);
  });
});

describe("completedFromBatchError", () => {
  it("returns the committed results of a partial failure", () => {
    const error = new PartialBatchError<string>({
      completed: ["one", "two"],
      failedIndex: 2,
      remaining: 1,
      reason: new Error("stop"),
      message: "partial",
    });
    expect(completedFromBatchError<string>(error)).toEqual(["one", "two"]);
  });

  it("returns nothing for an ordinary error, so callers can branch on it", () => {
    expect(completedFromBatchError(new Error("plain"))).toEqual([]);
    expect(completedFromBatchError("string")).toEqual([]);
    expect(completedFromBatchError(null)).toEqual([]);
  });
});
