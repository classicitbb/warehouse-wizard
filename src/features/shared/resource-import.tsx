// CSV/XLSX import button and its preview dialog for resource tables.
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileDown, Info, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  commitImportRows,
  downloadCsv,
  downloadCsvTemplate,
  type ImportPreview,
  type ImportProgress,
  parseCsvForResource,
  type ResourceDefinition,
} from "@/lib/wms-core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

// ── Inferred-field override state for product imports ────────────────────────
type ProductOverrides = {
  temperature_requirement: string;
  rotation_method: string;
  expiry_tracked: boolean;
  lot_tracked: boolean;
  batch_tracked: boolean;
};

function applyOverridesToPreview(preview: ImportPreview, overrides: ProductOverrides): ImportPreview {
  if (preview.resourceTable !== "products") return preview;
  const rows = preview.rows.map((r) => {
    if (!r.normalized || !r.inferred) return r;
    const updated = {
      ...r.normalized,
      temperature_requirement: overrides.temperature_requirement,
      rotation_method: overrides.rotation_method,
      expiry_tracked: overrides.expiry_tracked,
      lot_tracked: overrides.lot_tracked,
      batch_tracked: overrides.batch_tracked,
    };
    return { ...r, normalized: updated };
  });
  return { ...preview, rows };
}

export function ImportButton({ resource, asMenuItems = false }: { resource: ResourceDefinition; asMenuItems?: boolean }) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress>({ completed: 0, total: 0, inserted: 0, failed: 0 });
  const [overrides, setOverrides] = useState<ProductOverrides | null>(null);

  function handleImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setParsing(true);
      try {
        const p = await parseCsvForResource(resource, file);
        setPreview(p);
        // Seed overrides from the first inferred row so the panel has sensible defaults
        if (resource.table === "products") {
          const firstInferred = p.rows.find((r) => r.inferred);
          if (firstInferred?.inferred) {
            const inf = firstInferred.inferred;
            setOverrides({
              temperature_requirement: inf.temperature_requirement,
              rotation_method: inf.rotation_method,
              expiry_tracked: inf.expiry_tracked,
              lot_tracked: inf.lot_tracked,
              batch_tracked: inf.batch_tracked,
            });
          } else {
            setOverrides({ temperature_requirement: "ambient", rotation_method: "fifo", expiry_tracked: false, lot_tracked: false, batch_tracked: false });
          }
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not parse CSV");
      } finally {
        setParsing(false);
      }
    };
    input.click();
  }

  async function handleConfirm() {
    if (!preview) return;
    const finalPreview = (resource.table === "products" && overrides)
      ? applyOverridesToPreview(preview, overrides)
      : preview;
    setImportProgress({ completed: 0, total: finalPreview.summary.valid, inserted: 0, failed: 0 });
    setCommitting(true);
    try {
      const result = await commitImportRows(resource, finalPreview, setImportProgress);
      if (result.failed > 0) {
        downloadCsv(`${resource.table}-errors.csv`, result.errors);
        toast.error(`Imported ${result.inserted}, failed ${result.failed} — error report downloaded`);
      } else {
        toast.success(`Imported ${result.inserted} ${resource.title.toLowerCase()}`);
      }
      setPreview(null);
      setOverrides(null);
      await queryClient.invalidateQueries({ queryKey: ["records", resource.table] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  }

  if (asMenuItems) {
    return (
      <>
        <DropdownMenuItem onClick={() => downloadCsvTemplate(resource)}>
          <FileDown className="mr-2 h-4 w-4" />
          Template
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); handleImport(); }} disabled={parsing}>
          <Upload className="mr-2 h-4 w-4" />
          {parsing ? "Parsing…" : "Import CSV"}
        </DropdownMenuItem>
        <ImportPreviewDialog
          resource={resource}
          preview={preview}
          overrides={overrides}
          onOverridesChange={setOverrides}
          onCancel={() => { setPreview(null); setOverrides(null); }}
          onConfirm={handleConfirm}
          committing={committing}
          importProgress={importProgress}
        />
      </>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => downloadCsvTemplate(resource)}>
        <FileDown data-icon="inline-start" />
        Template
      </Button>
      <Button
        variant="outline"
        onClick={handleImport}
        disabled={parsing}
      >
        <Upload data-icon="inline-start" />
        {parsing ? "Parsing…" : "Import CSV"}
      </Button>
      <ImportPreviewDialog
        resource={resource}
        preview={preview}
        overrides={overrides}
        onOverridesChange={setOverrides}
        onCancel={() => { setPreview(null); setOverrides(null); }}
        onConfirm={handleConfirm}
        committing={committing}
        importProgress={importProgress}
      />
    </>
  );
}

const TEMP_OPTIONS = [
  { label: "Ambient", value: "ambient" },
  { label: "Cool", value: "cool" },
  { label: "Frozen", value: "frozen" },
];

const ROTATION_OPTIONS = [
  { label: "FEFO — First Expired First Out", value: "fefo" },
  { label: "FIFO — First In First Out", value: "fifo" },
];

