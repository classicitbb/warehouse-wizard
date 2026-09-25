// Warehouse structure tree: warehouse, zone, bay, level and position rows.
import { useMemo, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { z } from "zod";
import { AlertTriangle, Building2, Boxes, ChevronRight, Layers, LayoutGrid, MapPin, MoreHorizontal, Pencil, Plus, Printer, PackageSearch, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { deleteLocationCascade, deleteWarehouseCascade, deleteZoneCascade, displayRackLocationCode, bayCodeFromLocationCode } from "@/lib/wms-core";
import { LocationLabelPage } from "@/components/location-label-page";
import { ZoneLabelPage } from "@/components/zone-label-page";
import { BayLocationCodesPrintDialog, type LabelSheetItem } from "@/components/label-sheet-print";
import { type BayGroup, type LevelGroup, type LocationRow, type WarehouseRow, type ZoneRow, combineFillStats, escapeHtml, fetchZoneLocations, groupIntoTree, locationFillStats, prefixedCode } from "@/components/warehouse-tree/tree-data";
import { FillBar, TREE_CONTEXT_HINT, TreeRowFlyout, TreeRowFlyoutItem, useTCtx } from "@/components/warehouse-tree/tree-context";

// ─── Visual constants ─────────────────────────────────────────────────────────

const STATUS_CLS: Record<string, string> = {
  blocked: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  disabled: "bg-muted text-muted-foreground",
};

const TEMP_CLS: Record<string, string> = {
  cool: "text-blue-600 border-blue-300 dark:text-blue-400",
  frozen: "text-violet-600 border-violet-300 dark:text-violet-400",
};

const TEMP_LABEL: Record<string, string> = { cool: "Cool", frozen: "Frozen" };

// ─── Node components ──────────────────────────────────────────────────────────

/** RACK-BAY-LEVEL prefix for a location code — the scope of one level row. */
function levelPrefixFromLocationCode(code: string | null | undefined): string {
  const display = displayRackLocationCode(code);
  return display ? display.replace(/-P\d+$/i, "") : "";
}

function PositionNode({ location, nodeKey }: { location: LocationRow; nodeKey: string }) {
  const { activeTreeNodeKey, fillStats, selectTreeNode, setDialog, viewContents } = useTCtx();
  const displayCode = displayRackLocationCode(location.code);
  const showContents = () => viewContents({ node: "location", locationPrefix: displayCode, warehouseId: location.warehouse_id });
  const locationDisabled = location.status != null && location.status !== "active";
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-location", location }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { showContents(); close(); }}>
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem
            destructive
            onSelect={() => {
              setDialog({
                type: "delete",
                label: `location "${location.code}"`,
                deleteFn: () => deleteLocationCascade(location.id),
              });
              close();
            }}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
          </TreeRowFlyoutItem>
        </>
      )}
    >
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-9 items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
      <span className="h-3.5 w-3.5 shrink-0" />
      <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
      <span className="flex-1 truncate font-mono text-xs">{displayCode}</span>
      <FillBar stats={fillStats.byLocation.get(location.id) ?? locationFillStats(location)} disabled={locationDisabled} />
      {location.status && location.status !== "active" && (
        <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", STATUS_CLS[location.status])}>
          {location.status}
        </Badge>
      )}
      <div className="flex shrink-0 items-center gap-0.5 ">
        <LocationLabelPage
          code={location.code}
          aisle={location.aisle}
          bay={location.bay}
          level={location.level}
          locationType={location.location_type}
          temperatureClass={location.temperature_class ?? undefined}
          trigger={
            <Button variant="ghost" size="icon" className="h-7 w-7">
              <Printer className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={`Location actions — ${displayCode}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onSelect={() => setDialog({ type: "edit-location", location })}>
              <Pencil className="mr-2 h-3.5 w-3.5" />Edit
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={showContents}>
              <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() =>
                setDialog({
                  type: "delete",
                  label: `location "${location.code}"`,
                  deleteFn: () => deleteLocationCascade(location.id),
                })
              }
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
        </div>
    </TreeRowFlyout>
  );
}

function LevelNode({ levelGroup, nodeKey, bayItems }: { levelGroup: LevelGroup; nodeKey: string; bayItems: LabelSheetItem[] }) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const [printOpen, setPrintOpen] = useState(false);
  const stats = combineFillStats(levelGroup.positions, fillStats.byLocation);
  const firstLevelLocation = levelGroup.positions[0];
  // Level scope = the RACK-BAY-LEVEL prefix every position on this level shares.
  const levelPrefix = levelPrefixFromLocationCode(firstLevelLocation?.code);
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem
            disabled={!levelPrefix}
            onSelect={() => {
              viewContents({ node: "level", locationPrefix: levelPrefix, warehouseId: firstLevelLocation?.warehouse_id });
              close();
            }}
          >
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print parent bay label
          </TreeRowFlyoutItem>
        </>
      )}
    >
      <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
        <CollapsibleTrigger asChild>
            <div
              data-tree-key={nodeKey}
              tabIndex={-1}
              title={TREE_CONTEXT_HINT}
              className={cn(
                "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
                activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
              )}
              onClick={() => selectTreeNode(nodeKey)}
            >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Level {levelGroup.displayLevel}</span>
          <FillBar stats={stats} />
          <span className="mr-1 text-xs text-muted-foreground">{levelGroup.positions.length}</span>
            </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 border-l border-border pl-2">
            {levelGroup.positions.map((loc) => (
              <PositionNode key={loc.id} location={loc} nodeKey={`${nodeKey}:p${loc.id}`} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <BayLocationCodesPrintDialog items={bayItems} open={printOpen} onOpenChange={setPrintOpen} />
    </TreeRowFlyout>
  );
}

function BayNode({
  bayGroup, nodeKey, zone, warehouseName, aisle,
}: {
  bayGroup: BayGroup;
  nodeKey: string;
  zone: ZoneRow;
  warehouseName: string;
  aisle: string;
}) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const [printOpen, setPrintOpen] = useState(false);
  const total = bayGroup.levels.reduce((s, l) => s + l.positions.length, 0);
  const stats = combineFillStats(bayGroup.levels.flatMap((level) => level.positions), fillStats.byLocation);
  const firstLocation = bayGroup.levels.flatMap((level) => level.positions)[0];
  const bayCode = bayCodeFromLocationCode(firstLocation?.code) ?? "";
  const bayItems = useMemo<LabelSheetItem[]>(
    () => bayCode ? [{
      code: bayCode,
      title: `Aisle ${aisle} · Bay ${bayGroup.bay}`,
      subtitle: `${zone.name} · ${warehouseName}`,
      aisle,
      bay: bayGroup.bay,
      temperatureClass: zone.temperature_class,
    }] : [],
    [aisle, bayCode, bayGroup.bay, warehouseName, zone.name, zone.temperature_class],
  );
  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem
            disabled={!bayCode}
            onSelect={() => {
              viewContents({ node: "bay", locationPrefix: bayCode, warehouseId: zone.warehouse_id });
              close();
            }}
          >
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print bay label
          </TreeRowFlyoutItem>
        </>
      )}
    >
      <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
        <CollapsibleTrigger asChild>
            <div
              data-tree-key={nodeKey}
              tabIndex={-1}
              title={TREE_CONTEXT_HINT}
              className={cn(
                "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
                activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
              )}
              onClick={() => selectTreeNode(nodeKey)}
            >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-xs">Bay {bayGroup.bay}</span>
          <FillBar stats={stats} />
          <span className="mr-1 text-xs text-muted-foreground">{total}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            disabled={bayItems.length === 0}
            title="Print bay code"
            onClick={(event) => {
              event.stopPropagation();
              setPrintOpen(true);
            }}
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>
            </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-4 border-l border-border pl-2">
            {bayGroup.levels.map((lg) => (
              <LevelNode key={lg.level} levelGroup={lg} bayItems={bayItems} nodeKey={`${nodeKey}:l${lg.level}`} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
      <BayLocationCodesPrintDialog items={bayItems} open={printOpen} onOpenChange={setPrintOpen} />
    </TreeRowFlyout>
  );
}

function ZoneNode({
  zone, warehouseName, warehouseCode, nodeKey,
}: {
  zone: ZoneRow;
  warehouseName: string;
  warehouseCode: string;
  nodeKey: string;
}) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, setDialog, toggleNode, viewContents } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const zoneLabelCode = prefixedCode(warehouseCode, zone.code);
  const showZoneContents = () => viewContents({ node: "rack", zoneCode: zone.code, warehouseId: zone.warehouse_id });
  const [wizardOpen, setWizardOpen] = useState(false);
  const [printBaysOpen, setPrintBaysOpen] = useState(false);

  const { data: rawLocations = [], isLoading } = useQuery({
    queryKey: ["tree", "locations", zone.id],
    queryFn: () => fetchZoneLocations(zone.id),
    enabled: isOpen,
    staleTime: 60_000,
  });

  const isTruncated = rawLocations.length > 200;
  const aisleGroups = useMemo(
    () => groupIntoTree(isTruncated ? rawLocations.slice(0, 200) : rawLocations),
    [rawLocations, isTruncated],
  );
  const bayItems = useMemo<LabelSheetItem[]>(
    () => aisleGroups.flatMap((aisleGroup) => aisleGroup.bays.flatMap((bayGroup) => {
      const firstLocation = bayGroup.levels.flatMap((level) => level.positions)[0];
      const bayCode = bayCodeFromLocationCode(firstLocation?.code) ?? "";
      return bayCode ? [{
        code: bayCode,
        title: `Bay ${bayGroup.bay}`,
        subtitle: `${zone.name} · ${warehouseName}`,
        aisle: aisleGroup.aisle,
        bay: bayGroup.bay,
        temperatureClass: zone.temperature_class,
      }] : [];
    })),
    [aisleGroups, warehouseName, zone.name, zone.temperature_class],
  );

  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-zone", zone, warehouseName }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Zone
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { showZoneContents(); close(); }}>
            <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "wizard-zone", warehouseId: zone.warehouse_id, zoneId: zone.id, zoneCode: zone.code }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Locations
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-range", zone }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Location Range
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem disabled={bayItems.length === 0} onSelect={() => { setPrintBaysOpen(true); close(); }}>
            <Printer className="mr-2 h-3.5 w-3.5" />Print all bay labels
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem destructive onSelect={() => { setDialog({ type: "delete", label: `zone "${zone.name}" and all its locations`, deleteFn: () => deleteZoneCascade(zone.id) }); close(); }}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Zone
          </TreeRowFlyoutItem>
        </>
      )}
    >
    <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
      <CollapsibleTrigger asChild>
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-9 cursor-pointer items-center gap-1 rounded-sm px-1 text-sm outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
          <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Boxes className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate font-medium">{zone.name}</span>
          <FillBar stats={fillStats.byZone.get(zone.id)} />
          <span className="shrink-0 text-xs text-muted-foreground">{zone.code}</span>
          {TEMP_CLS[zone.temperature_class] && (
            <Badge variant="outline" className={cn("h-4 shrink-0 px-1 text-[10px]", TEMP_CLS[zone.temperature_class])}>
              {TEMP_LABEL[zone.temperature_class]}
            </Badge>
          )}
          {zone.is_staging && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Staging</Badge>}
          {zone.is_dispatch && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Dispatch</Badge>}
          {zone.is_quarantine && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[10px]">Quarantine</Badge>}
          <div className="flex shrink-0 items-center gap-0.5 ">
            <ZoneLabelPage
              code={zoneLabelCode}
              name={zone.name}
              warehouseName={warehouseName}
              temperatureClass={zone.temperature_class}
              isStaging={zone.is_staging ?? false}
              isDispatch={zone.is_dispatch ?? false}
              isQuarantine={zone.is_quarantine ?? false}
              trigger={
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                  <Printer className="h-3.5 w-3.5" />
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Zone actions — ${zone.code}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-zone", zone, warehouseName })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Zone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={showZoneContents}>
                  <PackageSearch className="mr-2 h-3.5 w-3.5" />View Contents
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setDialog({
                      type: "wizard-zone",
                      warehouseId: zone.warehouse_id,
                      zoneId: zone.id,
                      zoneCode: zone.code,
                    })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Locations
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-range", zone })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Location Range
                </DropdownMenuItem>
                <DropdownMenuItem disabled={bayItems.length === 0} onSelect={() => setPrintBaysOpen(true)}>
                  <Printer className="mr-2 h-3.5 w-3.5" />Print all bay labels
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    setDialog({
                      type: "delete",
                      label: `zone "${zone.name}" and all its locations`,
                      deleteFn: () => deleteZoneCascade(zone.id),
                    })
                  }
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Zone
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 border-l border-border pl-2">
          {isLoading ? (
            <>
              <Skeleton className="my-1 h-6 w-full" />
              <Skeleton className="my-1 h-6 w-3/4" />
              <Skeleton className="my-1 h-6 w-5/6" />
            </>
          ) : aisleGroups.length === 0 ? (
            <p className="px-1 py-2 text-xs italic text-muted-foreground">No locations</p>
          ) : (
            <>
              {isTruncated && (
                <p className="my-1 rounded-sm bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-400">
                  Showing 200 of {rawLocations.length}+ — use Bin Locations for bulk management.
                </p>
              )}
              {aisleGroups.flatMap((aisleGroup) => aisleGroup.bays.map((bayGroup) => (
                <BayNode
                  key={`${aisleGroup.aisle}:${bayGroup.bay}`}
                  bayGroup={bayGroup}
                  nodeKey={`${nodeKey}:a${aisleGroup.aisle}:b${bayGroup.bay}`}
                  zone={zone}
                  warehouseName={warehouseName}
                  aisle={aisleGroup.aisle}
                />
              )))}
            </>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
    <BayLocationCodesPrintDialog items={bayItems} open={printBaysOpen} onOpenChange={setPrintBaysOpen} />
    </TreeRowFlyout>
  );
}

function WarehouseLabelPage({
  warehouse,
  trigger,
}: {
  warehouse: WarehouseRow;
  trigger: React.ReactNode;
}) {
  const code = String(warehouse.code ?? "");
  const name = String(warehouse.name ?? code);

  function handlePrint() {
    if (!code) return;
    const qr = renderToStaticMarkup(<QRCodeSVG value={code} size={512} bgColor="#ffffff" fgColor="#000000" level="H" />);
    const win = window.open("", "_blank", "width=520,height=720");
    if (!win) return;
    win.document.write(`<!DOCTYPE html>
<html>
<head>
  <title>Warehouse Label - ${escapeHtml(name)}</title>
  <meta charset="utf-8" />
  <style>
    @page { size: 4in 6in portrait; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #000; font-family: system-ui, -apple-system, sans-serif; }
    .label { width: 4in; height: 6in; border: 1px solid #000; display: grid; grid-template-rows: 1fr auto; align-items: center; justify-items: center; gap: 0.08in; padding: 5px; overflow: hidden; text-align: center; }
    .qr { width: 100%; min-height: 0; display: flex; align-items: center; justify-content: center; }
    .qr svg { width: min(3.86in, 100%); height: min(3.86in, 100%); }
    .code { width: 100%; font-family: 'Arial Black', system-ui, sans-serif; font-size: 34pt; font-weight: 900; line-height: 1; overflow-wrap: anywhere; }
  </style>
</head>
<body>
  <section class="label">
    <div class="qr">${qr}</div>
    <div class="code">${escapeHtml(code)}</div>
  </section>
  <script>window.onload=()=>{window.print();window.close();}</script>
</body>
</html>`);
    win.document.close();
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Warehouse Label - {code}</DialogTitle>
          <DialogDescription>4 x 6 in Zebra label preview.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto grid aspect-[2/3] w-full max-w-[280px] grid-rows-[1fr_auto] items-center justify-items-center gap-1 border border-black bg-white p-[5px] text-center text-black">
          <div className="flex min-h-0 w-full items-center justify-center">
            <QRCodeSVG value={code} size={255} bgColor="#ffffff" fgColor="#000000" level="H" />
          </div>
          <p className="w-full break-words text-4xl font-black leading-none">{code}</p>
        </div>
        <DialogFooter>
          <Button onClick={handlePrint} className="w-full">
            <Printer className="mr-2 h-4 w-4" />
            Print Warehouse Label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WarehouseNode({ warehouse, nodeKey }: { warehouse: WarehouseRow; nodeKey: string }) {
  const { activeTreeNodeKey, expandedNodes, fillStats, selectTreeNode, toggleNode, setDialog, zones } = useTCtx();
  const isOpen = expandedNodes.has(nodeKey);
  const warehouseDisabled = warehouse.active === false;

  const warehouseZones = useMemo(
    () => zones.filter((z) => z.warehouse_id === warehouse.id),
    [zones, warehouse.id],
  );

  return (
    <TreeRowFlyout
      nodeKey={nodeKey}
      menu={(close) => (
        <>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "edit-warehouse", warehouse }); close(); }}>
            <Pencil className="mr-2 h-3.5 w-3.5" />Edit Warehouse
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "add-warehouse" }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Warehouse
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "add-zone", warehouseId: warehouse.id, warehouseName: warehouse.name }); close(); }}>
            <Plus className="mr-2 h-3.5 w-3.5" />Add Zone
          </TreeRowFlyoutItem>
          <TreeRowFlyoutItem onSelect={() => { setDialog({ type: "reorder-settings" }); close(); }}>
            <AlertTriangle className="mr-2 h-3.5 w-3.5" />Reorder Settings
          </TreeRowFlyoutItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <TreeRowFlyoutItem destructive onSelect={() => { setDialog({ type: "delete", label: `warehouse "${warehouse.name}" and all its zones and locations`, deleteFn: () => deleteWarehouseCascade(warehouse.id) }); close(); }}>
            <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Warehouse
          </TreeRowFlyoutItem>
        </>
      )}
    >
    <Collapsible open={isOpen} onOpenChange={() => toggleNode(nodeKey)}>
      <CollapsibleTrigger asChild>
        <div
          data-tree-key={nodeKey}
          tabIndex={-1}
          title={TREE_CONTEXT_HINT}
          className={cn(
            "group flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-sm font-medium outline-none transition-shadow hover:bg-accent hover:text-accent-foreground",
            activeTreeNodeKey === nodeKey && "bg-amber-400 text-amber-950 hover:bg-amber-400 hover:text-amber-950",
          )}
          onClick={() => selectTreeNode(nodeKey)}
        >
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-90")} />
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate">{warehouse.name}</span>
          <FillBar stats={fillStats.byWarehouse.get(warehouse.id)} disabled={warehouseDisabled} />
          <span className="font-mono text-xs text-muted-foreground">{warehouse.code}</span>
          {warehouse.active === false && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">Inactive</Badge>
          )}
          <div className="flex shrink-0 items-center gap-0.5 ">
            <WarehouseLabelPage
              warehouse={warehouse}
              trigger={
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
                  <Printer className="h-4 w-4" />
                </Button>
              }
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  aria-label={`Warehouse actions — ${warehouse.code}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onSelect={() => setDialog({ type: "edit-warehouse", warehouse })}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />Edit Warehouse
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "add-warehouse" })}>
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Warehouse
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    setDialog({ type: "add-zone", warehouseId: warehouse.id, warehouseName: warehouse.name })
                  }
                >
                  <Plus className="mr-2 h-3.5 w-3.5" />Add Zone
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog({ type: "reorder-settings" })}>
                  <AlertTriangle className="mr-2 h-3.5 w-3.5" />Reorder Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() =>
                    setDialog({
                      type: "delete",
                      label: `warehouse "${warehouse.name}" and all its zones and locations`,
                      deleteFn: () => deleteWarehouseCascade(warehouse.id),
                    })
                  }
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />Delete Warehouse
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-5 border-l border-border pl-2">
          {warehouseZones.length === 0 ? (
            <p className="px-1 py-2 text-xs italic text-muted-foreground">No zones</p>
          ) : (
            warehouseZones.map((zone) => (
              <ZoneNode
                key={zone.id}
                zone={zone}
                warehouseName={warehouse.name}
                warehouseCode={warehouse.code}
                nodeKey={`${nodeKey}:z${zone.id}`}
              />
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
    </TreeRowFlyout>
  );
}
