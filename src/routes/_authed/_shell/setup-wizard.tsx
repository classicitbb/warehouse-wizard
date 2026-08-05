import { createFileRoute } from "@tanstack/react-router";
import { SetupWizardPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/setup-wizard")({
  component: () => <SetupWizardPage />,
});