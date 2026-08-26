import { useState } from "react";
import { Bell, BellOff, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useNotificationPermission } from "@/hooks/use-notification-permission";
import { isBuildNotificationEnabled, setBuildNotificationEnabled } from "@/lib/notification-preferences";

const DENIED_STEPS = [
  "Desktop Chrome/Edge: click the padlock (or tune icon) left of the address bar, then set Notifications to Allow and reload.",
  "Android Chrome: tap the padlock > Permissions > Notifications > Allow, then reload.",
  "Installed app (home-screen icon): open your device Settings > Apps > Warehouse Wizard > Notifications and turn them on.",
  "Safari (macOS): Safari > Settings > Websites > Notifications, find this site and choose Allow.",
];

/**
 * Per-device notification controls. Permission lives with the browser, the
 * on/off switch lives with this device, so a shared floor tablet can stay quiet
 * while an office desktop gets build alerts.
 */
export function NotificationSettingsPanel() {
  const { supported, permission, requestPermission } = useNotificationPermission();
  const [buildAlerts, setBuildAlerts] = useState(isBuildNotificationEnabled);
  const [requesting, setRequesting] = useState(false);

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
          Controls apply to this device and browser only. Sign in elsewhere and you can set it differently there.
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
