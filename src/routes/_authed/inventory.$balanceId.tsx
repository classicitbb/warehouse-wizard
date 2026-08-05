import { createFileRoute } from "@tanstack/react-router";
import { InventoryDetailPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/inventory/$balanceId")({
  component: () => <InventoryDetailPage />,
});