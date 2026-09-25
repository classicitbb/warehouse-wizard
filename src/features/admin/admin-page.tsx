// Settings: a tab shell. Each tab lives in its own module; the heavier tabs load on first open.
import { lazy, Suspense, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell, FileText, Info, Loader2, MessageSquare, Network, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { cn } from "@/lib/utils";
import { NotificationSettingsPanel } from "@/features/shared/notification-settings";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AudioCuesCard } from "@/features/admin/audio-cues-card";
import { EnvironmentSettingsTab } from "@/features/admin/environment-settings-tab";
import { AboutSettingsTab } from "@/features/admin/about-settings-tab";

const WarehouseStructureTab = lazy(() => import("@/components/warehouse-tree-view").then((mod) => ({ default: mod.WarehouseStructureTab })));
const UsersRolesPage = lazy(() => import("@/features/admin/users-roles-page").then((mod) => ({ default: mod.UsersRolesPage })));
const ModulesSettingsPanel = lazy(() => import("@/features/admin/modules-settings-panel").then((mod) => ({ default: mod.ModulesSettingsPanel })));
const SupportRequestsPanel = lazy(() => import("@/features/admin/support-requests-panel").then((mod) => ({ default: mod.SupportRequestsPanel })));
const NetSuiteIntegrationsTab = lazy(() => import("@/features/admin/netsuite-settings").then((mod) => ({ default: mod.NetSuiteIntegrationsTab })));
const ClientVariablesPanel = lazy(() => import("@/features/admin/client-variables-panel").then((mod) => ({ default: mod.ClientVariablesPanel })));
const LicenseAgreementTab = lazy(() => import("@/features/admin/license-agreement").then((mod) => ({ default: mod.LicenseAgreementTab })));

function TabLoader({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
      {children}
    </Suspense>
  );
}

export function SettingsPage() {
  const { roles } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [searchParams] = useSearchParams();
  const canViewUsersRoles = roles.some((r) => ["developer", "admin", "warehouse_manager", "warehouse_supervisor"].includes(r));
  const canViewSupportRequests = canViewUsersRoles;
  const isDeveloperOrAdmin = roles.some((r) => ["developer", "admin"].includes(r));
  const requestedTab = searchParams.get("tab");
  const availableSettingsTabs = [
    "warehouse-structure",
    ...(canViewUsersRoles ? ["users-roles"] : []),
    "modules",
    "notifications",
    "environment",
    ...(canViewSupportRequests ? ["support-requests"] : []),
    ...(isDeveloperOrAdmin ? ["integrations"] : []),
    ...(isEnabled("clients") ? ["client-vars"] : []),
    "about",
    "license",
  ];

  const defaultSettingsTab = requestedTab && availableSettingsTabs.includes(requestedTab)
    ? requestedTab
    : "warehouse-structure";
  const [activeSettingsTab, setActiveSettingsTab] = useState(defaultSettingsTab);
  const warehouseStructureActive = activeSettingsTab === "warehouse-structure";

  return (
    <div className={cn("flex flex-col gap-6", warehouseStructureActive && "h-full min-h-0 overflow-hidden")}>
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-semibold">Settings</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              aria-label="Settings overview"
            >
              <Info className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Warehouse environment, client configuration, and system management.
          </TooltipContent>
        </Tooltip>
      </div>
      <Tabs
        value={activeSettingsTab}
        onValueChange={setActiveSettingsTab}
        className={cn(warehouseStructureActive && "flex min-h-0 flex-1 flex-col")}
      >
        <TabsList className="flex h-auto w-full flex-wrap items-stretch justify-start gap-1 sm:w-fit">
          <TabsTrigger value="warehouse-structure" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Network className="h-3.5 w-3.5" />Warehouse Structure</TabsTrigger>
          {canViewUsersRoles && (
            <TabsTrigger value="users-roles" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Users className="h-3.5 w-3.5" />Users & Roles</TabsTrigger>
          )}
          <TabsTrigger value="modules" className="min-h-9 flex-1 sm:flex-none">Modules</TabsTrigger>
          <TabsTrigger value="notifications" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Bell className="h-3.5 w-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="environment" className="min-h-9 flex-1 sm:flex-none">Environment</TabsTrigger>
          {canViewSupportRequests && (
            <TabsTrigger value="support-requests" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><MessageSquare className="h-3.5 w-3.5" />Support Requests</TabsTrigger>
          )}
          {isDeveloperOrAdmin && (
            <TabsTrigger value="integrations" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Network className="h-3.5 w-3.5" />Integrations</TabsTrigger>
          )}
          {isEnabled("clients") && (
            <TabsTrigger value="client-vars" className="min-h-9 flex-1 sm:flex-none">Client Variables</TabsTrigger>
          )}
          <TabsTrigger value="about" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><Info className="h-3.5 w-3.5" />About</TabsTrigger>
          <TabsTrigger value="license" className="min-h-9 flex-1 gap-1.5 sm:flex-none"><FileText className="h-3.5 w-3.5" />License</TabsTrigger>

        </TabsList>

        <TabsContent value="modules" className="mt-4">
          <TabLoader><ModulesSettingsPanel isAdmin={isDeveloperOrAdmin} /></TabLoader>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4 grid max-w-3xl gap-6">
          <NotificationSettingsPanel />
          <AudioCuesCard />
        </TabsContent>

        <TabsContent value="environment" className="mt-4 grid gap-6 xl:grid-cols-2">
          <EnvironmentSettingsTab isDeveloperOrAdmin={isDeveloperOrAdmin} />
        </TabsContent>

        {isEnabled("clients") && (
          <TabsContent value="client-vars" className="mt-4">
            <TabLoader><ClientVariablesPanel /></TabLoader>
          </TabsContent>
        )}

        {canViewSupportRequests && (
          <TabsContent value="support-requests" className="mt-4">
            <TabLoader><SupportRequestsPanel /></TabLoader>
          </TabsContent>
        )}

        {canViewUsersRoles && (
          <TabsContent value="users-roles" className="mt-4">
            <TabLoader><UsersRolesPage /></TabLoader>
          </TabsContent>
        )}


        <TabsContent value="warehouse-structure" className="mt-4 min-h-0 flex-1 data-[state=active]:flex">
          <div className="flex min-h-0 flex-1 flex-col">
            <TabLoader><WarehouseStructureTab /></TabLoader>
          </div>
        </TabsContent>

        {isDeveloperOrAdmin && (
          <TabsContent value="integrations" className="mt-4 grid gap-6 xl:grid-cols-2">
            <TabLoader><NetSuiteIntegrationsTab /></TabLoader>
          </TabsContent>
        )}

        <TabsContent value="about" className="mt-4 grid gap-6 xl:grid-cols-2">
          <AboutSettingsTab />
        </TabsContent>

        <TabsContent value="license" className="mt-4">
          <TabLoader><LicenseAgreementTab /></TabLoader>
        </TabsContent>
      </Tabs>
    </div>
  );
}
