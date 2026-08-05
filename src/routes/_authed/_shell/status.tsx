import { createFileRoute } from "@tanstack/react-router";
import { StatusPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/status")({
  component: () => <StatusPage />,
});