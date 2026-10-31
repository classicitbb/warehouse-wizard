import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import {
  CHROME_BUTTON,
  CHROME_CLOSE,
  ChromeCloseIcon,
  ChromeControls,
  ChromeHelpIcon,
  OVERLAY_TITLE,
  OverlayChrome,
  OverlayHeader,
  reportOverlayProblem,
} from "@/components/ui/overlay-chrome";
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

  const reportProblem = () => reportOverlayProblem(contentRef.current);

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
        {/* The content box is transformed, so "fixed" pins the floating
            controls to its corner while the body scrolls. */}
        <OverlayChrome
          floatingClassName="fixed right-3 top-3"
          controls={
            <ChromeControls>
              {hideReportButton ? null : (
                <DialogPrimitive.Close onClick={reportProblem} className={CHROME_BUTTON} title="Report a problem or send feedback">
                  <ChromeHelpIcon />
                </DialogPrimitive.Close>
              )}
              <DialogPrimitive.Close className={CHROME_CLOSE} title="Close">
                <ChromeCloseIcon />
              </DialogPrimitive.Close>
            </ChromeControls>
          }
        >
          {children}
        </OverlayChrome>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

DialogContent.displayName = DialogPrimitive.Content.displayName;

// The title bar: title and description on the left, the help and close
// buttons on the right (overlay-chrome). It stays pinned while the body scrolls.
const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <OverlayHeader
    data-dialog-header="true"
    className={cn("sticky top-0 z-10 shrink-0 border-b border-border/60 bg-background pb-3", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-footer="true"
    className={cn(
      "sticky bottom-0 z-10 shrink-0 bg-background pt-2 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
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
    className={cn(OVERLAY_TITLE, className)}
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
