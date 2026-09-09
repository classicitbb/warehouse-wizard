import { supabase } from "@/integrations/supabase/client";

const db = supabase.from.bind(supabase) as (table: string) => any;
const DASHBOARD_PREFERENCE_TABLES = [
  "dashboard_tile_visibility",
  "dashboard_device_tile_layout",
];

export type DashboardModeKey = "floor" | "dock" | "office";
/** Tile footprint in grid cells: columns x rows. */
export type DashboardCardSize = "1x1" | "2x1" | "1x2" | "2x2";

export const DASHBOARD_CARD_SIZES: DashboardCardSize[] = ["1x1", "2x1", "2x2", "1x2"];

/** Older saved layouts only knew "sm"/"lg". */
export function normalizeDashboardCardSize(value: unknown): DashboardCardSize {
  if (value === "sm") return "1x1";
  if (value === "lg") return "2x1";
  return DASHBOARD_CARD_SIZES.includes(value as DashboardCardSize) ? (value as DashboardCardSize) : "1x1";
}

export function nextDashboardCardSize(value: unknown): DashboardCardSize {
  const current = normalizeDashboardCardSize(value);
  const index = DASHBOARD_CARD_SIZES.indexOf(current);
  return DASHBOARD_CARD_SIZES[(index + 1) % DASHBOARD_CARD_SIZES.length];
}

export function dashboardTileSpanClass(value: unknown): string {
  switch (normalizeDashboardCardSize(value)) {
    case "2x1":
      return "sm:col-span-2 row-span-1";
    case "1x2":
      return "col-span-1 row-span-2";
    case "2x2":
      return "sm:col-span-2 row-span-2";
    default:
      return "col-span-1 row-span-1";
  }
}

export type DashboardTileConfig = {
  id: string;
  size: DashboardCardSize;
};

export type DashboardTileDefinition<ModuleKey extends string = string> = DashboardTileConfig & {
  label: string;
  moduleKey?: ModuleKey;
};

export type DashboardVisibilityMap = Record<string, boolean>;


function isMissingDashboardPreferenceTable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string };
  const message = value.message ?? "";
  return (
    (value.code === "PGRST205" || value.code === "42P01") &&
    DASHBOARD_PREFERENCE_TABLES.some((table) => message.includes(table))
  );
}

export function sanitizeDashboardLayout(
  layout: unknown,
  defaults: DashboardTileConfig[],
): DashboardTileConfig[] {
  const parsed = Array.isArray(layout) ? layout : [];
  const allowed = new Set(defaults.map((tile) => tile.id));
  const seen = new Set<string>();
  const sanitized = parsed
    .filter((tile): tile is DashboardTileConfig => {
      if (!tile || typeof tile !== "object") return false;
      const id = (tile as DashboardTileConfig).id;
      return typeof id === "string" && allowed.has(id);
    })
    .filter((tile) => {
      if (seen.has(tile.id)) return false;
      seen.add(tile.id);
      return true;
    })
    .map((tile) => ({ id: tile.id, size: tile.size === "lg" ? "lg" : "sm" as DashboardCardSize }));
  const missing = defaults.filter((tile) => !seen.has(tile.id));
  return [...sanitized, ...missing];
}

export function filterDashboardTileDefinitions<ModuleKey extends string>(
  definitions: DashboardTileDefinition<ModuleKey>[],
  isEnabled: (key: ModuleKey) => boolean,
) {
  return definitions.filter((tile) => !tile.moduleKey || isEnabled(tile.moduleKey));
}

export function visibleDashboardTiles(
  layout: DashboardTileConfig[],
  visibility: DashboardVisibilityMap,
  _editMode: boolean,
) {
  return layout.filter((tile) => visibility[tile.id] !== false);
}

export function hiddenDashboardTiles(
  layout: DashboardTileConfig[],
  visibility: DashboardVisibilityMap,
) {
  return layout.filter((tile) => visibility[tile.id] === false);
}

export async function loadDashboardTileVisibility(userId: string, mode: DashboardModeKey): Promise<DashboardVisibilityMap> {
  const { data, error } = await db("dashboard_tile_visibility")
    .select("tile_id, visible")
    .eq("user_id", userId)
    .eq("mode", mode);
  if (isMissingDashboardPreferenceTable(error)) return {};
  if (error) throw error;
  const rows = (data ?? []) as Array<{ tile_id: string; visible: boolean }>;
  return rows.reduce<DashboardVisibilityMap>((current, row) => {
    current[row.tile_id] = row.visible !== false;
    return current;
  }, {});
}

export async function saveDashboardTileVisibility(
  userId: string,
  mode: DashboardModeKey,
  tileId: string,
  visible: boolean,
) {
  const { error } = await db("dashboard_tile_visibility").upsert(
    {
      user_id: userId,
      mode,
      tile_id: tileId,
      visible,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,mode,tile_id" },
  );
  if (isMissingDashboardPreferenceTable(error)) return;
  if (error) throw error;
}

export async function loadDashboardDeviceLayout(
  userId: string,
  deviceId: string,
  mode: DashboardModeKey,
): Promise<unknown> {
  const { data, error } = await db("dashboard_device_tile_layout")
    .select("layout")
    .eq("user_id", userId)
    .eq("device_id", deviceId)
    .eq("mode", mode)
    .maybeSingle();
  if (isMissingDashboardPreferenceTable(error)) return undefined;
  if (error) throw error;
  return data?.layout;
}

export async function saveDashboardDeviceLayout(
  userId: string,
  deviceId: string,
  mode: DashboardModeKey,
  layout: DashboardTileConfig[],
) {
  const { error } = await db("dashboard_device_tile_layout").upsert(
    {
      user_id: userId,
      device_id: deviceId,
      mode,
      layout,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,device_id,mode" },
  );
  if (isMissingDashboardPreferenceTable(error)) return;
  if (error) throw error;
}
