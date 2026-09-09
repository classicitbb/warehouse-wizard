// use-feature-permission.ts — the client half of the Role Matrix.
//
// Reads `permission_features` + `role_permissions` and applies exactly the
// rule `public.has_feature_permission()` applies server-side, including the
// `is_released` gate. Client and server must agree here: the state this
// replaces — a roles array promising `inventory_clerk` write access that RLS
// refuses with a raw 403 — is what happens when they do not.

import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export interface FeaturePermission {
  /** May see the surface at all. */
  canView: boolean;
  /** May create or change its records. Implies canView. */
  canEdit: boolean;
  /** False while a feature is still developer-only. */
  isReleased: boolean;
  /** Distinguishes "not allowed" from "not loaded yet" at the call site. */
  isLoading: boolean;
}

const DENIED: Omit<FeaturePermission, "isLoading"> = {
  canView: false,
  canEdit: false,
  isReleased: false,
};

interface FeaturePermissionRow {
  can_view: boolean | null;
  can_edit: boolean | null;
  permission_features: { code: string; is_released: boolean | null } | null;
}

/**
 * Permission for one feature code, for the signed-in user.
 *
 * Fails closed: an error or a missing row denies rather than assuming access,
 * because the surfaces this gates write master data.
 */
export function useFeaturePermission(featureCode: string): FeaturePermission {
  const { user, profile, roles } = useAuth();
  // The same developer-identity convention normalizeDeveloperAccess() uses in
  // use-auth, so a developer on a demo session reaches their own preview
  // rather than being denied for having no matrix row.
  const isDeveloper =
    roles.includes("developer")
    || String(profile?.email ?? user?.email ?? "").trim().toLowerCase() === "russelljhunte@gmail.com"
    || String(profile?.user_code ?? "").trim().toUpperCase() === "DEV01";

  const { data, isLoading } = useQuery({
    queryKey: ["feature-permission", featureCode, user?.id ?? null],
    enabled: Boolean(user?.id),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: rows, error } = await (supabase as any)
        .from("role_permissions")
        .select("can_view, can_edit, permission_features!inner(code, is_released), roles!inner(user_roles!inner(user_id))")
        .eq("permission_features.code", featureCode)
        .eq("roles.user_roles.user_id", user!.id);

      if (error) {
        console.error("[useFeaturePermission] lookup failed:", error);
        return DENIED;
      }

      const list = (rows ?? []) as FeaturePermissionRow[];
      if (list.length === 0) return DENIED;

      // A user may hold several roles; the most permissive one wins, matching
      // the EXISTS in has_feature_permission().
      const isReleased = list.some((row) => row.permission_features?.is_released !== false);
      const granted = list.some((row) => row.can_view === true);
      const editable = list.some((row) => row.can_edit === true);

      // An unreleased feature is developer-only, whatever the matrix grants.
      if (!isReleased && !isDeveloper) return { ...DENIED, isReleased: false };

      return { canView: granted, canEdit: editable, isReleased };
    },
  });

  // A developer always sees the surface. The server agrees: the seed grants
  // developers view and edit, and has_feature_permission() exempts them from
  // the release gate. RLS remains the real gate on any write. The lookup still
  // runs so `isReleased` stays truthful once the feature ships and the
  // "Developer preview" badge disappears on its own.
  if (isDeveloper) {
    return { canView: true, canEdit: true, isReleased: data?.isReleased ?? false, isLoading: false };
  }

  return {
    canView: data?.canView ?? false,
    canEdit: data?.canEdit ?? false,
    isReleased: data?.isReleased ?? false,
    isLoading: Boolean(user?.id) && isLoading,
  };
}
