import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/app/app-pages";

// Pathless layout route: every child route below is auth-gated exactly as the
// original App.tsx route config gated them (RequireAuth renders <Outlet /> for
// signed-in, approved users and the login/pending screens otherwise).
export const Route = createFileRoute("/_authed")({
  component: () => <RequireAuth />,
});