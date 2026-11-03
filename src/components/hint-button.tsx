import { useEffect, useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverHeader, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function HintButton({
  label,
  children,
  buttonClassName,
  contentClassName,
}: {
  label: string;
  children: ReactNode;
  buttonClassName?: string;
  contentClassName?: string;
}) {
  const [isTouchLike, setIsTouchLike] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(pointer: coarse)");
    const update = () => setIsTouchLike(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground", buttonClassName)}
      aria-label={label}
    >
      <HelpCircle className="h-4 w-4" />
    </Button>
  );

  if (isTouchLike) {
    return (
      <Popover>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          className={cn("z-50 max-w-xs p-3 text-sm font-normal leading-5", contentClassName)}
        >
          <PopoverHeader title={label} />
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        className={cn("z-50 max-w-xs p-3 text-sm font-normal leading-5", contentClassName)}
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
