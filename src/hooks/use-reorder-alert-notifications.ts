import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const NOTIFIED_IDS_STORAGE_KEY = "warehouseWizard.reorderAlerts.notifiedIds";

type ReorderAlertNotificationRow = {
  id: string;
  available_quantity: number | null;
  recommended_quantity: number | null;
  email_queued_at?: string | null;
  products?: { sku: string | null; name: string | null } | null;
  warehouses?: { code: string | null; name: string | null } | null;
};

/**
 * Reorder alert emails are sent app-side (the database only raises the alert
 * row). The sender marks `email_queued_at`, so it is safe to ask more than
 * once — and a failure never affects the on-screen alert.
 */
async function sendReorderAlertEmail(alertId: string) {
  try {
    await supabase.functions.invoke("send-notification-email", {
      body: { kind: "reorder_alert", id: alertId },
    });
  } catch (error) {
    console.warn("Could not send the reorder alert email", error);
  }
}


function readNotifiedIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(NOTIFIED_IDS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeNotifiedIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOTIFIED_IDS_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Storage can fail (quota, private mode) — notifications just won't be deduped as tightly.
  }
}

async function showReorderAlertNotification(alert: ReorderAlertNotificationRow) {
  const sku = alert.products?.sku ?? "Product";
  const name = alert.products?.name;
  const warehouse = alert.warehouses?.code ?? alert.warehouses?.name;
  const available = Number(alert.available_quantity ?? 0);
  const recommended = Number(alert.recommended_quantity ?? 0);

  const title = "Reorder alert";
  const bodyParts = [`${sku}${name ? ` — ${name}` : ""}`];
  if (warehouse) bodyParts.push(`Warehouse ${warehouse}`);
  bodyParts.push(`${available} available · replenish ${recommended}`);

  const options: NotificationOptions = {
    body: bodyParts.join(" · "),
    tag: `reorder-alert-${alert.id}`,
    icon: "/favicon.png",
    badge: "/favicon.png",
  };

  // Prefer the service worker registration — required on Android/mobile
  // browsers (the page-level Notification constructor throws there) and
  // works fine on desktop too.
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      if (registration && "showNotification" in registration) {
        await registration.showNotification(title, options);
        return;
      }
    }
  } catch {
    // Fall through to the page-level constructor below.
  }

  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notification constructor unsupported in this context — nothing more we can do.
  }
}

/**
 * Polls active reorder alerts and fires a local browser/OS notification the
 * first time this device sees each alert. Notified alert ids persist in
 * localStorage (not sessionStorage) so a page refresh doesn't re-notify, and
 * are pruned to whatever is currently active so a resolved-then-recurring
 * alert can notify again.
 *
 * `enabled` should reflect both "this user's role should see reorder
 * alerts" and "notification permission is granted" — the hook itself stays
 * inert (no query, no notifications) otherwise.
 */
export function useReorderAlertNotifications(enabled: boolean) {
  const notifiedIdsRef = useRef<Set<string> | null>(null);
  if (notifiedIdsRef.current === null) notifiedIdsRef.current = readNotifiedIds();

  const { data: alerts = [] } = useQuery<ReorderAlertNotificationRow[]>({
    queryKey: ["reorder-alerts", "local-notifications"],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reorder_alerts")
        .select(
          "id, available_quantity, recommended_quantity, email_queued_at, products(sku, name), warehouses(code, name)",
        )
        .eq("status", "active");
      if (error) throw error;
      return (data ?? []) as ReorderAlertNotificationRow[];
    },
    refetchInterval: 30_000,
    meta: { suppressGlobalError: true },
  });

  useEffect(() => {
    if (!enabled) return;
    const notified = notifiedIdsRef.current ?? new Set<string>();
    const newAlerts = alerts.filter((alert) => !notified.has(alert.id));
    for (const alert of newAlerts) {
      void showReorderAlertNotification(alert);
    }

    for (const alert of alerts) {
      if (!alert.email_queued_at) void sendReorderAlertEmail(alert.id);
    }


    const nextNotified = new Set(alerts.map((alert) => alert.id));
    notifiedIdsRef.current = nextNotified;
    writeNotifiedIds(nextNotified);
  }, [alerts, enabled]);
}
