// Settings > Integrations: NetSuite sync job monitor with attempt history and AI run summaries.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const MAX_ATTEMPTS = 5;
const STATUSES = ["queued", "running", "succeeded", "failed", "dead_letter"] as const;

type SyncJob = {
  id: string;
  job_type: string;
  status: string;
  attempts: number;
  error_message: string | null;
  result: unknown;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
  netsuiteId: string | null;
  alreadyPosted: boolean;
  payload?: unknown;
};

type PayloadLog = { id: string; direction: string; payload: unknown; response: unknown; http_status: number | null; created_at: string };
type DeadLetter = { id: string; reason: string; resolved_at: string | null; created_at: string };
type Summary = {
  summary: string;
  failures: Array<{ jobId: string; cause: string; evidence: string }>;
  nextSteps: string[];
  stats: { totalJobs: number; byStatus: Record<string, number> };
  truncated: { jobs: boolean; logs: boolean };
};
type Filters = { status: string; from: string; to: string };

async function callAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("netsuite-sync-admin", { body });
  if (error) {
    // supabase-js wraps non-2xx responses; surface the function's own message.
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? error.message);
  }
  return data as T;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "default";
  if (status === "failed" || status === "dead_letter") return "destructive";
  if (status === "running") return "secondary";
  return "outline";
}

const formatTime = (iso: string) => new Date(iso).toLocaleString();
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

// A date input yields local midnight; the end bound is the end of that day.
const startOfDay = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : undefined);
const endOfDay = (d: string) => (d ? new Date(`${d}T23:59:59.999`).toISOString() : undefined);

