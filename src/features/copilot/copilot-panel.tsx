/**
 * copilot-panel.tsx
 *
 * Context-aware side panel for the Warehouse Copilot (draft feature).
 *
 * Read-only over WMS data: the copilot answers from live records and cites
 * them, and never changes stock, tasks or settings. The one thing it can create
 * is the operator's own problem report or feedback — it interviews them, then
 * files a ticket an agent can pick up. Every screen keeps working if this panel
 * errors.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Bot,
  Camera,
  Check,
  FileText,
  History,
  LifeBuoy,
  Loader2,
  MessageSquarePlus,
  Mic,
  MicOff,
  Plus,
  Send,
  Sparkle,
  Square,
  Ticket,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  askCopilot,
  createCopilotConversation,
  loadCopilotConversations,
  loadCopilotMessages,
  onCopilotReportRequest,
  saveCopilotMessage,
  saveCopilotFeedback,
  type CopilotFeedbackVote,
  type CopilotConversation,
  type CopilotMessage,
} from "@/features/copilot/copilot-core";
import {
  attachScreenshotToLatestDraft,
  captureAndUploadTicketScreenshot,
  readLogFile,
  SCREENSHOT_IGNORE_ATTR,
} from "@/features/copilot/screenshot-capture";
import {
  addEvidenceToOpenReport,
  attachmentLabel,
  makeLogAttachment,
  makeScreenshotAttachment,
  MAX_LOG_EXCERPT_CHARS,
  type TicketAttachment,
} from "@/features/copilot/feedback-core";
import { useCopilotDictation } from "@/features/copilot/use-copilot-dictation";
import {
  activeReportContext,
  reportContextForCopilot,
  type ScreenReportContext,
} from "@/features/copilot/report-context";
import { recordAction } from "@/lib/habit-tracking";
import { logErrorTelemetry } from "@/lib/system-telemetry";

const SUGGESTIONS = [
  "What is open for me right now?",
  "What stock expires in the next 14 days?",
  "What work is blocked or on hold?",
  "Give me a shift summary for this warehouse",
];

/**
 * Opening lines for the support flow. They are phrased as the operator, because
 * that is what actually starts the interview — the copilot's tool descriptions
 * do the rest. Nothing is filed until the operator confirms.
 */
const SUPPORT_PROMPTS = {
  bug: "Something on this screen is not working right. I want to report it.",
  feedback: "I want to leave feedback about how this screen works.",
  mine: "Show me the reports I have filed and where they have got to.",
} as const;

/** Tool names that mean the copilot touched a report rather than read records. */
const SUPPORT_TOOLS = new Set([
  "start_problem_report",
  "record_report_answer",
  "submit_problem_report",
  "list_my_reports",
]);

const SOURCE_LABELS: Record<string, string> = {
  search_inventory: "Inventory records",
  get_product_details: "Product catalogue",
  get_location_details: "Location records",
  get_receipt_status: "Receipt records",
  get_pick_list_status: "Pick-list records",
  get_putaway_tasks: "Put-away tasks",
  get_expiring_inventory: "Expiry records",
  get_open_tasks: "Open-work records",
  get_blocked_workflows: "Blocked-work records",
};

/** A screenshot or log excerpt the operator added, and where it has got to. */
type AttachmentChip = {
  id: string;
  label: string;
  state: "working" | "attached" | "waiting" | "failed";
};

/**
 * Evidence that belongs on the report the copilot is about to open. The draft
 * row does not exist until the first reply comes back, so anything attached
 * before then waits here rather than being lost.
 */
type PendingEvidence = {
  id: string;
  attachment?: TicketAttachment;
  screenContext?: ScreenReportContext | null;
};

const ATTACHMENT_STATE_LABELS: Record<AttachmentChip["state"], string> = {
  working: "attaching…",
  attached: "attached",
  waiting: "waits for the report",
  failed: "could not attach",
};

function messageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

/**
 * A dropped transcript write is not worth interrupting the operator over, but
 * it must not vanish either — a report whose conversation never persisted is
 * exactly the kind of thing nobody notices until it is needed.
 */
function reportSaveFailure(error: unknown, role: "user" | "assistant") {
  logErrorTelemetry({
    error,
    title: "Copilot message was not saved",
    source: "copilot-panel.saveCopilotMessage",
    severity: "warning",
    details: { role },
  });
}

