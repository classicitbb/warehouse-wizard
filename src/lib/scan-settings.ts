/**
 * Device-level scanner tuning.
 *
 * Both values live in localStorage so a floor tablet can be tuned from the
 * Settings > Environment tab without rebuilding or redeploying the app.
 *
 * - dwell: how long the same code must stay in view before it is accepted
 *   (0 = accept instantly, the default).
 * - cooldown: how long after a successful scan the same code is ignored, so a
 *   scanner that fires twice cannot submit the same value twice.
 */

const DWELL_KEY = "ww.scan.dwellMs";
const COOLDOWN_KEY = "ww.scan.cooldownMs";

export const DEFAULT_SCAN_DWELL_MS = 0;
export const DEFAULT_SCAN_COOLDOWN_MS = 1500;

export const SCAN_DWELL_MIN_MS = 0;
export const SCAN_DWELL_MAX_MS = 3000;
export const SCAN_COOLDOWN_MIN_MS = 0;
export const SCAN_COOLDOWN_MAX_MS = 10000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function read(key: string, fallback: number, min: number, max: number): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(Math.round(parsed), min, max);
  } catch {
    return fallback;
  }
}

function write(key: string, value: number, min: number, max: number): number {
  const next = clamp(Math.round(Number.isFinite(value) ? value : 0), min, max);
  try {
    localStorage?.setItem(key, String(next));
  } catch {
    // Private-mode browsers just keep the in-memory default.
  }
  return next;
}

export function getScanDwellMs(): number {
  return read(DWELL_KEY, DEFAULT_SCAN_DWELL_MS, SCAN_DWELL_MIN_MS, SCAN_DWELL_MAX_MS);
}

export function setScanDwellMs(value: number): number {
  return write(DWELL_KEY, value, SCAN_DWELL_MIN_MS, SCAN_DWELL_MAX_MS);
}

export function getScanCooldownMs(): number {
  return read(COOLDOWN_KEY, DEFAULT_SCAN_COOLDOWN_MS, SCAN_COOLDOWN_MIN_MS, SCAN_COOLDOWN_MAX_MS);
}

export function setScanCooldownMs(value: number): number {
  return write(COOLDOWN_KEY, value, SCAN_COOLDOWN_MIN_MS, SCAN_COOLDOWN_MAX_MS);
}

/** True when `value` was accepted less than the cooldown window ago. */
export function isWithinScanCooldown(
  last: { value: string; at: number } | null,
  value: string,
  now: number,
  cooldownMs: number = getScanCooldownMs(),
): boolean {
  if (!last || cooldownMs <= 0) return false;
  if (last.value !== value) return false;
  return now - last.at < cooldownMs;
}