function SummaryPanel({ summary }: { summary: Summary }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-4 text-sm">
      <p className="whitespace-pre-wrap">{summary.summary}</p>
      {summary.failures.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Failures</div>
          <ul className="space-y-2">
            {summary.failures.map((f, i) => (
              <li key={`${f.jobId}-${i}`} className="rounded border border-border p-2">
                <div className="font-mono text-xs text-muted-foreground">{f.jobId}</div>
                <div>{f.cause}</div>
                {f.evidence && <div className="text-xs text-muted-foreground">Evidence: {f.evidence}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.nextSteps.length > 0 && (
        <div>
          <div className="mb-1 font-medium">Recommended next steps</div>
          <ol className="list-decimal space-y-1 pl-5">
            {summary.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        AI-generated from {summary.stats.totalJobs} job(s){summary.truncated.jobs || summary.truncated.logs ? ", capped to the most recent records" : ""}. Verify before acting.
      </p>
    </div>
  );
}

function JobDetailDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const detail = useQuery({
    queryKey: ["settings", "netsuite-sync", "detail", jobId],
    enabled: !!jobId,
    queryFn: () => callAdmin<{ job: SyncJob; logs: PayloadLog[]; deadLetters: DeadLetter[] }>({ action: "detail", jobId }),
  });

  const summarize = async () => {
    if (!jobId) return;
    setSummarizing(true);
    try {
      setSummary(await callAdmin<Summary>({ action: "summarize", jobId }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI summary failed");
    } finally {
      setSummarizing(false);
    }
  };

  const job = detail.data?.job;
  return (
    <Dialog open={!!jobId} onOpenChange={(open) => { if (!open) { setSummary(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Sync job {job ? <Badge variant={statusVariant(job.status)} className="ml-2">{job.status}</Badge> : null}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{jobId}</DialogDescription>
        </DialogHeader>
        {detail.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {detail.error && <p className="text-sm text-destructive">{(detail.error as Error).message}</p>}
        {job && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Type</dt><dd>{job.job_type}</dd>
              <dt className="text-muted-foreground">Attempts</dt><dd>{job.attempts} / {MAX_ATTEMPTS}</dd>
              <dt className="text-muted-foreground">NetSuite adjustment ID</dt>
              <dd>{job.netsuiteId ?? "—"}{job.alreadyPosted ? " (already posted)" : ""}</dd>
              <dt className="text-muted-foreground">Created</dt><dd>{formatTime(job.created_at)}</dd>
              <dt className="text-muted-foreground">Updated</dt><dd>{formatTime(job.updated_at)}</dd>
              <dt className="text-muted-foreground">Idempotency key</dt><dd className="break-all font-mono text-xs">{job.idempotency_key}</dd>
            </dl>
            {job.error_message && <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">{job.error_message}</p>}
            {detail.data!.deadLetters.map((d) => (
              <p key={d.id} className="rounded border border-destructive/40 p-2 text-xs">
                Dead-lettered {formatTime(d.created_at)}: {d.reason}{d.resolved_at ? ` (resolved ${formatTime(d.resolved_at)})` : ""}
              </p>
            ))}

            <div>
              <div className="mb-2 font-medium">Attempt history ({detail.data!.logs.length})</div>
              {detail.data!.logs.length === 0 && (
                <p className="text-xs text-muted-foreground">No payload log. The job has not been attempted, or its logs were purged after 90 days.</p>
              )}
              <ol className="space-y-2">
                {detail.data!.logs.map((log, i) => (
                  <li key={log.id} className="rounded border border-border p-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium">#{i + 1} {log.direction}</span>
                      <Badge variant={log.http_status && log.http_status < 300 ? "default" : "destructive"}>{log.http_status ?? "no response"}</Badge>
                      <span className="text-muted-foreground">{formatTime(log.created_at)}</span>
                    </div>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Request</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{pretty(log.payload)}</pre>
                    </details>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-muted-foreground">Response</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 text-[11px]">{pretty(log.response)}</pre>
                    </details>
                  </li>
                ))}
              </ol>
            </div>

            <div className="space-y-2">
              <Button size="sm" variant="outline" onClick={summarize} disabled={summarizing}>
                {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                Explain this job with AI
              </Button>
              {summary && <SummaryPanel summary={summary} />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function NetSuiteSyncJobsCard() {
  const [filters, setFilters] = useState<Filters>({ status: "", from: "", to: "" });
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const range = { status: filters.status || undefined, from: startOfDay(filters.from), to: endOfDay(filters.to) };
  const jobs = useQuery({
    queryKey: ["settings", "netsuite-sync", "jobs", filters],
    queryFn: () => callAdmin<{ jobs: SyncJob[] }>({ action: "list", ...range }),
  });

  const summarizeRange = async () => {
    setSummarizing(true);
    try {
      setSummary(await callAdmin<Summary>({ action: "summarize", ...range }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI summary failed");
    } finally {
      setSummarizing(false);
    }
  };

  const rows = jobs.data?.jobs ?? [];
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>NetSuite sync jobs</CardTitle>
        <CardDescription>Status, attempt history and NetSuite adjustment IDs. Open a job for its request and response log.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sync-status">Status</Label>
            <select
              id="sync-status"
              value={filters.status}
              onChange={(e) => { setSummary(null); setFilters({ ...filters, status: e.target.value }); }}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sync-from">From</Label>
            <Input id="sync-from" type="date" value={filters.from} onChange={(e) => { setSummary(null); setFilters({ ...filters, from: e.target.value }); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sync-to">To</Label>
            <Input id="sync-to" type="date" value={filters.to} onChange={(e) => { setSummary(null); setFilters({ ...filters, to: e.target.value }); }} />
          </div>
          <Button variant="outline" size="sm" onClick={() => jobs.refetch()} disabled={jobs.isFetching}>
            <RefreshCw className={`mr-2 h-4 w-4 ${jobs.isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={summarizeRange} disabled={summarizing || rows.length === 0}>
            {summarizing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Summarize with AI
          </Button>
        </div>

        {summary && <SummaryPanel summary={summary} />}
        {jobs.error && <p className="text-sm text-destructive">{(jobs.error as Error).message}</p>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Adjustment ID</TableHead>
              <TableHead>Error</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.isLoading && <TableRow><TableCell colSpan={6}><Loader2 className="h-4 w-4 animate-spin" /></TableCell></TableRow>}
            {!jobs.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={6} className="text-muted-foreground">No sync jobs match.</TableCell></TableRow>}
            {rows.map((job) => (
              <TableRow key={job.id} className="cursor-pointer" onClick={() => setOpenJob(job.id)} data-testid={`sync-job-${job.id}`}>
                <TableCell><Badge variant={statusVariant(job.status)}>{job.status}</Badge></TableCell>
                <TableCell>{job.job_type}</TableCell>
                <TableCell>{job.attempts} / {MAX_ATTEMPTS}</TableCell>
                <TableCell>{job.netsuiteId ?? "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{job.error_message ?? ""}</TableCell>
                <TableCell>{formatTime(job.created_at)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <JobDetailDialog jobId={openJob} onClose={() => setOpenJob(null)} />
    </Card>
  );
}
