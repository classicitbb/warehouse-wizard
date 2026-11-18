/**
 * platform-support.ts
 *
 * Client for the control plane's `tenant-support` function, which now holds this
 * tenant's system log and support requests (platform ADR-0023). The caller's own
 * session token travels with each call; the platform verifies it against this
 * tenant's Supabase Auth, so no platform credentials live in the app.
 *
 * Configured by VITE_PLATFORM_URL (the control plane's public Supabase URL).
 * When it is not set the app keeps using its own tables, so a build without it
 * still works.
 */

import { supabase } from "@/integrations/supabase/client";

const PLATFORM_URL = (import.meta.env.VITE_PLATFORM_URL as string | undefined)?.replace(/\/$/, "") ?? "";
const TENANT_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";

export function platformSupportEnabled(): boolean {
  return Boolean(PLATFORM_URL && TENANT_URL);
}

export class PlatformSupportError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function callPlatformSupport<T = Record<string, unknown>>(
  action: string,
  args: Record<string, unknown> = {},
  options: { keepalive?: boolean } = {},
): Promise<T> {
  if (!platformSupportEnabled()) throw new PlatformSupportError("Platform support is not configured.", 503);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new PlatformSupportError("Sign in before contacting support.", 401);

  const response = await fetch(`${PLATFORM_URL}/functions/v1/tenant-support`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, tenant_url: TENANT_URL, ...args }),
    keepalive: options.keepalive,
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new PlatformSupportError(
      typeof body.error === "string" ? body.error : `Support request failed (${response.status}).`,
      response.status,
    );
  }
  return body as T;
}

/** Upload a screenshot to the platform's private bucket; returns its storage path. */
export async function uploadPlatformScreenshot(blob: Blob): Promise<string> {
  const contentType = blob.type === "image/png" || blob.type === "image/webp" ? blob.type : "image/jpeg";
  const target = await callPlatformSupport<{ path: string; signed_url: string }>("screenshots.upload_url", {
    content_type: contentType,
  });
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", blob);
  const response = await fetch(target.signed_url, { method: "PUT", body: form, headers: { "x-upsert": "false" } });
  if (!response.ok) throw new PlatformSupportError("Screenshot upload failed.", response.status);
  return target.path;
}
