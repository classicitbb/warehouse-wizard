import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { alertToast } from "@/features/shared/ui-shared";
import { listUnrecordedStoredPallets, releaseUnrecordedPalletLocation } from "@/features/inventory/inventory-core";
import { createReturnedPalletDraft } from "@/features/receiving/receiving-core";

const SUPERVISOR_ROLES = ["admin", "developer", "dev", "warehouse_manager", "warehouse_supervisor"];

/**
 * A pallet that has no stock record — or that shows a location with no
 * receiving line and no completed put-away or move behind it — cannot be
 * stored and must not hold a bay. Nothing is cleared automatically: a
 * supervisor decides whether to free the bay or re-receive the stock.
 */
export function UnrecordedPalletsBanner({ warehouseId }: { warehouseId?: string | null }) {
  const { roles } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const allowed = (roles ?? []).some((role) => SUPERVISOR_ROLES.includes(String(role)));

  const { data: pallets = [] } = useQuery({
    queryKey: ["unrecorded-stored-pallets", warehouseId ?? "all"],
    queryFn: () => listUnrecordedStoredPallets(warehouseId ?? null),
    enabled: allowed,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["unrecorded-stored-pallets"] }),
      queryClient.invalidateQueries({ queryKey: ["inventory-search"] }),
      queryClient.invalidateQueries({ queryKey: ["putaway-tasks"] }),
    ]);
  };

  const release = useMutation({
    mutationFn: (palletId: string) =>
      releaseUnrecordedPalletLocation(palletId, "Pallet had no stock record and could not be stored"),
    onSuccess: async () => {
      alertToast.success("Location freed — the pallet is now marked Missing");
      await refresh();
    },
    onError: (error: unknown) => {
      alertToast.noGo(error instanceof Error ? error.message : "Could not free this location");
    },
  });

  const reReceive = useMutation({
    mutationFn: async (pallet: { palletId: string; warehouseId: string | null; palletBarcode: string }) => {
      if (!pallet.warehouseId) throw new Error("This pallet has no warehouse, so it cannot be re-received.");
      await releaseUnrecordedPalletLocation(pallet.palletId, "Re-received: pallet had no stock record");
      return createReturnedPalletDraft({
        palletId: pallet.palletId,
        warehouseId: pallet.warehouseId,
        sourceLabel: `Unrecorded pallet ${pallet.palletBarcode}`,
        sourceType: "unrecorded_pallet",
        sourceId: pallet.palletId,
        reason: "Pallet found stored with no stock record",
      });
    },
    onSuccess: async (draftId: string) => {
      alertToast.success("Receiving draft opened for this pallet");
      await refresh();
      navigate(`/receiving?draft=${draftId}`);
    },
    onError: (error: unknown) => {
      alertToast.noGo(error instanceof Error ? error.message : "Could not open a receiving draft");
    },
  });

  if (!allowed || pallets.length === 0) return null;
  const busy = release.isPending || reReceive.isPending;

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {pallets.length} pallet{pallets.length === 1 ? "" : "s"} hold a location with no stock record
      </p>
      <p className="mt-1 text-xs sm:text-sm">
        A pallet with no record cannot be stored. Free the location, or re-receive it to record what is physically on it.
      </p>
      <ul className="mt-2 grid gap-1">
        {pallets.map((pallet) => (
          <li
            key={pallet.palletId}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-destructive/30 bg-background/70 px-2 py-1 text-foreground"
          >
            <span className="text-xs">
              <span className="font-mono">{pallet.palletBarcode}</span>
              {pallet.locationCode ? <> · at <span className="font-mono">{pallet.locationCode}</span></> : null}
              {pallet.sku ? <> · {pallet.sku}</> : null}
              {" · qty "}
              {pallet.quantity}
              {pallet.reason === "no_provenance" ? " · no receiving or put-away history" : " · no stock record"}
            </span>
            <span className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => release.mutate(pallet.palletId)}>
                Release location
              </Button>
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => reReceive.mutate(pallet)}>
                Re-receive
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
