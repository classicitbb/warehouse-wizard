/**
 * ErrorBoundary — enterprise-grade React error isolation.
 *
 * Provides three layers of protection:
 *  1. Route-level: wraps each lazy page so one page crash never kills the shell.
 *  2. App-level: wraps the entire app so even shell crashes show a recovery UI.
 *  3. Chunk-load recovery: detects failed dynamic-import network errors and
 *     offers a hard reload to pick up the latest service-worker assets.
 *
 * Usage:
 *   <ErrorBoundary>                   // minimal – uses default fallback
 *   <ErrorBoundary level="route">     // route-level (shows "Back to Dashboard")
 *   <ErrorBoundary level="app">       // outermost (no navigation available)
 *   <ErrorBoundary fallback={<MyUI />}>  // custom fallback element
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, LifeBuoy, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { logErrorTelemetry } from "@/lib/system-telemetry";
import { describeErrorForReport, requestCopilotReport } from "@/features/copilot/copilot-core";
import { recordAction } from "@/lib/habit-tracking";

// ── Chunk-load detection ──────────────────────────────────────────────────────

function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk \d+ failed/i.test(error.message) ||
    /failed to fetch dynamically imported module/i.test(error.message) ||
    /error loading dynamically imported module/i.test(error.message)
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ErrorBoundaryLevel = "route" | "app" | "section";

interface Props {
  children: ReactNode;
  /** Controls the wording / navigation options in the fallback UI. */
  level?: ErrorBoundaryLevel;
  /** Fully custom fallback element (overrides built-in UI). */
  fallback?: ReactNode;
  /** Called with (error, info) when an error is caught — use for logging. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ errorInfo: info });
    this.props.onError?.(error, info);

    // Always log to console so DevTools shows the full stack.
    console.error("[ErrorBoundary] Uncaught render error:", error, info.componentStack);
    recordAction({
      action: "error.render",
      outcome: "error",
      metadata: {
        message: error.message.slice(0, 160),
        level: this.props.level ?? "route",
      },
    });
    logErrorTelemetry({
      error,
      title: "React render error",
      source: `react-error-boundary.${this.props.level ?? "route"}`,
      details: {
        componentStack: info.componentStack,
        boundaryLevel: this.props.level ?? "route",
        isChunkLoadError: isChunkLoadError(error),
      },
      severity: this.props.level === "app" ? "critical" : "error",
    });

    // Chunk-load errors mean a stale tab with missing assets — reload once.
    if (isChunkLoadError(error)) {
      const CHUNK_RELOAD_KEY = "__ww_chunk_reload__";
      if (!sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
        window.location.reload();
      }
    }
  }

  reset = () => {
    sessionStorage.removeItem("__ww_chunk_reload__");
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    const { error, errorInfo } = this.state;
    const { children, fallback, level = "route" } = this.props;

    if (!error) return children;

    // Custom fallback overrides built-in UI entirely.
    if (fallback !== undefined) return fallback;

    return <DefaultFallback error={error} info={errorInfo} level={level} onReset={this.reset} />;
  }
}

// ── Default fallback UI ───────────────────────────────────────────────────────

function DefaultFallback({
  error,
  info,
  level,
  onReset,
}: {
  error: Error;
  info: ErrorInfo | null;
  level: ErrorBoundaryLevel;
  onReset: () => void;
}) {
  const isChunk = isChunkLoadError(error);
  const { toPath } = useTenantPath();

  const title = isChunk
    ? "Update available"
    : level === "app"
    ? "Warehouse Wizard encountered an error"
    : "Something went wrong on this page";

  const description = isChunk
    ? "A new version of Warehouse Wizard was deployed. Reloading will fix this."
    : level === "app"
    ? "A critical error occurred. Please reload the application."
    : "This section crashed. You can retry or return to the dashboard — the rest of the app is unaffected.";

  return (
    <div className="flex min-h-[300px] items-center justify-center p-6">
      <Card className="w-full max-w-lg border-destructive/30">
        <CardHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden />
            <CardTitle className="text-lg">{title}</CardTitle>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>

          {/* Error detail (collapsed in prod) */}
          {!isChunk && (
            <details className="rounded border bg-muted/40 p-3 text-xs">
              <summary className="cursor-pointer select-none font-medium">
                Error detail
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-destructive">
                {error.message}
                {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ""}
              </pre>
            </details>
          )}

          <div className="flex flex-wrap gap-2">
            {isChunk ? (
              <Button size="sm" onClick={() => window.location.reload()}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Reload now
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={onReset}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Try again
                </Button>
                {level === "route" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onReset();
                      window.location.replace(toPath("/"));
                    }}
                  >
                    <Home className="mr-1.5 h-3.5 w-3.5" />
                    Dashboard
                  </Button>
                )}
                {/* Only where the shell (and therefore the copilot panel) is
                    still standing — at app level the panel has crashed too. */}
                {level !== "app" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onReset();
                      requestCopilotReport({
                        message: describeErrorForReport(error, window.location.pathname),
                        route: window.location.pathname,
                      });
                    }}
                  >
                    <LifeBuoy className="mr-1.5 h-3.5 w-3.5" />
                    Report this
                  </Button>
                )}
                {level === "app" && (
                  <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Reload application
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Convenience wrappers ──────────────────────────────────────────────────────

/**
 * Wrap a single lazy-loaded route so its crash doesn't kill the app shell.
 */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary level="route">{children}</ErrorBoundary>;
}

/**
 * Outermost boundary — wraps the entire React tree.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return <ErrorBoundary level="app">{children}</ErrorBoundary>;
}
