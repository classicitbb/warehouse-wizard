const ISO6346_PATTERN = /^[A-Z]{3}[UJZ]\d{7}$/;

const LETTER_VALUES: Record<string, number> = {
  A: 10,
  B: 12,
  C: 13,
  D: 14,
  E: 15,
  F: 16,
  G: 17,
  H: 18,
  I: 19,
  J: 20,
  K: 21,
  L: 23,
  M: 24,
  N: 25,
  O: 26,
  P: 27,
  Q: 28,
  R: 29,
  S: 30,
  T: 31,
  U: 32,
  V: 34,
  W: 35,
  X: 36,
  Y: 37,
  Z: 38,
};

export type ContainerNumberValidation = {
  normalized: string;
  valid: boolean;
  message: string;
};

export type ContainerNumberScanResult = {
  normalized: string;
  valid: boolean;
  candidate?: string;
  message: string;
};

export function normalizeContainerNumber(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeOcrContainerCandidate(value: string) {
  const raw = normalizeContainerNumber(value);
  if (raw.length !== 11) return raw;

  const ownerAndCategory = raw.slice(0, 4).replace(/[0185]/g, (char) => {
    if (char === "0") return "O";
    if (char === "1") return "I";
    if (char === "8") return "B";
    return "S";
  });
  const serialAndCheck = raw.slice(4).replace(/[OQDISBZ]/g, (char) => {
    if (char === "O" || char === "Q" || char === "D") return "0";
    if (char === "I") return "1";
    if (char === "S") return "5";
    if (char === "B") return "8";
    return "2";
  });

  return `${ownerAndCategory}${serialAndCheck}`;
}

export function collectIso6346ContainerCandidates(value: unknown) {
  const compact = normalizeContainerNumber(value);
  const candidates = new Set<string>();

  for (const match of compact.match(/[A-Z0-9]{4}\d{7}/g) ?? []) {
    candidates.add(normalizeOcrContainerCandidate(match));
  }
  for (let index = 0; index <= compact.length - 11; index += 1) {
    candidates.add(normalizeOcrContainerCandidate(compact.slice(index, index + 11)));
  }

  return Array.from(candidates).filter((candidate) => ISO6346_PATTERN.test(candidate));
}

export function calculateIso6346CheckDigit(codeWithoutCheckDigit: string) {
  const code = normalizeContainerNumber(codeWithoutCheckDigit).slice(0, 10);
  if (!/^[A-Z]{3}[UJZ]\d{6}$/.test(code)) return null;

  const total = Array.from(code).reduce((sum, char, index) => {
    const value = /\d/.test(char) ? Number(char) : LETTER_VALUES[char];
    if (value == null) return sum;
    return sum + value * (2 ** index);
  }, 0);
  const remainder = total % 11;
  return remainder === 10 ? 0 : remainder;
}

export function validateIso6346ContainerNumber(value: unknown): ContainerNumberValidation {
  const normalized = normalizeContainerNumber(value);
  if (!normalized) {
    return {
      normalized,
      valid: false,
      message: "Enter a container number before saving.",
    };
  }
  if (!ISO6346_PATTERN.test(normalized)) {
    return {
      normalized,
      valid: false,
      message: "Enter a valid ISO 6346 container number: 4 letters, 7 digits.",
    };
  }
  const expected = calculateIso6346CheckDigit(normalized.slice(0, 10));
  const actual = Number(normalized.slice(10));
  if (expected !== actual) {
    return {
      normalized,
      valid: false,
      message: `Container check digit should be ${expected}. Check the number and try again.`,
    };
  }
  return {
    normalized,
    valid: true,
    message: "Valid ISO 6346 container number.",
  };
}

export function extractIso6346ContainerNumber(value: unknown): ContainerNumberScanResult {
  const text = normalizeContainerNumber(value);
  const candidates = collectIso6346ContainerCandidates(value);
  for (const candidate of candidates) {
    const validation = validateIso6346ContainerNumber(candidate);
    if (validation.valid) {
      return { ...validation, candidate };
    }
  }
  if (candidates[0]) {
    const validation = validateIso6346ContainerNumber(candidates[0]);
    return { ...validation, candidate: candidates[0] };
  }
  return {
    normalized: text,
    valid: false,
    message: "No ISO 6346 container number was found in the scan.",
  };
}

/**
 * Accepts any typed container reference. Valid ISO 6346 numbers are returned
 * normalized; anything else is kept as typed (trimmed) so non-standard
 * references can still be saved. Callers show the validation message as a soft warning.
 */
export function resolveContainerNumberInput(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const validation = validateIso6346ContainerNumber(raw);
  return validation.valid ? validation.normalized : raw;
}
