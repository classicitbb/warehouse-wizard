import { createFileRoute } from "@tanstack/react-router";
import { ReceivingPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/receiving")({
  component: () => <ReceivingPage />,
});