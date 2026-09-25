import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { Building2, ChevronsDownUp, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { displayRackLocationCode, bayCodeFromLocationCode } from "@/lib/wms-core";
import { LocationWizardDialog } from "@/features/shared/location-wizard";
import { ReorderForecastSettingsPanel } from "@/features/shared/reorder-forecast-settings";
import { type ActiveDialog, TreeCtx, type TreeCtxValue } from "@/components/warehouse-tree/tree-context";
import { type TreeSearchLocation, type WarehouseRow, type ZoneRow, fetchLocationFillStats, fetchTreeSearchLocations, normalizeTreeSearch, scrollToTreeNodeWhenReady } from "@/components/warehouse-tree/tree-data";
import { WarehouseNode } from "@/components/warehouse-tree/tree-nodes";
import { AddEditWarehouseDialog, AddEditZoneDialog, ConfirmDeleteDialog } from "@/components/warehouse-tree/entity-dialogs";
import { EditLocationDialog, EditLocationRangeDialog } from "@/components/warehouse-tree/location-dialogs";

// ─── Main export ──────────────────────────────────────────────────────────────

export function WarehouseStructureTab() {
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const { profile, roles } = useAuth();

  const LS_KEY = "wms-tree-expanded";
  const activeWarehouseId = profile?.default_warehouse_id;

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set<string>();
  });

  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<ActiveDialog>(null);
  const [activeTreeNodeKey, setActiveTreeNodeKey] = useState<string | null>(null);

  const toggleNode = useCallback((key: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const { data: warehouses = [], isLoading: wLoading } = useQuery({
    queryKey: ["tree", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, code, name, city, country, has_cool_zone, active")
        .order("code");
      if (error) throw error;
      return (data ?? []) as WarehouseRow[];
    },
  });

  const { data: zones = [], isLoading: zLoading } = useQuery({
    queryKey: ["tree", "zones"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("zones")
        .select("id, code, name, warehouse_id, temperature_class, is_staging, is_dispatch, is_quarantine")
        .eq("is_hidden", false)
        .order("code");
      if (error) throw error;
      return (data ?? []) as ZoneRow[];
    },
  });

  const { data: fillStats = { byWarehouse: new Map(), byZone: new Map(), byLocation: new Map() }, isLoading: fillLoading } = useQuery({
    queryKey: ["tree", "fill-stats"],
    queryFn: fetchLocationFillStats,
    staleTime: 30_000,
  });

  // Only loaded once the operator actually searches — the full location list
  // is a heavy read and the tree itself renders zone by zone on expand.
  const { data: searchLocations = [] } = useQuery({
    queryKey: ["tree", "search-locations"],
    queryFn: fetchTreeSearchLocations,
    enabled: normalizeTreeSearch(filter).length > 0,
    staleTime: 60_000,
  });


  // Settings opens on Warehouse Structure, so expose the top-level layout
  // immediately instead of making operators rediscover each warehouse.
  const hasAutoExpandedRef = useRef(false);
  useEffect(() => {
    if (hasAutoExpandedRef.current) return;
    if (warehouses.length === 0) return;
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      for (const warehouse of warehouses) next.add(`w${warehouse.id}`);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    hasAutoExpandedRef.current = true;
  }, [warehouses]);

  const isLoading = wLoading || zLoading || fillLoading;

  const zonesById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);
  const warehousesById = useMemo(() => new Map(warehouses.map((warehouse) => [warehouse.id, warehouse])), [warehouses]);

  const filteredWarehouses = useMemo(() => {
    const normalized = normalizeTreeSearch(filter);
    if (!normalized) return warehouses;
    const warehouseIds = new Set<string>();

    for (const warehouse of warehouses) {
      if ([warehouse.code, warehouse.name, warehouse.city, warehouse.country].some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(warehouse.id);
      }
    }

    for (const zone of zones) {
      if ([zone.code, zone.name].some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(zone.warehouse_id);
      }
    }

    for (const location of searchLocations) {
      const warehouse = warehousesById.get(location.warehouse_id);
      const zone = zonesById.get(location.zone_id);
      const tokens = [
        location.code,
        displayRackLocationCode(location.code),
        bayCodeFromLocationCode(location.code),
        location.aisle,
        location.bay,
        location.level,
        location.position,
        warehouse?.code,
        warehouse?.name,
        zone?.code,
        zone?.name,
        warehouse && zone && location.aisle && location.bay ? `${warehouse.code}-${zone.code}-${location.aisle}-${location.bay}` : "",
        location.aisle && location.bay ? `${location.aisle}-${location.bay}` : "",
      ];
      if (tokens.some((value) => normalizeTreeSearch(value).includes(normalized))) {
        warehouseIds.add(location.warehouse_id);
      }
    }

    return warehouses.filter((warehouse) => warehouseIds.has(warehouse.id));
  }, [filter, searchLocations, warehouses, warehousesById, zones, zonesById]);

  function expandAndTargetLocation(location: TreeSearchLocation, target: "bay" | "location") {
    const warehouseKey = `w${location.warehouse_id}`;
    const zoneKey = `${warehouseKey}:z${location.zone_id}`;
    const aisleKey = `${zoneKey}:a${location.aisle ?? "—"}`;
    const bayKey = `${aisleKey}:b${location.bay ?? "—"}`;
    const levelKey = `${bayKey}:l${location.level != null ? String(location.level) : "—"}`;
    const locationKey = `${levelKey}:p${location.id}`;
    const keys = target === "bay"
      ? [warehouseKey, zoneKey, aisleKey]
      : [warehouseKey, zoneKey, aisleKey, bayKey, levelKey];
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      try { localStorage.setItem(LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    scrollToTreeNodeWhenReady(target === "bay" ? bayKey : locationKey);
  }

  function commitSearch() {
    const normalized = normalizeTreeSearch(filter);
    if (!normalized) return;
    const exactLocation = searchLocations.find((location) =>
      [location.code, displayRackLocationCode(location.code)].some((value) => normalizeTreeSearch(value) === normalized),
    );
    if (exactLocation) {
      expandAndTargetLocation(exactLocation, "location");
      return;
    }

    const exactBay = searchLocations.find((location) => {
      const warehouse = warehousesById.get(location.warehouse_id);
      const zone = zonesById.get(location.zone_id);
      const tokens = [
        bayCodeFromLocationCode(location.code),
        location.aisle && location.bay ? `${location.aisle}-${location.bay}` : "",
        warehouse && zone && location.aisle && location.bay ? `${warehouse.code}-${zone.code}-${location.aisle}-${location.bay}` : "",
        warehouse && zone && location.aisle && location.bay ? `BAY:${warehouse.code}:${zone.code}:${location.aisle}:${location.bay}` : "",
      ];
      return tokens.some((value) => normalizeTreeSearch(value) === normalized);
    });
    if (exactBay) expandAndTargetLocation(exactBay, "bay");
  }
  const viewContents = useCallback<TreeCtxValue["viewContents"]>(
    ({ node, zoneCode, locationPrefix, warehouseId }) => {
      const params = new URLSearchParams();
      if (locationPrefix) params.set("loc", locationPrefix);
      else if (zoneCode) params.set("zone", zoneCode);
      params.set("node", node);
      if (warehouseId) params.set("warehouse", warehouseId);
      navigate(toPath(`/inventory-search?${params.toString()}`));
    },
    [navigate, toPath],
  );

  const ctx = useMemo<TreeCtxValue>(
    () => ({
      expandedNodes,
      toggleNode,
      activeTreeNodeKey,
      selectTreeNode: setActiveTreeNodeKey,
      setDialog,
      warehouses,
      zones,
      navigate,
      viewContents,
      fillStats,
    }),
    [activeTreeNodeKey, expandedNodes, toggleNode, warehouses, zones, navigate, viewContents, fillStats],
  );

  return (
    <TreeCtx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search warehouses…"
              className="h-8 pl-8 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSearch();
                }
              }}
            />
          </div>
          <Button
            variant="ghost" size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setExpandedNodes(new Set())}
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />Collapse all
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="grid gap-1">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : filteredWarehouses.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {filter ? "No warehouses match your search." : "No warehouses configured yet."}
              </p>
            </div>
          ) : (
            <div className="grid gap-0.5">
              {filteredWarehouses.map((wh) => (
                <WarehouseNode key={wh.id} warehouse={wh} nodeKey={`w${wh.id}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {dialog?.type === "add-warehouse" && (
        <AddEditWarehouseDialog onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-warehouse" && (
        <AddEditWarehouseDialog warehouse={dialog.warehouse} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "add-zone" && (
        <AddEditZoneDialog warehouseId={dialog.warehouseId} warehouseName={dialog.warehouseName} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-zone" && (
        <AddEditZoneDialog warehouseId={dialog.zone.warehouse_id} warehouseName={dialog.warehouseName} zone={dialog.zone} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "edit-location" && (
        <EditLocationDialog location={dialog.location} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "wizard-zone" && (
        <LocationWizardDialog
          open
          trigger={null}
          defaultWarehouseId={dialog.warehouseId}
          defaultZoneId={dialog.zoneId}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      )}
      {dialog?.type === "edit-range" && (
        <EditLocationRangeDialog zone={dialog.zone} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === "reorder-settings" && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Reorder Settings</DialogTitle>
              <DialogDescription>Configure forecasting rules for products in this warehouse environment.</DialogDescription>
            </DialogHeader>
            <ReorderForecastSettingsPanel isAdmin={roles.some((role) => ["developer", "admin"].includes(role))} />
          </DialogContent>
        </Dialog>
      )}
      {dialog?.type === "delete" && (
        <ConfirmDeleteDialog label={dialog.label} deleteFn={dialog.deleteFn} onClose={() => setDialog(null)} />
      )}
    </TreeCtx.Provider>
  );
}
