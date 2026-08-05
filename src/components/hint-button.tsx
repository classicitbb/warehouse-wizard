import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function HintButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 rounded-full border border-border bg-card/70 text-xs font-semibold text-muted-foreground hover:text-foreground"
          aria-label={label}
        >
          ?
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="z-50 w-[min(16rem,calc(100vw-2rem))] p-3 text-sm font-normal leading-5"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}
