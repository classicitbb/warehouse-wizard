/**
 * feedback-core.ts
 *
 * Operator problem reports and feedback, turned into tickets an agent can pick
 * up and repair.
 *
 * The interview is deterministic, not model-driven. `nextClarifyingQuestion()`
 * decides what is still missing from a report; the copilot only supplies the
 * wording around it. That means a report filed on a handheld at 03:00 collects
 * the same facts whether or not the model was having a good day, and the same
 * logic is what the UI uses to show progress.
 *
 * A ticket is a description of a problem. Nothing in this module writes to an
 * operational WMS table.
 */

import { supabase } from "@/integrations/supabase/client";
import { db, formatSupabaseError } from "@/features/shared/core-types";
import { getRouteHelp } from "@/lib/help-content";
import {
  describeHabitsForCopilot,
  lastFailedAction,
  localHabitSummary,
  recentActions,
  type ActionEvent,
  type HabitSummary,
} from "@/lib/habit-tracking";

export type TicketKind = "bug" | "feedback" | "request" | "question";
export type TicketStatus = "draft" | "open" | "triaged" | "in_progress" | "resolved" | "wont_fix";
export type TicketSeverity = "low" | "normal" | "high" | "critical";

export type Clarification = {
  /** The draft field this exchange was filling in. */
  field: TicketField;
  question: string;
  answer: string;
  askedAt: string;
};

export type TicketEvidence = {
  recentActions: ActionEvent[];
  recentErrors: Array<{ title: string; message: string; source: string; at: string }>;
  systemLogIds: string[];
  habits: HabitSummary | null;
};

export type TicketDraft = {
  id?: string;
  ticketNumber?: string | null;
  kind: TicketKind;
  status: TicketStatus;
  severity: TicketSeverity;
  title: string;
  summary: string;
  stepsToReproduce: string;
  expectedBehavior: string;
  actualBehavior: string;
  route: string;
  module: string;
  appVersion: string;
  userAgent: string;
  warehouseId: string | null;
  conversationId: string | null;
  clarifications: Clarification[];
  evidence: TicketEvidence;
  labels: string[];
  /** Storage path of the screen capture taken when the report was started. */
  screenshotPath?: string | null;
};

export type TicketField =
  | "title"
  | "summary"
  | "actualBehavior"
  | "expectedBehavior"
  | "stepsToReproduce"
  | "severity";

// ── The interview ────────────────────────────────────────────────────────────

/**
 * What each kind of report has to answer before it is worth an agent's time.
 * Order matters: this is the order the operator is asked.
 */
const REQUIRED_FIELDS: Record<TicketKind, TicketField[]> = {
  bug: ["title", "actualBehavior", "expectedBehavior", "stepsToReproduce", "severity"],
  request: ["title", "summary", "expectedBehavior"],
  feedback: ["title", "summary"],
  question: ["title", "summary"],
};

type QuestionSpec = { question: (draft: TicketDraft) => string; hint?: string };

const QUESTIONS: Record<TicketField, QuestionSpec> = {
  title: {
    question: (draft) =>
      draft.kind === "bug"
        ? "In one line — what were you trying to do when it went wrong?"
        : "In one line — what is this about?",
    hint: "Short is fine. \"Putaway confirm rejects a valid pallet\" is plenty.",
  },
  actualBehavior: {
    question: () => "What actually happened? Include any message you saw on screen.",
    hint: "Quote the error text if there was one.",
  },
  expectedBehavior: {
    question: (draft) =>
      draft.kind === "request"
        ? "What would you want it to do instead?"
        : "What did you expect to happen instead?",
  },
  stepsToReproduce: {
    question: () => "Walk me through it — what do I press, in order, to make it happen again?",
    hint: "Rough steps are fine. Add the pallet, location or task number if one was involved.",
  },
  summary: {
    question: (draft) =>
      draft.kind === "question"
        ? "What do you need to know?"
        : "Tell me a bit more — what should we know about it?",
  },
  severity: {
    question: () => "Is this stopping work right now, slowing it down, or just annoying?",
    hint: "Stopping work → critical. Slowing it down → high. Annoying → normal.",
  },
};

const FIELD_LABELS: Record<TicketField, string> = {
  title: "Summary line",
  summary: "Detail",
  actualBehavior: "What happened",
  expectedBehavior: "What should happen",
  stepsToReproduce: "Steps to reproduce",
  severity: "Impact",
};

