/**
 * screenshot-capture.ts
 *
 * Captures the screen the operator is looking at when they start a report, so
 * the ticket carries a picture of the problem instead of a description of one.
 *
 * The copilot panel itself is excluded from the shot (it is marked with
 * `data-ticket-screenshot-ignore`), so what lands in the ticket is the page
 * underneath the chat.
 *
 * Images go to the private `ticket-screenshots` bucket under the reporter's own
 * folder. Nothing here throws into the report flow: a failed capture is logged
 * and the report continues without a picture.
 */

import { supabase } from "@/integrations/supabase/client";
import { db, formatSupabaseError } from "@/features/shared/core-types";
import { logErrorTelemetry } from "@/lib/system-telemetry";

export const TICKET_SCREENSHOT_BUCKET = "ticket-screenshots";

/** Anything carrying this attribute is left out of the capture. */
export const SCREENSHOT_IGNORE_ATTR = "data-ticket-screenshot-ignore";

const MAX_WIDTH = 1400;

/** Render the current page to a JPEG blob. Returns null when it cannot. */
export async function capturePageScreenshot(): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  try {
    const { default: html2canvas } = await import("html2canvas-pro");
    const target = document.body;
    const scale = Math.min(1, MAX_WIDTH / Math.max(1, target.clientWidth));
    const canvas = await html2canvas(target, {
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#ffffff",
      logging: false,
      useCORS: true,
      scale,
      windowWidth: document.documentElement.clientWidth,
      windowHeight: document.documentElement.clientHeight,
      ignoreElements: (element) =>
        element.hasAttribute?.(SCREENSHOT_IGNORE_ATTR) ||
        element.getAttribute?.("role") === "dialog" && element.hasAttribute?.(SCREENSHOT_IGNORE_ATTR),
    });
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.72);
    });
  } catch (error) {
    logErrorTelemetry({
      error,
      title: "Report screenshot could not be captured",
      source: "screenshot-capture.capturePageScreenshot",
      severity: "warning",
    });
    return null;
  }
}

/** Upload a capture and return its storage path, or null on failure. */
export async function uploadTicketScreenshot(blob: Blob): Promise<string | null> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return null;
    const path = `${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
    const { error } = await supabase.storage
      .from(TICKET_SCREENSHOT_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error) throw new Error(error.message);
    return path;
  } catch (error) {
    logErrorTelemetry({
      error,
      title: "Report screenshot could not be uploaded",
      source: "screenshot-capture.uploadTicketScreenshot",
      severity: "warning",
    });
    return null;
  }
}

/** Capture and upload in one step. Null when either half fails. */
export async function captureAndUploadTicketScreenshot(): Promise<string | null> {
  const blob = await capturePageScreenshot();
  if (!blob) return null;
  return uploadTicketScreenshot(blob);
}

/**
 * Attach a stored capture to the reporter's most recent draft report — the one
 * the copilot has just opened for them.
 */
export async function attachScreenshotToLatestDraft(path: string): Promise<boolean> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) return false;
    const { data, error } = await db("operator_tickets")
      .select("id, screenshot_path")
      .eq("reported_by", userId)
      .eq("status", "draft")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(formatSupabaseError(error, "Could not find the open report."));
    const row = data as { id?: string; screenshot_path?: string | null } | null;
    if (!row?.id || row.screenshot_path) return false;
    const { error: updateError } = await db("operator_tickets")
      .update({ screenshot_path: path })
      .eq("id", row.id);
    if (updateError) throw new Error(formatSupabaseError(updateError, "Could not attach the screenshot."));
    return true;
  } catch (error) {
    logErrorTelemetry({
      error,
      title: "Report screenshot could not be attached",
      source: "screenshot-capture.attachScreenshotToLatestDraft",
      severity: "warning",
    });
    return false;
  }
}

/** A short-lived link an admin can open to view a capture. */
export async function signedScreenshotUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(TICKET_SCREENSHOT_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) return null;
  return data?.signedUrl ?? null;
}
