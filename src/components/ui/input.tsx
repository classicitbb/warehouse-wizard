import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const isSearch = type === "search";
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-input px-3 py-2 text-base file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[inset_0_0_0_1px_hsl(var(--ring)),inset_0_0_0_9999px_hsl(var(--ring)/0.04)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          isSearch &&
            "bg-muted border-primary/40 shadow-inner placeholder:text-muted-foreground/80 focus-visible:border-primary [&::-webkit-search-cancel-button]:appearance-none",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
