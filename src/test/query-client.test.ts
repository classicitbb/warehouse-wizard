import { describe, expect, it, vi } from "vitest";

import { createAppQueryClient, queryClientDefaultOptions } from "@/lib/query-client";

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

  it("allows offline-queueable mutations to run while offline", async () => {
    const queryClient = createAppQueryClient();
    const mutate = vi.fn().mockResolvedValue("ok");

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

    const result = await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: mutate, meta: { offlineQueueable: true } })
      .execute(undefined);

    expect(result).toBe("ok");
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
