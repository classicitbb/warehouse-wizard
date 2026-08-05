import { createFileRoute } from "@tanstack/react-router";
import { EmailLogPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/email-log")({
  component: () => <EmailLogPage />,
});