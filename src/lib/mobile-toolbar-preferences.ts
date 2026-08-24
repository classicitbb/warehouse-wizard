import { supabase } from "@/integrations/supabase/client";

const db = supabase.from.bind(supabase) as (table: string) => any;
const TABLE = "user_mobile_toolbar_preferences";

function isMissingPreferenceTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  return (value.code === "PGRST205" || value.code === "42P01") && (value.message ?? "").includes(TABLE);
}

export type UserWorkspacePreferences = {
  moduleKeys?: unknown;
  moduleFlags?: unknown;
};

/** Reads the account copy of the workspace: pinned favourites + module switches. */
export async function loadWorkspacePreferences(userId: string): Promise<UserWorkspacePreferences | undefined> {
  const { data, error } = await db(TABLE)
    .select("module_keys, module_flags")
    .eq("user_id", userId)
    .maybeSingle();
  if (isMissingPreferenceTable(error)) return undefined;
  if (error) throw error;
  if (!data) return {};
  return { moduleKeys: data.module_keys, moduleFlags: data.module_flags };
}

export async function loadMobileToolbarPreferences(userId: string): Promise<unknown | undefined> {
  const prefs = await loadWorkspacePreferences(userId);
  return prefs?.moduleKeys;
}

export async function saveWorkspacePreferences(
  userId: string,
  values: { moduleKeys?: string[]; moduleFlags?: Record<string, boolean> },
) {
  const payload: Record<string, unknown> = {
    user_id: userId,
    updated_at: new Date().toISOString(),
  };
  if (values.moduleKeys) payload.module_keys = values.moduleKeys;
  if (values.moduleFlags) payload.module_flags = values.moduleFlags;
  const { error } = await db(TABLE).upsert(payload, { onConflict: "user_id" });
  if (isMissingPreferenceTable(error)) return;
  if (error) throw error;
}

export async function saveMobileToolbarPreferences(userId: string, moduleKeys: string[]) {
  await saveWorkspacePreferences(userId, { moduleKeys });
}
