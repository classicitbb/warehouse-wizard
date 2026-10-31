import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";
import { CHROME_CLOSE, ChromeCloseIcon, ChromeControls } from "@/components/ui/overlay-chrome";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * When a popover opens from inside a modal dialog, portalling to <body> puts it
 * outside the dialog's scroll lock, so wheel events over the popover get
 * cancelled and inner lists cannot scroll. Portal into the open dialog instead.
 */
function useDialogPortalContainer() {
  const [container, setContainer] = React.useState<HTMLElement | undefined>(undefined);
  React.useEffect(() => {
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"][data-state="open"]'),
    ).filter((node) => !node.closest("[data-radix-popper-content-wrapper]"));
    setContainer(dialogs[dialogs.length - 1]);
  }, []);
  return container;
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & { container?: HTMLElement | null }
>(({ className, align = "center", sideOffset = 4, container, ...props }, ref) => {
  const dialogContainer = useDialogPortalContainer();
  return (
    <PopoverPrimitive.Portal container={container ?? dialogContainer}>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
});

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

const PopoverClose = PopoverPrimitive.Close;

/**
 * The popover version of the app's title bar (overlay-chrome): a small title on
 * the left, optional actions, and the same close button as dialogs on the
 * right. Use it at the top of any popover that has a heading.
 */
function PopoverHeader({
  title,
  description,
  actions,
  showClose = true,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  showClose?: boolean;
  className?: string;
}) {
  return (
    <div data-overlay-header="true" className={cn("-mx-1 mb-2 flex items-start gap-2 border-b border-border/60 px-1 pb-2", className)}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="py-1 text-sm font-semibold leading-5">{title}</span>
        {description ? <span className="text-xs text-muted-foreground">{description}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      {showClose ? (
        <ChromeControls>
          <PopoverPrimitive.Close className={cn(CHROME_CLOSE, "h-6 w-6")} title="Close">
            <ChromeCloseIcon />
          </PopoverPrimitive.Close>
        </ChromeControls>
      ) : null}
    </div>
  );
}

export { Popover, PopoverTrigger, PopoverAnchor, PopoverClose, PopoverContent, PopoverHeader };
