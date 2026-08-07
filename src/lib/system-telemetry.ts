import { toast as sonnerToast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { writeSystemLog, type SystemLogEntry } from "@/features/system/system-core";

type LogType = SystemLogEntry["log_type"];
type Severity = SystemLogEntry["severity"];

type TelemetryPayload = {
  log_type: LogType;
  severity: Severity;
  title: string;
  message?: string;
  source: string;
  details?: Record<string, unknown>;
};

const MAX_STRING_LENGTH = 4_000;
const MAX_ARRAY_LENGTH = 20;
const MAX_OBJECT_KEYS = 40;
const REDACTED_VALUE = "[redacted]";
const SENSITIVE_KEY_PATTERN = /password|passcode|pin|token|secret|apikey|api_key|authorization|cookie|session|credential|refresh/i;

let toastTelemetryInstalled = false;
let consoleErrorTelemetryInstalled = false;

/** Dev-only noise we never want to persist into the system log. */
const IGNORED_CONSOLE_PATTERNS = [
  /Function components cannot be given refs/i,
  /Warning: ReactDOM.render is no longer supported/i,
];

function getAppVersion() {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  } catch {
    return "unknown";
  }
}

function getRuntimeContext() {
  return {
    appVersion: getAppVersion(),
    href: window.location.href,
    pathname: window.location.pathname,
    search: window.location.search,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    timestamp: new Date().toISOString(),
  };
}

function truncateString(value: string) {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return truncateString(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol" || typeof value === "function") return String(value);
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Event) {
    return {
      type: value.type,
      target: value.target instanceof Element ? describeElement(value.target) : null,
      currentTarget: value.currentTarget instanceof Element ? describeElement(value.currentTarget) : null,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED_VALUE : sanitizeValue(nestedValue, seen);
    }
    return output;
  }
  return String(value);
}

function describeElement(element: Element) {
  return {
    tagName: element.tagName.toLowerCase(),
    id: element.id || null,
    className: typeof element.className === "string" ? element.className : null,
    ariaLabel: element.getAttribute("aria-label"),
    name: element.getAttribute("name"),
    type: element.getAttribute("type"),
  };
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if ("cause" in error) serialized.cause = sanitizeValue(error.cause);
    return serialized;
  }
  return {
    name: typeof error,
    message: typeof error === "string" ? error : "Non-Error value thrown",
    value: sanitizeValue(error),
  };
}

export function logSystemTelemetry(payload: TelemetryPayload) {
  const details = {
    ...(payload.details ?? {}),
    runtime: getRuntimeContext(),
  };

  void supabase.auth
    .getSession()
    .then(({ data }) => {
      // Unauthenticated visitors cannot write system logs — skip instead of 401 noise.
      if (!data.session) return;
      return writeSystemLog({
    log_type: payload.log_type,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    source: payload.source,
    details: sanitizeValue(details) as Record<string, unknown>,
      });
    })
    .catch((error) => {
      console.error("[system-telemetry] writeSystemLog failed:", error);
    });
}

export function logErrorTelemetry({
  error,
  title,
  source,
  details,
  severity = "error",
}: {
  error: unknown;
  title: string;
  source: string;
  details?: Record<string, unknown>;
  severity?: Extract<Severity, "warning" | "error" | "critical">;
}) {
  const serialized = serializeError(error);
  logSystemTelemetry({
    log_type: "error",
    severity,
    title,
    message: typeof serialized.message === "string" ? serialized.message : "Unexpected error",
    source,
    details: {
      error: serialized,
      ...(details ?? {}),
    },
  });
}

function getToastText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  return "Toast notification";
}

function getToastSeverity(method: string): Severity {
  if (method === "error") return "error";
  if (method === "warning") return "warning";
  if (method === "success" || method === "info" || method === "message") return "info";
  return "debug";
}

function recordToast(method: string, args: unknown[]) {
  const title = getToastText(args[0]);
  const severity = getToastSeverity(method);
  logSystemTelemetry({
    log_type: severity === "error" ? "error" : "info",
    severity,
    title: `Toast: ${title}`,
    message: title,
    source: `toast.${method}`,
    details: {
      toast: {
        method,
        title,
        options: sanitizeValue(args[1]),
      },
    },
  });
}

export function installToastTelemetry() {
  if (toastTelemetryInstalled) return;
  toastTelemetryInstalled = true;

  const toastObject = sonnerToast as unknown as Record<string, unknown>;
  const originalDefault = sonnerToast.bind(null);
  const wrappedDefault = ((...args: unknown[]) => {
    recordToast("default", args);
    return originalDefault(...(args as Parameters<typeof sonnerToast>));
  }) as typeof sonnerToast;

  for (const key of Object.keys(toastObject)) {
    (wrappedDefault as unknown as Record<string, unknown>)[key] = toastObject[key];
  }

  for (const method of ["success", "error", "warning", "info", "message", "loading"] as const) {
    const original = toastObject[method];
    if (typeof original !== "function") continue;
    (toastObject as Record<string, unknown>)[method] = (...args: unknown[]) => {
      recordToast(method, args);
      return Reflect.apply(original, sonnerToast, args);
    };
    (wrappedDefault as unknown as Record<string, unknown>)[method] = toastObject[method];
  }

  Object.assign(sonnerToast, wrappedDefault);
}

export function installConsoleErrorTelemetry() {
  if (consoleErrorTelemetryInstalled) return;
  consoleErrorTelemetryInstalled = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalConsoleError(...args);

    const firstArg = typeof args[0] === "string" ? args[0] : "";
    if (firstArg.startsWith("[system-telemetry]")) return;
    if (IGNORED_CONSOLE_PATTERNS.some((pattern) => pattern.test(firstArg))) return;

    const errorArg = args.find((arg) => arg instanceof Error);
    logSystemTelemetry({
      log_type: "error",
      severity: "error",
      title: firstArg ? `Console error: ${firstArg}` : "Console error",
      message: errorArg instanceof Error ? errorArg.message : firstArg || "console.error was called",
      source: "console.error",
      details: {
        consoleArgs: sanitizeValue(args),
        error: errorArg instanceof Error ? serializeError(errorArg) : null,
      },
    });
  };
}
