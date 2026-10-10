import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { isActiveWorkInProgress } from "@/lib/active-work";
import { isPreviewEnvironment } from "@/lib/preview-env";
import {
  applyForcedUpdate,
  clearForcedReloadAttempts,
  MAX_FORCED_RELOAD_ATTEMPTS,
  readForcedReloadAttempts,
} from "@/lib/release-policy";
import {
  decideFirstTouch,
  DEFERRED_RETRY_MS,
  fetchDeployedVersion,
  isBehindDeployed,
  shouldProbe,
} from "@/lib/version-check";

type GateState =
  | { kind: "idle" }
  | { kind: "updating"; deployed: string }
  | { kind: "deferred"; deployed: string; reason: "work" | "offline" }
  | { kind: "failed"; deployed: string };

/**
 * The first-touch half of "nobody works on old code".
 *
 * The moment a device wakes, loads, or is touched after a long idle spell, this
 * asks the host which build is deployed. If the running build is behind it
 * blocks the screen with a plain "updating" notice, purges the stale shell and
 * reloads — before the operator has started anything, so there is nothing to
 * lose. Mid-task (a later wake with a scan/confirm flow open) it never blocks:
 * it shows a banner and applies when the flow ends.
 *
 * Mounted at the root, outside the app's error boundary and independent of
 * sign-in, so a crashed or signed-out tablet on a stale build is still pulled
 * forward. Renders nothing when the build is current — the common case.
 */
export function FirstTouchUpdateGate({ runningVersion = String(__APP_VERSION__) }: { runningVersion?: string }) {
  const [state, setState] = useState<GateState>({ kind: "idle" });
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const lastProbeMs = useRef<number | null>(null);
  const lastTouchMs = useRef<number | null>(null);
  const probing = useRef(false);
  const applying = useRef(false);

  const apply = useCallback(
    (deployed: string) => {
      if (applying.current) return;
      applying.current = true;
      setState({ kind: "updating", deployed });
      void applyForcedUpdate(deployed).then((applied) => {
        // Not applied means a guard held it back (offline, preview, attempt cap).
        // A successful apply reloads the page, so nothing below runs for it.
        if (applied) return;
        applying.current = false;
        setState({ kind: "failed", deployed });
      });
    },
    [],
  );

  const check = useCallback(
    async (kind: "load" | "wake" | "touch" | "retry") => {
      if (probing.current || applying.current) return;
      const now = Date.now();
      if (kind !== "retry") {
        const allowed = shouldProbe({
          nowMs: now,
          lastProbeMs: lastProbeMs.current,
          lastTouchMs: lastTouchMs.current,
          kind,
        });
        lastTouchMs.current = now;
        if (!allowed) return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      probing.current = true;
      lastProbeMs.current = now;
      try {
        const deployed = await fetchDeployedVersion();
        if (!deployed || !isBehindDeployed(runningVersion, deployed)) {
          // Current build (or unknowable): the gate has proved itself, so forget
          // any failed attempts recorded against an earlier target.
          if (deployed) clearForcedReloadAttempts();
          setState({ kind: "idle" });
          return;
        }
        const decision = decideFirstTouch({
          running: runningVersion,
          deployed,
          online: navigator.onLine !== false,
          activeWork: isActiveWorkInProgress(),
          attemptsExhausted: readForcedReloadAttempts(deployed) >= MAX_FORCED_RELOAD_ATTEMPTS,
        });
        if (decision === "apply") apply(deployed);
        else if (decision === "defer-work") setState({ kind: "deferred", deployed, reason: "work" });
        else if (decision === "defer-offline") setState({ kind: "deferred", deployed, reason: "offline" });
        else if (decision === "exhausted") setState({ kind: "failed", deployed });
      } finally {
        probing.current = false;
      }
    },
    [apply, runningVersion],
  );

  // Wake, load, touch and reconnect events.
  useEffect(() => {
    if (isPreviewEnvironment()) return;

    void check("load");
    const onVisible = () => {
      if (document.visibilityState === "visible") void check("wake");
    };
    const onFocus = () => void check("wake");
    const onTouch = () => void check("touch");
    const onOnline = () => {
      setOnline(true);
      void check("wake");
    };
    const onOffline = () => setOnline(false);

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onTouch, { passive: true });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onTouch);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [check]);

  // A deferred update re-checks until the operator is done (or back online).
  const deferred = state.kind === "deferred";
  useEffect(() => {
    if (!deferred) return;
    const timer = window.setInterval(() => void check("retry"), DEFERRED_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [deferred, check]);

  if (state.kind === "idle") return null;

  if (state.kind === "updating") {
    return (
      <div
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        aria-label="Warehouse Wizard is updating"
        className="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 p-6 backdrop-blur-sm"
      >
        <div className="max-w-sm text-center">
          <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-primary" />
          <p className="text-lg font-semibold">Warehouse Wizard has been updated</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Installing v{state.deployed} (this device was on v{runningVersion}). It takes a few seconds, then
            you can start work on the new version.
          </p>
        </div>
      </div>
    );
  }

  const failed = state.kind === "failed";
  const headline = failed
    ? `Update to v${state.deployed} could not be applied`
    : state.reason === "offline" || !online
      ? `Update v${state.deployed} is waiting for a connection`
      : `Update v${state.deployed} is ready — it applies as soon as you finish this task`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-0 bottom-14 z-[60] border-t border-amber-500/60 bg-amber-100/95 px-4 py-2.5 backdrop-blur dark:bg-amber-950/95 lg:landscape:bottom-0"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-950 dark:text-amber-50">{headline}</p>
          <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
            {failed
              ? `This device is still on v${runningVersion}. Report this — the new build may not have reached it yet.`
              : `Running v${runningVersion}. Finish the step you are on and the update installs right after.`}
          </p>
        </div>
      </div>
    </div>
  );
}
