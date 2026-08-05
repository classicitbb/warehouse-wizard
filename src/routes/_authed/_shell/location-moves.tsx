import { createFileRoute } from "@tanstack/react-router";
import { LocationMovesPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/location-moves")({
  component: () => <LocationMovesPage />,
});