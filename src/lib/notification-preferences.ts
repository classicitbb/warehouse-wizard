/**
 * Per-device notification preferences.
 *
 * Deliberately local to the browser/device: an operator may want OS-level
 * build alerts on their office desktop but not on a shared floor tablet.
 */

const BUILD_NOTIFICATIONS_KEY = "warehouseWizard.notifications.buildAlerts";

export function isBuildNotificationEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    // Default on — permission is still the real gate.
    return window.localStorage.getItem(BUILD_NOTIFICATIONS_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setBuildNotificationEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BUILD_NOTIFICATIONS_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable — preference simply won't persist on this device.
  }
}
