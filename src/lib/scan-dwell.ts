// One-second dwell for live camera scans.
//
// A decoded value must stay on camera continuously for `SCAN_DWELL_MS` before
// it is accepted. A different value restarts the timer; losing the code
// cancels it. This keeps a passing glimpse of a neighbouring label from
// inserting itself, and gives the operator a visible "hold steady" beat.

export const SCAN_DWELL_MS = 1000;

export type ScanDwellState = {
  value: string;
  startedAt: number;
} | null;

export type ScanDwellResult = {
  /** Carry this into the next call. */
  state: ScanDwellState;
  /** 0..1 while a candidate is being held; null when nothing is tracked. */
  progress: number | null;
  /** True once the same value has been seen continuously for the dwell. */
  ready: boolean;
};

export function updateScanDwell(
  state: ScanDwellState,
  rawValue: string | null,
  now: number,
  dwellMs: number = SCAN_DWELL_MS,
): ScanDwellResult {
  const value = (rawValue ?? "").trim();
  if (!value) {
    return { state: null, progress: null, ready: false };
  }
  if (!state || state.value !== value) {
    return { state: { value, startedAt: now }, progress: 0, ready: dwellMs <= 0 };
  }
  if (now - state.startedAt >= dwellMs) {
    return { state: null, progress: null, ready: true };
  }
  return { state, progress: Math.min(0.99, (now - state.startedAt) / dwellMs), ready: false };
}
