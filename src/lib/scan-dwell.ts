// Live camera scans accept the first decoded value instantly.
//
// `SCAN_DWELL_MS` is 0: a found code is accepted on first sight. The dwell
// machinery below still supports a hold-steady delay if a future scanner
// needs it — pass an explicit dwell to `updateScanDwell`.

export const SCAN_DWELL_MS = 0;

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
