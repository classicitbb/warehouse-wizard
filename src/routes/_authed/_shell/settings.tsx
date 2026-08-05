import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/settings")({
  component: () => <SettingsPage />,
});