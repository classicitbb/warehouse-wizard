import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BarChart3, Boxes, Forklift, Lock, LockOpen, Maximize2, Minimize2, Truck } from "lucide-react";

import { HintButton } from "@/components/hint-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PalletPakDesigner } from "@/features/dashboard/pallet-pak-designer";
import { useAuth } from "@/hooks/use-auth";
import { canAccessCopilot, useFeatureFlags, type ModuleKey } from "@/hooks/use-feature-flags";
import { useFeaturePermission } from "@/hooks/use-feature-permission";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { supabase } from "@/integrations/supabase/client";
import { getOrCreateDeviceId } from "@/lib/device-identity";
import { buildEnterpriseDashboard, type DashboardMode } from "@/lib/enterprise-wms";
import { cn } from "@/lib/utils";
import { getDashboardMetrics, getReportData } from "@/lib/wms-core";
import type { BoardMode } from "./board-layout";
import { BOARD_TILES, type BoardData } from "./board-tiles";
import { DashboardBoard } from "./dashboard-board";
import { useBoardLayout } from "./use-board-layout";

function CommandCenterBoard({ mode, data, editMode, isTileEnabled, profileId, deviceId }: {
  mode: BoardMode;
  data: BoardData;
  editMode: boolean;
  isTileEnabled: (key: ModuleKey) => boolean;
  profileId: string | undefined;
  deviceId: string;
}) {
  const tiles = useMemo(
    () => BOARD_TILES[mode].filter((tile) => !tile.moduleKey || isTileEnabled(tile.moduleKey)),
    [isTileEnabled, mode],
  );
  const board = useBoardLayout(mode, tiles, profileId, deviceId);
  const hiddenIds = useMemo(() => new Set(board.hiddenSpecs.map((spec) => spec.id)), [board.hiddenSpecs]);
  const hiddenTiles = useMemo(() => tiles.filter((tile) => hiddenIds.has(tile.id)), [hiddenIds, tiles]);

  return (
    <DashboardBoard
      tiles={tiles}
      layout={board.layout}
      visibleIds={board.visibleIds}
      hiddenTiles={hiddenTiles}
      data={data}
      editMode={editMode}
      onLayoutChange={board.saveLayout}
      onHide={board.hide}
      onRestore={board.restore}
      onReset={board.reset}
    />
  );
}

