// Products page > settings gear: pop-up modal to browse the NetSuite item catalog and import products.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQueryClient } from "@tanstack/react-query";

type NetSuiteListedItem = {
  externalId: string;
  itemId: string;
  displayName: string;
  upcCode: string;
  active: boolean;
  alreadyImported: boolean;
};

type ItemSortKey = "datecreated" | "itemid" | "displayname" | "status";
type ItemSortDir = "asc" | "desc";

const PAGE_SIZE = 25;
// When imported items are hidden the filter runs client-side, so fetch a bigger window to keep pages reasonably full.
const HIDE_IMPORTED_PAGE_SIZE = 100;

function toImportPayload(i: NetSuiteListedItem) {
  return { externalId: i.externalId, itemId: i.itemId, displayName: i.displayName, upcCode: i.upcCode, active: i.active };
}

function NetSuiteImportPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<NetSuiteListedItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAllProgress, setImportAllProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, NetSuiteListedItem>>({});
  const [notConfigured, setNotConfigured] = useState(false);
  const [hideImported, setHideImported] = useState(false);
  // Newest-added first by default. Item/name sort in NetSuite; status sorts the loaded page.
  const [sortKey, setSortKey] = useState<ItemSortKey>("datecreated");
  const [sortDir, setSortDir] = useState<ItemSortDir>("desc");
  const limit = hideImported ? HIDE_IMPORTED_PAGE_SIZE : PAGE_SIZE;

  const fetchItems = useCallback(async (nextOffset: number, nextSearch: string, nextSort: ItemSortKey, nextDir: ItemSortDir, nextLimit: number) => {
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

      const serverSort = nextSort === "status" ? "datecreated" : nextSort;
      const serverDir = nextSort === "status" ? "desc" : nextDir;
      const { data, error } = await supabase.functions.invoke("netsuite-connection", {
        body: { action: "list_items", search: nextSearch || undefined, limit: nextLimit, offset: nextOffset, sort: serverSort, direction: serverDir },
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

  useEffect(() => { void fetchItems(0, "", "datecreated", "desc", PAGE_SIZE); }, [fetchItems]);

  const runSearch = () => {
    const trimmed = searchInput.trim();
    setSearch(trimmed);
    setOffset(0);
    void fetchItems(0, trimmed, sortKey, sortDir, limit);
  };

  const goToPage = (nextOffset: number) => {
    setOffset(nextOffset);
    void fetchItems(nextOffset, search, sortKey, sortDir, limit);
  };

  const toggleHideImported = (checked: boolean) => {
    const nextLimit = checked ? HIDE_IMPORTED_PAGE_SIZE : PAGE_SIZE;
    setHideImported(checked);
    setOffset(0);
    void fetchItems(0, search, sortKey, sortDir, nextLimit);
  };

  const toggleSort = (key: ItemSortKey) => {
    const dir: ItemSortDir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    setSortKey(key);
    setSortDir(dir);
    if (key === "status") return; // client-side on the loaded page
    setOffset(0);
    void fetchItems(0, search, key, dir, limit);
  };

  const visibleItems = useMemo(() => {
    const base = hideImported ? items.filter((i) => !i.alreadyImported) : items;
    if (sortKey !== "status") return base;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => (Number(a.alreadyImported) - Number(b.alreadyImported)) * factor);
  }, [items, hideImported, sortKey, sortDir]);

  const toggleSelected = (item: NetSuiteListedItem) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[item.externalId]) delete next[item.externalId];
      else next[item.externalId] = item;
      return next;
    });
  };

  const selectedCount = Object.keys(selected).length;

  const refreshAfterImport = async () => {
    setSelected({});
    await fetchItems(offset, search, sortKey, sortDir, limit);
    await queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const sendImport = async (batch: NetSuiteListedItem[]) => {
    const { data, error } = await supabase.functions.invoke("netsuite-connection", {
      body: { action: "import_items", items: batch.map(toImportPayload) },
    });
    if (error) throw error;
    const result = data as { succeeded?: number; failed?: number; error?: string };
    if (result?.error) throw new Error(result.error);
    return { succeeded: result?.succeeded ?? 0, failed: result?.failed ?? 0 };
  };

  const reportImport = (succeeded: number, failed: number) => {
    if (failed > 0) toast.warning(`Imported ${succeeded}, ${failed} failed — check System Log for details.`);
    else toast.success(`Imported ${succeeded} product${succeeded === 1 ? "" : "s"} from NetSuite`);
  };

  const handleImport = async () => {
    const toImport = Object.values(selected);
    if (toImport.length === 0) return;
    setImporting(true);
    try {
      const r = await sendImport(toImport);
      reportImport(r.succeeded, r.failed);
      await refreshAfterImport();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // Walks every page matching the current search (100 at a time) and imports the not-yet-imported items.
  const handleImportAll = async () => {
    setImporting(true);
    let succeeded = 0;
    let failed = 0;
    let scanned = 0;
    try {
      let pageOffset = 0;
      for (;;) {
        setImportAllProgress(`Checked ${scanned} · imported ${succeeded}…`);
        const { data, error } = await supabase.functions.invoke("netsuite-connection", {
          body: { action: "list_items", search: search || undefined, limit: 100, offset: pageOffset, sort: "datecreated", direction: "desc" },
        });
        if (error) throw error;
        const result = data as { items?: NetSuiteListedItem[]; hasMore?: boolean; error?: string };
        if (result?.error) throw new Error(result.error);
        const page = result?.items ?? [];
        scanned += page.length;
        const pending = page.filter((i) => !i.alreadyImported);
        if (pending.length > 0) {
          const r = await sendImport(pending);
          succeeded += r.succeeded;
          failed += r.failed;
        }
        if (!result?.hasMore || page.length === 0) break;
        pageOffset += page.length;
      }
      if (succeeded === 0 && failed === 0) toast.info("Everything in this list is already imported.");
      else reportImport(succeeded, failed);
      await refreshAfterImport();
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : "Import failed"} (imported ${succeeded} before stopping — run Import all again to continue)`);
    } finally {
      setImporting(false);
      setImportAllProgress(null);
    }
  };

  const sortHead = (key: ItemSortKey, label: string) => (
    <TableHead aria-sort={sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(key)}>
        {label}
        {sortKey === key ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-50" />}
      </button>
    </TableHead>
  );

  return (
    <div className="grid min-h-0 gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
            placeholder="Search by item ID or name…"
            aria-label="Search NetSuite items"
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={runSearch} disabled={loading}>Search</Button>
        <Button size="sm" onClick={handleImport} disabled={selectedCount === 0 || importing}>
          {importing && !importAllProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Import selected ({selectedCount})
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="secondary" disabled={importing || notConfigured}>
              {importAllProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {importAllProgress ?? "Import all"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Import all items?</AlertDialogTitle>
              <AlertDialogDescription>
                {search
                  ? `Every active NetSuite item matching "${search}" that is not imported yet will be added.`
                  : "Every active NetSuite item that is not imported yet will be added. Large catalogs can take a few minutes — keep this window open."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void handleImportAll()}>Import all</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox id="ns-hide-imported" checked={hideImported} onCheckedChange={(v) => toggleHideImported(v === true)} />
        <Label htmlFor="ns-hide-imported" className="text-sm font-normal">Hide products that are already imported</Label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : notConfigured ? (
        <p className="text-sm text-muted-foreground">NetSuite is not connected yet. Save valid credentials under Settings → Integrations to browse the item catalog.</p>
      ) : visibleItems.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {items.length > 0 && hideImported
            ? "Every item on this page is already imported. Use Next to keep looking."
            : "No items found. Make sure the NetSuite connection is configured and enabled."}
        </p>
      ) : (
        <div className="min-h-0 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                {sortHead("itemid", "Item ID")}
                {sortHead("displayname", "Name")}
                <TableHead>UPC</TableHead>
                {sortHead("status", "Status")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleItems.map((item) => (
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
    </div>
  );
}

/** Modal wrapper. The panel mounts only while open, so NetSuite is not queried until the user asks. */
export function NetSuiteImportDialog({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Import Products from NetSuite</DialogTitle>
          <DialogDescription>
            Search the NetSuite item catalog and choose which products to bring into Warehouse Wizard. Re-selecting an already-imported item updates it.
          </DialogDescription>
        </DialogHeader>
        {open ? <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><NetSuiteImportPanel /></div> : null}
      </DialogContent>
    </Dialog>
  );
}
