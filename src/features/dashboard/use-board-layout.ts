// Loads and saves one Command Center board's layout and hidden tiles.
//
// Layout is saved per user and device (a wall monitor and a tablet arrange the
// same board differently); hidden tiles are saved per user. Both go to
// localStorage first so they survive when the preference tables are absent.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  loadDashboardDeviceLayout,
  loadDashboardTileVisibility,
  saveDashboardDeviceLayout,
  saveDashboardTileVisibility,
  type DashboardVisibilityMap,
} from "@/lib/dashboard-preferences";
import {
  boardStorageKey,
  defaultBoardLayout,
  placeAtBottom,
  sanitizeBoardLayout,
  type BoardItem,
  type BoardMode,
  type BoardTileSpec,
} from "./board-layout";

function readJson(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — the in-memory board still works */
  }
}

export function useBoardLayout(mode: BoardMode, specs: BoardTileSpec[], profileId: string | undefined, deviceId: string) {
  const layoutKey = boardStorageKey(mode, profileId, deviceId);
  const visibilityKey = `${boardStorageKey(mode, profileId, "all-devices")}.visibility`;

  const [layout, setLayout] = useState<BoardItem[]>(() => sanitizeBoardLayout(readJson(layoutKey), specs));
  const [visibility, setVisibility] = useState<DashboardVisibilityMap>(() => (readJson(visibilityKey) as DashboardVisibilityMap) ?? {});

  useEffect(() => {
    let cancelled = false;
    const local = readJson(layoutKey);
    setLayout(sanitizeBoardLayout(local, specs));
    setVisibility((readJson(visibilityKey) as DashboardVisibilityMap) ?? {});
    if (!profileId) return;
    Promise.all([loadDashboardDeviceLayout(profileId, deviceId, mode), loadDashboardTileVisibility(profileId, mode)])
      .then(([remoteLayout, remoteVisibility]) => {
        if (cancelled) return;
        // Layouts saved by the old sortable board have no grid positions; ignore them.
        const isGridLayout = Array.isArray(remoteLayout) && remoteLayout.some((raw) => typeof raw?.x === "number");
        if (isGridLayout) setLayout(sanitizeBoardLayout(remoteLayout, specs));
        setVisibility((current) => ({ ...current, ...remoteVisibility }));
      })
      .catch((error) => console.error("[Command Center] board preferences unavailable:", error));
    return () => {
      cancelled = true;
    };
  }, [deviceId, layoutKey, mode, profileId, specs, visibilityKey]);

  const isVisible = useCallback(
    (spec: BoardTileSpec) => visibility[spec.id] ?? Boolean(spec.placement),
    [visibility],
  );

  const visibleIds = useMemo(() => new Set(specs.filter(isVisible).map((spec) => spec.id)), [isVisible, specs]);
  const hiddenSpecs = useMemo(() => specs.filter((spec) => !isVisible(spec)), [isVisible, specs]);

  // Visibility follows the user across devices but positions do not, so a tile
  // added on another device (or before local storage was cleared) can be
  // visible with no spot in this device's layout. Give it one at the bottom
  // rather than leaving it neither on the board nor in "Add a tile".
  const boardLayout = useMemo(() => {
    const placed = new Set(layout.map((item) => item.i));
    const missing = specs.filter((spec) => visibleIds.has(spec.id) && !placed.has(spec.id));
    if (!missing.length) return layout;
    const completed = layout.filter((item) => visibleIds.has(item.i));
    for (const spec of missing) completed.push(placeAtBottom(completed, spec));
    return [...completed, ...layout.filter((item) => !visibleIds.has(item.i))];
  }, [layout, specs, visibleIds]);

  const saveLayout = useCallback(
    (next: BoardItem[]) => {
      setLayout((current) => {
        // The grid only knows the visible tiles; keep hidden tiles' spots.
        const nextIds = new Set(next.map((item) => item.i));
        const merged = [...next, ...current.filter((item) => !nextIds.has(item.i))];
        writeJson(layoutKey, merged);
        if (profileId) {
          saveDashboardDeviceLayout(profileId, deviceId, mode, merged).catch((error) => {
            console.error("[Command Center] save layout failed:", error);
            toast.error("Dashboard layout could not be saved");
          });
        }
        return merged;
      });
    },
    [deviceId, layoutKey, mode, profileId],
  );

  const setTileVisible = useCallback(
    (id: string, visible: boolean) => {
      setVisibility((current) => {
        const next = { ...current, [id]: visible };
        writeJson(visibilityKey, next);
        return next;
      });
      if (profileId) {
        saveDashboardTileVisibility(profileId, mode, id, visible).catch((error) => {
          console.error("[Command Center] save visibility failed:", error);
          toast.error("Dashboard tile visibility could not be saved");
        });
      }
    },
    [mode, profileId, visibilityKey],
  );

  const hide = useCallback((id: string) => setTileVisible(id, false), [setTileVisible]);

  const restore = useCallback(
    (id: string) => {
      const spec = specs.find((item) => item.id === id);
      if (!spec) return;
      const visibleLayout = boardLayout.filter((item) => visibleIds.has(item.i));
      // Always re-enter at the bottom: its old spot may be taken by now.
      saveLayout([...visibleLayout, placeAtBottom(visibleLayout, spec)]);
      setTileVisible(id, true);
    },
    [boardLayout, saveLayout, setTileVisible, specs, visibleIds],
  );

  const reset = useCallback(() => {
    const defaults = defaultBoardLayout(specs);
    setLayout(defaults);
    writeJson(layoutKey, defaults);
    if (profileId) saveDashboardDeviceLayout(profileId, deviceId, mode, defaults).catch(() => undefined);
    for (const spec of specs) {
      if (visibility[spec.id] !== undefined) setTileVisible(spec.id, Boolean(spec.placement));
    }
  }, [deviceId, layoutKey, mode, profileId, setTileVisible, specs, visibility]);

  return { layout: boardLayout, visibleIds, hiddenSpecs, saveLayout, hide, restore, reset };
}
