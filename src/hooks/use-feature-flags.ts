import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { loadMobileToolbarPreferences, saveMobileToolbarPreferences } from "@/lib/mobile-toolbar-preferences";

export type ModuleKey =
  | "dashboard"
  | "copilot"
  | "receiving"
  | "putaway"
  | "inventory"
  | "location-moves"
  | "transfers"
  | "pick-lists"
  | "products"
  | "warehouses"
  | "zones"
  | "locations"
  | "users"
  | "settings"
  | "clients"
  | "packaging"
  | "cycle-counts"
  | "reports"
  | "status"
  | "system-log"
  | "email-log";

export const STARTER_MODULES: Record<ModuleKey, boolean> = {
  dashboard: true,
  copilot: true,
  receiving: true,
  putaway: true,
  inventory: true,
  "location-moves": true,
  transfers: false,
  "pick-lists": true,
  products: true,
  warehouses: true,
  zones: true,
  locations: true,
  users: true,
  settings: true,
  clients: false,
  packaging: false,
  "cycle-counts": false,
  reports: false,
  status: false,
  "system-log": false,
  "email-log": false,
};

export const DISABLED_MODULES = new Set<ModuleKey>(["transfers"]);

const MODULE_LABELS: Record<ModuleKey, { label: string; description: string }> = {
  dashboard: { label: "Dashboard", description: "Command Center for live warehouse operations" },
  copilot: { label: "Copilot", description: "Role-aware warehouse recommendations and next actions" },
  receiving: { label: "Receiving", description: "Receive stock and create pallet labels" },
  putaway: { label: "Put-Away", description: "Scan pallets into storage locations" },
  inventory: { label: "Inventory Search", description: "Search and inspect current stock" },
  "location-moves": { label: "Location Moves", description: "Move pallets between locations in the same warehouse" },
  transfers: { label: "Transfers", description: "Move pallets between warehouses and picking areas" },
  "pick-lists": { label: "Pick Lists", description: "Create and execute pick orders" },
  products: { label: "Products", description: "Manage product catalogue and SKUs" },
  warehouses: { label: "Warehouses", description: "Add and configure warehouse sites" },
  zones: { label: "Zones", description: "Define temperature and functional zones" },
  locations: { label: "Locations / Bins", description: "Configure bin locations and capacity limits" },
  users: { label: "Users & Roles", description: "Invite users and manage role assignments" },
  settings: { label: "Settings", description: "Environment, client variables, and system config" },
  clients: { label: "Clients", description: "Manage 3PL clients and stock ownership" },
  packaging: { label: "Packaging Profiles", description: "Pallet dimension templates" },
  "cycle-counts": { label: "Cycle Counts", description: "Schedule and execute inventory audits" },
  reports: { label: "Reports", description: "Export operational and financial reports" },
  status: { label: "Status Controls", description: "Manually adjust pallet and task statuses" },
  "system-log": { label: "System Log", description: "Audit trail and system event history" },
  "email-log": { label: "Email Log", description: "Outbound email delivery records" },
};

export { MODULE_LABELS };

const STORAGE_KEY = "wms.modules.v1";
const TOOLBAR_STORAGE_KEY = "wms.mobile-toolbar.v1";
export const MAX_TOOLBAR_MODULES = 8;
export const COPILOT_ACCESS_ROLES = ["developer", "admin", "warehouse_manager", "warehouse_supervisor"] as const;

export function canAccessCopilot(roles: string[]) {
  return roles.some((role) => COPILOT_ACCESS_ROLES.includes(role as (typeof COPILOT_ACCESS_ROLES)[number]));
}

const DEFAULT_TOOLBAR_MODULES: ModuleKey[] = ["dashboard", "receiving", "putaway", "inventory", "pick-lists", "location-moves"];
const TOOLBAR_PREFERENCE_MARKER = "__toolbar_v2__";

export function serializeToolbarModules(keys: ModuleKey[]): string[] {
  return [TOOLBAR_PREFERENCE_MARKER, ...keys.slice(0, MAX_TOOLBAR_MODULES)];
}

function loadFlags(): Record<ModuleKey, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...STARTER_MODULES, ...(JSON.parse(raw) as Record<ModuleKey, boolean>), dashboard: true };
  } catch {
    // ignore
  }
  return { ...STARTER_MODULES };
}

function saveFlags(flags: Record<ModuleKey, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...flags, dashboard: true }));
}

