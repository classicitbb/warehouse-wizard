import { supabase } from "@/integrations/supabase/client";

const db = supabase.from.bind(supabase) as (table: string) => any;

export type DashboardModeKey = "floor" | "dock" | "office";
export type DashboardCardSize = "sm" | "lg";

export type DashboardTileConfig = {
  id: string;
  size: DashboardCardSize;
};

export type DashboardTileDefinition<ModuleKey extends string = string> = DashboardTileConfig & {
  label: string;
  moduleKey?: ModuleKey;
};

export type DashboardVisibilityMap = Record<string, boolean>;

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
  if (error) throw error;
}
