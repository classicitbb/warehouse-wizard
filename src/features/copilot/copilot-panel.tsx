/**
 * copilot-panel.tsx
 *
 * Context-aware side panel for the Warehouse Copilot (draft feature).
 * Read-only: the copilot answers from live records and cites them. It never
 * changes WMS data, and every screen keeps working if this panel errors.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bot, Loader2, Send, Sparkle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { askCopilot, isCopilotPreviewHost, type CopilotMessage } from "@/features/copilot/copilot-core";

const SUGGESTIONS = [
  "What is open for me right now?",
  "What stock expires in the next 14 days?",
  "What work is blocked or on hold?",
  "Give me a shift summary for this warehouse",
];

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function CopilotPanel({ variant = "desktop" }: { variant?: "desktop" | "mobile" | "dock" }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || busy) return;
      const history = messages
        .filter((message) => !message.error)
        .slice(-8)
        .map((message) => ({ role: message.role, content: message.content }));

      setMessages((prev) => [...prev, { id: messageId(), role: "user", content: trimmed }]);
      setInput("");
      setBusy(true);
      try {
        const result = await askCopilot({ question: trimmed, pathname, history });
        setMessages((prev) => [
          ...prev,
          {
            id: messageId(),
            role: "assistant",
            content: result.answer || "No answer was returned.",
            trace: result.trace,
          },
        ]);
      } catch (error) {
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
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, messages, pathname],
  );

  if (!isCopilotPreviewHost()) return null;

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
            Read-only. Answers come from live records you have access to and cite them. It never changes data.
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Ask about stock, receipts, put-aways, picks or how a workflow is meant to run.
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
                    {message.trace.length} record lookup{message.trace.length === 1 ? "" : "s"}
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
          <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={busy || !input.trim()} aria-label="Send">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
