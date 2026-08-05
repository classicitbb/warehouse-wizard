import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/features/app/app-pages";

export const Route = createFileRoute("/login")({
  component: () => <LoginPage />,
});