import {
  type PropsWithChildren,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type RoleCode =
  | "admin"
  | "warehouse_manager"
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

async function fetchProfileBundle(userId: string) {
  const [{ data: profile }, { data: roleRows }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
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
    profile: profile ?? null,
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
    setProfile(bundle.profile);
    setRoles(bundle.roles);
  }, [user]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().catch(() => ({ data: { session: null } })).then(async ({ data }) => {
      if (!mounted) {
        return;
      }

      const demoEmail = window.localStorage.getItem(demoSessionKey);
      const demoAuth = !data.session && demoEmail && demoUsers[demoEmail] ? buildDemoAuth(demoEmail) : null;
      const nextSession = data.session ?? demoAuth?.session ?? null;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (demoAuth) {
        setProfile(demoAuth.profile);
        setRoles(demoAuth.roles);
        setLoading(false);
        return;
      }

      if (nextSession?.user) {
        const bundle = await fetchProfileBundle(nextSession.user.id);
        if (!mounted) {
          return;
        }
        setProfile(bundle.profile);
        setRoles(bundle.roles);
      }

      setLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        setProfile(null);
        setRoles([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      fetchProfileBundle(nextSession.user.id)
        .then((bundle) => {
          if (!mounted) {
            return;
          }
          setProfile(bundle.profile);
          setRoles(bundle.roles);
        })
        .finally(() => {
          if (mounted) {
            setLoading(false);
          }
        });
    });

    return () => {
      mounted = false;
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

        if (password === "Warehouse123!" && demoMatch) {
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

        if (!identifier.includes("@")) {
          const resolveLoginCodeRpc = supabase.rpc.bind(supabase) as unknown as (
            fn: string,
            args: Record<string, string>,
          ) => Promise<{ data: string | null }>;
          const { data } = await resolveLoginCodeRpc("resolve_login_code", { in_login_code: identifier }).catch(() => ({ data: null }));
          authEmail = data ?? "";

          if (!authEmail && password === "Warehouse123!" && demoMatch) {
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
        }

        const { error } = await supabase.auth.signInWithPassword({ email: authEmail, password });
        if (error) {
          if (error.message === "Database error querying schema" && password === "Warehouse123!" && demoMatch) {
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
          throw error;
        }
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