function isAnswered(draft: TicketDraft, field: TicketField): boolean {
  if (field === "severity") {
    // `normal` is the default, so it only counts as answered once the operator
    // (or a signal strong enough to override it) has actually set it.
    return draft.severity !== "normal" || draft.labels.includes("severity-confirmed");
  }
  return String(draft[field] ?? "").trim().length > 0;
}

/** Fields still missing, in the order they should be asked. */
export function missingFields(draft: TicketDraft): TicketField[] {
  return REQUIRED_FIELDS[draft.kind].filter((field) => !isAnswered(draft, field));
}

export type ClarifyingQuestion = {
  field: TicketField;
  label: string;
  question: string;
  hint?: string;
  /** How many required fields remain including this one. */
  remaining: number;
};

/** The next thing to ask, or null when the report is complete. */
export function nextClarifyingQuestion(draft: TicketDraft): ClarifyingQuestion | null {
  const missing = missingFields(draft);
  const field = missing[0];
  if (!field) return null;
  const spec = QUESTIONS[field];
  return {
    field,
    label: FIELD_LABELS[field],
    question: spec.question(draft),
    hint: spec.hint,
    remaining: missing.length,
  };
}

export type TicketReadiness = {
  complete: boolean;
  missing: TicketField[];
  answered: number;
  required: number;
  percent: number;
};

export function ticketReadiness(draft: TicketDraft): TicketReadiness {
  const required = REQUIRED_FIELDS[draft.kind];
  const missing = missingFields(draft);
  const answered = required.length - missing.length;
  return {
    complete: missing.length === 0,
    missing,
    answered,
    required: required.length,
    percent: required.length === 0 ? 100 : Math.round((answered / required.length) * 100),
  };
}

/** Record an answer against the field it was asked for. */
export function applyAnswer(draft: TicketDraft, field: TicketField, answer: string): TicketDraft {
  const trimmed = answer.trim();
  const clarification: Clarification = {
    field,
    question: QUESTIONS[field].question(draft),
    answer: trimmed,
    askedAt: new Date().toISOString(),
  };
  const next: TicketDraft = {
    ...draft,
    clarifications: [...draft.clarifications, clarification],
  };

  if (field === "severity") {
    next.severity = severityFromAnswer(trimmed) ?? draft.severity;
    next.labels = draft.labels.includes("severity-confirmed")
      ? draft.labels
      : [...draft.labels, "severity-confirmed"];
    return next;
  }

  next[field] = trimmed;
  return next;
}

