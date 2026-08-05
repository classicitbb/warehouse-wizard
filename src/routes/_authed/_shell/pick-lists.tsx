import { createFileRoute } from "@tanstack/react-router";
import { PickListsPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/pick-lists")({
  component: () => <PickListsPage />,
});