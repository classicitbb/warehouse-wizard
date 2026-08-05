import { createFileRoute } from "@tanstack/react-router";
import { UsersRolesPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/_authed/_shell/users")({
  component: () => <UsersRolesPage />,
});