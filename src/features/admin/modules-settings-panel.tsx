// Settings > Modules: which feature modules are enabled and pinned to the toolbar.
import { Star } from "lucide-react";
import { MAX_TOOLBAR_MODULES, useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
import { NAVIGATION } from "@/lib/wms-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFrame } from "@/features/shared/resource-forms";
import { Switch } from "@/components/ui/switch";

const MODULE_GROUPS: { label: string; keys: ModuleKey[] }[] = [
  {
    label: "Workspace",
    keys: ["dashboard", "copilot"],
  },
  {
    label: "Core Operations",
    keys: ["receiving", "putaway", "inventory", "pick-lists", "location-moves", "transfers"],
  },
  {
    label: "Master Data",
    keys: ["products", "warehouses", "zones", "locations", "users", "settings", "clients", "packaging"],
  },
  {
    label: "Advanced",
    keys: ["cycle-counts", "reports", "status", "system-log", "email-log"],
  },
];

export function ModulesSettingsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { flags, toolbarModules, isToolbarModule, setModule, setToolbarModule, resetToStarter } = useFeatureFlags();

  return (
    <Card className="flex h-full min-w-0 flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 space-y-0 px-4 py-3">
        <div className="min-w-0 flex-1 basis-64">
          <CardTitle>Module Visibility</CardTitle>
          <CardDescription>
            Hide modules that aren't needed for your operation. Star up to {MAX_TOOLBAR_MODULES} modules for personal shortcuts. Dashboard is always available, but its shortcut is optional. Copilot is available to every role that can access Settings when enabled.
            {!isAdmin && " Only administrators can change module visibility; your shortcut stars are personal."}
          </CardDescription>
        </div>
        {isAdmin && (
          <Button size="sm" variant="outline" onClick={resetToStarter}>
            Reset to Starter defaults
          </Button>
        )}
      </CardHeader>
      <CardContent className="min-h-16 flex-1 p-0">
        <TableFrame className="h-full min-h-0 rounded-none border-t border-border">
          <Table className="min-w-[520px]">
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Module</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-24 text-center">Shortcut</TableHead>
                <TableHead className="w-24 text-center">Visible</TableHead>
              </TableRow>
            </TableHeader>
            {MODULE_GROUPS.map((group) => (
              <TableBody key={group.label}>
                <TableRow className="bg-muted/50">
                  <TableCell colSpan={4} className="px-2 py-1 text-xs font-semibold text-muted-foreground">{group.label}</TableCell>
                </TableRow>
                {group.keys.map((key) => {
                  const meta = MODULE_LABELS[key];
                  const enabled = flags[key] ?? STARTER_MODULES[key];
                  const pinned = isToolbarModule(key);
                  const hasToolbarDestination = key === "copilot" || NAVIGATION.some((item) => item.moduleKey === key);
                  const toolbarDisabled = !hasToolbarDestination || (!pinned && (!enabled || toolbarModules.length >= MAX_TOOLBAR_MODULES));
                  return (
                    <TableRow key={key}>
                      <TableCell className="whitespace-nowrap py-1 font-medium">{meta.label}</TableCell>
                      <TableCell className="py-1 text-xs text-muted-foreground">{meta.description}</TableCell>
                      <TableCell className="py-1 text-center">
                        <Button
                          type="button"
                          size="icon"
                          variant={pinned ? "secondary" : "ghost"}
                          className="h-7 w-7"
                          aria-pressed={pinned}
                          disabled={toolbarDisabled}
                          onClick={() => setToolbarModule(key, !pinned)}
                          title={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                          aria-label={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                        >
                          <Star className={cn("h-4 w-4", pinned && "fill-current")} />
                        </Button>
                      </TableCell>
                      <TableCell className="py-1 text-center">
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => setModule(key, v)}
                          disabled={!isAdmin || key === "dashboard"}
                          aria-label={`Toggle ${meta.label}`}
                          title={key === "dashboard" ? "Dashboard is always enabled" : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            ))}
          </Table>
        </TableFrame>
      </CardContent>
    </Card>
  );
}
