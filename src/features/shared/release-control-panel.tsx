import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, Rocket, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  clampGraceMinutes,
  clampRefreshHour,
  fetchFleetSessions,
  GRACE_MINUTES_MAX,
  GRACE_MINUTES_MIN,
  HEARTBEAT_ACTIVE_WINDOW_MS,
  REFRESH_HOUR_MAX,
  REFRESH_HOUR_MIN,
  saveReleasePolicy,
  summarizeFleetVersions,
  useReleasePolicy,
} from "@/lib/release-policy";

/**
 * Release control — the admin half of the version gate.
 *
 * Publishing a hot fix stays a normal publish; this card is what then pulls the
 * floor onto it. "Require this build" can only ever require the build the admin
 * is themselves running, so it is impossible to demand a version that does not
 * exist yet and strand every tablet in a reload loop.
 */
export function ReleaseControlPanel() {
  const { policy, refresh } = useReleasePolicy();
  const currentVersion = String(__APP_VERSION__);

  const [graceMinutes, setGraceMinutes] = useState(String(policy.graceMinutes));
  const [message, setMessage] = useState(policy.message ?? "");
  const [refreshHour, setRefreshHour] = useState(String(policy.dailyRefreshHour));
  const [saving, setSaving] = useState(false);

  // Re-seed the form whenever a newer policy arrives (poll, or another admin).
  useEffect(() => {
    setGraceMinutes(String(policy.graceMinutes));
    setMessage(policy.message ?? "");
    setRefreshHour(String(policy.dailyRefreshHour));
  }, [policy.updatedAt, policy.graceMinutes, policy.message, policy.dailyRefreshHour]);

  const fleet = useQuery({
    queryKey: ["release-control", "fleet-sessions"],
    queryFn: fetchFleetSessions,
    refetchInterval: 60_000,
  });

  const versionRows = useMemo(() => summarizeFleetVersions(fleet.data ?? []), [fleet.data]);
  const activeWindowMinutes = Math.round(HEARTBEAT_ACTIVE_WINDOW_MS / 60_000);

  const persist = async (patch: Parameters<typeof saveReleasePolicy>[0], successMessage: string) => {
    setSaving(true);
    try {
      await saveReleasePolicy(patch);
      await refresh();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the release policy");
    } finally {
      setSaving(false);
    }
  };

  const grace = clampGraceMinutes(Number(graceMinutes));

  const forceCurrentBuild = () =>
    persist(
      {
        minRequiredVersion: currentVersion,
        forceAfter: new Date(Date.now() + grace * 60_000).toISOString(),
        graceMinutes: grace,
        message: message.trim() ? message.trim() : null,
      },
      `Every session must now be on ${currentVersion}`,
    );

  const clearRequirement = () =>
    persist({ minRequiredVersion: null, forceAfter: null, message: null }, "Version requirement cleared");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Release control
        </CardTitle>
        <CardDescription>
          Publish the hot fix as usual, then require it here. Every open session shows a countdown, finishes the step it
          is on, and reloads onto the new build.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">This session is running {currentVersion}</p>
              <p className="text-xs text-muted-foreground">
                {policy.minRequiredVersion
                  ? `Minimum required: ${policy.minRequiredVersion}`
                  : "No minimum version is being enforced."}
              </p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void fleet.refetch()} disabled={fleet.isFetching}>
              {fleet.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
              Refresh sessions
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {versionRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No sessions have reported in during the last {activeWindowMinutes} minutes.
              </p>
            ) : (
              versionRows.map((row) => (
                <Badge key={row.version} variant={row.version === currentVersion ? "default" : "secondary"}>
                  {row.version} — {row.sessions} {row.sessions === 1 ? "session" : "sessions"}
                </Badge>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">Sessions active in the last {activeWindowMinutes} minutes.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="release-grace">Grace period (minutes)</Label>
            <Input
              id="release-grace"
              type="number"
              inputMode="numeric"
              min={GRACE_MINUTES_MIN}
              max={GRACE_MINUTES_MAX}
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              How long operators get to finish current work. {GRACE_MINUTES_MIN}–{GRACE_MINUTES_MAX}.
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="release-message">Message for operators (optional)</Label>
            <Input
              id="release-message"
              value={message}
              maxLength={300}
              placeholder="Hot fix: pallet moves"
              onChange={(e) => setMessage(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Shown on the countdown banner.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void forceCurrentBuild()} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldAlert className="mr-1 h-3.5 w-3.5" />}
            Force everyone onto {currentVersion}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void clearRequirement()}
            disabled={saving || !policy.minRequiredVersion}
          >
            Clear requirement
          </Button>
        </div>

        <div className="grid gap-3 border-t border-border pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Morning refresh</p>
              <p className="text-xs text-muted-foreground">
                Once a day after the hour below, a tab that has been open since yesterday purges its caches and reloads
                onto the published build.
              </p>
            </div>
            <Switch
              checked={policy.dailyRefreshEnabled}
              disabled={saving}
              onCheckedChange={(checked) =>
                void persist({ dailyRefreshEnabled: checked }, checked ? "Morning refresh on" : "Morning refresh off")
              }
            />
          </div>
          <div className="grid max-w-[12rem] gap-1.5">
            <Label htmlFor="release-refresh-hour">
              Refresh hour (local, {REFRESH_HOUR_MIN}–{REFRESH_HOUR_MAX})
            </Label>
            <Input
              id="release-refresh-hour"
              type="number"
              inputMode="numeric"
              min={REFRESH_HOUR_MIN}
              max={REFRESH_HOUR_MAX}
              value={refreshHour}
              onChange={(e) => setRefreshHour(e.target.value)}
              onBlur={() => {
                const hour = clampRefreshHour(Number(refreshHour));
                setRefreshHour(String(hour));
                if (hour !== policy.dailyRefreshHour) {
                  void persist({ dailyRefreshHour: hour }, `Morning refresh set to ${String(hour).padStart(2, "0")}:00`);
                }
              }}
            />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Nightly sign-out</p>
              <p className="text-xs text-muted-foreground">
                A device idle across the refresh hour is signed out on its next load, so the shift starts with a fresh
                login and a fresh bundle.
              </p>
            </div>
            <Switch
              checked={policy.nightlySignoutEnabled}
              disabled={saving}
              onCheckedChange={(checked) =>
                void persist({ nightlySignoutEnabled: checked }, checked ? "Nightly sign-out on" : "Nightly sign-out off")
              }
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