export function CopilotPanel({ variant = "desktop" }: { variant?: "desktop" | "mobile" | "dock" }) {
  const { pathname } = useLocation();
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, CopilotFeedbackVote>>({});
  const [votingMessageId, setVotingMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** React state updates are asynchronous, so this prevents two Enter presses racing. */
  const sendingRef = useRef(false);
  const stoppedRef = useRef(false);
  /** Screen capture in flight for the report the operator is about to file. */
  const pendingShotRef = useRef<Promise<string | null> | null>(null);
  /** True while a report is open in this thread — the attach controls belong to it. */
  const [reportFlow, setReportFlow] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentChip[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState("");
  const [logName, setLogName] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  /** What was on screen when the report was started, filed with the ticket. */
  const reportContextRef = useRef<ScreenReportContext | null>(null);
  const pendingEvidenceRef = useRef<PendingEvidence[]>([]);
  const logFileRef = useRef<HTMLInputElement | null>(null);
  const dictation = useCopilotDictation((transcript) => {
    setInput((current) => [current.trim(), transcript].filter(Boolean).join(current.trim() ? " " : ""));
    inputRef.current?.focus();
  });

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useLayoutEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
  }, [input]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open || !user?.id) return;
    void loadCopilotConversations(user.id).then(setConversations).catch(() => {
      // History is supplementary; the active chat remains usable if it cannot load.
    });
  }, [open, user?.id]);

  const resetReportFlow = useCallback(() => {
    setReportFlow(false);
    setAttachments([]);
    setLogOpen(false);
    setLogText("");
    setLogName(null);
    pendingEvidenceRef.current = [];
    reportContextRef.current = null;
  }, []);

  const startNewChat = useCallback(() => {
    if (busy) return;
    setConversationId(null);
    setMessages([]);
    setFeedback({});
    setHistoryOpen(false);
    setInput("");
    resetReportFlow();
    inputRef.current?.focus();
  }, [busy, resetReportFlow]);

  /**
   * Move everything queued onto the open draft report. Anything the copilot has
   * not opened a report for yet stays queued and is tried again after the next
   * reply, so an operator who attaches first and talks second loses nothing.
   */
  const flushEvidence = useCallback(async () => {
    if (pendingEvidenceRef.current.length === 0) return;
    const queue = pendingEvidenceRef.current;
    pendingEvidenceRef.current = [];
    const stillWaiting: PendingEvidence[] = [];

    for (const item of queue) {
      let state: AttachmentChip["state"] = "waiting";
      try {
        state = (await addEvidenceToOpenReport({
          attachment: item.attachment,
          screenContext: item.screenContext,
        }))
          ? "attached"
          : "waiting";
      } catch (error) {
        state = "failed";
        logErrorTelemetry({
          error,
          title: "Report evidence could not be attached",
          source: "copilot-panel.flushEvidence",
          severity: "warning",
          details: { kind: item.attachment?.kind ?? "screen-context" },
        });
      }
      if (state === "waiting") stillWaiting.push(item);
      if (item.attachment) {
        setAttachments((current) =>
          current.map((chip) => (chip.id === item.id ? { ...chip, state } : chip)),
        );
      }
    }

    pendingEvidenceRef.current = [...stillWaiting, ...pendingEvidenceRef.current];
  }, []);

  /** Take a picture of the screen behind the panel and file it with the report. */
  const attachScreenshot = useCallback(async () => {
    if (capturing) return;
    const id = messageId();
    setCapturing(true);
    setAttachments((current) => [...current, { id, label: "Screenshot", state: "working" }]);
    const path = await captureAndUploadTicketScreenshot();
    setCapturing(false);
    if (!path) {
      setAttachments((current) => current.map((chip) => (chip.id === id ? { ...chip, state: "failed" } : chip)));
      return;
    }
    pendingEvidenceRef.current.push({ id, attachment: makeScreenshotAttachment(path, "operator") });
    await flushEvidence();
  }, [capturing, flushEvidence]);

  /** File pasted log text — an error, a console dump — with the report. */
  const attachLogExcerpt = useCallback(async () => {
    const attachment = makeLogAttachment(logText, logName);
    if (!attachment) return;
    const id = messageId();
    setAttachments((current) => [...current, { id, label: attachmentLabel(attachment), state: "working" }]);
    setLogText("");
    setLogName(null);
    setLogOpen(false);
    pendingEvidenceRef.current.push({ id, attachment });
    await flushEvidence();
  }, [flushEvidence, logName, logText]);

  const openConversation = useCallback(async (id: string) => {
    if (busy || id === conversationId) return;
    try {
      setMessages(await loadCopilotMessages(id));
      setConversationId(id);
      setHistoryOpen(false);
    } catch (error) {
      // Keep the current thread intact, but say so — silently doing nothing
      // reads as a dead button.
      logErrorTelemetry({
        error,
        title: "Copilot conversation could not be opened",
        source: "copilot-panel.openConversation",
        severity: "warning",
        details: { conversationId: id },
      });
      setHistoryOpen(false);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId(),
          role: "assistant",
          content: "That saved chat could not be opened. Your current thread is unchanged.",
          error: true,
        },
      ]);
    }
  }, [busy, conversationId]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    abortRef.current?.abort();
  }, []);

  // The report-request listener must always reach the current `send`, but it is
  // subscribed once — a ref keeps the two apart without re-subscribing on every
  // keystroke.
  const sendRef = useRef<(question: string) => Promise<void>>(async () => {});

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy || sendingRef.current) return;
      sendingRef.current = true;
      const chatHistory = messages
        .filter((message) => !message.error)
        .slice(-5)
        .map((message) => ({ role: message.role, content: message.content }));

      const userMessage = { id: messageId(), role: "user" as const, content: trimmed };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setBusy(true);
      stoppedRef.current = false;
      let activeConversationId = conversationId;
      if (!activeConversationId && user?.id) {
        try {
          const conversation = await createCopilotConversation({
            userId: user.id,
            warehouseId: profile?.default_warehouse_id ?? null,
            title: trimmed,
          });
          activeConversationId = conversation.id;
          setConversationId(conversation.id);
          setConversations((prev) => [conversation, ...prev]);
        } catch (error) {
          // The chat still works in preview/demo environments without a
          // persisted session, but a report filed in an unsaved thread loses
          // its transcript — worth knowing about even though it is not fatal.
          logErrorTelemetry({
            error,
            title: "Copilot conversation could not be created",
            source: "copilot-panel.createConversation",
            severity: "warning",
          });
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;
      if (activeConversationId && user?.id) {
        void saveCopilotMessage({ conversationId: activeConversationId, userId: user.id, message: userMessage }).catch(
          (error: unknown) => reportSaveFailure(error, "user"),
        );
      }
      try {
        const result = await askCopilot({
          question: trimmed,
          pathname,
          history: chatHistory,
          // What the operator had on screen when they reached for the life buoy:
          // the selected product, the quantities they typed, the session behind
          // them. Evidence about their own screen, never an instruction.
          selection: reportContextForCopilot(reportContextRef.current),
          conversationId: activeConversationId,
          signal: controller.signal,
        });
        const assistantMessage = {
          id: messageId(),
          role: "assistant" as const,
          content: result.answer || "No answer was returned.",
          trace: result.trace,
        };
        setMessages((prev) => [...prev, assistantMessage]);
        // The screen capture taken when the report was started belongs to the
        // draft the copilot has just opened.
        const usedTools = new Set((result.trace ?? []).map((entry) => entry.tool));
        if (usedTools.has("start_problem_report")) {
          setReportFlow(true);
          // A report the operator opened by typing rather than by pressing the
          // life buoy still deserves the screen it was opened from.
          if (!reportContextRef.current) {
            const context = activeReportContext();
            if (context) {
              reportContextRef.current = context;
              pendingEvidenceRef.current.push({ id: messageId(), screenContext: context });
            }
          }
          if (pendingShotRef.current) {
            const shot = pendingShotRef.current;
            pendingShotRef.current = null;
            void shot.then((path) => (path ? attachScreenshotToLatestDraft(path) : false));
          }
        }
        // Screen context and anything the operator attached go on the same draft.
        // Once the report is filed there is nothing left to attach to.
        void flushEvidence().then(() => {
          if (usedTools.has("submit_problem_report")) setReportFlow(false);
        });
        if (activeConversationId && user?.id) {
          void saveCopilotMessage({ conversationId: activeConversationId, userId: user.id, message: assistantMessage })
            .then(() => loadCopilotConversations(user.id).then(setConversations))
            .catch((error: unknown) => reportSaveFailure(error, "assistant"));
        }
      } catch (error) {
        if (stoppedRef.current || controller.signal.aborted) return;
        setMessages((prev) => [
          ...prev,
          {
            id: messageId(),
            role: "assistant",
            content: error instanceof Error ? error.message : "The copilot is unavailable right now.",
            error: true,
          },
        ]);
      } finally {
        abortRef.current = null;
        setBusy(false);
        sendingRef.current = false;
        inputRef.current?.focus();
      }
    },
    [busy, conversationId, flushEvidence, messages, pathname, profile?.default_warehouse_id, user?.id],
  );

  // Copilot is generally available on every build and for every signed-in user.


  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const voteOnMessage = useCallback(async (messageId: string, vote: CopilotFeedbackVote) => {
    if (!user?.id || votingMessageId || feedback[messageId] === vote) return;
    setFeedback((current) => ({ ...current, [messageId]: vote }));
    setVotingMessageId(messageId);
    try {
      await saveCopilotFeedback({ userId: user.id, conversationId, messageId, vote });
    } catch (error) {
      setFeedback((current) => {
        const next = { ...current };
        delete next[messageId];
        return next;
      });
      logErrorTelemetry({ error, title: "Copilot feedback was not saved", source: "copilot-panel.saveCopilotFeedback", severity: "warning" });
    } finally {
      setVotingMessageId(null);
    }
  }, [conversationId, feedback, user?.id, votingMessageId]);

  /** Open the support flow from a button. Starts a fresh thread so the
   *  interview is not tangled up with whatever was being discussed, and grabs
   *  a picture of the screen underneath before the conversation moves on. */
  const startSupport = useCallback(
    (kind: keyof typeof SUPPORT_PROMPTS) => {
      if (busy) return;
      recordAction({ action: `copilot.support.${kind}`, route: pathname, outcome: "ok" });
      if (kind !== "mine") pendingShotRef.current = captureAndUploadTicketScreenshot();
      setConversationId(null);
      setMessages([]);
      setHistoryOpen(false);
      resetReportFlow();
      if (kind !== "mine") {
        const context = activeReportContext();
        reportContextRef.current = context;
        if (context) pendingEvidenceRef.current.push({ id: messageId(), screenContext: context });
        setReportFlow(true);
      }
      void sendRef.current(SUPPORT_PROMPTS[kind]);
    },
    [busy, pathname, resetReportFlow],
  );

  // Anywhere in the app can hand the copilot a problem — the error boundary's
  // "Report this" button is the main one.
  useEffect(() =>
    onCopilotReportRequest((request) => {
      pendingShotRef.current = captureAndUploadTicketScreenshot();
      setOpen(true);
      setConversationId(null);
      setMessages([]);
      setHistoryOpen(false);
      resetReportFlow();
      // The life buoy reads the screen before it closes and hands the facts
      // over with the request; fall back to whatever is still published.
      const context = request.context ?? activeReportContext();
      reportContextRef.current = context;
      if (context) pendingEvidenceRef.current.push({ id: messageId(), screenContext: context });
      setReportFlow(true);
      void sendRef.current(request.message);
    }),
  [resetReportFlow]);


  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {variant === "dock" ? (
          <Button
            className="h-full w-full flex-col gap-0.5 rounded-md px-0.5 py-1 text-[10px] font-medium"
            variant="ghost"
            aria-label="Ask Copilot"
            title="Ask Copilot"
          >
            <Bot className="h-5 w-5" />
            <span className="w-full truncate text-center leading-none">Copilot</span>
          </Button>
        ) : variant === "mobile" ? (
          <Button className="h-8 w-8 shrink-0" size="icon" variant="outline" aria-label="Ask Copilot" title="Ask Copilot">
            <Bot className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-9 gap-2" aria-label="Ask Copilot">
            <Bot className="h-4 w-4" />
            <span className="hidden xl:inline">Copilot</span>
          </Button>
        )}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md"
        {...{ [SCREENSHOT_IGNORE_ATTR]: "" }}
      >
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-primary" />
            Warehouse Copilot
            <Badge variant="outline" className="text-[10px] font-medium uppercase">Draft</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Answers come from live records you have access to and cite them. It never changes warehouse data —
            the only thing it files is a report you ask it to file.
          </SheetDescription>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => setHistoryOpen((value) => !value)}>
              <History className="h-3.5 w-3.5" /> History
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={startNewChat} disabled={busy}>
              <Plus className="h-3.5 w-3.5" /> New chat
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => startSupport("mine")}
              disabled={busy}
            >
              <Ticket className="h-3.5 w-3.5" /> My reports
            </Button>
          </div>
        </SheetHeader>

        {historyOpen ? (
          <div className="max-h-44 space-y-1 overflow-y-auto border-b border-border bg-muted/20 px-4 py-2">
            {conversations.length ? conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => void openConversation(conversation.id)}
                disabled={busy}
                className={cn("block w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-not-allowed", conversation.id === conversationId && "bg-muted font-medium")}
                title={conversation.title ?? "Untitled chat"}
              >
                {conversation.title || "Untitled chat"}
              </button>
            )) : <p className="px-2 py-1 text-xs text-muted-foreground">No saved chats yet.</p>}
          </div>
        ) : null}

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Ask about stock, receipts, put-aways, picks or how a workflow is meant to run.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto justify-start gap-2 whitespace-normal py-2 text-left text-xs"
                  onClick={() => startSupport("bug")}
                  disabled={busy}
                >
                  <LifeBuoy className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  Report a problem
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-auto justify-start gap-2 whitespace-normal py-2 text-left text-xs"
                  onClick={() => startSupport("feedback")}
                  disabled={busy}
                >
                  <MessageSquarePlus className="h-3.5 w-3.5 shrink-0 text-primary" />
                  Send feedback
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                It will ask what went wrong, then file a ticket for repair. Nothing is filed until you confirm.
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void send(suggestion)}
                    className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <Sparkle className="h-3.5 w-3.5 shrink-0 text-primary" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "text-sm",
                message.role === "user"
                  ? "ml-auto w-fit max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                  : "max-w-full text-foreground",
                message.error ? "text-destructive" : "",
              )}
            >
              {message.role === "assistant" && !message.error ? (
                <div className="space-y-2 overflow-x-auto text-sm leading-relaxed [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_h3]:mt-2 [&_h3]:text-xs [&_h3]:font-semibold [&_h4]:text-xs [&_h4]:font-semibold [&_li]:ml-4 [&_li]:list-disc [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_table]:text-[11px] [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left [&_ul]:space-y-1">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
              )}
              {message.trace && message.trace.length > 0 ? (
                <details className="mt-2 rounded-md border border-border/70 bg-muted/30 px-2 py-1.5">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                    {message.trace.some((entry) => SUPPORT_TOOLS.has(entry.tool))
                      ? `${message.trace.length} report step${message.trace.length === 1 ? "" : "s"}`
                      : `${message.trace.length} record lookup${message.trace.length === 1 ? "" : "s"}`}
                  </summary>
                  <ul className="mt-1 space-y-1">
                    {message.trace.map((entry, index) => (
                      <li key={`${entry.tool}-${index}`} className="text-[11px] text-muted-foreground">
                        <span className="font-medium text-foreground">{entry.tool}</span>
                        {typeof entry.rows === "number" ? ` — ${entry.rows} row${entry.rows === 1 ? "" : "s"}` : ""}
                        {entry.outcome !== "ok" ? ` — ${entry.outcome}` : ""}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {message.role === "assistant" && !message.error ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2">
                  {message.trace?.filter((entry) => !SUPPORT_TOOLS.has(entry.tool)).length ? (
                    <span className="mr-auto text-[11px] text-muted-foreground" title="Only records returned through the server-side, warehouse-scoped tools are sources.">
                      Sources: {Array.from(new Set(message.trace.filter((entry) => !SUPPORT_TOOLS.has(entry.tool)).map((entry) => SOURCE_LABELS[entry.tool] ?? entry.tool))).join(", ")}
                    </span>
                  ) : <span className="mr-auto text-[11px] text-muted-foreground">No record sources used</span>}
                  <span className="text-[11px] text-muted-foreground">Was this helpful?</span>
                  <Button type="button" size="icon" variant={feedback[message.id] === "helpful" ? "secondary" : "ghost"} className="h-7 w-7" aria-label="Helpful" title="Helpful" disabled={!user?.id || votingMessageId === message.id} onClick={() => void voteOnMessage(message.id, "helpful")}>
                    <ThumbsUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="icon" variant={feedback[message.id] === "not_helpful" ? "secondary" : "ghost"} className="h-7 w-7" aria-label="Not helpful" title="Not helpful" disabled={!user?.id || votingMessageId === message.id} onClick={() => void voteOnMessage(message.id, "not_helpful")}>
                    <ThumbsDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}

          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking the records…
            </p>
          ) : null}
        </div>

        {reportFlow ? (
          <div className="border-t border-border bg-muted/20 px-4 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Attach to this report</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => void attachScreenshot()}
                disabled={capturing}
              >
                {capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Screenshot
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => setLogOpen((value) => !value)}
              >
                <FileText className="h-3.5 w-3.5" />
                Log excerpt
              </Button>
            </div>

            {attachments.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {attachments.map((chip) => (
                  <li
                    key={chip.id}
                    className={cn(
                      "flex max-w-full items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]",
                      chip.state === "failed" && "border-destructive/60 text-destructive",
                    )}
                  >
                    {chip.state === "working" ? (
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
                    ) : chip.state === "attached" ? (
                      <Check className="h-3 w-3 shrink-0 text-primary" />
                    ) : (
                      <TriangleAlert className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">{chip.label}</span>
                    <span className="shrink-0 text-muted-foreground">— {ATTACHMENT_STATE_LABELS[chip.state]}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {logOpen ? (
              <div className="mt-2 grid gap-1.5">
                <Textarea
                  value={logText}
                  onChange={(event) => setLogText(event.target.value)}
                  rows={4}
                  aria-label="Log excerpt"
                  placeholder="Paste the error text or the log lines you saw…"
                  className="resize-none text-xs"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logFileRef}
                    type="file"
                    accept=".txt,.log,.json,.csv,text/plain"
                    className="hidden"
                    aria-label="Choose a log file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      void readLogFile(file).then((text) => {
                        if (text === null) return;
                        setLogName(file.name);
                        setLogText((current) => (current ? `${current}\n${text}` : text));
                      });
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => logFileRef.current?.click()}
                  >
                    Choose a file
                  </Button>
                  <span className="text-[11px] text-muted-foreground">
                    {logText.length}/{MAX_LOG_EXCERPT_CHARS}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    className="ml-auto h-7 px-2 text-xs"
                    disabled={!logText.trim()}
                    onClick={() => void attachLogExcerpt()}
                  >
                    Attach
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setLogOpen(false);
                      setLogText("");
                      setLogName(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <form
          className="flex items-end gap-2 border-t border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          {dictation.state !== "idle" ? (
            <div className="absolute bottom-[4.25rem] left-4 right-4 flex items-center gap-2 rounded-md border border-primary/30 bg-background px-3 py-2 text-xs shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="min-w-0 flex-1">{dictation.state === "starting" ? "Starting microphone…" : dictation.state === "listening" ? "Listening — tap Done when you finish." : "Transcribing — review the text before sending."}</span>
              {dictation.state === "listening" ? <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={dictation.stop}>Done</Button> : null}
            </div>
          ) : null}
          <Button
            type="button"
            size="icon"
            variant={dictation.state === "listening" ? "destructive" : "ghost"}
            className="h-9 w-9 shrink-0"
            aria-label={dictation.state === "listening" ? "Stop voice input" : "Start voice input"}
            title={dictation.state === "listening" ? "Stop and transcribe" : "Speak your question"}
            disabled={busy || dictation.state === "starting" || dictation.state === "transcribing"}
            onClick={() => (dictation.state === "listening" ? dictation.stop() : void dictation.start())}
          >
            {dictation.state === "listening" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy || dictation.state !== "idle"}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask anything about this warehouse…"
            rows={1}
            className="min-h-[2.5rem] max-h-36 flex-1 resize-none overflow-y-auto text-sm"
          />
          {busy ? (
            <Button type="button" size="icon" variant="destructive" className="h-9 w-9 shrink-0" onClick={stop} aria-label="Stop response" title="Stop response">
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={!input.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>
        {dictation.error ? <p className="border-t border-border px-4 py-2 text-xs text-destructive">{dictation.error}</p> : null}
      </SheetContent>
    </Sheet>
  );
}
