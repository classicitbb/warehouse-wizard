// Settings > About: current version, release history and feature register.
import { RELEASE_HISTORY } from "@/lib/release-history";
import { CheckCircle2, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AboutSettingsTab() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            Warehouse Wizard Enterprise WMS
          </CardTitle>
          <CardDescription>Version history and feature register.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="font-medium">Current version</span>
            <span className="font-mono text-xs font-semibold text-primary">v{__APP_VERSION__}</span>
          </div>
          {RELEASE_HISTORY.map((release) => (
            <div key={release.version} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-mono text-xs font-semibold bg-primary/10 text-primary rounded px-1.5 py-0.5">v{release.version}</span>
                <span className="text-xs text-muted-foreground">{release.date}</span>
              </div>
              <ul className="grid gap-1">
                {release.changes.map((c) => (
                  <li key={c} className="text-xs text-muted-foreground flex gap-2">
                    <span className="mt-0.5 shrink-0 text-primary">•</span>
                    {c}
                  </li>
                ))}
              </ul>
              {release.fixes?.length ? (
                <>
                  <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Fixes</p>
                  <ul className="grid gap-1">
                    {release.fixes.map((f) => (
                      <li key={f} className="text-xs text-muted-foreground flex gap-2">
                        <span className="mt-0.5 shrink-0 text-muted-foreground">•</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Feature Register</CardTitle>
          <CardDescription>All active feature areas in this deployment.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {[
            ["Warehouses", "Multi-facility master data with cool zone flags"],
            ["Zones", "Temperature-classed storage and workflow zones per warehouse"],
            ["Bin Locations", "Rack, staging, dispatch, quarantine, and floor slots with capacity rules"],
            ["Clients", "3PL customer master with stock-sharing and expiry policies"],
            ["Products", "SKU master with rotation method, temperature class, and lot tracking"],
            ["Packaging Profiles", "Unit, carton, pallet pack forms with dimensions and barcodes"],
            ["Receiving", "Manual, PO, and transfer inbound with lot/expiry capture and putaway queuing"],
            ["Put-Away", "Directed put-away with temperature, capacity, and height validation"],
            ["Inventory Search", "Live pallet lookup by SKU, barcode, lot, location, or pallet code"],
            ["Pick Lists", "Rotation-aware pick wave creation with shortage capture"],
            ["Transfers", "Inter-warehouse moves with pallet identity preservation and driver sign-off"],
            ["Cycle Counts", "Periodic counts by location, zone, SKU, or spot with variance reporting"],
            ["Status Controls", "Pallet hold, quarantine, damaged, missing with reason audit"],
            ["Dashboard", "Floor, Dock, and Office modes with draggable metric cards"],
            ["Reports", "Inventory, occupancy, and cycle count exports"],
            ["Users & Roles", "Admin/Dev user creation, role scope, and trusted-device badge login"],
            ["System Log", "Full audit trail viewer with severity filtering and resolve workflow"],
            ["Help Centre", "Contextual help sidebar and searchable article wiki"],
          ].map(([feature, desc]) => (
            <div key={feature} className="flex items-start gap-2 rounded border border-border px-3 py-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
              <div>
                <p className="font-medium leading-snug">{feature}</p>
                <p className="text-[11px] text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
