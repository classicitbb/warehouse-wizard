import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Clock,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  listAllTickets,
  updateTicketStatus,
  type StoredTicket,
  type TicketKind,
  type TicketSeverity,
  type TicketStatus,
} from "@/features/copilot/feedback-core";
import { formatDate } from "@/lib/wms-core";
import { cn } from "@/lib/utils";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STATUS_OPTIONS: { value: TicketStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "triaged", label: "Triaged" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "wont_fix", label: "Won't Fix" },
];

const KIND_LABELS: Record<TicketKind, string> = {
  bug: "Bug",
  feedback: "Feedback",
  request: "Request",
  question: "Question",
};

const SEVERITY_ORDER: Record<TicketSeverity, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

function severityBadge(severity: TicketSeverity) {
  switch (severity) {
    case "critical":
      return (
        <Badge variant="destructive" className="gap-1">
          <ShieldAlert className="h-3 w-3" /> Critical
        </Badge>
      );
    case "high":
      return (
        <Badge className="gap-1 bg-orange-500 text-white hover:bg-orange-600">
          <AlertCircle className="h-3 w-3" /> High
        </Badge>
      );
    case "low":
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" /> Low
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1">
          <MessageSquare className="h-3 w-3" /> Normal
        </Badge>
      );
  }
}

function kindIcon(kind: TicketKind) {
  switch (kind) {
    case "bug":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "feedback":
      return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
    case "request":
      return <Lightbulb className="h-4 w-4 text-yellow-500" />;
    case "question":
      return <HelpCircle className="h-4 w-4 text-blue-500" />;
  }
}

function statusBadge(status: TicketStatus) {
  switch (status) {
    case "resolved":
      return (
        <Badge variant="outline" className="gap-1 text-green-600 border-green-600/30 bg-green-50">
          <CheckCircle2 className="h-3 w-3" /> Resolved
        </Badge>
      );
    case "wont_fix":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <CircleOff className="h-3 w-3" /> Won't fix
        </Badge>
      );
    case "in_progress":
      return (
        <Badge variant="outline" className="gap-1 text-blue-600 border-blue-600/30 bg-blue-50">
          <Loader2 className="h-3 w-3 animate-spin" /> In progress
        </Badge>
      );
    case "triaged":
      return (
        <Badge variant="outline" className="gap-1 text-purple-600 border-purple-600/30 bg-purple-50">
          <ArrowUpRight className="h-3 w-3" /> Triaged
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-orange-600 border-orange-600/30 bg-orange-50">
          <Clock className="h-3 w-3" /> Open
        </Badge>
      );
  }
}

async function fetchReporterProfiles(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, { email?: string; full_name?: string }>();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", Array.from(new Set(userIds)));
  if (error) throw error;
  const map = new Map<string, { email?: string; full_name?: string }>();
  for (const row of data ?? []) {
    map.set(row.id as string, { email: row.email as string | undefined, full_name: row.full_name as string | undefined });
  }
  return map;
}

