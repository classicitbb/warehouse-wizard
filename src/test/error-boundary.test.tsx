import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const telemetryMocks = vi.hoisted(() => ({ logErrorTelemetry: vi.fn() }));
const habitMocks = vi.hoisted(() => ({ recordAction: vi.fn() }));
const copilotMocks = vi.hoisted(() => ({
  requestCopilotReport: vi.fn(),
  describeErrorForReport: vi.fn((error: unknown, where: string) => `report:${String(error)}@${where}`),
}));

vi.mock("@/lib/system-telemetry", () => ({ logErrorTelemetry: telemetryMocks.logErrorTelemetry }));
vi.mock("@/lib/habit-tracking", () => ({ recordAction: habitMocks.recordAction }));
vi.mock("@/features/copilot/copilot-core", () => copilotMocks);

import { ErrorBoundary } from "@/components/error-boundary";

function Boom({ message = "Location A-08-C is full" }: { message?: string }): JSX.Element {
  throw new Error(message);
}

function ChunkBoom(): JSX.Element {
  throw new Error("Failed to fetch dynamically imported module: /assets/page.js");
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  // React logs the caught error itself; keep the run readable.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  window.sessionStorage.clear();
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>Put-away queue</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("Put-away queue")).toBeInTheDocument();
  });

  it("keeps the rest of the app alive when a section crashes", () => {
    render(
      <div>
        <p>Shell survived</p>
        <ErrorBoundary level="section">
          <Boom />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("Shell survived")).toBeInTheDocument();
    expect(screen.getByText(/something went wrong on this page/i)).toBeInTheDocument();
  });

  it("shows the error message so the operator can quote it in a report", () => {
    render(
      <ErrorBoundary level="route">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Location A-08-C is full/)).toBeInTheDocument();
  });

  it("logs telemetry with the boundary level and component stack", () => {
    render(
      <ErrorBoundary level="route">
        <Boom />
      </ErrorBoundary>,
    );

    expect(telemetryMocks.logErrorTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "React render error",
        source: "react-error-boundary.route",
        severity: "error",
        details: expect.objectContaining({ boundaryLevel: "route" }),
      }),
    );
  });

  it("treats an app-level crash as critical", () => {
    render(
      <ErrorBoundary level="app">
        <Boom />
      </ErrorBoundary>,
    );
    expect(telemetryMocks.logErrorTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "critical" }),
    );
  });

  it("leaves a breadcrumb, so a later report knows what crashed", () => {
    render(
      <ErrorBoundary level="route">
        <Boom />
      </ErrorBoundary>,
    );

    expect(habitMocks.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "error.render", outcome: "error" }),
    );
  });

  it("hands the crash to the copilot when the operator asks it to", () => {
    render(
      <ErrorBoundary level="route">
        <Boom />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByRole("button", { name: /report this/i }));

    expect(copilotMocks.describeErrorForReport).toHaveBeenCalled();
    expect(copilotMocks.requestCopilotReport).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("report:") }),
    );
  });

  it("does not offer the copilot at app level, where the panel has crashed too", () => {
    render(
      <ErrorBoundary level="app">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole("button", { name: /report this/i })).not.toBeInTheDocument();
  });

  it("treats a stale-chunk failure as an update rather than a bug", () => {
    render(
      <ErrorBoundary level="route">
        <ChunkBoom />
      </ErrorBoundary>,
    );

    expect(screen.getByText(/update available/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reload now/i })).toBeInTheDocument();
    // Nothing to report and nothing to retry — the fix is the reload.
    expect(screen.queryByRole("button", { name: /report this/i })).not.toBeInTheDocument();
    expect(telemetryMocks.logErrorTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ isChunkLoadError: true }) }),
    );
  });

  it("reloads once for a stale chunk and does not loop", () => {
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...original, reload, pathname: "/putaway-tasks" },
    });

    render(
      <ErrorBoundary level="route">
        <ChunkBoom />
      </ErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);

    // A second crash in the same tab must not reload again — that is a boot loop.
    render(
      <ErrorBoundary level="route">
        <ChunkBoom />
      </ErrorBoundary>,
    );
    expect(reload).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("renders a custom fallback instead of the built-in one", () => {
    render(
      <ErrorBoundary fallback={<p>Nothing to show here</p>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Nothing to show here")).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("calls the caller's own onError hook", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary level="section" onError={onError}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ componentStack: expect.any(String) }));
  });
});
