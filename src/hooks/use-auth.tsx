import {
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type RoleCode =
  | "developer"
  | "admin"
  | "warehouse_manager"
  | "warehouse_supervisor"
  | "inventory_clerk"
  | "warehouse_operator"
  | "dispatch_driver";

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Tables<"profiles"> | null;
  roles: RoleCode[];
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  hasRole: (allowed: RoleCode[]) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const demoSessionKey = "warehouse-wizard-demo-session";
const rememberMeKey = "warehouse-wizard-remember-me";
function clearSupabaseSession() {
  void supabase.auth.signOut();
}
// Demo fallback is only enabled in dev/preview builds. In production, hardcoded
// demo credentials must never grant a fake session, even if Supabase is unreachable.
const demoEnabled =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_DEMO === "true" ||
  (typeof window !== "undefined" &&
    /^(localhost|127\.0\.0\.1|.*\.lovable\.app)$/.test(window.location.hostname) &&
    !/^threeplmgmt\.lovable\.app$/.test(window.location.hostname));

const demoUsers: Record<string, { id: string; fullName: string; roles: RoleCode[]; userCode: string; badgeCode: string }> = {
  "admin@warehousewizard.local": {
    id: "11111111-1111-1111-1111-111111111111",
    fullName: "System Admin",
    roles: ["admin", "warehouse_manager", "inventory_clerk", "warehouse_operator", "dispatch_driver"],
    userCode: "ADMIN01",
    badgeCode: "BADGE-ADMIN01",
  },
  "manager@warehousewizard.local": {
    id: "22222222-2222-2222-2222-222222222222",
    fullName: "Shanice Jordan",
    roles: ["warehouse_manager", "inventory_clerk", "warehouse_operator"],
    userCode: "MGR01",
    badgeCode: "BADGE-MGR01",
  },
  "clerk@warehousewizard.local": {
    id: "33333333-3333-3333-3333-333333333333",
    fullName: "Darnell Clarke",
    roles: ["inventory_clerk"],
    userCode: "CLK01",
    badgeCode: "BADGE-CLK01",
  },
  "operator@warehousewizard.local": {
    id: "44444444-4444-4444-4444-444444444444",
    fullName: "Kemar Holder",
    roles: ["warehouse_operator"],
    userCode: "OPR01",
    badgeCode: "BADGE-OPR01",
  },
  "driver@warehousewizard.local": {
    id: "55555555-5555-5555-5555-555555555555",
    fullName: "Janelle Ifill",
    roles: ["dispatch_driver"],
    userCode: "DRV01",
    badgeCode: "BADGE-DRV01",
  },
  "supervisor@warehousewizard.local": {
    id: "66666666-6666-6666-6666-666666666666",
    fullName: "Andre Wilde",
    roles: ["warehouse_manager", "warehouse_operator"],
    userCode: "SUP01",
    badgeCode: "BADGE-SUP01",
  },
};

function findDemoUser(identifier: string) {
  const normalized = identifier.trim().toUpperCase();
  return Object.entries(demoUsers).find(([email, user]) =>
    email.toUpperCase() === normalized || user.userCode === normalized || user.badgeCode === normalized,
  );
}

function buildDemoAuth(email: string) {
  const demo = demoUsers[email];
  const user = {
    id: demo.id,
    email,
    app_metadata: {},
    user_metadata: { full_name: demo.fullName },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as User;
  const session = {
    access_token: "preview-demo-token",
    refresh_token: "preview-demo-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user,
  } as Session;
  const profile = {
    id: demo.id,
    email,
    full_name: demo.fullName,
    active: true,
    approved: true,
    user_code: demo.userCode,
    badge_code: demo.badgeCode,
  } as unknown as Tables<"profiles">;

  return { session, user, profile, roles: demo.roles };
}

function isDeveloperIdentity(profile: Tables<"profiles"> | null, user: User | null) {
  const email = String(profile?.email ?? user?.email ?? "").trim().toLowerCase();
  const userCode = String(profile?.user_code ?? "").trim().toUpperCase();
  return email === "russelljhunte@gmail.com" || userCode === "DEV01";
}

function normalizeDeveloperAccess(
  profile: Tables<"profiles"> | null,
  roles: RoleCode[],
  user: User | null,
): Tables<"profiles"> | null {
  if (!profile || (!roles.includes("developer") && !isDeveloperIdentity(profile, user))) {
    return profile;
  }

  if (profile.approved === true && profile.active === true) {
    return profile;
  }

  return {
    ...profile,
    approved: true,
    active: true,
  };
}

async function fetchProfileBundle(userId: string) {
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, email, phone, approved, created_at, updated_at, active, default_warehouse_id, user_code, badge_code"
      )
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("user_roles")
      .select("role_id, roles!inner(code)")
      .eq("user_id", userId)
  ]);

  const roles = (roleRows ?? [])
    .flatMap((row) => {
      const nested = row.roles as { code: RoleCode } | { code: RoleCode }[] | null;

      if (Array.isArray(nested)) {
        return nested.map((entry) => entry.code);
      }

      return nested ? [nested.code] : [];
    })
    .filter((value, index, values) => values.indexOf(value) === index);

  return {
    profile: profile ? { ...profile, pin_hash: null } : null,
    roles,
  };
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Tables<"profiles"> | null>(null);
  const [roles, setRoles] = useState<RoleCode[]>([]);

  const refreshProfile = useCallback(async () => {
    const currentUser = supabase.auth.getUser ? (await supabase.auth.getUser()).data.user : user;

    if (!currentUser) {
      setProfile(null);
      setRoles([]);
      return;
    }

    const bundle = await fetchProfileBundle(currentUser.id);
    setProfile(normalizeDeveloperAccess(bundle.profile, bundle.roles, currentUser));
    setRoles(bundle.roles);
  }, [user]);

  // Tracks whether the initial session bootstrap has completed, and which
  // user we last resolved a profile for. Supabase's auth client re-validates
  // (and often silently refreshes) the session whenever the tab/app regains
  // visibility — e.g. switching back from another app on Android, or
  // returning to a backgrounded browser tab. That fires onAuthStateChange
  // again for the *same* signed-in user. Previously we treated that exactly
  // like a fresh sign-in and flipped `loading` back to true, which made
  // RequireAuth unmount the whole current screen and show the full-page
  // spinner — wiping out whatever the operator was in the middle of. Now we
  // only show that loading state for a genuine sign-in/user-switch; a
  // same-user revalidation just refreshes profile/roles quietly underneath
  // the page that's already on screen.
  const hasBootstrappedRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const handlePageHide = () => {
      if (window.localStorage.getItem(rememberMeKey) === "0") {
        clearSupabaseSession();
      }
    };
    window.addEventListener("pagehide", handlePageHide);

    supabase.auth.getSession().catch(() => ({ data: { session: null } })).then(async ({ data }) => {
      if (!mounted) {
        return;
      }

      const demoEmail = window.localStorage.getItem(demoSessionKey);
      const demoAuth =
        demoEnabled && !data.session && demoEmail && demoUsers[demoEmail]
          ? buildDemoAuth(demoEmail)
          : null;
      if (!demoEnabled && demoEmail) {
        window.localStorage.removeItem(demoSessionKey);
      }
      const nextSession = data.session ?? demoAuth?.session ?? null;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (demoAuth) {
        setProfile(demoAuth.profile);
        setRoles(demoAuth.roles);
        setLoading(false);
        lastUserIdRef.current = demoAuth.user.id;
        hasBootstrappedRef.current = true;
        return;
      }

      if (nextSession?.user) {
        const bundle = await fetchProfileBundle(nextSession.user.id);
        if (!mounted) {
          return;
        }
        setProfile(normalizeDeveloperAccess(bundle.profile, bundle.roles, nextSession.user));
        setRoles(bundle.roles);
        lastUserIdRef.current = nextSession.user.id;
      }

      setLoading(false);
      hasBootstrappedRef.current = true;
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setProfile(null);
        setRoles([]);
        setLoading(false);
        lastUserIdRef.current = null;
        hasBootstrappedRef.current = true;
        return;
      }

      // Same user we already had loaded — this is a background session
      // revalidation/token refresh, not a real sign-in. Refresh profile/roles
      // in place without touching `loading`, so the currently rendered page
      // (and anything in progress on it) stays put.
      const isSameUserRevalidation =
        hasBootstrappedRef.current && lastUserIdRef.current === nextSession.user.id;

      if (!isSameUserRevalidation) {
        setLoading(true);
      }

      fetchProfileBundle(nextSession.user.id)
        .then((bundle) => {
          if (!mounted) {
            return;
          }
          setProfile(normalizeDeveloperAccess(bundle.profile, bundle.roles, nextSession.user));
          setRoles(bundle.roles);
          lastUserIdRef.current = nextSession.user.id;
          hasBootstrappedRef.current = true;
        })
        .finally(() => {
          if (mounted && !isSameUserRevalidation) {
            setLoading(false);
          }
        });
    });

    return () => {
      mounted = false;
      window.removeEventListener("pagehide", handlePageHide);
      authListener.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user,
      profile,
      roles,
      signIn: async (email, password) => {
        const identifier = email.trim();
        const demoMatch = findDemoUser(identifier);
        let authEmail = identifier;

        // Resolve short login codes to full email addresses
        if (!identifier.includes("@")) {
          const resolveLoginCodeRpc = supabase.rpc.bind(supabase) as unknown as (
            fn: string,
            args: Record<string, string>,
          ) => Promise<{ data: string | null }>;
          try {
            const { data } = await resolveLoginCodeRpc("resolve_login_code", { in_login_code: identifier });
            authEmail = data ?? "";
          } catch {
            authEmail = "";
          }
        }

        // Always attempt real Supabase Auth first so auth.uid() is valid in DB functions.
        // Only fall back to demo session if the Supabase instance is unreachable or
        // explicitly returns a schema-query error (local dev without migrations).
        if (authEmail) {
          let { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });

          // Transparent retry for known transient Supabase auth errors
          // ("Database error querying schema" / "unexpected_failure") that
          // surface intermittently and otherwise lock real users out.
          const isTransient = (err: typeof error) => {
            if (!err) return false;
            const m = (err.message ?? "").toLowerCase();
            return (
              m.includes("database error querying schema") ||
              m.includes("unexpected_failure") ||
              m.includes("unexpected failure")
            );
          };

          for (let attempt = 0; attempt < 2 && isTransient(error); attempt++) {
            await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
            ({ error } = await supabase.auth.signInWithPassword({ email: authEmail, password }));
          }
          if (!error) return;

          const isDemoFallback =
            password === "Warehouse123!" &&
            demoMatch &&
            (error.message === "Database error querying schema" ||
              error.message?.toLowerCase().includes("fetch") ||
              error.status === 0);

          if (!isDemoFallback) throw error;
        }

        // Fallback: apply local demo session (no real JWT — auth.uid() will be NULL)
        if (demoEnabled && password === "Warehouse123!" && demoMatch) {
          const [demoEmail] = demoMatch;
          const demoAuth = buildDemoAuth(demoEmail);
          window.localStorage.setItem(demoSessionKey, demoEmail);
          setSession(demoAuth.session);
          setUser(demoAuth.user);
          setProfile(demoAuth.profile);
          setRoles(demoAuth.roles);
          setLoading(false);
          return;
        }

        throw new Error("Invalid credentials");
      },
      signOut: async () => {
        window.localStorage.removeItem(demoSessionKey);
        if (session?.access_token === "preview-demo-token") {
          setSession(null);
          setUser(null);
          setProfile(null);
          setRoles([]);
          return;
        }
        const { error } = await supabase.auth.signOut();
        if (error) {
          throw error;
        }
      },
      refreshProfile,
      hasRole: (allowed) => allowed.some((role) => roles.includes(role)),
    }),
    [loading, profile, refreshProfile, roles, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
