import { beforeEach, describe, expect, it } from "vitest";

import {
  __resetActivitySnapshotForTests,
  decideDailyRefresh,
  markActivity,
  markDailyRefresh,
  mostRecentCutoff,
  readActivityAtLoad,
  readLastActivity,
  readLastDailyRefresh,
  shouldSignOutForNight,
} from "@/lib/daily-refresh";

/** Local-time helper so these assertions hold in any timezone. */
function localTime(year: number, month: number, day: number, hour: number, minute = 0) {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe("mostRecentCutoff", () => {
  it("is today's cutoff once the hour has passed", () => {
    expect(mostRecentCutoff(localTime(2026, 9, 2, 7, 30), 4)).toBe(localTime(2026, 9, 2, 4));
  });

  it("is yesterday's cutoff before the hour arrives", () => {
    expect(mostRecentCutoff(localTime(2026, 9, 2, 2, 15), 4)).toBe(localTime(2026, 9, 1, 4));
  });

  it("clamps an out-of-range hour", () => {
    // 99 clamps to 23:00, which is still ahead of noon, so it rolls back a day.
    expect(mostRecentCutoff(localTime(2026, 9, 2, 12), 99)).toBe(localTime(2026, 9, 1, 23));
  });
});

describe("decideDailyRefresh", () => {
  const now = localTime(2026, 9, 2, 7, 30);
  /** A shell that has been running since before this morning's cutoff. */
  const staleShell = localTime(2026, 9, 1, 16);

  it("reloads a tab that has been open since before the cutoff", () => {
    expect(
      decideDailyRefresh({
        nowMs: now,
        lastRunMs: staleShell,
        documentLoadedAtMs: staleShell,
        hour: 4,
        enabled: true,
      }),
    ).toBe("reload");
  });

  it("does not reload a shell that already loaded after the cutoff — straight to work", () => {
    // The operator switched the tablet on at 07:00 this morning. Its bundle is
    // already today's, so a purge + reload would cost a second cold start for
    // nothing. The day is still recorded as handled.
    expect(
      decideDailyRefresh({
        nowMs: now,
        lastRunMs: staleShell,
        documentLoadedAtMs: localTime(2026, 9, 2, 7),
        hour: 4,
        enabled: true,
      }),
    ).toBe("stamp-only");
  });

  it("does not run twice in the same day", () => {
    expect(
      decideDailyRefresh({
        nowMs: now,
        lastRunMs: localTime(2026, 9, 2, 5),
        documentLoadedAtMs: staleShell,
        hour: 4,
        enabled: true,
      }),
    ).toBe("idle");
  });

  it("does not run before the cutoff hour", () => {
    const earlyMorning = localTime(2026, 9, 2, 2);
    expect(
      decideDailyRefresh({
        nowMs: earlyMorning,
        lastRunMs: staleShell,
        documentLoadedAtMs: localTime(2026, 9, 1, 15),
        hour: 4,
        enabled: true,
      }),
    ).toBe("idle");
  });

  it("seeds a device with no stamp instead of reloading it", () => {
    expect(
      decideDailyRefresh({ nowMs: now, lastRunMs: null, documentLoadedAtMs: staleShell, hour: 4, enabled: true }),
    ).toBe("stamp-only");
  });

  it("does nothing at all when disabled", () => {
    expect(
      decideDailyRefresh({
        nowMs: now,
        lastRunMs: localTime(2026, 8, 20, 9),
        documentLoadedAtMs: staleShell,
        hour: 4,
        enabled: false,
      }),
    ).toBe("idle");
  });
});

describe("shouldSignOutForNight", () => {
  const now = localTime(2026, 9, 2, 6, 45);

  it("signs out a device idle since before the cutoff", () => {
    expect(
      shouldSignOutForNight({ nowMs: now, lastActivityMs: localTime(2026, 9, 1, 22), hour: 4, enabled: true }),
    ).toBe(true);
  });

  it("leaves a device that has been used since the cutoff alone", () => {
    expect(
      shouldSignOutForNight({ nowMs: now, lastActivityMs: localTime(2026, 9, 2, 5, 30), hour: 4, enabled: true }),
    ).toBe(false);
  });

  it("does nothing when the toggle is off or activity is unknown", () => {
    expect(
      shouldSignOutForNight({ nowMs: now, lastActivityMs: localTime(2026, 9, 1, 22), hour: 4, enabled: false }),
    ).toBe(false);
    expect(shouldSignOutForNight({ nowMs: now, lastActivityMs: null, hour: 4, enabled: true })).toBe(false);
  });
});

describe("stamps", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetActivitySnapshotForTests();
  });

  it("pins the load-time activity snapshot so this session cannot erase it", () => {
    const lastNight = localTime(2026, 9, 1, 22);
    markActivity(lastNight);

    // First read pins the pre-session value; later activity moves the live
    // stamp but must not move the snapshot the sign-out check reads.
    expect(readActivityAtLoad()).toBe(lastNight);
    markActivity(localTime(2026, 9, 2, 6, 30));
    expect(readLastActivity()).toBe(localTime(2026, 9, 2, 6, 30));
    expect(readActivityAtLoad()).toBe(lastNight);

    // Which is what lets an overnight-idle device actually sign out.
    expect(
      shouldSignOutForNight({
        nowMs: localTime(2026, 9, 2, 6, 45),
        lastActivityMs: readActivityAtLoad(),
        hour: 4,
        enabled: true,
      }),
    ).toBe(true);
  });

  it("records the daily refresh stamp", () => {
    const at = localTime(2026, 9, 2, 4, 5);
    markDailyRefresh(at);
    expect(readLastDailyRefresh()).toBe(at);
  });

  it("throttles activity writes to once a minute", () => {
    const first = localTime(2026, 9, 2, 9, 0);
    markActivity(first);
    markActivity(first + 5_000);
    expect(readLastActivity()).toBe(first);
    markActivity(first + 61_000);
    expect(readLastActivity()).toBe(first + 61_000);
  });
});
