import { createFileRoute } from "@tanstack/react-router";
import { CycleCountsPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/cycle-counts")({
  component: () => <CycleCountsPage />,
});