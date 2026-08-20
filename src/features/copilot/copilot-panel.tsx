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

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bot, History, LifeBuoy, Loader2, MessageSquarePlus, Plus, Send, Sparkle, Square, Ticket } from "lucide-react";
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
  type CopilotConversation,
  type CopilotMessage,
} from "@/features/copilot/copilot-core";
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

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [conversations, setConversations] = useState<CopilotConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stoppedRef = useRef(false);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    if (!open || !user?.id) return;
    void loadCopilotConversations(user.id).then(setConversations).catch(() => {
      // History is supplementary; the active chat remains usable if it cannot load.
    });
  }, [open, user?.id]);

  const startNewChat = useCallback(() => {
    if (busy) return;
    setConversationId(null);
    setMessages([]);
    setHistoryOpen(false);
    setInput("");
    inputRef.current?.focus();
  }, [busy]);

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
      if (!trimmed || busy) return;
      const chatHistory = messages
        .filter((message) => !message.error)
        .slice(-8)
        .map((message) => ({ role: message.role, content: message.content }));

      const userMessage = { id: messageId(), role: "user" as const, content: trimmed };
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

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setBusy(true);
      stoppedRef.current = false;
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
        inputRef.current?.focus();
      }
    },
    [busy, conversationId, messages, pathname, profile?.default_warehouse_id, user?.id],
  );

  // Copilot is generally available on every build and for every signed-in user.


  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  /** Open the support flow from a button. Starts a fresh thread so the
   *  interview is not tangled up with whatever was being discussed. */
  const startSupport = useCallback(
    (kind: keyof typeof SUPPORT_PROMPTS) => {
      if (busy) return;
      recordAction({ action: `copilot.support.${kind}`, route: pathname, outcome: "ok" });
      setConversationId(null);
      setMessages([]);
      setHistoryOpen(false);
      void sendRef.current(SUPPORT_PROMPTS[kind]);
    },
    [busy, pathname],
  );

  // Anywhere in the app can hand the copilot a problem — the error boundary's
  // "Report this" button is the main one.
  useEffect(() =>
    onCopilotReportRequest((request) => {
      setOpen(true);
      setConversationId(null);
      setMessages([]);
      setHistoryOpen(false);
      void sendRef.current(request.message);
    }),
  []);

  // The dock is an explicit user opt-in; keep the existing header controls
  // preview-only until Copilot is generally released.
  if (variant !== "dock" && !isCopilotPreviewHost()) return null;
>>>>>>> Stashed changes

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
      <SheetContent side="right" className="flex w-full max-w-md flex-col gap-0 p-0 sm:max-w-md">
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
            </div>
          ))}

          {busy ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Checking the records…
            </p>
          ) : null}
        </div>

        <form
          className="flex items-end gap-2 border-t border-border px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            disabled={busy}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(input);
              }
            }}
            placeholder="Ask about this warehouse…"
            rows={2}
            className="min-h-[2.5rem] flex-1 resize-none text-sm"
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
      </SheetContent>
    </Sheet>
  );
}
