import { describe, expect, it } from "vitest";

import { SCAN_DWELL_MS, updateScanDwell, type ScanDwellState } from "@/lib/scan-dwell";

describe("updateScanDwell", () => {
  it("starts the timer on first sight without accepting", () => {
    const result = updateScanDwell(null, "PLT-1", 1000);
    expect(result.ready).toBe(false);
    expect(result.state).toEqual({ value: "PLT-1", startedAt: 1000 });
    expect(result.progress).toBe(0);
  });

  it("accepts only after the same value is held for the full dwell", () => {
    let state: ScanDwellState = null;
    let result = updateScanDwell(state, "PLT-1", 0);
    state = result.state;
    result = updateScanDwell(state, "PLT-1", SCAN_DWELL_MS - 1);
    expect(result.ready).toBe(false);
    expect(result.progress).toBeGreaterThan(0);
    state = result.state;
    result = updateScanDwell(state, "PLT-1", SCAN_DWELL_MS);
    expect(result.ready).toBe(true);
    expect(result.state).toBeNull();
    expect(result.progress).toBeNull();
  });

  it("a different value restarts the timer", () => {
    const first = updateScanDwell(null, "PLT-1", 0);
    const restarted = updateScanDwell(first.state, "PLT-2", SCAN_DWELL_MS + 500);
    expect(restarted.ready).toBe(false);
    expect(restarted.state).toEqual({ value: "PLT-2", startedAt: SCAN_DWELL_MS + 500 });
    expect(restarted.progress).toBe(0);
  });

  it("losing the code cancels the dwell", () => {
    const started = updateScanDwell(null, "PLT-1", 0);
    const lost = updateScanDwell(started.state, null, 400);
    expect(lost.state).toBeNull();
    expect(lost.progress).toBeNull();
    expect(lost.ready).toBe(false);
  });

  it("ignores blank decodes without disturbing a tracked candidate", () => {
    const started = updateScanDwell(null, "PLT-1", 0);
    const blank = updateScanDwell(started.state, "   ", 400);
    expect(blank.state).toBeNull();
  });
});
