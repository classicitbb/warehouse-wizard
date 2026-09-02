import { useEffect } from "react";

import { ForcedUpdateBanner } from "@/components/forced-update-banner";
import { useAuth } from "@/hooks/use-auth";
import { isActiveWorkInProgress } from "@/lib/active-work";
import { markActivity, readActivityAtLoad, shouldSignOutForNight } from "@/lib/daily-refresh";
import { isPreviewEnvironment } from "@/lib/preview-env";
import {
  HEARTBEAT_INTERVAL_MS,
  sendClientHeartbeat,
  useReleasePolicy,
  type ReleasePolicy,
} from "@/lib/release-policy";

/**
 * Reports which build this session is running, every few minutes.
 *
 * Without this, "force everyone onto vX" is unverifiable — an admin can see
 * that they set the policy but not whether the floor actually moved.
 */
function ClientHeartbeat({ label }: { label: string | null }) {
  const version = String(__APP_VERSION__);

  useEffect(() => {
    const beat = () => void sendClientHeartbeat(version, label).catch(() => {});
    beat();
    const timer = window.setInterval(beat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [version, label]);

  return null;
}

/**
 * Signs out a device that sat idle across the nightly cutoff, so the morning
 * starts with a fresh login and therefore a freshly fetched bundle.
 *
 * Reads the activity snapshot pinned at page load, never the live stamp: this
 * session's own activity must not answer the question "was this device idle
 * overnight?".
 */
function NightlySignOut({ policy }: { policy: ReleasePolicy }) {
  const { signOut } = useAuth();
  const { nightlySignoutEnabled, dailyRefreshHour } = policy;

  useEffect(() => {
    if (!nightlySignoutEnabled) return;

    const check = () => {
      if (isActiveWorkInProgress()) return;
      if (
        !shouldSignOutForNight({
          nowMs: Date.now(),
          lastActivityMs: readActivityAtLoad(),
          hour: dailyRefreshHour,
          enabled: true,
        })
      ) {
        return;
      }
      // Stamp before signing out so the fresh login is not immediately
      // signed out again.
      markActivity(Date.now());
      void signOut().catch(() => {
        /* a failed sign-out just leaves the session in place until next load */
      });
    };

    check();
    // A tab held open across the night gets the same treatment on next focus.
    const onWake = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [nightlySignoutEnabled, dailyRefreshHour, signOut]);

  return null;
}

/**
 * Everything the release policy drives for one signed-in session, reading the
 * policy row once and sharing it.
 *
 * Nothing here runs for a signed-out session or inside the Lovable preview
 * iframe, where a hard reload breaks the token-bearing proxy URL.
 */
export function ReleaseGate() {
  const { session, profile } = useAuth();
  const signedIn = Boolean(session);
  const active = signedIn && !isPreviewEnvironment();
  const { policy } = useReleasePolicy({ enabled: active });

  if (!active) return null;

  return (
    <>
      <ClientHeartbeat label={profile?.user_code ?? profile?.full_name ?? null} />
      <NightlySignOut policy={policy} />
      <ForcedUpdateBanner policy={policy} />
    </>
  );
}
