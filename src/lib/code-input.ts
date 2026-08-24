/**
 * Entry rules for the two code shapes operators type or scan by hand.
 *
 * 1. Pallet-only fields must hold a `PLT-` barcode. Every pallet in the system
 *    is generated with that prefix, so anything else is a mis-scan (a SKU, a
 *    location label, a task number) and would only fail later at lookup time.
 * 2. Bay/location fields must match a code that actually exists — as a prefix
 *    while the operator is still typing, or exactly once complete.
 *
 * These helpers are pure so both the UI fields and the core write paths can
 * share one rule (and one message).
 */

export const PALLET_BARCODE_PREFIX = "PLT-";
export const PALLET_BARCODE_MESSAGE = "Pallet barcodes start with PLT-";
export const UNKNOWN_LOCATION_CODE_MESSAGE = "No bay or location matches this code";

export function normalizeCodeInput(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Trim/uppercase and drop the whitespace some scanners append mid-string. */
export function normalizePalletBarcode(value: unknown): string {
  return normalizeCodeInput(value).replace(/\s+/g, "");
}

export function isPalletBarcode(value: unknown): boolean {
  const normalized = normalizePalletBarcode(value);
  return normalized.startsWith(PALLET_BARCODE_PREFIX) && normalized.length > PALLET_BARCODE_PREFIX.length;
}

/**
 * Inline field error for a pallet-only input. Empty input is neutral — the
 * action button is already disabled while the field is blank.
 */
export function palletBarcodeError(value: unknown): string | null {
  const normalized = normalizePalletBarcode(value);
  if (!normalized) return null;
  return isPalletBarcode(normalized) ? null : PALLET_BARCODE_MESSAGE;
}

/** Throwing variant for core write paths (offline replay, Copilot, tests). */
export function assertPalletBarcode(value: unknown): string {
  const normalized = normalizePalletBarcode(value);
  if (!isPalletBarcode(normalized)) throw new Error(PALLET_BARCODE_MESSAGE);
  return normalized;
}

export type KnownCodeIndex = {
  /** Sorted, de-duplicated list of every acceptable full code. */
  codes: string[];
  /**
   * Dash-free lookup so operators can type `A01A` and get `A-01-A`. Maps every
   * separator-stripped code *and* prefix to its canonical dashed form, or to
   * `null` when more than one code shares that stripped prefix (ambiguous, so
   * nothing is auto-corrected).
   */
  looseIndex: Record<string, string | null>;
  ready: boolean;
};

export const EMPTY_KNOWN_CODE_INDEX: KnownCodeIndex = { codes: [], looseIndex: {}, ready: false };

export type KnownLocationRow = {
  code?: string | null;
  zone_code?: string | null;
  warehouse_code?: string | null;
};

/** Drop the separators operators skip when typing (`A-01-A` -> `A01A`). */
export function stripCodeSeparators(value: unknown): string {
  return normalizeCodeInput(value).replace(/[-_\s./]/g, "");
}

/**
 * Builds the acceptable-code list from location rows. Both shapes a label can
 * carry are indexed: the short rack code (`A-04-A`) and the full hierarchy code
 * printed on newer labels (`WH3-A-04-A`), which move validation already
 * resolves back to the short code.
 */
export function buildKnownCodeIndex(rows: KnownLocationRow[]): KnownCodeIndex {
  const codes = new Set<string>();
  for (const row of rows) {
    const code = normalizeCodeInput(row?.code);
    if (!code) continue;
    codes.add(code);
    const zone = normalizeCodeInput(row?.zone_code);
    const warehouse = normalizeCodeInput(row?.warehouse_code);
    if (warehouse && zone) codes.add(`${warehouse}-${zone}-${code}`);
    if (warehouse) codes.add(`${warehouse}-${code}`);
  }
  const sorted = Array.from(codes).sort();
  const looseIndex: Record<string, string | null> = {};
  for (const code of sorted) {
    const stripped = stripCodeSeparators(code);
    for (let length = 1; length <= stripped.length; length += 1) {
      const key = stripped.slice(0, length);
      // The canonical value is the dashed code truncated to the same number of
      // meaningful characters, so partial typing corrects as it goes.
      const canonical = truncateToStrippedLength(code, length);
      if (!(key in looseIndex)) looseIndex[key] = canonical;
      else if (looseIndex[key] !== canonical) looseIndex[key] = null;
    }
  }
  return { codes: sorted, looseIndex, ready: codes.size > 0 };
}

/** Slice a dashed code so it contains `length` non-separator characters. */
function truncateToStrippedLength(code: string, length: number): string {
  let seen = 0;
  let end = 0;
  for (let i = 0; i < code.length; i += 1) {
    end = i + 1;
    if (!/[-_\s./]/.test(code[i])) {
      seen += 1;
      if (seen === length) break;
    }
  }
  return code.slice(0, end);
}

/** Binary search: is `prefix` the start of (or equal to) any indexed code? */
export function matchesKnownCode(index: KnownCodeIndex, value: unknown): boolean {
  const prefix = normalizeCodeInput(value);
  if (!prefix) return true;
  const { codes } = index;
  let low = 0;
  let high = codes.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const code = codes[mid];
    if (code.startsWith(prefix)) return true;
    if (code < prefix) low = mid + 1;
    else high = mid - 1;
  }
  return false;
}

/** True when the dash-free form of `value` can still lead to a real code. */
export function matchesKnownCodeLoosely(index: KnownCodeIndex, value: unknown): boolean {
  const stripped = stripCodeSeparators(value);
  if (!stripped) return true;
  return stripped in index.looseIndex;
}

/**
 * Autocorrects typed input towards the canonical dashed code. Returns the value
 * to put back in the field: the canonical form when the dash-free text resolves
 * to exactly one code, otherwise the value as typed (uppercased/trimmed).
 */
export function resolveKnownCode(index: KnownCodeIndex, value: unknown): { value: string; corrected: boolean } {
  const typed = normalizeCodeInput(value);
  if (!index.ready || !typed) return { value: typed, corrected: false };
  const stripped = stripCodeSeparators(typed);
  const canonical = index.looseIndex[stripped];
  if (!canonical || canonical === typed) return { value: typed, corrected: false };
  return { value: canonical, corrected: true };
}

/**
 * Inline field error for a bay/location input. While the index is still
 * loading (or empty, e.g. a brand new warehouse) nothing is flagged so the
 * floor is never blocked by a slow query.
 */
export function knownCodeError(index: KnownCodeIndex, value: unknown): string | null {
  if (!index.ready) return null;
  const normalized = normalizeCodeInput(value);
  if (!normalized) return null;
  if (matchesKnownCode(index, normalized)) return null;
  return matchesKnownCodeLoosely(index, normalized) ? null : UNKNOWN_LOCATION_CODE_MESSAGE;
}


/**
 * Field-level autocorrect for typed bay/location codes. Only fires while the
 * operator is adding characters, so backspacing over an inserted dash still
 * works.
 */
export function applyCodeAutocorrect(index: KnownCodeIndex, next: unknown, previous: unknown): string {
  const typed = normalizeCodeInput(next);
  const before = normalizeCodeInput(previous);
  if (typed.length < before.length) return typed;
  return resolveKnownCode(index, typed).value;
}
