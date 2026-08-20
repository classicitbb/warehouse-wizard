import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OFFLINE_WORK_MESSAGE,
  assertOnline,
  guardMutation,
  isAppOnline,
  probeLiveConnection,
} from "@/hooks/use-network-status";

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isAppOnline", () => {
  it("follows the browser's own flag", () => {
    expect(isAppOnline()).toBe(true);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(isAppOnline()).toBe(false);
  });
});

describe("assertOnline", () => {
  it("passes silently while connected", () => {
    expect(() => assertOnline()).not.toThrow();
  });

  it("throws the operator-facing offline message, not a generic one", () => {
    // Pages match on this text and several show it verbatim, so the wording is
    // part of the contract rather than an implementation detail.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(() => assertOnline()).toThrow(OFFLINE_WORK_MESSAGE);
    expect(OFFLINE_WORK_MESSAGE).toContain("Connection lost");
  });
});

describe("guardMutation", () => {
  it("runs the wrapped call when connected and passes arguments through", async () => {
    const inner = vi.fn(async (a: string, b: number) => `${a}:${b}`);
    const guarded = guardMutation(inner);

    await expect(guarded("PLT-1", 4)).resolves.toBe("PLT-1:4");
    expect(inner).toHaveBeenCalledWith("PLT-1", 4);
  });

  it("refuses to call through while offline", () => {
    // The guard has to fire before the call, not after: a half-sent commit is
    // exactly what the offline freeze exists to prevent.
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const inner = vi.fn();
    const guarded = guardMutation(inner);

    expect(() => guarded()).toThrow(OFFLINE_WORK_MESSAGE);
    expect(inner).not.toHaveBeenCalled();
  });
});

describe("probeLiveConnection", () => {
  it("treats any HTTP response as proof the service is reachable", async () => {
    // Even a 401 or 503 means the radio, Wi-Fi and DNS all worked.
    const fetchMock = vi.fn(async () => ({ status: 503 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(probeLiveConnection()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/v1/health"),
      expect.objectContaining({ cache: "no-store" }),
    );
    vi.unstubAllGlobals();
  });

  it("reports offline only when the transport itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    await expect(probeLiveConnection()).resolves.toBe(false);
    vi.unstubAllGlobals();
  });

  it("gives up on a hung request rather than freezing the screen", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      }),
    ));

    await expect(probeLiveConnection(10)).resolves.toBe(false);
    vi.unstubAllGlobals();
  });
});
