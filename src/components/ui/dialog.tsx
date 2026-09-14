import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { LifeBuoy, X } from "lucide-react";

import { requestCopilotReport } from "@/features/copilot/copilot-core";
import { activeReportContext } from "@/features/copilot/report-context";
import { cn } from "@/lib/utils";


const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Hide the report/feedback life buoy shown next to the close icon. */
    hideReportButton?: boolean;
  }
>(({ className, children, hideReportButton, ...props }, ref) => {
  // Dialogs cover the header, so the report/feedback entry point lives here too.
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref],
  );

  React.useLayoutEffect(() => {
    const node = contentRef.current;
    if (!node) return;

    const syncPadding = () => {
      const style = window.getComputedStyle(node);
      node.style.setProperty("--dialog-padding-top", style.paddingTop);
      node.style.setProperty("--dialog-padding-right", style.paddingRight);
    };

    syncPadding();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncPadding);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [className]);

  function reportProblem() {
    const title = contentRef.current?.querySelector("h2")?.textContent?.trim();
    const route = typeof window === "undefined" ? "" : window.location.pathname;
    // The dialog closes on its way to the copilot, so what was on screen —
    // selected product, typed quantities, the session behind them — is read
    // here, while it is still true.
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

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={setRefs}
        data-dialog-viewport-fit="true"
        className={cn(
          // The frame never grows past the visible window height: content
          // scrolls inside, while the title row, close/report controls and the
          // footer commit buttons stay pinned and fully visible.
          "dialog-scrollbar fixed left-[50%] top-[50%] z-50 grid max-h-[calc(100svh-2rem)] w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto overscroll-contain border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className,
        )}
        {...props}
      >
        {/* Runtime padding variables keep this rail on the frame corner even
            when a dialog replaces the shared padding with p-0 or p-4. */}
        <div
          className="pointer-events-none sticky z-20 -mb-4 h-0"
          data-dialog-controls="true"
          style={{
            top: "calc(-1 * var(--dialog-padding-top, 1.5rem))",
            marginTop: "calc(-1 * var(--dialog-padding-top, 1.5rem))",
          }}
        >
          {hideReportButton ? null : (
            <DialogPrimitive.Close
              onClick={reportProblem}
              className="pointer-events-auto absolute top-0 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
              style={{ right: "calc(var(--dialog-padding-right, 1.5rem) * -1 + 2.75rem)" }}
              title="Report a problem or send feedback"
              aria-label="Report a problem or send feedback"
            >
              <LifeBuoy className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
          <DialogPrimitive.Close
            className="pointer-events-auto absolute top-0 inline-flex h-8 w-10 items-center justify-center rounded-none bg-destructive text-destructive-foreground hover:bg-destructive active:bg-destructive/80 focus:outline-none focus-visible:outline-none disabled:pointer-events-none"
            style={{ right: "calc(-1 * var(--dialog-padding-right, 1.5rem))" }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-header="true"
    className={cn(
      "sticky -top-6 z-10 shrink-0 bg-background pb-2 pt-6 -mt-6 flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-footer="true"
    className={cn(
      "sticky -bottom-6 z-10 shrink-0 bg-background pb-6 pt-2 -mb-6 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
