import { createFileRoute } from "@tanstack/react-router";
import { PutawayTasksPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/putaway-tasks")({
  component: () => <PutawayTasksPage />,
});