import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isActiveWorkInProgress } from "@/lib/active-work";
import { notifyNewBuildAvailable } from "@/lib/build-notification";
import {
  applyForcedUpdate,
  clearForcedReloadAttempts,
  computeForcedUpdateDeadline,
  isBuildOutdated,
  MAX_ACTIVE_WORK_EXTENSION_MS,
  MAX_FORCED_RELOAD_ATTEMPTS,
  readForcedDeadline,
  readForcedReloadAttempts,
  writeForcedDeadline,
  type ReleasePolicy,
} from "@/lib/release-policy";
import { cn } from "@/lib/utils";

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The countdown half of the version gate.
 *
 * When this build is older than the policy's minimum, it shows a persistent
 * countdown and then reloads onto the new bundle. An active scan/confirm flow
 * holds the reload off past the deadline, but only for a bounded extension — a
 * hot fix cannot be deferred forever by a dialog somebody left open.
 *
 * Renders nothing at all when the build is current, which is the common case:
 * no update pending means no banner and no delay.
 */
export function ForcedUpdateBanner({ policy }: { policy: ReleasePolicy }) {
  const currentVersion = String(__APP_VERSION__);
  const required = policy.minRequiredVersion;
  const outdated = isBuildOutdated(currentVersion, required);

  const [now, setNow] = useState(() => Date.now());
  const [deadline, setDeadline] = useState<number | null>(null);
  const [reloading, setReloading] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const reloadStarted = useRef(false);

  // The gate proved it works: this build satisfies the policy, so forget any
  // failed attempts recorded against an earlier target.
  useEffect(() => {
    if (required && !outdated) clearForcedReloadAttempts();
  }, [required, outdated]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  // Pick (or recover) the deadline for this target version.
  useEffect(() => {
    if (!outdated || !required) {
      setDeadline(null);
      reloadStarted.current = false;
      return;
    }
    const existing = readForcedDeadline(required);
    if (existing !== null) {
      setDeadline(existing);
      return;
    }
    const forceAfterMs = policy.forceAfter ? Date.parse(policy.forceAfter) : NaN;
    const next = computeForcedUpdateDeadline({
      nowMs: Date.now(),
      forceAfterMs: Number.isFinite(forceAfterMs) ? forceAfterMs : null,
      graceMinutes: policy.graceMinutes,
    });
    writeForcedDeadline(required, next);
    setDeadline(next);
    void notifyNewBuildAvailable(`required-${required}`);
  }, [outdated, required, policy.forceAfter, policy.graceMinutes]);

  const attempts = required ? readForcedReloadAttempts(required) : 0;
  const exhausted = attempts >= MAX_FORCED_RELOAD_ATTEMPTS;

  const reloadNow = useCallback(() => {
    if (!required || reloadStarted.current) return;
    reloadStarted.current = true;
    setReloading(true);
    void applyForcedUpdate(required).then((applied) => {
      if (!applied) {
        reloadStarted.current = false;
        setReloading(false);
      }
    });
  }, [required]);

  // One ticking loop drives both the countdown and the auto-reload decision.
  useEffect(() => {
    if (!outdated || deadline === null) return;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (current < deadline || reloadStarted.current || exhausted) return;
      if (navigator.onLine === false) return;
      if (isActiveWorkInProgress() && current < deadline + MAX_ACTIVE_WORK_EXTENSION_MS) return;
      reloadNow();
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [outdated, deadline, exhausted, reloadNow]);

  if (!outdated || !required) return null;

  const remaining = deadline === null ? 0 : deadline - now;
  const waitingOnWork = remaining <= 0 && isActiveWorkInProgress();

  let headline: string;
  if (exhausted) {
    headline = `Update to ${required} could not be applied`;
  } else if (reloading) {
    headline = `Updating to ${required}…`;
  } else if (!online) {
    headline = `New version required — waiting for a connection`;
  } else if (waitingOnWork) {
    headline = `New version required — reloading as soon as you finish this task`;
  } else {
    headline = `New version required — reloading in ${formatCountdown(remaining)}`;
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "fixed inset-x-0 bottom-14 z-[60] border-t border-amber-500/60 bg-amber-100/95 px-4 py-2.5 backdrop-blur",
        "dark:bg-amber-950/95 lg:landscape:bottom-0",
        exhausted && "border-destructive/60 bg-destructive/10",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-950 dark:text-amber-50">{headline}</p>
          <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
            {exhausted
              ? `This device reloaded ${attempts} times and is still on ${currentVersion}. Report this — the published build may not have reached it yet.`
              : policy.message
                ? policy.message
                : `Running ${currentVersion}. The reload waits until the step you are on is finished.`}
          </p>
        </div>
        <Button size="sm" onClick={reloadNow} disabled={reloading || !online}>
          {reloading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Reload now
        </Button>
      </div>
    </div>
  );
}
