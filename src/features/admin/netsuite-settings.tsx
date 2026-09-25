// Settings > Integrations: NetSuite connection, warehouse mapping and item import.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Boxes, Download, KeyRound, Loader2, MapPinned, Network, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";

/**
 * One-time reveal for a server-generated shared secret. The plaintext is
 * returned by netsuite-connection only on the save that creates it, so this is
 * the single opportunity the operator has to copy it.
 */
function RevealedSecret({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <div className="mb-1 font-medium text-amber-700 dark:text-amber-300">{label} — copy now, it will not be shown again:</div>
      <code className="block break-all rounded bg-background/60 p-2 font-mono text-[11px]">{value}</code>
      <p className="mt-2 text-muted-foreground">{hint}</p>
    </div>
  );
}

function downloadNetSuiteCertificate(pem: string) {
  const url = URL.createObjectURL(new Blob([pem], { type: "application/x-pem-file" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "warehouse-wizard-netsuite-m2m.pem";
  link.click();
  URL.revokeObjectURL(url);
}

function NetSuiteIntegrationCard() {
  const [status, setStatus] = useState<{
    configured: boolean;
    enabled: boolean;
    missing: string[];
    accountIdMasked: string | null;
    clientIdMasked: string | null;
    certificateId: string | null;
    certificatePem: string | null;
    certificateExpiresAt: string | null;
    adjustmentAccountId: string | null;
    adjustmentSubsidiaryId: string | null;
    queueRunnerConfigured: boolean;
    lastTestedAt: string | null;
    lastTestOk: boolean | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [clientId, setClientId] = useState("");
  const [certificateId, setCertificateId] = useState("");
  const [adjustmentAccountId, setAdjustmentAccountId] = useState("");
  const [adjustmentSubsidiaryId, setAdjustmentSubsidiaryId] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [revealedWebhookSecret, setRevealedWebhookSecret] = useState<string | null>(null);
  const [revealedQueueSecret, setRevealedQueueSecret] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "status" },
      });
      if (error) throw error;
      setStatus(data as any);
      setEnabled(Boolean((data as any)?.enabled));
      const posting = data as { adjustmentAccountId?: string | null; adjustmentSubsidiaryId?: string | null } | null;
      setAdjustmentAccountId(posting?.adjustmentAccountId ?? "");
      setAdjustmentSubsidiaryId(posting?.adjustmentSubsidiaryId ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load NetSuite status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleSave = async () => {
    // Blank fields keep the stored value, so only a first save needs both IDs.
    if ((!accountId.trim() && !status?.accountIdMasked) || (!clientId.trim() && !status?.clientIdMasked)) {
      toast.error("Account ID and Client ID are required");
      return;
    }
    setSaving(true);
    setRevealedWebhookSecret(null);
    setRevealedQueueSecret(null);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: {
          action: "save",
          accountId: accountId.trim() || undefined,
          clientId: clientId.trim() || undefined,
          certificateId: certificateId.trim() || undefined,
          // Shown unmasked and pre-filled, so an empty value clears the setting.
          // Before status has loaded the fields are unknown, so keep what is stored.
          adjustmentAccountId: status ? adjustmentAccountId.trim() : undefined,
          adjustmentSubsidiaryId: status ? adjustmentSubsidiaryId.trim() : undefined,
          enabled,
        },
      });
      if (error) throw error;
      const result = data as { ok: boolean; webhookSecret?: string | null; queueRunnerSecret?: string | null };
      if (result?.webhookSecret) setRevealedWebhookSecret(result.webhookSecret);
      if (result?.queueRunnerSecret) setRevealedQueueSecret(result.queueRunnerSecret);
      toast.success("NetSuite connection saved");
      setAccountId("");
      setClientId("");
      setCertificateId("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateCertificate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "generate_certificate" },
      });
      if (error) throw error;
      const result = data as { ok?: boolean; certificatePem?: string; error?: string };
      if (!result?.certificatePem) throw new Error(result?.error ?? "Certificate generation failed");
      downloadNetSuiteCertificate(result.certificatePem);
      toast.success("Certificate generated. Upload it to NetSuite, then save the Certificate ID it assigns.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Certificate generation failed");
    } finally {
      setGenerating(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "test" },
      });
      if (error) throw error;
      const result = data as { ok: boolean; error?: string };
      if (result?.ok) toast.success("NetSuite credentials verified");
      else toast.error(result?.error ?? "Test failed");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  const keepPlaceholder = (masked: string | null | undefined, fallback: string) =>
    masked ? `${masked} saved (leave blank to keep)` : fallback;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Network className="h-4 w-4" />NetSuite Integration</CardTitle>
        <CardDescription>
          OAuth 2.0 client credentials (machine-to-machine) for the NetSuite REST API. The signing key is generated and kept server-side; only its public certificate is ever downloaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground grid gap-1">
              <div>Status: <span className="font-medium text-foreground">{status?.configured ? "Configured" : "Not configured"}</span> · {status?.enabled ? "Enabled" : "Disabled"}</div>
              {!status?.configured && status?.missing?.length ? <div>Missing: {status.missing.join(", ")}</div> : null}
              {status?.accountIdMasked && <div>Account: <span className="font-mono">{status.accountIdMasked}</span></div>}
              {status?.clientIdMasked && <div>Client ID: <span className="font-mono">{status.clientIdMasked}</span></div>}
              <div>
                Certificate: <span className="font-medium text-foreground">{status?.certificatePem ? "Generated" : "Not generated"}</span>
                {status?.certificateExpiresAt && <> · expires {new Date(status.certificateExpiresAt).toLocaleDateString()}</>}
              </div>
              <div>Certificate ID: <span className="font-mono text-foreground">{status?.certificateId ?? "Not set"}</span></div>
              <div>
                Adjustment account:{" "}
                {status?.adjustmentAccountId
                  ? <span className="font-mono text-foreground">{status.adjustmentAccountId}</span>
                  : <span className="font-medium text-foreground">Not set · inventory sync paused</span>}
              </div>
              <div>Queue runner secret: <span className="font-medium text-foreground">{status?.queueRunnerConfigured ? "Configured" : "Not configured"}</span></div>
              {status?.lastTestedAt && (
                <div>Last tested: {new Date(status.lastTestedAt).toLocaleString()}{status.lastTestOk != null && <> · {status.lastTestOk ? "passed" : "failed"}</>}</div>
              )}
            </div>

            <ol className="list-decimal space-y-1 rounded-md border p-3 pl-7 text-xs text-muted-foreground">
              <li>In NetSuite, open the integration record and enable <span className="text-foreground">Client Credentials (Machine to Machine) Grant</span> and the <span className="text-foreground">REST Web Services</span> scope. Save its Client ID and your Account ID here.</li>
              <li>Generate a certificate below. The public certificate downloads as a .pem file.</li>
              <li>In NetSuite, go to Setup &gt; Integration &gt; Manage Authentication &gt; OAuth 2.0 Client Credentials (M2M) Setup, create a mapping for the integration user, role, and this application, and upload the certificate.</li>
              <li>Paste the Certificate ID NetSuite assigns, save, then test the connection.</li>
            </ol>

            <div className="grid gap-2">
              <Label htmlFor="ns-account">Account ID</Label>
              <Input id="ns-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder={keepPlaceholder(status?.accountIdMasked, "123456_SB1")} autoComplete="off" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ns-client-id">Client ID</Label>
              <Input id="ns-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder={keepPlaceholder(status?.clientIdMasked, "")} autoComplete="off" />
            </div>

            <div className="grid gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 text-sm font-medium"><KeyRound className="h-4 w-4" />Signing certificate</p>
                  <p className="text-xs text-muted-foreground">EC P-256 (ES256), valid two years. Regenerating replaces the key, so the new certificate must be uploaded again.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {status?.certificatePem && (
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadNetSuiteCertificate(status.certificatePem!)}>
                      <Download className="mr-2 h-4 w-4" />Download
                    </Button>
                  )}
                  {status?.certificatePem ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="outline" size="sm" disabled={generating}>
                          {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Regenerate
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Replace the NetSuite signing certificate?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The current key is discarded and the saved Certificate ID is cleared. NetSuite sync stops until the new certificate is uploaded in NetSuite and its Certificate ID is saved here.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={handleGenerateCertificate}>Regenerate</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button type="button" size="sm" onClick={handleGenerateCertificate} disabled={generating || !status?.accountIdMasked}>
                      {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Generate certificate
                    </Button>
                  )}
                </div>
              </div>
              <Label htmlFor="ns-certificate-id" className="mt-1">Certificate ID</Label>
              <Input
                id="ns-certificate-id"
                value={certificateId}
                onChange={(e) => setCertificateId(e.target.value)}
                placeholder={status?.certificateId ? `${status.certificateId} (leave blank to keep)` : "Assigned by NetSuite after upload"}
                autoComplete="off"
              />
            </div>
            <div className="grid gap-2 rounded-md border p-3">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium"><Boxes className="h-4 w-4" />Inventory adjustment posting</p>
                <p className="text-xs text-muted-foreground">Putaway sync posts inventory adjustments against these NetSuite internal IDs. Sync waits in the queue until the adjustment account is set.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="ns-adjustment-account" className="text-xs text-muted-foreground">Adjustment Account Internal ID</Label>
                  <Input
                    id="ns-adjustment-account"
                    value={adjustmentAccountId}
                    onChange={(e) => setAdjustmentAccountId(e.target.value)}
                    placeholder="e.g. 212"
                    autoComplete="off"
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="ns-adjustment-subsidiary" className="text-xs text-muted-foreground">Subsidiary Internal ID (optional)</Label>
                  <Input
                    id="ns-adjustment-subsidiary"
                    value={adjustmentSubsidiaryId}
                    onChange={(e) => setAdjustmentSubsidiaryId(e.target.value)}
                    placeholder="Blank uses the NetSuite default"
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <Label htmlFor="ns-enabled" className="text-sm font-medium">Enabled</Label>
                <p className="text-xs text-muted-foreground">Turn on to allow sync jobs against NetSuite.</p>
              </div>
              <Switch id="ns-enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {revealedWebhookSecret && (
              <RevealedSecret
                label="Webhook shared secret"
                value={revealedWebhookSecret}
                hint="Send this as the X-Webhook-Secret header from the NetSuite SuiteScript."
              />
            )}

            {revealedQueueSecret && (
              <RevealedSecret
                label="Queue runner secret"
                value={revealedQueueSecret}
                hint="Store as the NETSUITE_QUEUE_RUNNER_SECRET repository secret so the scheduled queue drain can authenticate."
              />
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save connection
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={testing || !status?.configured}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NetSuiteWarehouseMappingCard() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ["settings", "netsuite-mapping", "warehouses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("warehouses")
        .select("id, name, code")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string; code: string | null }>;
    },
  });

  const linksQuery = useQuery({
    queryKey: ["settings", "netsuite-mapping", "links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("external_record_links")
        .select("id, local_id, external_id")
        .eq("system", "netsuite")
        .eq("local_table", "warehouses")
        .eq("external_record_type", "location");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; local_id: string; external_id: string }>;
    },
  });

  const linkByWarehouse = useMemo(() => {
    const map = new Map<string, { id: string; external_id: string }>();
    for (const link of linksQuery.data ?? []) {
      map.set(link.local_id, { id: link.id, external_id: link.external_id });
    }
    return map;
  }, [linksQuery.data]);

  const handleSave = async (warehouseId: string) => {
    const existing = linkByWarehouse.get(warehouseId);
    const nextValue = (drafts[warehouseId] ?? existing?.external_id ?? "").trim();
    setSavingId(warehouseId);
    try {
      if (!nextValue) {
        if (existing) {
          const { error } = await supabase
            .from("external_record_links")
            .delete()
            .eq("id", existing.id);
          if (error) throw error;
          toast.success("Mapping cleared");
        }
      } else if (existing) {
        const { error } = await supabase
          .from("external_record_links")
          .update({ external_id: nextValue })
          .eq("id", existing.id);
        if (error) throw error;
        toast.success("Mapping updated");
      } else {
        const { error } = await supabase.from("external_record_links").insert({
          system: "netsuite",
          local_table: "warehouses",
          local_id: warehouseId,
          external_record_type: "location",
          external_id: nextValue,
        });
        if (error) throw error;
        toast.success("Mapping saved");
      }
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[warehouseId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["settings", "netsuite-mapping", "links"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSavingId(null);
    }
  };

  const warehouses = warehousesQuery.data ?? [];
  const loading = warehousesQuery.isLoading || linksQuery.isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPinned className="h-4 w-4" />NetSuite Location Mapping</CardTitle>
        <CardDescription>
          Map each Warehouse Wizard warehouse to its NetSuite Location internal ID so inventory adjustments post to the correct location.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : warehouses.length === 0 ? (
          <p className="text-sm text-muted-foreground">No warehouses defined yet.</p>
        ) : (
          <div className="grid gap-3">
            {warehouses.map((wh) => {
              const existing = linkByWarehouse.get(wh.id);
              const draftValue = drafts[wh.id];
              const value = draftValue ?? existing?.external_id ?? "";
              const dirty = draftValue !== undefined && draftValue.trim() !== (existing?.external_id ?? "");
              return (
                <div key={wh.id} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                  <div className="min-w-0">
                    <Label className="text-xs text-muted-foreground">Warehouse</Label>
                    <div className="truncate text-sm font-medium">{wh.name}</div>
                    {wh.code ? <div className="truncate text-xs text-muted-foreground font-mono">{wh.code}</div> : null}
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`ns-loc-${wh.id}`} className="text-xs text-muted-foreground">NetSuite Location Internal ID</Label>
                    <Input
                      id={`ns-loc-${wh.id}`}
                      value={value}
                      placeholder="e.g. 123"
                      autoComplete="off"
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [wh.id]: e.target.value }))}
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSave(wh.id)}
                    disabled={savingId === wh.id || (!dirty && !(existing && value === ""))}
                  >
                    {savingId === wh.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type NetSuiteListedItem = {
  externalId: string;
  itemId: string;
  displayName: string;
  upcCode: string;
  active: boolean;
  alreadyImported: boolean;
};

function NetSuiteImportCard() {
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<NetSuiteListedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<Record<string, NetSuiteListedItem>>({});
  const [notConfigured, setNotConfigured] = useState(false);
  const limit = 25;

  const fetchItems = useCallback(async (nextOffset: number, nextSearch: string) => {
    setLoading(true);
    try {
      const { data: statusData, error: statusError } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "status" },
      });
      if (statusError) throw statusError;
      const statusResult = statusData as { configured?: boolean } | null;
      if (!statusResult?.configured) {
        setNotConfigured(true);
        setItems([]);
        setHasMore(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "list_items", search: nextSearch || undefined, limit, offset: nextOffset },
      });
      const result = data as { items?: NetSuiteListedItem[]; hasMore?: boolean; error?: string; notConfigured?: boolean };
      const errMsg = result?.error ?? (error instanceof Error ? error.message : "");
      if (result?.notConfigured || (errMsg && /(no netsuite connection|credentials incomplete)/i.test(errMsg))) {
        setNotConfigured(true);
        setItems([]);
        setHasMore(false);
        return;
      }
      setNotConfigured(false);
      if (error) throw error;
      if (result?.error) throw new Error(result.error);
      setItems(result?.items ?? []);
      setHasMore(Boolean(result?.hasMore));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load NetSuite items");
      setItems([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchItems(0, ""); }, [fetchItems]);

  const runSearch = () => {
    const trimmed = searchInput.trim();
    setSearch(trimmed);
    setOffset(0);
    void fetchItems(0, trimmed);
  };

  const goToPage = (nextOffset: number) => {
    setOffset(nextOffset);
    void fetchItems(nextOffset, search);
  };

  const toggleSelected = (item: NetSuiteListedItem) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.externalId]) delete next[item.externalId];
      else next[item.externalId] = item;
      return next;
    });
  };

  const selectedCount = Object.keys(selected).length;

  const handleImport = async () => {
    const toImport = Object.values(selected);
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: {
          action: "import_items",
          items: toImport.map((i) => ({
            externalId: i.externalId,
            itemId: i.itemId,
            displayName: i.displayName,
            upcCode: i.upcCode,
            active: i.active,
          })),
        },
      });
      if (error) throw error;
      const result = data as { succeeded?: number; failed?: number; error?: string };
      if (result?.error) throw new Error(result.error);
      if ((result?.failed ?? 0) > 0) {
        toast.warning(`Imported ${result?.succeeded ?? 0}, ${result?.failed} failed — check System Log for details.`);
      } else {
        toast.success(`Imported ${result?.succeeded ?? 0} product${result?.succeeded === 1 ? "" : "s"} from NetSuite`);
      }
      setSelected({});
      await fetchItems(offset, search);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Download className="h-4 w-4" />Import Products from NetSuite</CardTitle>
        <CardDescription>
          Search the NetSuite item catalog and choose which products to bring into Warehouse Wizard. Re-selecting an already-imported item updates it.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              placeholder="Search by item ID or name…"
              className="pl-8"
            />
          </div>
          <Button variant="outline" size="sm" onClick={runSearch} disabled={loading}>Search</Button>
          <Button size="sm" onClick={handleImport} disabled={selectedCount === 0 || importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Import selected ({selectedCount})
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : notConfigured ? (
          <p className="text-sm text-muted-foreground">NetSuite is not connected yet. Save valid credentials in the connection card above to browse the item catalog.</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items found. Make sure the NetSuite connection above is configured and enabled.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>UPC</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.externalId}>
                    <TableCell>
                      <Checkbox
                        checked={Boolean(selected[item.externalId])}
                        onCheckedChange={() => toggleSelected(item)}
                        aria-label={`Select ${item.itemId}`}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.itemId}</TableCell>
                    <TableCell className="max-w-[240px] truncate">{item.displayName || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{item.upcCode || "—"}</TableCell>
                    <TableCell>
                      {item.alreadyImported ? (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Imported</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not imported</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={offset === 0 || loading} onClick={() => goToPage(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => goToPage(offset + limit)}>
            Next
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function NetSuiteIntegrationsTab() {
  return (
    <>
      <NetSuiteIntegrationCard />
      <NetSuiteWarehouseMappingCard />
      <NetSuiteImportCard />
    </>
  );
}
