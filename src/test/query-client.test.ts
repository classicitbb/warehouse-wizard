import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));
const telemetryMocks = vi.hoisted(() => ({ logErrorTelemetry: vi.fn() }));
const habitMocks = vi.hoisted(() => ({ recordAction: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastMocks.error } }));
vi.mock("@/lib/system-telemetry", () => ({ logErrorTelemetry: telemetryMocks.logErrorTelemetry }));
vi.mock("@/lib/habit-tracking", () => ({ recordAction: habitMocks.recordAction }));

import { createAppQueryClient, queryClientDefaultOptions } from "@/lib/query-client";

/** Run one mutation through the real cache callbacks. */
async function runMutation(options: Record<string, unknown>, variables: unknown = undefined) {
  const queryClient = createAppQueryClient();
  const mutation = queryClient.getMutationCache().build(queryClient, options as never);
  return mutation.execute(variables as never).catch((error: unknown) => error);
}

beforeEach(() => {
  toastMocks.error.mockClear();
  telemetryMocks.logErrorTelemetry.mockClear();
  habitMocks.recordAction.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("query client", () => {
  it("uses brisk-navigation defaults", () => {
    expect(queryClientDefaultOptions.queries?.staleTime).toBe(30_000);
    expect(queryClientDefaultOptions.queries?.gcTime).toBe(600_000);
    expect(queryClientDefaultOptions.queries?.refetchOnWindowFocus).toBe(false);
    expect(queryClientDefaultOptions.queries?.refetchOnReconnect).toBe(true);
    expect(queryClientDefaultOptions.queries?.retry).toBeTypeOf("function");
    const retry = queryClientDefaultOptions.queries?.retry as (failureCount: number, error: unknown) => boolean;
    expect(retry(0, new Error("Temporary failure"))).toBe(true);
    expect(retry(2, new Error("Temporary failure"))).toBe(false);
    expect(retry(0, new Error("404 not found"))).toBe(false);
    expect(queryClientDefaultOptions.mutations?.retry).toBe(0);
  });

  it("never retries a mutation, so a warehouse write is attempted once", () => {
    // Retrying a put-away confirm would double-store a pallet.
    expect(queryClientDefaultOptions.mutations?.retry).toBe(0);
  });

  it("uses longer cache windows for shared reference data", () => {
    const queryClient = createAppQueryClient();

    expect(queryClient.getQueryDefaults(["options"]).staleTime).toBe(300_000);
    expect(queryClient.getQueryDefaults(["options"]).gcTime).toBe(1_800_000);
    expect(queryClient.getQueryDefaults(["products", "options-for-table"]).staleTime).toBe(300_000);
  });

  it("blocks mutations while offline", async () => {
    const queryClient = createAppQueryClient();
    const mutate = vi.fn();

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await expect(
      queryClient.getMutationCache().build(queryClient, { mutationFn: mutate }).execute(undefined),
    ).rejects.toThrow("Connection lost");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("still blocks commit mutations while offline even if meta is set", async () => {
    const queryClient = createAppQueryClient();
    const mutate = vi.fn().mockResolvedValue("ok");

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    await expect(
      queryClient.getMutationCache().build(queryClient, { mutationFn: mutate, meta: { offlineQueueable: true } }).execute(undefined),
    ).rejects.toThrow("Connection lost");
    expect(mutate).not.toHaveBeenCalled();
  });
});

describe("global mutation error fallback", () => {
  it("toasts a mutation that has no onError of its own", async () => {
    await runMutation({
      mutationFn: async () => {
        throw new Error("Location is full");
      },
    });

    expect(toastMocks.error).toHaveBeenCalledWith("Location is full");
  });

  it("stays quiet when the mutation reports the failure itself", async () => {
    // Otherwise the operator sees the same failure twice, once in the page's
    // own wording and once in the generic fallback.
    const onError = vi.fn();
    await runMutation({
      mutationFn: async () => {
        throw new Error("Location is full");
      },
      onError,
    });

    expect(onError).toHaveBeenCalled();
    expect(toastMocks.error).not.toHaveBeenCalled();
  });

  it("logs telemetry even when the mutation handles its own error", async () => {
    await runMutation({
      mutationFn: async () => {
        throw new Error("Location is full");
      },
      onError: vi.fn(),
      mutationKey: ["putaway", "confirm"],
    });

    expect(telemetryMocks.logErrorTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "React Query mutation failed",
        source: "react-query.mutation",
        details: expect.objectContaining({ hasLocalOnError: true }),
      }),
    );
  });

  it("leaves network failures to the offline banner", async () => {
    await runMutation({
      mutationFn: async () => {
        throw new Error("Failed to fetch");
      },
    });

    expect(toastMocks.error).not.toHaveBeenCalled();
    expect(telemetryMocks.logErrorTelemetry).not.toHaveBeenCalled();
  });

  it("falls back to a readable message for a non-Error throw", async () => {
    await runMutation({
      mutationFn: async () => {
        throw { message: "constraint violated" };
      },
    });

    expect(toastMocks.error).toHaveBeenCalledWith("constraint violated");
  });
});

describe("habit signal", () => {
  it("records every successful write without the mutation opting in", async () => {
    await runMutation({ mutationFn: async () => "ok", mutationKey: ["putaway", "confirm"] });

    expect(habitMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mutation.putaway", outcome: "ok" }),
    );
  });

  it("prefers an explicit meta.action name", async () => {
    await runMutation({ mutationFn: async () => "ok", meta: { action: "putaway.confirm" } });

    expect(habitMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "putaway.confirm", outcome: "ok" }),
    );
  });

  it("records failures, including network ones the toast suppresses", async () => {
    // A silent failure is exactly the thing an operator later reports as
    // "it just did nothing" — the breadcrumb has to survive the suppression.
    await runMutation({
      mutationFn: async () => {
        throw new Error("Failed to fetch");
      },
      meta: { action: "receiving.save" },
    });

    expect(habitMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "receiving.save", outcome: "error" }),
    );
  });

  it("does not record a success for a failed mutation", async () => {
    await runMutation({
      mutationFn: async () => {
        throw new Error("nope");
      },
      onError: vi.fn(),
    });

    const outcomes = habitMocks.recordAction.mock.calls.map((call) => call[0].outcome);
    expect(outcomes).toEqual(["error"]);
  });

  it("falls back to a generic name when the mutation is unnamed", async () => {
    await runMutation({ mutationFn: async () => "ok" });

    expect(habitMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mutation" }),
    );
  });
});
