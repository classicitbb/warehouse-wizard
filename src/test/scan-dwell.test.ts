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

  it("ignores blank decodes without disturbing a tracked candidate", () => {
    const started = updateScanDwell(null, "PLT-1", 0, 1000);
    const blank = updateScanDwell(started.state, "   ", 400, 1000);
    expect(blank.state).toBeNull();
  });
});
