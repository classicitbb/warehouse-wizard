// wms-ui.tsx — barrel re-export
// All feature UI modules are split under src/features/
// App.tsx lazy-imports from this file; those paths continue to work.

export { AppShell } from "@/features/shared/app-shell";
export { ResourcePage } from "@/features/resources/resource-page";
export { DashboardPage } from "@/features/dashboard/dashboard-page";
export { ReceivingPage } from "@/features/receiving/receiving-page";
export { PutawayTasksPage } from "@/features/putaway/putaway-page";
export { InventorySearchPage } from "@/features/inventory/inventory-page";
export { PickListsPage } from "@/features/picking/picking-page";
export { TransfersPage } from "@/features/transfers/transfers-page";
export { CycleCountsPage } from "@/features/cycle-counts/cycle-counts-page";
export { LocationMovesPage } from "@/features/moves/moves-page";
export { StatusPage, ReportsPage } from "@/features/status/status-page";
export { UsersRolesPage, SettingsPage, MobileActionBar } from "@/features/admin/admin-page";
export { SystemLogPage, EmailLogPage } from "@/features/system/system-page";
export { distributeShipmentLine } from "@/features/receiving/receiving-form-state";
export type { LocationWizardValues } from "@/features/shared/location-wizard";
