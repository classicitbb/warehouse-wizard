// Settings > Environment: scanner settings, release control, setup wizard and data resets.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, PackageX, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ScannerSettingsPanel } from "@/features/shared/scanner-settings";
import { ReleaseControlPanel } from "@/features/shared/release-control-panel";
import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { resetWmsData, deleteAllProducts } from "@/lib/wms-core";
import { invalidateWarehouseData } from "@/lib/query-invalidation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function EnvironmentSettingsTab({ isDeveloperOrAdmin }: { isDeveloperOrAdmin: boolean }) {
  const { roles } = useAuth();
  const { toPath } = useTenantPath();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resetMutation = useMutation({
    mutationFn: resetWmsData,
    onSuccess: async (result) => {
      const removed =
        (result as { deleted_users?: number; removed_users?: number } | null)?.removed_users ??
        (result as { deleted_users?: number; removed_users?: number } | null)?.deleted_users ??
        0;
      toast.success(`Reset complete. Removed ${removed} user account${removed === 1 ? "" : "s"}.`);
      await invalidateWarehouseData(queryClient);
      navigate(toPath("/setup-wizard"));
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Reset failed"),
  });
  const [resetOpen, setResetOpen] = useState(false);
  const [resetChallenge, setResetChallenge] = useState("");
  const resetReady = resetChallenge.trim() === "RESET ALL";

  const deleteProductsMutation = useMutation({
    mutationFn: deleteAllProducts,
    onSuccess: async (result) => {
      const deleted = (result as { deleted?: number } | null)?.deleted ?? 0;
      toast.success(`Deleted ${deleted} product${deleted === 1 ? "" : "s"}. Warehouse structure preserved.`);
      await invalidateWarehouseData(queryClient);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Product delete failed"),
  });
  const [deleteProductsOpen, setDeleteProductsOpen] = useState(false);
  const isDeveloper = roles.includes("developer");

  return (
    <>
      <ScannerSettingsPanel />
      {isDeveloperOrAdmin ? <ReleaseControlPanel /> : null}
      <Card>
        <CardHeader>
          <CardTitle>Environment & Setup</CardTitle>
          <CardDescription>Use the setup wizard to build the warehouse structure. Forms start blank; nothing is seeded automatically.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground">
          <p>1. Keep users and role assignments in place.</p>
          <p>2. Launch the warehouse setup wizard to define warehouses, zones, and location rules.</p>
          <p>3. Demo operational data (clients, products, pallets, receipts) is opt-in for developers only on the final step.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link to={toPath("/setup-wizard")}>Open warehouse setup wizard</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={toPath("/system-log")}>View system log</Link>
            </Button>
            <Button variant="destructive" onClick={() => { setResetChallenge(""); setResetOpen(true); }} disabled={resetMutation.isPending || !isDeveloperOrAdmin}>
              {resetMutation.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw data-icon="inline-start" />}
              Reset all
            </Button>
            {isDeveloper && (
              <Button variant="outline" className="border-destructive text-destructive hover:bg-destructive/10" onClick={() => setDeleteProductsOpen(true)} disabled={deleteProductsMutation.isPending}>
                {deleteProductsMutation.isPending ? <Loader2 className="animate-spin" /> : <PackageX data-icon="inline-start" />}
                Delete products
              </Button>
            )}
          </div>
          {!isDeveloperOrAdmin ? <p>Only admins and developers can run Reset All.</p> : null}
          {isDeveloper && <p className="text-xs text-muted-foreground">Delete products is dev-only — removes all products and inventory, preserves warehouse structure.</p>}
        </CardContent>
      </Card>
      <Dialog open={resetOpen} onOpenChange={(o) => { if (!resetMutation.isPending) setResetOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">Reset all warehouse data</DialogTitle>
            <DialogDescription>This action is permanent and cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="font-medium">What will happen:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>All warehouses, zones, locations, and products will be deleted.</li>
              <li>All clients, pallets, inventory, orders, picks, transfers, and counts will be deleted.</li>
              <li>All printed labels, templates, integrations, AI recommendations, and reports will be cleared.</li>
              <li>All audit history and system logs will be cleared.</li>
              <li><strong>All users except developer accounts</strong> will be removed and must be re-created by an Admin or Dev user.</li>
            </ul>
            <div className="grid gap-1.5 pt-2">
              <label htmlFor="reset-challenge" className="text-sm font-medium">Type <span className="font-mono font-semibold">RESET ALL</span> to confirm</label>
              <Input id="reset-challenge" value={resetChallenge} onChange={(e) => setResetChallenge(e.target.value)} autoComplete="off" autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={resetMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!resetReady || resetMutation.isPending}
              onClick={() => { resetMutation.mutate(undefined, { onSettled: () => setResetOpen(false) }); }}
            >
              {resetMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Reset everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={deleteProductsOpen} onOpenChange={(o) => { if (!deleteProductsMutation.isPending) setDeleteProductsOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-destructive">Delete all products</DialogTitle>
            <DialogDescription>Developer-only. Warehouse structure is preserved.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm">
            <p className="font-medium">What will be deleted:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>All products and their external sync mappings.</li>
              <li>All inventory balances, pallets, and lot/batch records linked to those products.</li>
              <li>All receipts, putaway tasks, pick lists, transfers, and cycle counts that reference those products.</li>
            </ul>
            <p className="font-medium">What is preserved:</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>All warehouses, zones, and locations.</li>
              <li>All users, roles, and client records.</li>
              <li>System settings, label templates, and printer stations.</li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProductsOpen(false)} disabled={deleteProductsMutation.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={deleteProductsMutation.isPending}
              onClick={() => { deleteProductsMutation.mutate(undefined, { onSettled: () => setDeleteProductsOpen(false) }); }}
            >
              {deleteProductsMutation.isPending ? <Loader2 className="animate-spin" /> : null}
              Delete all products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
