// Kept apart from copilot-core so ui/dialog and the error boundary can raise a
// report without pulling the help-centre text into the entry bundle.
import { type ScreenReportContext } from "@/features/copilot/report-context";

// ── Cross-surface report requests ────────────────────────────────────────────
// Anywhere in the app can hand a problem to the copilot — the error boundary's
// "Report this" button, a failed scan, a stuck task. The panel listens, opens
// itself and starts the interview. A plain DOM event keeps the panel out of
// every caller's import graph.

const REPORT_REQUEST_EVENT = "wms:copilot-report-request";

export type CopilotReportRequest = {
  /** What to say on the operator's behalf to open the report. */
  message: string;
  /** Screen the problem happened on, when it is not the current one. */
  route?: string;
  /**
   * What the operator had on screen — selected product, typed quantities, the
   * receiving session. Captured when the button was pressed, because the screen
   * behind it usually closes on the way to the copilot.
   */
  context?: ScreenReportContext | null;
};

export function requestCopilotReport(request: CopilotReportRequest) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<CopilotReportRequest>(REPORT_REQUEST_EVENT, { detail: request }));
}

export function onCopilotReportRequest(handler: (request: CopilotReportRequest) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<CopilotReportRequest>).detail;
    if (detail?.message) handler(detail);
  };
  window.addEventListener(REPORT_REQUEST_EVENT, listener);
  return () => window.removeEventListener(REPORT_REQUEST_EVENT, listener);
}

/** Opening line for a report seeded from a caught error. */
export function describeErrorForReport(error: unknown, where: string): string {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "an unexpected error";
  return `Something went wrong on ${where}. The app showed: "${message}". I want to report it.`;
}
