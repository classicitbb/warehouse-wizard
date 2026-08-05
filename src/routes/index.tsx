import { createFileRoute } from "@tanstack/react-router";
import { HomeRedirect } from "@/features/app/app-pages";

export const Route = createFileRoute("/")({
  component: () => <HomeRedirect />,
});