function ImportPreviewDialog({
  resource,
  preview,
  overrides,
  onOverridesChange,
  onCancel,
  onConfirm,
  committing,
  importProgress,
}: {
  resource: ResourceDefinition;
  preview: ImportPreview | null;
  overrides: ProductOverrides | null;
  onOverridesChange: (o: ProductOverrides) => void;
  onCancel: () => void;
  onConfirm: () => void;
  committing: boolean;
  importProgress: ImportProgress;
}) {
  const open = preview !== null;
  const summary = preview?.summary ?? { total: 0, valid: 0, invalid: 0 };
  const isProducts = resource.table === "products";

  // Determine which inferred categories appear in this file
  const inferredCategories = useMemo(() => {
    if (!preview || !isProducts) return [];
    const seen = new Map<string, number>();
    for (const r of preview.rows) {
      if (r.inferred) seen.set(r.inferred.label, (seen.get(r.inferred.label) ?? 0) + 1);
    }
    return Array.from(seen.entries()).map(([label, count]) => ({ label, count }));
  }, [preview, isProducts]);

  const hasInferred = inferredCategories.length > 0;
  const importPercent = importProgress.total > 0
    ? Math.min(100, Math.floor((importProgress.completed / importProgress.total) * 100))
    : 0;

  // Show all non-select fields for products, all fields for others
  const previewCols = isProducts
    ? ["sku", "barcode", "name", "description", "temperature_requirement", "rotation_method", "expiry_tracked", "lot_tracked", "batch_tracked", "active"]
    : resource.fields.map((f) => f.name);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !committing) onCancel(); }}>
      <DialogContent className="flex flex-col w-[95vw] max-w-[95vw] h-[90vh] max-h-[90vh] p-0 gap-0">
        {/* ── Header ── */}
        <div className="flex-none px-6 pt-6 pb-3 border-b">
          <DialogHeader>
            <DialogTitle>Review {resource.title} import</DialogTitle>
            <DialogDescription>
              Rows are validated before anything is written. IDs and timestamps are ignored — new records get fresh IDs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 mt-3 text-sm">
            <Badge variant="secondary">Total {summary.total}</Badge>
            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Valid {summary.valid}</Badge>
            {summary.invalid > 0 && <Badge variant="destructive">Errors {summary.invalid}</Badge>}
            {hasInferred && <Badge className="bg-amber-500 text-white hover:bg-amber-500">Auto-categorised {inferredCategories.reduce((s, c) => s + c.count, 0)}</Badge>}
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 px-6 py-3 gap-3">
          {/* Auto-categorisation override panel */}
          {isProducts && hasInferred && overrides && (
            <div className="flex-none rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-3 space-y-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <span className="font-medium">Fields were inferred from product names.</span>{" "}
                  Detected: {inferredCategories.map((c) => `${c.label} (${c.count})`).join(", ")}.
                  Adjust below to apply different defaults to all auto-categorised rows before importing.
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Temperature</label>
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    value={overrides.temperature_requirement}
                    onChange={(e) => onOverridesChange({ ...overrides, temperature_requirement: e.target.value })}
                  >
                    {TEMP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Rotation</label>
                  <select
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    value={overrides.rotation_method}
                    onChange={(e) => onOverridesChange({ ...overrides, rotation_method: e.target.value })}
                  >
                    {ROTATION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-4 col-span-2 pt-1">
                  {(["expiry_tracked", "lot_tracked", "batch_tracked"] as const).map((f) => (
                    <label key={f} className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={overrides[f]}
                        onChange={(e) => onOverridesChange({ ...overrides, [f]: e.target.checked })}
                        className="h-3.5 w-3.5 accent-amber-600"
                      />
                      <span className="text-xs">{f.replace(/_/g, " ")}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Table: scroll both axes */}
          <div className="flex-1 min-h-0 overflow-auto rounded border">
            <Table className="min-w-max text-xs">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow>
                  <TableHead className="w-10 sticky left-0 bg-background z-20">#</TableHead>
                  <TableHead className="w-20 sticky left-10 bg-background z-20">Status</TableHead>
                  {previewCols.map((c) => (
                    <TableHead key={c} className="whitespace-nowrap px-3">{c}</TableHead>
                  ))}
                  <TableHead className="min-w-[200px]">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview?.rows.map((r) => {
                  const effectiveNormalized = (isProducts && overrides && r.inferred && r.normalized)
                    ? { ...r.normalized, ...overrides }
                    : r.normalized;
                  return (
                    <TableRow key={r.rowNumber} className={r.inferred ? "bg-amber-50/40 dark:bg-amber-950/20" : undefined}>
                      <TableCell className="font-mono sticky left-0 bg-inherit">{r.rowNumber}</TableCell>
                      <TableCell className="sticky left-10 bg-inherit">
                        {effectiveNormalized
                          ? <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px] px-1.5">{r.inferred ? "Auto" : "OK"}</Badge>
                          : <Badge variant="destructive" className="text-[10px] px-1.5">Error</Badge>}
                      </TableCell>
                      {previewCols.map((c) => {
                        const val = String((effectiveNormalized?.[c] ?? r.raw[c]) ?? "");
                        const wasInferred = r.inferred && effectiveNormalized && c in (r.inferred as object) && !(c in r.raw || r.raw[c]);
                        return (
                          <TableCell key={c} className={`whitespace-nowrap px-3 ${wasInferred ? "text-amber-700 dark:text-amber-400 font-medium" : ""}`}>
                            {val === "true" ? "✓" : val === "false" ? "–" : val}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-muted-foreground min-w-[200px]">
                        {r.errors.length > 0
                          ? <span className="text-destructive">{r.errors.join("; ")}</span>
                          : r.warnings.filter((w) => !w.startsWith("Auto-categorised")).join("; ")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex-none px-6 py-4 border-t space-y-3">
          {committing && (
            <div className="space-y-1.5" aria-live="polite">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Importing rows</span>
                <span>{importPercent}% · {importProgress.completed.toLocaleString()} of {importProgress.total.toLocaleString()}</span>
              </div>
              <Progress value={importPercent} className="h-2" />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel} disabled={committing}>Cancel</Button>
            <Button onClick={onConfirm} disabled={committing || summary.valid === 0}>
              {committing ? `Importing ${importPercent}%` : <><Upload data-icon="inline-start" />Import {summary.valid} row{summary.valid === 1 ? "" : "s"}</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
