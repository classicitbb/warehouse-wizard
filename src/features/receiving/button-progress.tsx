// Progress fill for Receiving's save buttons while a post is in flight.
import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

export function useTimedButtonProgress(active: boolean) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }

    setProgress((current) => current || 8);
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current < 60) return current + 8;
        if (current < 86) return current + 4;
        if (current < 94) return current + 1;
        return current;
      });
    }, 450);

    return () => window.clearInterval(timer);
  }, [active]);

  return active ? progress : 0;
}

export function ButtonProgress({ value, label }: { value: number; label: string }) {
  const boundedValue = Math.min(100, Math.max(3, Math.round(value)));

  return (
    <div className="relative z-10 inline-flex min-w-0 items-center gap-2" aria-live="polite">
      <Progress
        value={boundedValue}
        className="h-1.5 w-14 shrink-0 bg-current/20 [&>div]:bg-current"
        aria-label={`${label} progress`}
      />
      <span className="truncate">{label}</span>
      <span className="font-mono text-[0.72rem] tabular-nums">{boundedValue}%</span>
    </div>
  );
}
