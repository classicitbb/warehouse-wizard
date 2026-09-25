// Scanner text normalisation and warehouse-scope rules shared by floor pages.
import { extractIso6346ContainerNumber, normalizeContainerNumber } from "@/lib/container-number";

export function shouldRestrictToDefaultWarehouse(roles: string[]) {
  return roles.some((role) => ["inventory_clerk", "warehouse_operator", "dispatch_driver"].includes(role)) &&
    !roles.some((role) => ["admin", "warehouse_manager"].includes(role));
}

export function normalizeScannerText(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

export function resolveContainerScanValue(value: unknown) {
  const result = extractIso6346ContainerNumber(value);
  if (result.valid) return { value: result.normalized, valid: true, message: result.message, candidate: result.candidate };
  return {
    value: result.candidate ?? normalizeContainerNumber(value),
    valid: false,
    candidate: result.candidate,
    message: result.message,
  };
}

export function isBaySelectorCode(value: string) {
  const normalized = normalizeScannerText(value);
  if (normalized.startsWith("BAY:")) return true;
  const parts = normalized.split("-").filter(Boolean);
  if (parts.length === 2 && /^\d+$/.test(parts[1])) return true;
  return parts.length >= 4 && !parts.some((part) => /^L\d+$/i.test(part));
}
