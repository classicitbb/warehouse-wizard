// One title bar for every dialog, sheet, drawer and popover in the app.
//
// Layout (fixed, app wide):
//   [ title + description ............................ ] [ ? | x ]
// The controls sit in a small pill at the right of the header row, centred on
// the first line of the title, so a long title wraps under itself and never
// runs under the icons. The help button (report a problem) and the close
// button are the same size; close is the red one.
//
// The frame (DialogContent, SheetContent, DrawerContent) owns the controls and
// hands them to its header through context. When there is no visible header,
// the frame shows the same pill floating in its top-right corner instead.
import * as React from "react";
import { LifeBuoy, X } from "lucide-react";

import { requestCopilotReport } from "@/features/copilot/report-request";
import { activeReportContext } from "@/features/copilot/report-context";
import { cn } from "@/lib/utils";

/**
 * Opens the copilot report for the overlay `node` is in. The overlay closes on
 * its way to the copilot, so what was on screen (selected product, typed
 * quantities, the session behind them) is read here, while it is still true.
 */
export function reportOverlayProblem(node: HTMLElement | null) {
  const title = node?.querySelector("h2")?.textContent?.trim();
  const route = typeof window === "undefined" ? "" : window.location.pathname;
  const context = activeReportContext();
  const screen = title || context?.screen;
  requestCopilotReport({
    message: screen
      ? `I have a problem with the "${screen}" screen. Here is what happened: `
      : "I have a problem with the screen I was on. Here is what happened: ",
    route: route || undefined,
    context: context
      ? { ...context, screen: screen ?? context.screen, route: context.route ?? route ?? undefined }
      : null,
  });
}

const CONTROL_BASE =
  "inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none";

/** A neutral icon button in the title bar (help, report). */
export const CHROME_BUTTON = cn(CONTROL_BASE, "text-muted-foreground hover:bg-accent hover:text-foreground");

/** The close button in the title bar. */
export const CHROME_CLOSE = cn(CONTROL_BASE, "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80");

/** The pill that holds the title-bar buttons. */
export function ChromeControls({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      data-overlay-controls="true"
      className={cn("flex shrink-0 items-center gap-0.5 rounded-lg border border-border/70 bg-muted/60 p-0.5 shadow-sm", className)}
    >
      {children}
    </div>
  );
}

/** Help button content: the report/feedback icon. Wrap it in the frame's Close or a button. */
export function ChromeHelpIcon() {
  return (
    <>
      <LifeBuoy className="h-3.5 w-3.5" />
      <span className="sr-only">Report a problem or send feedback</span>
    </>
  );
}

/** Close button content. Wrap it in the frame's Close primitive. */
export function ChromeCloseIcon() {
  return (
    <>
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </>
  );
}

type ChromeValue = {
  controls: React.ReactNode;
  register: (id: string) => () => void;
  owner: string | null;
};

const ChromeContext = React.createContext<ChromeValue | null>(null);

/**
 * Gives the frame's controls to the first visible header inside it. With no
 * header, the controls float in the corner (`floatingClassName` places them).
 */
export function OverlayChrome({
  controls,
  floatingClassName = "absolute right-3 top-3",
  children,
}: {
  controls: React.ReactNode;
  floatingClassName?: string;
  children: React.ReactNode;
}) {
  const [owners, setOwners] = React.useState<string[]>([]);
  const register = React.useCallback((id: string) => {
    setOwners((prev) => (prev.includes(id) ? prev : [...prev, id]));
    return () => setOwners((prev) => prev.filter((owner) => owner !== id));
  }, []);
  const value = React.useMemo(() => ({ controls, register, owner: owners[0] ?? null }), [controls, register, owners]);

  return (
    <ChromeContext.Provider value={value}>
      {owners.length === 0 ? (
        <div className={cn("pointer-events-none z-20", floatingClassName)} data-overlay-controls-floating="true">
          <div className="pointer-events-auto">{controls}</div>
        </div>
      ) : null}
      {children}
    </ChromeContext.Provider>
  );
}

/**
 * The header row: the title block on the left, the frame's controls on the
 * right. A screen-reader-only header does not take the controls.
 */
export const OverlayHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const chrome = React.useContext(ChromeContext);
    const register = chrome?.register;
    const id = React.useId();
    const hidden = /\bsr-only\b/.test(className ?? "");

    React.useLayoutEffect(() => {
      if (!register || hidden) return;
      return register(id);
    }, [register, id, hidden]);

    const showControls = Boolean(chrome && !hidden && chrome.owner === id);
    if (hidden) {
      return (
        <div ref={ref} className={className} {...props}>
          {children}
        </div>
      );
    }
    return (
      <div ref={ref} data-overlay-header="true" className={cn("flex items-start gap-3 text-left", className)} {...props}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
        {showControls ? <div className="-mr-1">{chrome!.controls}</div> : null}
      </div>
    );
  },
);
OverlayHeader.displayName = "OverlayHeader";

/** Title text style: the first line is centred on the 34px controls pill (22px line + 2 x 6px). */
export const OVERLAY_TITLE = "py-1.5 text-lg font-semibold leading-[1.375rem] tracking-tight";
