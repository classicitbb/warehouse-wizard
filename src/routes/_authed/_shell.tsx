import { createFileRoute } from "@tanstack/react-router";
import { Outlet } from "@/lib/router-compat";
import { ProtectedShell } from "@/features/app/app-pages";

// Preserves the original App.tsx layout stack: AppShell + MobileActionBar
// around every workspace page.
function ProtectedLayout() {
  return (
    <ProtectedShell>
      <Outlet />
    </ProtectedShell>
  );
}

export const Route = createFileRoute("/_authed/_shell")({
  component: () => <ProtectedLayout />,
});