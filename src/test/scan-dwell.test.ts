import { describe, expect, it } from "vitest";

import { SCAN_DWELL_MS, updateScanDwell, type ScanDwellState } from "@/lib/scan-dwell";

describe("updateScanDwell", () => {
  it("accepts a found code instantly by default", () => {
    expect(SCAN_DWELL_MS).toBe(0);
    const result = updateScanDwell(null, "PLT-1", 1000);
    expect(result.ready).toBe(true);
    expect(result.state).toEqual({ value: "PLT-1", startedAt: 1000 });
    expect(result.progress).toBe(0);
  });

  it("accepts only after the same value is held for an explicit dwell", () => {
    const dwellMs = 1000;
    let state: ScanDwellState = null;
    let result = updateScanDwell(state, "PLT-1", 0, dwellMs);
    expect(result.ready).toBe(false);
    state = result.state;
    result = updateScanDwell(state, "PLT-1", dwellMs - 1, dwellMs);
    expect(result.ready).toBe(false);
    expect(result.progress).toBeGreaterThan(0);
    state = result.state;
    result = updateScanDwell(state, "PLT-1", dwellMs, dwellMs);
    expect(result.ready).toBe(true);
    expect(result.state).toBeNull();
    expect(result.progress).toBeNull();
  });

  it("a different value restarts an explicit dwell", () => {
    const dwellMs = 1000;
    const first = updateScanDwell(null, "PLT-1", 0, dwellMs);
    const restarted = updateScanDwell(first.state, "PLT-2", dwellMs + 500, dwellMs);
    expect(restarted.ready).toBe(false);
    expect(restarted.state).toEqual({ value: "PLT-2", startedAt: dwellMs + 500 });
    expect(restarted.progress).toBe(0);
  });

  it("losing the code cancels the dwell", () => {
    const started = updateScanDwell(null, "PLT-1", 0, 1000);
    const lost = updateScanDwell(started.state, null, 400, 1000);
    expect(lost.state).toBeNull();
    expect(lost.progress).toBeNull();
    expect(lost.ready).toBe(false);
  });

  it("reports progress as the exact share of the dwell elapsed", () => {
    const started = updateScanDwell(null, "PLT-1", 1000, 1000);
    const quarter = updateScanDwell(started.state, "PLT-1", 1250, 1000);
    expect(quarter.progress).toBe(0.25);
    expect(quarter.state).toEqual({ value: "PLT-1", startedAt: 1000 });
    expect(quarter.ready).toBe(false);
  });

  it("caps progress just short of complete until the dwell is reached", () => {
    const started = updateScanDwell(null, "PLT-1", 0, 1000);
    const almost = updateScanDwell(started.state, "PLT-1", 999, 1000);
    expect(almost.progress).toBe(0.99);
    expect(almost.ready).toBe(false);
  });

  it("trims scanner whitespace so a padded re-read continues the same dwell", () => {
    const started = updateScanDwell(null, " PLT-1 ", 0, 1000);
    expect(started.state).toEqual({ value: "PLT-1", startedAt: 0 });
    const held = updateScanDwell(started.state, "PLT-1\n", 500, 1000);
    expect(held.state).toEqual({ value: "PLT-1", startedAt: 0 });
    expect(held.progress).toBe(0.5);
  });

  it("ignores blank decodes without disturbing a tracked candidate", () => {
    const started = updateScanDwell(null, "PLT-1", 0, 1000);
    const blank = updateScanDwell(started.state, "   ", 400, 1000);
    expect(blank.state).toBeNull();
  });
});