export function sanitizeToolbarModules(value: unknown): ModuleKey[] {
  if (!Array.isArray(value)) return [...DEFAULT_TOOLBAR_MODULES];
  const isVersioned = value.includes(TOOLBAR_PREFERENCE_MARKER);
  const modules = Array.from(
    new Set(
      value.filter(
        (key): key is ModuleKey =>
          typeof key === "string" && key in STARTER_MODULES && !DISABLED_MODULES.has(key as ModuleKey),
      ),
    ),
  );
  if (isVersioned) return modules.slice(0, MAX_TOOLBAR_MODULES);
  return (["dashboard", ...modules.filter((key) => key !== "dashboard")] as ModuleKey[]).slice(0, MAX_TOOLBAR_MODULES);
}

function toolbarStorageKey(userId?: string) {
  return userId ? `${TOOLBAR_STORAGE_KEY}.${userId}` : TOOLBAR_STORAGE_KEY;
}

function loadToolbarModules(userId?: string): ModuleKey[] {
  try {
    const raw = localStorage.getItem(toolbarStorageKey(userId));
    if (raw) return sanitizeToolbarModules(JSON.parse(raw));
  } catch {
    // ignore
  }
  return [...DEFAULT_TOOLBAR_MODULES];
}

function saveToolbarModules(keys: ModuleKey[], userId?: string) {
  localStorage.setItem(toolbarStorageKey(userId), JSON.stringify(serializeToolbarModules(keys)));
}

type FeatureFlagContextValue = {
  flags: Record<ModuleKey, boolean>;
  toolbarModules: ModuleKey[];
  isToolbarModule: (key: ModuleKey) => boolean;
  isEnabled: (key: ModuleKey) => boolean;
  setModule: (key: ModuleKey, enabled: boolean) => void;
  setToolbarModule: (key: ModuleKey, pinned: boolean) => void;
  resetToStarter: () => void;
};

export const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export function useFeatureFlagState(): FeatureFlagContextValue {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Record<ModuleKey, boolean>>(loadFlags);
  const [toolbarModules, setToolbarModules] = useState<ModuleKey[]>(loadToolbarModules);

  useEffect(() => {
    if (!user) {
      setToolbarModules([...DEFAULT_TOOLBAR_MODULES]);
      return;
    }

    let cancelled = false;
    void loadMobileToolbarPreferences(user.id)
      .then((saved) => {
        if (cancelled) return;
        const next = saved === undefined ? loadToolbarModules(user.id) : sanitizeToolbarModules(saved);
        setToolbarModules(next);
        saveToolbarModules(next, user.id);
      })
      .catch((error) => {
        console.error("[FeatureFlags] mobile toolbar preferences unavailable:", error);
        if (!cancelled) setToolbarModules(loadToolbarModules(user.id));
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const isEnabled = useCallback((key: ModuleKey) => !DISABLED_MODULES.has(key) && (flags[key] ?? true), [flags]);
  const isToolbarModule = useCallback((key: ModuleKey) => toolbarModules.includes(key), [toolbarModules]);

  const setModule = useCallback((key: ModuleKey, enabled: boolean) => {
    if (key === "dashboard" || DISABLED_MODULES.has(key)) return;
    setFlags((prev) => {
      const next = { ...prev, [key]: enabled };
      saveFlags(next);
      return next;
    });
    if (!enabled) {
      setToolbarModules((prev) => {
        const next = prev.filter((item) => item !== key);
        saveToolbarModules(next, user?.id);
        if (user) void saveMobileToolbarPreferences(user.id, serializeToolbarModules(next)).catch((error) => console.error("[FeatureFlags] could not save mobile toolbar preferences:", error));
        return next;
      });
    }
  }, [user]);

  const setToolbarModule = useCallback((key: ModuleKey, pinned: boolean) => {
    setToolbarModules((prev) => {
      const without = prev.filter((item) => item !== key);
      const next = pinned ? [...without, key].slice(0, MAX_TOOLBAR_MODULES) : without;
      saveToolbarModules(next, user?.id);
      if (user) void saveMobileToolbarPreferences(user.id, serializeToolbarModules(next)).catch((error) => console.error("[FeatureFlags] could not save mobile toolbar preferences:", error));
      return next;
    });
  }, [user]);

  const resetToStarter = useCallback(() => {
    const defaults = { ...STARTER_MODULES };
    setFlags(defaults);
    saveFlags(defaults);
    setToolbarModules([...DEFAULT_TOOLBAR_MODULES]);
    saveToolbarModules(DEFAULT_TOOLBAR_MODULES, user?.id);
    if (user) void saveMobileToolbarPreferences(user.id, serializeToolbarModules(DEFAULT_TOOLBAR_MODULES)).catch((error) => console.error("[FeatureFlags] could not save mobile toolbar preferences:", error));
  }, [user]);

  return { flags, toolbarModules, isToolbarModule, isEnabled, setModule, setToolbarModule, resetToStarter };
}

export function useFeatureFlags(): FeatureFlagContextValue {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) throw new Error("useFeatureFlags must be used inside FeatureFlagProvider");
  return ctx;
}
