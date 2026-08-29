/**
 * report-context.ts
 *
 * What the operator actually had on screen when they reached for the life buoy.
 *
 * A route is not a report. `/receiving` says nothing about which SKU was
 * selected, what quantities were typed, or which container the session was
 * against — and those are the first three things anyone repairing the problem
 * asks for. A screen publishes that context while it is mounted; the life buoy
 * reads whatever is active at the moment it is pressed and hands it to the
 * copilot, which files it with the ticket.
 *
 * Nothing here writes to a WMS table, and nothing published here is treated as
 * an instruction — it is evidence about the reporter's own screen.
 */

import { useEffect, useRef } from "react";

export type ReportContextDetail = {
  label: string;
  value: string;
};

export type ScreenReportContext = {
  /** Human name of the screen or dialog — "New Shipment", not "/receiving". */
  screen: string;
  route?: string;
  details: ReportContextDetail[];
};

/** Guard rails so a runaway form cannot push a novel into a ticket. */
const MAX_DETAILS = 32;
const MAX_VALUE_CHARS = 400;

function trimValue(value: string): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

/** Drop blanks, trim values, and cap the list. */
export function normalizeReportDetails(details: ReportContextDetail[]): ReportContextDetail[] {
  return details
    .map((detail) => ({ label: String(detail.label ?? "").trim(), value: trimValue(detail.value) }))
    .filter((detail) => detail.label !== "" && detail.value !== "")
    .slice(0, MAX_DETAILS);
}

export function makeReportContext(input: {
  screen: string;
  route?: string;
  details: ReportContextDetail[];
}): ScreenReportContext {
  return {
    screen: String(input.screen ?? "").trim() || "Unnamed screen",
    ...(input.route ? { route: input.route } : {}),
    details: normalizeReportDetails(input.details),
  };
}

// ── The active screen ────────────────────────────────────────────────────────
// One slot, claimed by whichever screen published last. Only the owner may
// clear it, so a dialog unmounting after another screen has taken over does not
// blank out the newer context.

let active: ScreenReportContext | null = null;
let owner: symbol | null = null;

export function publishReportContext(token: symbol, context: ScreenReportContext | null): void {
  if (context) {
    active = context;
    owner = token;
    return;
  }
  if (owner === token) {
    active = null;
    owner = null;
  }
}

export function activeReportContext(): ScreenReportContext | null {
  return active;
}

/** Test seam: forget whatever screen is publishing. */
export function resetReportContext(): void {
  active = null;
  owner = null;
}

/**
 * Publish this screen's context while the component is mounted. Passing null
 * (for example while a dialog is closed) leaves the slot free for another
 * screen rather than clearing it outright.
 */
export function useReportContext(context: ScreenReportContext | null): void {
  const tokenRef = useRef<symbol | null>(null);
  if (tokenRef.current === null) tokenRef.current = Symbol("report-context");
  const token = tokenRef.current;

  useEffect(() => {
    publishReportContext(token, context);
  }, [context, token]);

  useEffect(() => () => publishReportContext(token, null), [token]);
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** A plain-text block for the agent brief and the report transcript. */
export function describeReportContext(context: ScreenReportContext | null | undefined): string {
  if (!context) return "";
  const lines = [`Screen: ${context.screen}${context.route ? ` (${context.route})` : ""}`];
  for (const detail of context.details) lines.push(`- ${detail.label}: ${detail.value}`);
  return lines.join("\n");
}

/** The same facts as a flat object, for the copilot's on-screen selection. */
export function reportContextForCopilot(
  context: ScreenReportContext | null | undefined,
): Record<string, unknown> {
  if (!context) return {};
  const details: Record<string, string> = {};
  for (const detail of context.details) details[detail.label] = detail.value;
  return {
    screen_name: context.screen,
    ...(context.route ? { route: context.route } : {}),
    ...(Object.keys(details).length > 0 ? { on_screen: details } : {}),
  };
}
