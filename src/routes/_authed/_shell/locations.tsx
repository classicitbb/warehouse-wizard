import { createFileRoute } from "@tanstack/react-router";
import { ResourcePage } from "@/features/app/app-pages";
import { RESOURCE_DEFINITIONS } from "@/lib/wms-core";

export const Route = createFileRoute("/_authed/_shell/locations")({
  component: () => <ResourcePage resource={RESOURCE_DEFINITIONS.locations as any} />,
});