// Most-severe first. Bare "down" is deliberately absent: "it slows us down" is
// a complaint about speed, not a stoppage, and matching it as critical would put
// every slow screen at the top of the repair queue.
const SEVERITY_WORDS: Array<[TicketSeverity, RegExp]> = [
  [
    "critical",
    /\b(critical|stopp\w*|blocked|blocking|cannot work|can'?t work|cannot use|can'?t use|halt\w*|standstill|(?:is|are|it'?s)\s+down)\b/i,
  ],
  ["high", /\b(high|slow\w*|urgent|major|serious|delay\w*|workaround)\b/i],
  ["low", /\b(low|minor|cosmetic|typo|annoy\w*|nitpick|whenever)\b/i],
  ["normal", /\b(normal|medium|moderate)\b/i],
];

/** Map a free-text impact answer onto a severity. Null when it says nothing. */
export function severityFromAnswer(answer: string): TicketSeverity | null {
  for (const [severity, pattern] of SEVERITY_WORDS) {
    if (pattern.test(answer)) return severity;
  }
  return null;
}

// ── Draft construction ───────────────────────────────────────────────────────

function appVersion() {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  } catch {
    return "unknown";
  }
}

/** Module name for a route, reusing the help centre's route map. */
export function moduleForRoute(route: string): string {
  try {
    return getRouteHelp(route)?.id ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Seed a report from what we already know: the screen, the module, the last
 * thing that failed, and the operator's habit context. Every seeded field is
 * still editable — this only saves the operator from typing what we can see.
 */
export function createTicketDraft(input: {
  kind: TicketKind;
  route: string;
  warehouseId?: string | null;
  conversationId?: string | null;
  title?: string;
  actualBehavior?: string;
  error?: unknown;
  systemLogIds?: string[];
}): TicketDraft {
  const failed = lastFailedAction();
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : typeof input.error === "string"
        ? input.error
        : "";

  return {
    kind: input.kind,
    status: "draft",
    severity: "normal",
    title: (input.title ?? "").trim(),
    summary: "",
    stepsToReproduce: "",
    expectedBehavior: "",
    actualBehavior: (input.actualBehavior ?? errorMessage).trim(),
    route: input.route,
    module: moduleForRoute(input.route),
    appVersion: appVersion(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    warehouseId: input.warehouseId ?? null,
    conversationId: input.conversationId ?? null,
    clarifications: [],
    evidence: {
      recentActions: recentActions(20),
      recentErrors: errorMessage
        ? [
            {
              title: "Reported error",
              message: errorMessage,
              source: failed?.action ?? "user-reported",
              at: new Date().toISOString(),
            },
          ]
        : [],
      systemLogIds: input.systemLogIds ?? [],
      habits: localHabitSummary(),
    },
    labels: [],
  };
}

// ── Agent brief ──────────────────────────────────────────────────────────────

/**
 * Where an agent should start reading, per module. Not a promise that the bug
 * lives there — a first heading, so the agent does not begin from nothing.
 */
const MODULE_SOURCE_HINTS: Record<string, string[]> = {
  receiving: ["src/features/receiving/receiving-page.tsx", "src/features/receiving/receiving-core.ts"],
  putaway: ["src/features/putaway/putaway-page.tsx", "src/features/putaway/putaway-core.ts"],
  inventory: ["src/features/inventory/inventory-page.tsx", "src/features/inventory/inventory-core.ts"],
  picking: ["src/features/picking/picking-page.tsx", "src/features/picking/picking-core.ts"],
  "pick-lists": ["src/features/picking/picking-page.tsx", "src/features/picking/picking-core.ts"],
  moves: ["src/features/moves/moves-page.tsx", "src/features/moves/moves-core.ts"],
  transfers: ["src/features/transfers/transfers-page.tsx", "src/features/transfers/transfers-core.ts"],
  "cycle-counts": ["src/features/cycle-counts/cycle-counts-page.tsx", "src/features/cycle-counts/cycle-counts-core.ts"],
  dashboard: ["src/features/dashboard/dashboard-page.tsx", "src/features/dashboard/dashboard-core.ts"],
  status: ["src/features/status/status-page.tsx", "src/features/status/status-core.ts"],
  settings: ["src/features/admin/admin-page.tsx", "src/features/admin/admin-core.ts"],
  system: ["src/features/system/system-page.tsx", "src/features/system/system-core.ts"],
};

export function sourceHintsForModule(module: string): string[] {
  return MODULE_SOURCE_HINTS[module] ?? [];
}

function section(heading: string, body: string | undefined | null): string[] {
  const text = String(body ?? "").trim();
  return text ? [`## ${heading}`, "", text, ""] : [];
}

/**
 * The handoff document. It has to stand alone: an agent picking this up has no
 * access to the chat it came from, so everything needed is inlined.
 */
export function buildAgentBrief(
  draft: TicketDraft,
  context: { reporterName?: string | null; warehouseLabel?: string | null; now?: string } = {},
): string {
  const now = context.now ?? new Date().toISOString();
  const hints = sourceHintsForModule(draft.module);
  const habitNote = draft.evidence.habits ? describeHabitsForCopilot(draft.evidence.habits) : "";

  const lines: string[] = [
    `# ${draft.title || "Untitled operator report"}`,
    "",
    `**Kind:** ${draft.kind}  |  **Severity:** ${draft.severity}  |  **Module:** ${draft.module}`,
    `**Screen:** \`${draft.route}\`  |  **App version:** ${draft.appVersion}`,
    `**Reported by:** ${context.reporterName ?? "an operator"}${
      context.warehouseLabel ? ` at ${context.warehouseLabel}` : ""
    }  |  **Filed:** ${now}`,
    "",
    ...section("What happened", draft.actualBehavior),
    ...section("What should happen", draft.expectedBehavior),
    ...section("Steps to reproduce", draft.stepsToReproduce),
    ...section("Detail", draft.summary),
  ];

  if (draft.clarifications.length > 0) {
    lines.push("## Clarifying exchange", "");
    for (const item of draft.clarifications) {
      lines.push(`- **${FIELD_LABELS[item.field] ?? item.field}** — ${item.question}`);
      lines.push(`  > ${item.answer.replace(/\n/g, "\n  > ")}`);
    }
    lines.push("");
  }

  const actions = draft.evidence.recentActions.slice(-10);
  if (actions.length > 0) {
    lines.push("## What the operator did just before", "");
    for (const action of actions) {
      const outcome = action.outcome === "ok" ? "" : ` — ${action.outcome}`;
      lines.push(`- \`${action.occurredAt}\` ${action.action} on \`${action.route}\`${outcome}`);
    }
    lines.push("");
  }

  if (draft.evidence.recentErrors.length > 0) {
    lines.push("## Errors captured", "");
    for (const error of draft.evidence.recentErrors) {
      lines.push(`- **${error.title}** (${error.source}): ${error.message}`);
    }
    lines.push("");
  }

  if (draft.evidence.systemLogIds.length > 0) {
    lines.push("## System log references", "");
    lines.push(draft.evidence.systemLogIds.map((id) => `\`${id}\``).join(", "));
    lines.push("");
  }

  if (habitNote) {
    lines.push("## Reporter's usual pattern", "", habitNote, "");
  }

  if (hints.length > 0) {
    lines.push("## Suggested starting points", "");
    lines.push(...hints.map((path) => `- \`${path}\``));
    lines.push("");
  }

  lines.push(
    "## Ground rules for the repair",
    "",
    "- Read `AGENTS.md` first; keep the diff scoped to this report.",
    "- `supabase/migrations/**` is additive only — never edit an existing migration.",
    "- Add or update a test under `src/test/**` that fails before the fix and passes after.",
    "",
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── Persistence ──────────────────────────────────────────────────────────────

const TICKET_COLUMNS =
  "id, ticket_number, kind, status, severity, title, summary, steps_to_reproduce, expected_behavior, " +
  "actual_behavior, route, module, app_version, warehouse_id, reported_by, conversation_id, clarifications, " +
  "telemetry, agent_brief, labels, assigned_to, resolution, screenshot_path, submitted_at, resolved_at, created_at, updated_at";

function toRow(draft: TicketDraft) {
  return {
    kind: draft.kind,
    status: draft.status,
    severity: draft.severity,
    title: draft.title.slice(0, 200),
    summary: draft.summary,
    steps_to_reproduce: draft.stepsToReproduce || null,
    expected_behavior: draft.expectedBehavior || null,
    actual_behavior: draft.actualBehavior || null,
    route: draft.route || null,
    module: draft.module || null,
    app_version: draft.appVersion || null,
    user_agent: draft.userAgent ? draft.userAgent.slice(0, 400) : null,
    warehouse_id: draft.warehouseId,
    conversation_id: draft.conversationId,
    clarifications: JSON.parse(JSON.stringify(draft.clarifications)),
    telemetry: JSON.parse(JSON.stringify(draft.evidence)),
    labels: draft.labels,
    ...(draft.screenshotPath ? { screenshot_path: draft.screenshotPath } : {}),
  };
}

export type StoredTicket = TicketDraft & {
  id: string;
  ticketNumber: string | null;
  reportedBy: string;
  agentBrief: string | null;
  assignedTo: string | null;
  resolution: string | null;
  submittedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Row values arrive untyped until the generated Supabase types catch up. */
function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

const EMPTY_EVIDENCE: TicketEvidence = {
  recentActions: [],
  recentErrors: [],
  systemLogIds: [],
  habits: null,
};

export function rowToTicket(row: Record<string, unknown>): StoredTicket {
  return {
    id: text(row.id),
    ticketNumber: nullableText(row.ticket_number),
    kind: text(row.kind, "bug") as TicketKind,
    status: text(row.status, "draft") as TicketStatus,
    severity: text(row.severity, "normal") as TicketSeverity,
    title: text(row.title),
    summary: text(row.summary),
    stepsToReproduce: text(row.steps_to_reproduce),
    expectedBehavior: text(row.expected_behavior),
    actualBehavior: text(row.actual_behavior),
    route: text(row.route),
    module: text(row.module),
    appVersion: text(row.app_version),
    userAgent: text(row.user_agent),
    warehouseId: nullableText(row.warehouse_id),
    conversationId: nullableText(row.conversation_id),
    clarifications: Array.isArray(row.clarifications) ? (row.clarifications as Clarification[]) : [],
    evidence:
      row.telemetry && typeof row.telemetry === "object"
        ? { ...EMPTY_EVIDENCE, ...(row.telemetry as Partial<TicketEvidence>) }
        : { ...EMPTY_EVIDENCE },
    labels: Array.isArray(row.labels) ? row.labels.map(String) : [],
    reportedBy: text(row.reported_by),
    agentBrief: nullableText(row.agent_brief),
    assignedTo: nullableText(row.assigned_to),
    resolution: nullableText(row.resolution),
    submittedAt: nullableText(row.submitted_at),
    resolvedAt: nullableText(row.resolved_at),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

/** Persist a draft. The row is invisible to triage until it is submitted. */
export async function saveTicketDraft(draft: TicketDraft): Promise<StoredTicket> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) throw new Error("Sign in before filing a report.");

  const payload = { ...toRow(draft), reported_by: userId };

  const query = draft.id
    ? db("operator_tickets").update(payload).eq("id", draft.id).select(TICKET_COLUMNS).single()
    : db("operator_tickets").insert(payload).select(TICKET_COLUMNS).single();

  const { data, error } = await query;
  if (error) throw new Error(formatSupabaseError(error, "Could not save this report."));
  return rowToTicket(data);
}

/**
 * Hand the report over: writes the agent brief and moves it out of draft, so it
 * shows up in `operator_ticket_queue`.
 */
export async function submitTicket(
  draft: TicketDraft,
  context: { reporterName?: string | null; warehouseLabel?: string | null } = {},
): Promise<StoredTicket> {
  const readiness = ticketReadiness(draft);
  if (!readiness.complete) {
    throw new Error(
      `This report still needs: ${readiness.missing.map((field) => FIELD_LABELS[field]).join(", ")}.`,
    );
  }

  const saved = await saveTicketDraft(draft);
  const brief = buildAgentBrief({ ...draft, id: saved.id }, context);

  const { data, error } = await db("operator_tickets")
    .update({ status: "open", agent_brief: brief })
    .eq("id", saved.id)
    .select(TICKET_COLUMNS)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not submit this report."));

  const ticket = rowToTicket(data);
  await appendTicketEvent(ticket.id, "submitted", {
    kind: ticket.kind,
    severity: ticket.severity,
    module: ticket.module,
  }).catch(() => {
    // The ticket is filed; a missing history row must not fail the submit.
  });
  return ticket;
}

export async function appendTicketEvent(
  ticketId: string,
  event: string,
  detail: Record<string, unknown> = {},
  actorKind: "user" | "copilot" | "agent" | "system" = "copilot",
): Promise<void> {
  const { error } = await db("operator_ticket_events").insert({
    ticket_id: ticketId,
    event,
    actor_kind: actorKind,
    detail,
  });
  if (error) throw new Error(formatSupabaseError(error, "Could not record ticket history."));
}

export async function listMyTickets(limit = 25): Promise<StoredTicket[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return [];
  const { data, error } = await db("operator_tickets")
    .select(TICKET_COLUMNS)
    .eq("reported_by", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(formatSupabaseError(error, "Could not load your reports."));
  return (data ?? []).map(rowToTicket);
}

/** Submitted tickets waiting for an agent, most severe first. */
export async function listTicketQueue(limit = 50): Promise<StoredTicket[]> {
  const { data, error } = await db("operator_ticket_queue").select("*").limit(limit);
  if (error) throw new Error(formatSupabaseError(error, "Could not load the ticket queue."));
  return (data ?? []).map(rowToTicket);
}

/** All tickets the caller is allowed to see, newest first. */
export async function listAllTickets(limit = 200): Promise<StoredTicket[]> {
  const { data, error } = await db("operator_tickets")
    .select(TICKET_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(formatSupabaseError(error, "Could not load support requests."));
  return (data ?? []).map(rowToTicket);
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus,
  context?: { assignedTo?: string | null; resolution?: string | null },
): Promise<StoredTicket> {
  const payload: Record<string, unknown> = { status };
  if (context?.assignedTo !== undefined) payload.assigned_to = context.assignedTo;
  if (context?.resolution !== undefined) payload.resolution = context.resolution;
  const { data, error } = await db("operator_tickets")
    .update(payload)
    .eq("id", ticketId)
    .select(TICKET_COLUMNS)
    .single();
  if (error) throw new Error(formatSupabaseError(error, "Could not update ticket status."));
  return rowToTicket(data);
}

