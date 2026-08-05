import { createFileRoute } from "@tanstack/react-router";
import { PickExecutionPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/pick-lists/$pickListId")({
  component: () => <PickExecutionPage />,
});