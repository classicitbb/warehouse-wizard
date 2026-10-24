import { db } from "@/features/shared/core-types";

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type ReportSubscription = {
  id: string;
  user_id: string;
  report_id: string;
  warehouse_id: string | null;
  frequency: ReportFrequency;
  email_delivery: boolean;
  active: boolean;
  last_delivered_at: string | null;
  created_at: string;
};

const INTERVAL_DAYS: Record<ReportFrequency, number> = { daily: 1, weekly: 7, monthly: 30 };

/** A subscription is due once its interval has passed since the last delivery. */
export function isSubscriptionDue(subscription: Pick<ReportSubscription, "active" | "frequency" | "last_delivered_at" | "created_at">, now = new Date()) {
  if (!subscription.active) return false;
  const anchor = new Date(subscription.last_delivered_at ?? subscription.created_at);
  return now.getTime() - anchor.getTime() >= INTERVAL_DAYS[subscription.frequency] * 86_400_000 - 60_000;
}

export async function listReportSubscriptions(userId: string): Promise<ReportSubscription[]> {
  const { data, error } = await db("report_subscriptions").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveReportSubscription(input: {
  userId: string;
  reportId: string;
  warehouseId: string | null;
  frequency: ReportFrequency;
  emailDelivery: boolean;
}) {
  const { error } = await db("report_subscriptions").insert({
    user_id: input.userId,
    report_id: input.reportId,
    warehouse_id: input.warehouseId,
    frequency: input.frequency,
    email_delivery: input.emailDelivery,
  });
  if (error) throw error;
}

export async function updateReportSubscription(id: string, patch: Partial<Pick<ReportSubscription, "active" | "frequency" | "email_delivery" | "last_delivered_at">>) {
  const { error } = await db("report_subscriptions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function deleteReportSubscription(id: string) {
  const { error } = await db("report_subscriptions").delete().eq("id", id);
  if (error) throw error;
}
