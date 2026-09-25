// Settings > Modules: which feature modules are enabled and pinned to the toolbar.
import { Star } from "lucide-react";
import { MAX_TOOLBAR_MODULES, useFeatureFlags, MODULE_LABELS, STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
import { NAVIGATION } from "@/lib/wms-core";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div>
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
        <CardContent className="flex flex-col gap-6">
          {MODULE_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>
              <div className="flex flex-col gap-3">
                {group.keys.map((key) => {
                  const meta = MODULE_LABELS[key];
                  const enabled = flags[key] ?? STARTER_MODULES[key];
                  const pinned = isToolbarModule(key);
                  const hasToolbarDestination = key === "copilot" || NAVIGATION.some((item) => item.moduleKey === key);
                  const toolbarDisabled = !hasToolbarDestination || (!pinned && (!enabled || toolbarModules.length >= MAX_TOOLBAR_MODULES));
                  return (
                    <div key={key} className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{meta.label}</p>
                        <p className="text-xs text-muted-foreground">{meta.description}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          size="icon"
                          variant={pinned ? "secondary" : "ghost"}
                          className="h-8 w-8"
                          disabled={toolbarDisabled}
                          onClick={() => setToolbarModule(key, !pinned)}
                          title={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                          aria-label={!hasToolbarDestination ? `${meta.label} does not have a dock shortcut` : pinned ? `Remove ${meta.label} from mobile toolbar` : `Add ${meta.label} to mobile toolbar`}
                        >
                          <Star className={cn("h-4 w-4", pinned && "fill-current")} />
                        </Button>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(v) => setModule(key, v)}
                          disabled={!isAdmin || key === "dashboard"}
                          aria-label={`Toggle ${meta.label}`}
                          title={key === "dashboard" ? "Dashboard is always enabled" : undefined}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
