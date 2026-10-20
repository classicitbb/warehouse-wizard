import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { InventorySearchPage } from "@/features/inventory/inventory-page";
import "@/index.css";

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}>
  <TooltipProvider><MemoryRouter><div className="flex h-dvh flex-col gap-3 bg-background p-3 text-foreground">
    <p className="text-sm font-medium">Local fixture — no backend connected</p>
    <Routes><Route path="/" element={<InventorySearchPage />} /><Route path="/inventory/:id" element={<p>Existing inventory detail route reached (fixture)</p>} /></Routes>
  </div><Toaster /></MemoryRouter></TooltipProvider>
</QueryClientProvider>);
