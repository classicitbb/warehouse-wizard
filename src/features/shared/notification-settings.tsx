import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import { useAuth } from "@/hooks/use-auth";
import {
  DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES,
  isBuildNotificationEnabled,
  loadAccountNotificationPreferences,
  saveAccountNotificationPreferences,
  setBuildNotificationEnabled,
  type AccountNotificationPreferences,
} from "@/lib/notification-preferences";
import { ensurePushSubscription } from "@/lib/push-subscription";

const DENIED_STEPS = [
  "Desktop Chrome/Edge: click the padlock (or tune icon) left of the address bar, then set Notifications to Allow and reload.",
  "Android Chrome: tap the padlock > Permissions > Notifications > Allow, then reload.",
  "Installed app (home-screen icon): open your device Settings > Apps > Warehouse Wizard > Notifications and turn them on.",
  "Safari (macOS): Safari > Settings > Websites > Notifications, find this site and choose Allow.",
];

/**
 * Notification controls, in two halves.
 *
 * Permission and build alerts belong to this device and browser, so a shared
 * floor tablet can stay quiet while an office desktop gets build alerts. The
 * pick-ticket, put-away and email switches belong to the account and follow
 * the person everywhere - the email one has to, because the server reads it
 * when building a recipient list.
 */
export function NotificationSettingsPanel() {
  const { supported, permission, requestPermission } = useNotificationPermission();
  const [buildAlerts, setBuildAlerts] = useState(isBuildNotificationEnabled);
  const [requesting, setRequesting] = useState(false);
  const { user } = useAuth();
  // Account-level, unlike the build-alert switch above it: these follow the
  // person across devices, and the email flag has to be readable by the
  // server when it builds a recipient list.
  const [prefs, setPrefs] = useState<AccountNotificationPreferences>(DEFAULT_ACCOUNT_NOTIFICATION_PREFERENCES);
  const [savingPref, setSavingPref] = useState<keyof AccountNotificationPreferences | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void loadAccountNotificationPreferences(user.id)
      .then((loaded) => {
        if (!cancelled) setPrefs(loaded);
      })
      .catch(() => {
        // Defaults already applied; a settings panel is not worth a toast.
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handlePrefToggle = async (key: keyof AccountNotificationPreferences, next: boolean) => {
    if (!user?.id) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: next });
    setSavingPref(key);
    try {
      await saveAccountNotificationPreferences(user.id, { [key]: next });
    } catch {
      // Roll back rather than leave the switch lying about what was saved.
      setPrefs(previous);
      toast.error("Could not save that preference");
    } finally {
      setSavingPref(null);
    }
  };

  const granted = permission === "granted";
  const denied = permission === "denied";

  const handleToggle = (next: boolean) => {
    setBuildAlerts(next);
    setBuildNotificationEnabled(next);
    toast.success(next ? "Build notifications on for this device" : "Build notifications off for this device");
  };

  const handleRequest = async () => {
    setRequesting(true);
    try {
      const result = await requestPermission();
      if (result === "granted") {
        await ensurePushSubscription();
        toast.success("Notifications enabled for this browser");
      } else if (result === "denied") {
        toast.error("Notifications were blocked — follow the steps below to unblock this site");
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleTest = async () => {
    if (!granted) return;
    try {
      const options: NotificationOptions = {
        body: "This is what a Warehouse Wizard alert looks like on this device.",
        icon: "/favicon.png",
        badge: "/favicon.png",
        tag: "ww-test-notification",
      };
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("Test notification", options);
        return;
      }
      new Notification("Test notification", options);
    } catch {
      toast.error("This browser blocked the test notification");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4" />
          Notifications
        </CardTitle>
        <CardDescription>
          Permission and build alerts apply to this device only. The pick ticket, put-away and email switches
          follow your account to every device you sign in on.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          {!supported ? (
            <>
              <BellOff className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">This browser does not support notifications. In-app toasts still work.</span>
            </>
          ) : granted ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Notifications are allowed on this device.</span>
              <Button variant="outline" size="sm" className="ml-auto" onClick={handleTest}>
                Send test
              </Button>
            </>
          ) : denied ? (
            <>
              <BellOff className="h-4 w-4 text-destructive" />
              <span>Notifications are blocked for this site.</span>
            </>
          ) : (
            <>
              <Info className="h-4 w-4 text-muted-foreground" />
              <span>Notifications have not been enabled on this device yet.</span>
              <Button size="sm" className="ml-auto" onClick={handleRequest} disabled={requesting}>
                Enable notifications
              </Button>
            </>
          )}
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="build-alerts" className="text-sm font-medium">
              New build alerts
            </Label>
            <p className="text-xs text-muted-foreground">
              Get a notification when a newer version of Warehouse Wizard is pushed, even when this tab is in the background.
            </p>
          </div>
          <Switch id="build-alerts" checked={buildAlerts} onCheckedChange={handleToggle} disabled={!supported} />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="pick-list-ring" className="text-sm font-medium">
              Ring for new pick tickets
            </Label>
            <p className="text-xs text-muted-foreground">
              A released pick ticket chimes three times so it carries from another page. The chime needs the app open
              on a tab; with the app closed your device plays its own notification sound.
            </p>
          </div>
          <Switch
            id="pick-list-ring"
            checked={prefs.pickListRing}
            onCheckedChange={(next) => void handlePrefToggle("pickListRing", next)}
            disabled={savingPref !== null}
          />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="putaway-badge" className="text-sm font-medium">
              New put-away work
            </Label>
            <p className="text-xs text-muted-foreground">
              One silent notification per batch received, not one per pallet, so you can see there is work waiting
              without being interrupted mid-task.
            </p>
          </div>
          <Switch
            id="putaway-badge"
            checked={prefs.putawayBadge}
            onCheckedChange={(next) => void handlePrefToggle("putawayBadge", next)}
            disabled={savingPref !== null}
          />
        </div>

        <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="email-pick-list" className="text-sm font-medium">
              Email me about pick tickets
            </Label>
            <p className="text-xs text-muted-foreground">
              Separate from the ring, so you can keep the alert and drop the inbox. The unsubscribe link in those
              emails stops them everywhere, whatever this is set to.
            </p>
          </div>
          <Switch
            id="email-pick-list"
            checked={prefs.emailPickList}
            onCheckedChange={(next) => void handlePrefToggle("emailPickList", next)}
            disabled={savingPref !== null}
          />
        </div>

        {denied ? (
          <div className="grid gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
            <p className="font-medium text-foreground">How to unblock notifications</p>
            {DENIED_STEPS.map((step) => (
              <p key={step}>• {step}</p>
            ))}
            <p>Until then, Warehouse Wizard still shows in-app toasts for the same alerts while the app is open.</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