export function DashboardPage() {
  const { profile, roles } = useAuth();
  const { toPath } = useTenantPath();
  const { flags, isEnabled } = useFeatureFlags();
  const [mode, setMode] = useState<DashboardMode>("floor");
  // Gated on the stored release switch rather than a role literal, so
  // releasing the designer never means editing this file.
  const packDesignerPermission = useFeaturePermission("pack_designer");
  const canSeeDesigner = packDesignerPermission.canView;
  useEffect(() => {
    // An admin can revoke the grant mid-session; without this the tab strip
    // is left with no active trigger.
    if (mode === "packing" && !canSeeDesigner && !packDesignerPermission.isLoading) setMode("floor");
  }, [mode, canSeeDesigner, packDesignerPermission.isLoading]);
  const [editMode, setEditMode] = useState(false);
  const deviceId = useMemo(() => (typeof window === "undefined" ? "server-render-device" : getOrCreateDeviceId()), []);
  const hasCopilotAccess = canAccessCopilot(roles);
  const isTileEnabled = useCallback(
    (key: ModuleKey) => isEnabled(key) && (key !== "copilot" || hasCopilotAccess),
    [hasCopilotAccess, isEnabled],
  );
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [simulatedFullscreen, setSimulatedFullscreen] = useState(false);
  const [fitToScreen, setFitToScreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === dashboardRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // Mobile/tablet browsers (notably iOS Safari) lack the Fullscreen API —
    // fall back to a fixed-position immersive view so the button works everywhere.
    const fullscreenSupported =
      typeof document !== "undefined" && document.fullscreenEnabled && dashboardRef.current?.requestFullscreen;
    if (!fullscreenSupported) {
      setSimulatedFullscreen((value) => !value);
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (dashboardRef.current) {
        await dashboardRef.current.requestFullscreen();
      }
    } catch {
      setSimulatedFullscreen((value) => !value);
    }
  }, []);

  const immersiveMode = isFullscreen || simulatedFullscreen;

  const { data: metrics, isLoading } = useQuery({
    // Key intentionally excludes feature flags so the sidebar counters and the
    // Command Center share a single fetch of the server-side summary.
    queryKey: ["dashboard-metrics", profile?.default_warehouse_id ?? null],
    queryFn: () => getDashboardMetrics(profile?.default_warehouse_id, flags),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const { data: reorderAlerts = [] } = useQuery({
    queryKey: ["reorder-alerts", "command-center"],
    queryFn: async () => {
      const { data, error } = await (supabase.from as any)("reorder_alerts")
        .select("id")
        .eq("status", "active");
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const { data: reports } = useQuery({
    queryKey: ["reports", "enterprise-dashboard", profile?.default_warehouse_id],
    queryFn: () => getReportData({ warehouseId: profile?.default_warehouse_id }),
    staleTime: 60_000,
  });
  const snapshot = useMemo(() => buildEnterpriseDashboard(metrics, reports), [metrics, reports]);
  const boardData = useMemo<BoardData>(
    () => ({ snapshot, metrics, isLoading, isEnabled: isTileEnabled }),
    [isLoading, isTileEnabled, metrics, snapshot],
  );

  return (
    <div
      ref={dashboardRef}
      className={cn(
        "cc-grid-bg flex min-h-0 flex-col gap-6 overflow-y-auto overflow-x-hidden lg:h-full lg:gap-3",
        (immersiveMode || fitToScreen) && "h-screen overflow-auto bg-background p-4",
        simulatedFullscreen && "fixed inset-0 z-50",
      )}
    >
      <div className="flex shrink-0 flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold tracking-tight">Command Center</h2>
          <HintButton label="Command Center guidance" buttonClassName="text-muted-foreground">
            Live warehouse metrics. Unlock the layout to move, resize, hide, or add tiles. Tiles always grow to fit what they show.
          </HintButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={mode} onValueChange={(value) => setMode(value as DashboardMode)}>
            <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit sm:grid-cols-5">
              <TabsTrigger value="floor" className="gap-1.5"><Forklift className="h-3.5 w-3.5" /> Floor</TabsTrigger>
              <TabsTrigger value="dock" className="gap-1.5"><Truck className="h-3.5 w-3.5" /> Dock</TabsTrigger>
              <TabsTrigger value="office" className="gap-1.5"><BarChart3 className="h-3.5 w-3.5" /> Office</TabsTrigger>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-flex">
                    <TabsTrigger value="3d" disabled className="gap-1.5 opacity-60"><Lock className="h-3.5 w-3.5" /> 3D</TabsTrigger>
                  </span>
                </TooltipTrigger>
                <TooltipContent>3D warehouse view — coming soon</TooltipContent>
              </Tooltip>
              {canSeeDesigner ? (
                <TabsTrigger value="packing" className="gap-1.5"><Boxes className="h-3.5 w-3.5" /> Packing</TabsTrigger>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex">
                      <TabsTrigger value="packing" disabled className="gap-1.5 opacity-60"><Lock className="h-3.5 w-3.5" /> Packing</TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Pallet Pak Designer — not released yet</TooltipContent>
                </Tooltip>
              )}
            </TabsList>
          </Tabs>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={editMode ? "secondary" : "outline"}
                onClick={() => setEditMode((value) => !value)}
                aria-label={editMode ? "Lock dashboard layout" : "Unlock dashboard layout"}
                aria-pressed={editMode}
              >
                {editMode ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{editMode ? "Lock dashboard layout" : "Unlock dashboard layout"}</TooltipContent>
          </Tooltip>
          <div className="hidden items-center gap-2 sm:flex">
            <Button size="sm" variant="outline" onClick={() => setFitToScreen((v) => !v)} aria-pressed={fitToScreen}>
              {fitToScreen ? "Reset fit" : "Fit to screen"}
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen} aria-label={immersiveMode ? "Exit fullscreen" : "Enter fullscreen"} aria-pressed={immersiveMode}>
              {immersiveMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {reorderAlerts.length > 0 ? (
        <Card className="shrink-0 border-2 border-amber-500 bg-amber-100 shadow-sm dark:border-amber-500 dark:bg-amber-950/50">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" />
              <span className="font-semibold text-amber-900 dark:text-amber-100">{reorderAlerts.length} active reorder alert{reorderAlerts.length === 1 ? "" : "s"}</span>
              <span className="text-sm text-amber-800/90 dark:text-amber-200/80">Forecasts use completed outbound picks and supplier lead time.</span>
            </div>
            <Button asChild size="sm" variant="default" className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700">
              <Link to={toPath("/products")}>View products</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "floor" || mode === "dock" || mode === "office" ? (
          <CommandCenterBoard
            key={mode}
            mode={mode}
            data={boardData}
            editMode={editMode}
            isTileEnabled={isTileEnabled}
            profileId={profile?.id}
            deviceId={deviceId}
          />
        ) : null}
        {mode === "packing" && canSeeDesigner ? <PalletPakDesigner /> : null}
      </div>
    </div>
  );
}
