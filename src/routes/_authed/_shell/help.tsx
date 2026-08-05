import { createFileRoute } from "@tanstack/react-router";
import { HelpCenterPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/help")({
  component: () => <HelpCenterPage />,
});