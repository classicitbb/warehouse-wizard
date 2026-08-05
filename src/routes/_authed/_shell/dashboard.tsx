import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/dashboard")({
  component: () => <DashboardPage />,
});