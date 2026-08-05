import { Suspense, useEffect } from "react";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/use-auth";
import { RouteErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FeatureFlagProvider, PageSpinner, RuntimeModeBadge } from "@/features/app/app-pages";
import NotFound from "@/pages/NotFound";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { installConsoleErrorTelemetry, installToastTelemetry, logErrorTelemetry } from "@/lib/system-telemetry";

// ported from main.tsx — global error telemetry (browser only; SW registration dropped by design)
if (typeof window !== "undefined") {
  installConsoleErrorTelemetry();
  installToastTelemetry();

  // Catch unhandled promise rejections (e.g. fire-and-forget async calls that
  // throw). We log to console and show a toast, but never crash the app.
  window.addEventListener("unhandledrejection", (event) => {
    const error = event.reason;
    const message =
      error instanceof Error ? error.message : typeof error === "string" ? error : "Unhandled async error";

    // Skip noisy network errors — the offline banner already covers these.
    const isNetwork = /fetch|network|failed to fetch|load failed/i.test(message);
    if (!isNetwork) {
      console.error("[unhandledrejection]", error);
      logErrorTelemetry({
        error,
        title: "Unhandled promise rejection",
        source: "window.unhandledrejection",
        details: {
          reasonType: typeof event.reason,
        },
      });
      toast.error(message, { id: "unhandled-rejection", duration: 8_000 });
    }
  });

  // Log uncaught synchronous errors (belt-and-suspenders alongside ErrorBoundary).
  window.addEventListener("error", (event) => {
    if (event.error) {
      console.error("[uncaught error]", event.error);
      logErrorTelemetry({
        error: event.error,
        title: "Uncaught browser error",
        source: "window.error",
        details: {
          message: event.message,
          filename: event.filename,
          line: event.lineno,
          column: event.colno,
        },
      });
    }
  });
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "Warehouse Wizard WMS" },
      {
        name: "description",
        content: "Internal warehouse management for receiving, putaway, picking, and transfers.",
      },
      { name: "author", content: "Lovable" },
      { name: "theme-color", content: "#1a2932" },
      { property: "og:type", content: "website" },
      { property: "og:title", content: "Warehouse Wizard WMS" },
      {
        property: "og:description",
        content: "Internal warehouse management for receiving, putaway, picking, and transfers.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/74026050-a996-4737-89a4-d77bcfa1500f/id-preview-c64f47c2--b1278655-12aa-44aa-a245-7d311e40dddf.lovable.app-1774994022270.png",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Warehouse Wizard WMS" },
      {
        name: "twitter:description",
        content: "Internal warehouse management for receiving, putaway, picking, and transfers.",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/74026050-a996-4737-89a4-d77bcfa1500f/id-preview-c64f47c2--b1278655-12aa-44aa-a245-7d311e40dddf.lovable.app-1774994022270.png",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/logo.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => <NotFound />,
  errorComponent: RootErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <FeatureFlagProvider>
          <AuthProvider>
            <Toaster />
            <Sonner />
            <RouteErrorBoundary>
              <Suspense fallback={<PageSpinner />}>
                <Outlet />
              </Suspense>
            </RouteErrorBoundary>
            <RuntimeModeBadge />
            <Analytics />
          </AuthProvider>
        </FeatureFlagProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-lg">
        <h1 className="text-xl font-semibold text-foreground">This page didn't load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong while loading this page. You can try again or head back home.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            onClick={() => {
              void router.invalidate();
              reset();
            }}
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}