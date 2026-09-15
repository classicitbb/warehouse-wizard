import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}) },
}));

import {
  markNotificationReminderShown,
  shouldRemindAboutNotifications,
} from "@/lib/notification-preferences";

/**
 * The weekly "are notifications on?" check.
 *
 * The rule the user asked for: check weekly per user; if notifications can be
 * detected as on, take no action; otherwise remind in the notification bell
 * only. Browser permission is per device, so the throttle is keyed per user
 * per device - floor tablets are shared, and one person dismissing a reminder
 * must not silence it for the next shift.
 */

const WEEK = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 15, 9, 0, 0);

beforeEach(() => {
  window.localStorage.clear();
});

describe("shouldRemindAboutNotifications", () => {
  it("says nothing at all when permission is already granted", () => {
    expect(shouldRemindAboutNotifications("granted", "user-1", NOW)).toBe(false);
  });

  it("says nothing where notifications do not exist", () => {
    // An in-app webview with no Notification API cannot act on the reminder.
    expect(shouldRemindAboutNotifications("unsupported", "user-1", NOW)).toBe(false);
  });

  it("reminds the first time it sees a user with notifications off", () => {
    expect(shouldRemindAboutNotifications("default", "user-1", NOW)).toBe(true);
    expect(shouldRemindAboutNotifications("denied", "user-1", NOW)).toBe(true);
  });

  it("stays quiet for a week after it has been shown", () => {
    markNotificationReminderShown("user-1", NOW);

    expect(shouldRemindAboutNotifications("default", "user-1", NOW)).toBe(false);
    expect(shouldRemindAboutNotifications("default", "user-1", NOW + WEEK - 60_000)).toBe(false);
  });

  it("reminds again once the week is up", () => {
    markNotificationReminderShown("user-1", NOW);
    expect(shouldRemindAboutNotifications("default", "user-1", NOW + WEEK)).toBe(true);
  });

  it("keeps the throttle separate per user on a shared tablet", () => {
    markNotificationReminderShown("user-1", NOW);

    expect(shouldRemindAboutNotifications("default", "user-1", NOW)).toBe(false);
    expect(shouldRemindAboutNotifications("default", "user-2", NOW)).toBe(true);
  });

  it("errs toward reminding when storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    try {
      expect(shouldRemindAboutNotifications("default", "user-1", NOW)).toBe(true);
    } finally {
      getItem.mockRestore();
    }
  });

  it("treats a corrupted timestamp as never shown", () => {
    window.localStorage.setItem("warehouseWizard.notifications.permissionNagShownAt.user-1", "not-a-number");
    expect(shouldRemindAboutNotifications("default", "user-1", NOW)).toBe(true);
  });
});
