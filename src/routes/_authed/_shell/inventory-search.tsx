import { createFileRoute } from "@tanstack/react-router";
import { InventorySearchPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/inventory-search")({
  component: () => <InventorySearchPage />,
});