export function SupportRequestsPanel() {
  const { roles } = useAuth();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "all">("all");
  const [selectedTicket, setSelectedTicket] = useState<StoredTicket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const isAdmin = roles.some((r) => ["developer", "admin"].includes(r));

  const { data: tickets = [], isLoading, error, refetch } = useQuery({
    queryKey: ["support-requests", "all-tickets"],
    queryFn: () => listAllTickets(200),
  });

  const reporterIds = useMemo(() => tickets.map((t) => t.reportedBy).filter(Boolean), [tickets]);
  const { data: reporterMap = new Map() } = useQuery({
    queryKey: ["support-requests", "reporter-profiles", reporterIds],
    queryFn: () => fetchReporterProfiles(reporterIds),
    enabled: reporterIds.length > 0,
  });

  const updateMutation = useMutation({
    mutationFn: ({
      ticketId,
      status,
      resolution,
    }: {
      ticketId: string;
      status: TicketStatus;
      resolution?: string | null;
    }) => updateTicketStatus(ticketId, status, { resolution }),
    onSuccess: () => {
      toast.success("Ticket updated");
      void queryClient.invalidateQueries({ queryKey: ["support-requests"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Update failed"),
  });

  const filteredTickets = useMemo(() => {
    let rows = tickets;
    if (statusFilter !== "all") {
      rows = rows.filter((t) => t.status === statusFilter);
    }
    const term = filter.trim().toLowerCase();
    if (term) {
      rows = rows.filter(
        (t) =>
          t.title.toLowerCase().includes(term) ||
          t.ticketNumber?.toLowerCase().includes(term) ||
          t.module.toLowerCase().includes(term) ||
          reporterMap.get(t.reportedBy)?.email?.toLowerCase().includes(term) ||
          reporterMap.get(t.reportedBy)?.full_name?.toLowerCase().includes(term),
      );
    }
    return rows.slice().sort((a, b) => {
      const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tickets, statusFilter, filter, reporterMap]);

  const openCounts = useMemo(() => {
    const counts: Record<TicketStatus | "all", number> = {
      all: tickets.length,
      draft: 0,
      open: 0,
      triaged: 0,
      in_progress: 0,
      resolved: 0,
      wont_fix: 0,
    };
    for (const t of tickets) counts[t.status] = (counts[t.status] ?? 0) + 1;
    return counts;
  }, [tickets]);

  function openDetail(ticket: StoredTicket) {
    setSelectedTicket(ticket);
    setDetailOpen(true);
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Support Requests
              </CardTitle>
              <CardDescription>
                Operator reports, feedback, and questions filed through the Copilot panel.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isLoading}>
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as TicketStatus | "all")}>
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="all">All ({openCounts.all})</TabsTrigger>
              <TabsTrigger value="open">Open ({openCounts.open})</TabsTrigger>
              <TabsTrigger value="triaged">Triaged ({openCounts.triaged})</TabsTrigger>
              <TabsTrigger value="in_progress">In Progress ({openCounts.in_progress})</TabsTrigger>
              <TabsTrigger value="resolved">Resolved ({openCounts.resolved})</TabsTrigger>
              <TabsTrigger value="wont_fix">Won't Fix ({openCounts.wont_fix})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by ticket number, title, module, or reporter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <p className="font-medium">Could not load support requests</p>
              <p className="text-muted-foreground">{error instanceof Error ? error.message : String(error)}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Ticket</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead className="w-[100px]">Kind</TableHead>
                    <TableHead className="w-[100px]">Severity</TableHead>
                    <TableHead className="w-[110px]">Status</TableHead>
                    <TableHead className="w-[160px]">Reporter</TableHead>
                    <TableHead className="w-[140px]">Submitted</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center">
                        <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : filteredTickets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                        No support requests match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredTickets.map((ticket) => {
                      const reporter = reporterMap.get(ticket.reportedBy);
                      return (
                        <TableRow
                          key={ticket.id}
                          className="cursor-pointer"
                          onClick={() => openDetail(ticket)}
                        >
                          <TableCell className="font-mono text-xs">
                            {ticket.ticketNumber ?? "—"}
                          </TableCell>
                          <TableCell className="max-w-xs truncate font-medium">
                            {ticket.title || "Untitled"}
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5">
                              {kindIcon(ticket.kind)}
                              <span className="text-sm">{KIND_LABELS[ticket.kind]}</span>
                            </span>
                          </TableCell>
                          <TableCell>{severityBadge(ticket.severity)}</TableCell>
                          <TableCell>{statusBadge(ticket.status)}</TableCell>
                          <TableCell className="text-sm">
                            {reporter?.full_name || reporter?.email || "Unknown"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {ticket.submittedAt ? formatDate(ticket.submittedAt) : formatDate(ticket.createdAt)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetail(ticket);
                              }}
                            >
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selectedTicket && kindIcon(selectedTicket.kind)}
              {selectedTicket?.title || "Support request"}
            </SheetTitle>
          </SheetHeader>
          {selectedTicket && (
            <div className="mt-6 grid gap-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm">{selectedTicket.ticketNumber ?? "—"}</span>
                {severityBadge(selectedTicket.severity)}
                {statusBadge(selectedTicket.status)}
              </div>

              <div className="grid gap-2 text-sm">
                <div className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">Module</span>
                  <span className="font-medium capitalize">{selectedTicket.module}</span>
                </div>
                <div className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">Screen</span>
                  <span className="font-medium">{selectedTicket.route || "—"}</span>
                </div>
                <div className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">App version</span>
                  <span className="font-medium">{selectedTicket.appVersion || "—"}</span>
                </div>
                <div className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">Reporter</span>
                  <span className="font-medium">
                    {reporterMap.get(selectedTicket.reportedBy)?.full_name ||
                      reporterMap.get(selectedTicket.reportedBy)?.email ||
                      "Unknown"}
                  </span>
                </div>
                <div className="flex justify-between border-b py-1">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="font-medium">
                    {selectedTicket.submittedAt
                      ? formatDate(selectedTicket.submittedAt)
                      : formatDate(selectedTicket.createdAt)}
                  </span>
                </div>
              </div>

              {selectedTicket.actualBehavior && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">What happened</h4>
                  <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                    {selectedTicket.actualBehavior}
                  </p>
                </div>
              )}

              {selectedTicket.expectedBehavior && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">What should happen</h4>
                  <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                    {selectedTicket.expectedBehavior}
                  </p>
                </div>
              )}

              {selectedTicket.stepsToReproduce && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">Steps to reproduce</h4>
                  <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                    {selectedTicket.stepsToReproduce}
                  </p>
                </div>
              )}

              {selectedTicket.summary && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">Detail</h4>
                  <p className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">{selectedTicket.summary}</p>
                </div>
              )}

              {selectedTicket.clarifications.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">Clarifying exchange</h4>
                  <div className="grid gap-2">
                    {selectedTicket.clarifications.map((c, idx) => (
                      <div key={idx} className="rounded-md border p-3 text-sm">
                        <p className="font-medium">{c.question}</p>
                        <p className="mt-1 text-muted-foreground">{c.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedTicket.agentBrief && (
                <div>
                  <h4 className="mb-1 text-sm font-medium">Agent brief</h4>
                  <div className="max-h-96 overflow-auto rounded-md border bg-muted/50 p-3">
                    <pre className="whitespace-pre-wrap text-xs font-mono leading-relaxed">
                      {selectedTicket.agentBrief}
                    </pre>
                  </div>
                </div>
              )}

              <div className="grid gap-3 rounded-lg border p-4">
                <h4 className="text-sm font-medium">Update status</h4>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Select
                    value={selectedTicket.status}
                    onValueChange={(value) =>
                      updateMutation.mutate({
                        ticketId: selectedTicket.id,
                        status: value as TicketStatus,
                      })
                    }
                    disabled={updateMutation.isPending}
                  >
                    <SelectTrigger className="w-full sm:w-[220px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isAdmin && selectedTicket.status !== "resolved" && selectedTicket.status !== "wont_fix" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          ticketId: selectedTicket.id,
                          status: "resolved",
                        })
                      }
                      disabled={updateMutation.isPending}
                    >
                      <CheckCircle2 className="mr-1.5 h-4 w-4" /> Mark resolved
                    </Button>
                  )}
                </div>
                {updateMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
