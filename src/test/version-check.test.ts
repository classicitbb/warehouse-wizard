import { describe, expect, it, vi } from "vitest";

import {
  decideFirstTouch,
  fetchDeployedVersion,
  IDLE_BEFORE_WAKE_MS,
  isBehindDeployed,
  MIN_PROBE_GAP_MS,
  parseVersionManifest,
  shouldProbe,
} from "@/lib/version-check";

describe("isBehindDeployed", () => {
  it("is true only when the deployed build is certainly newer", () => {
    expect(isBehindDeployed("1.30.6", "1.30.7")).toBe(true);
    expect(isBehindDeployed("1.30.10", "1.31.0")).toBe(true);
    expect(isBehindDeployed("1.30.6", "1.30.6")).toBe(false);
    expect(isBehindDeployed("1.30.7", "1.30.6")).toBe(false);
  });

  it("fails open on anything that is not a plain dotted version", () => {
    expect(isBehindDeployed("test", "1.30.7")).toBe(false);
    expect(isBehindDeployed("1.30.6", "latest")).toBe(false);
    expect(isBehindDeployed("1.30.6", null)).toBe(false);
  });
});

describe("decideFirstTouch", () => {
  const base = { running: "1.30.6", deployed: "1.30.7", online: true, activeWork: false, attemptsExhausted: false };

  it("applies when behind and safe", () => {
    expect(decideFirstTouch(base)).toBe("apply");
  });

  it("does nothing when current or unknowable", () => {
    expect(decideFirstTouch({ ...base, deployed: "1.30.6" })).toBe("current");
    expect(decideFirstTouch({ ...base, deployed: null })).toBe("current");
  });

  it("never purges while offline", () => {
    expect(decideFirstTouch({ ...base, online: false })).toBe("defer-offline");
  });

  it("never interrupts an active scan/confirm flow", () => {
    expect(decideFirstTouch({ ...base, activeWork: true })).toBe("defer-work");
  });

  it("stops reloading once attempts are exhausted, whatever else is true", () => {
    expect(decideFirstTouch({ ...base, attemptsExhausted: true })).toBe("exhausted");
    expect(decideFirstTouch({ ...base, attemptsExhausted: true, online: false })).toBe("exhausted");
  });
});

describe("shouldProbe", () => {
  const now = 1_000_000_000;

  it("always probes on load and wake, but not twice inside the minimum gap", () => {
    expect(shouldProbe({ nowMs: now, lastProbeMs: null, lastTouchMs: null, kind: "load" })).toBe(true);
    expect(shouldProbe({ nowMs: now, lastProbeMs: now - MIN_PROBE_GAP_MS - 1, lastTouchMs: now, kind: "wake" })).toBe(true);
    expect(shouldProbe({ nowMs: now, lastProbeMs: now - 1_000, lastTouchMs: null, kind: "wake" })).toBe(false);
  });

  it("only treats a plain touch as a wake after a long idle spell", () => {
    expect(shouldProbe({ nowMs: now, lastProbeMs: null, lastTouchMs: now - 5_000, kind: "touch" })).toBe(false);
    expect(
      shouldProbe({ nowMs: now, lastProbeMs: null, lastTouchMs: now - IDLE_BEFORE_WAKE_MS, kind: "touch" }),
    ).toBe(true);
    expect(shouldProbe({ nowMs: now, lastProbeMs: null, lastTouchMs: null, kind: "touch" })).toBe(true);
  });
});

describe("parseVersionManifest", () => {
  it("reads a version and rejects everything else", () => {
    expect(parseVersionManifest({ version: " 1.30.7 " })).toBe("1.30.7");
    expect(parseVersionManifest({ version: "" })).toBeNull();
    expect(parseVersionManifest({ version: 1 })).toBeNull();
    expect(parseVersionManifest(null)).toBeNull();
    expect(parseVersionManifest("1.30.7")).toBeNull();
  });
});

describe("fetchDeployedVersion", () => {
  const response = (body: unknown, init: { ok?: boolean; type?: string } = {}) =>
    ({
      ok: init.ok ?? true,
      headers: new Headers({ "content-type": init.type ?? "application/json" }),
      json: async () => body,
    }) as unknown as Response;

  it("reads the deployed version and bypasses every cache", async () => {
    const fetchImpl = vi.fn(async () => response({ version: "1.30.7" }));
    await expect(fetchDeployedVersion(fetchImpl as unknown as typeof fetch, 42)).resolves.toBe("1.30.7");
    expect(fetchImpl).toHaveBeenCalledWith("/version.json?t=42", expect.objectContaining({ cache: "no-store" }));
  });

  it("treats an HTML answer (dev server / SPA rewrite) as unknown, not as an error", async () => {
    const fetchImpl = vi.fn(async () => response({ version: "9.9.9" }, { type: "text/html" }));
    await expect(fetchDeployedVersion(fetchImpl as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("fails open on a bad status or a network failure", async () => {
    const notOk = vi.fn(async () => response({}, { ok: false }));
    const boom = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchDeployedVersion(notOk as unknown as typeof fetch)).resolves.toBeNull();
    await expect(fetchDeployedVersion(boom as unknown as typeof fetch)).resolves.toBeNull();
  });
});
