import { beforeEach, describe, expect, it } from "vitest";

import {
  clearForcedReloadAttempts,
  compareAppVersions,
  computeForcedUpdateDeadline,
  isBuildOutdated,
  MAX_FORCED_RELOAD_ATTEMPTS,
  MIN_FORCED_GRACE_MS,
  parseAppVersion,
  readForcedDeadline,
  readForcedReloadAttempts,
  recordForcedReloadAttempt,
  summarizeFleetVersions,
  writeForcedDeadline,
} from "@/lib/release-policy";

describe("version comparison", () => {
  it("parses dotted numeric versions and rejects anything else", () => {
    expect(parseAppVersion("1.29.2")).toEqual([1, 29, 2]);
    expect(parseAppVersion("1.28")).toEqual([1, 28]);
    expect(parseAppVersion(" 1.29.2 ")).toEqual([1, 29, 2]);
    expect(parseAppVersion("test")).toBeNull();
    expect(parseAppVersion("1.29.2-beta")).toBeNull();
    expect(parseAppVersion(null)).toBeNull();
  });

  it("orders the project's roll-at-10 numbering correctly", () => {
    expect(compareAppVersions("1.28.9", "1.28.10")).toBe(-1);
    expect(compareAppVersions("1.28.10", "1.29.0")).toBe(-1);
    expect(compareAppVersions("1.29.0", "1.28.10")).toBe(1);
    expect(compareAppVersions("1.29.2", "1.29.2")).toBe(0);
    // Missing segments count as zero, so 1.28 and 1.28.0 are the same build.
    expect(compareAppVersions("1.28", "1.28.0")).toBe(0);
    expect(compareAppVersions("1.9.0", "1.10.0")).toBe(-1);
  });

  it("fails open when either version is not comparable", () => {
    expect(compareAppVersions("test", "1.29.2")).toBeNull();
    expect(isBuildOutdated("test", "1.29.2")).toBe(false);
    expect(isBuildOutdated("1.29.2", null)).toBe(false);
    expect(isBuildOutdated("1.29.1", "1.29.2")).toBe(true);
    expect(isBuildOutdated("1.29.2", "1.29.2")).toBe(false);
    expect(isBuildOutdated("1.30.0", "1.29.2")).toBe(false);
  });
});

describe("grace window", () => {
  const now = Date.parse("2026-09-02T10:00:00.000Z");

  it("uses the full grace period when no force_after is set", () => {
    expect(computeForcedUpdateDeadline({ nowMs: now, forceAfterMs: null, graceMinutes: 10 })).toBe(now + 10 * 60_000);
  });

  it("honours force_after inside the grace window", () => {
    const forceAfterMs = now + 4 * 60_000;
    expect(computeForcedUpdateDeadline({ nowMs: now, forceAfterMs, graceMinutes: 10 })).toBe(forceAfterMs);
  });

  it("never waits longer than the configured grace, even with a skewed clock", () => {
    const forceAfterMs = now + 12 * 60 * 60_000;
    expect(computeForcedUpdateDeadline({ nowMs: now, forceAfterMs, graceMinutes: 10 })).toBe(now + 10 * 60_000);
  });

  it("still gives the operator a readable countdown when force_after already passed", () => {
    const forceAfterMs = now - 60 * 60_000;
    expect(computeForcedUpdateDeadline({ nowMs: now, forceAfterMs, graceMinutes: 10 })).toBe(now + MIN_FORCED_GRACE_MS);
  });

  it("clamps a zero grace up to the readable minimum", () => {
    expect(computeForcedUpdateDeadline({ nowMs: now, forceAfterMs: null, graceMinutes: 0 })).toBe(
      now + MIN_FORCED_GRACE_MS,
    );
  });
});

describe("deadline persistence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it("only returns a deadline recorded for the same target version", () => {
    writeForcedDeadline("1.29.3", 123456);
    expect(readForcedDeadline("1.29.3")).toBe(123456);
    expect(readForcedDeadline("1.29.4")).toBeNull();
  });
});

describe("forced reload attempt guard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("counts attempts per target version and stops at the cap", () => {
    expect(readForcedReloadAttempts("1.29.3")).toBe(0);
    expect(recordForcedReloadAttempt("1.29.3")).toBe(1);
    expect(recordForcedReloadAttempt("1.29.3")).toBe(2);
    expect(readForcedReloadAttempts("1.29.3")).toBe(MAX_FORCED_RELOAD_ATTEMPTS);
    // A new target starts its own count, so one bad policy value cannot
    // permanently disable the gate.
    expect(readForcedReloadAttempts("1.29.4")).toBe(0);
  });

  it("clears once the running build satisfies the policy", () => {
    recordForcedReloadAttempt("1.29.3");
    clearForcedReloadAttempts();
    expect(readForcedReloadAttempts("1.29.3")).toBe(0);
  });
});

describe("fleet rollup", () => {
  it("groups sessions by build, newest first", () => {
    const rows = summarizeFleetVersions([
      { deviceId: "a", appVersion: "1.29.2", lastSeenAt: "", userLabel: null },
      { deviceId: "b", appVersion: "1.28.10", lastSeenAt: "", userLabel: null },
      { deviceId: "c", appVersion: "1.29.2", lastSeenAt: "", userLabel: null },
    ]);
    expect(rows).toEqual([
      { version: "1.29.2", sessions: 2 },
      { version: "1.28.10", sessions: 1 },
    ]);
  });
});
