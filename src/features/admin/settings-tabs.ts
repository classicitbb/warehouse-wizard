// Settings tab registry: one list drives the tab strip, URL slugs (/settings/:slug) and access rules.

export type SettingsTabSlug =
  | "warehouse-structure"
  | "users-roles"
  | "modules"
  | "notifications"
  | "environment"
  | "support-requests"
  | "integrations"
  | "client-vars"
  | "about"
  | "license";

export type SettingsTabContext = {
  canViewUsersRoles: boolean;
  isDeveloperOrAdmin: boolean;
  clientsEnabled: boolean;
};

type SettingsTabDefinition = {
  slug: SettingsTabSlug;
  label: string;
  visible?: (ctx: SettingsTabContext) => boolean;
};

export const SETTINGS_TABS: SettingsTabDefinition[] = [
  { slug: "warehouse-structure", label: "Warehouse Structure" },
  { slug: "users-roles", label: "Users & Roles", visible: (ctx) => ctx.canViewUsersRoles },
  { slug: "modules", label: "Modules" },
  { slug: "notifications", label: "Notifications" },
  { slug: "environment", label: "Environment" },
  { slug: "support-requests", label: "Support Requests", visible: (ctx) => ctx.canViewUsersRoles },
  { slug: "integrations", label: "Integrations", visible: (ctx) => ctx.isDeveloperOrAdmin },
  { slug: "client-vars", label: "Client Variables", visible: (ctx) => ctx.clientsEnabled },
  { slug: "about", label: "About" },
  { slug: "license", label: "License" },
];

export const DEFAULT_SETTINGS_TAB: SettingsTabSlug = "warehouse-structure";

export function isKnownSettingsTab(slug: string | undefined): slug is SettingsTabSlug {
  return SETTINGS_TABS.some((tab) => tab.slug === slug);
}

export function getVisibleSettingsTabs(ctx: SettingsTabContext): SettingsTabSlug[] {
  return SETTINGS_TABS.filter((tab) => !tab.visible || tab.visible(ctx)).map((tab) => tab.slug);
}

export function settingsTabPath(slug: SettingsTabSlug): string {
  return `/settings/${slug}`;
}

/** First path segment after /settings, from the route splat ("integrations/netsuite" -> "integrations"). */
export function settingsTabFromSplat(splat: string | undefined): string {
  return (splat ?? "").split("/").filter(Boolean)[0] ?? "";
}
