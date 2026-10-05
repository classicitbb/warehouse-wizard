/**
 * copilot-core.ts
 *
 * Client side of the Warehouse Copilot. Assembles the on-screen context and the
 * help-centre extracts, calls the `copilot` edge function, and returns a grounded
 * answer. All model calls, prompts and tool execution stay server-side.
 *
 * The copilot is an assist layer: if this call fails, every screen keeps working.
 */

import { supabase } from "@/integrations/supabase/client";
import { getRouteHelp, getArticleById, searchHelpArticles, helpArticles } from "@/lib/help-content";
import { localHabitSummary, recentActions } from "@/lib/habit-tracking";
import { DefaultChatTransport, type UIMessage } from "ai";

export type CopilotTraceEntry = {
  tool: string;
  input: unknown;
  outcome: string;
  rows?: number;
};

export type CopilotMessage = UIMessage & { error?: boolean };

export type CopilotFeedbackVote = "helpful" | "not_helpful";

export type CopilotConversation = {
  id: string;
  title: string | null;
  updatedAt: string;
};

/**
 * The copilot ships as a draft feature: available in preview/dev builds (and to anyone
 * who explicitly opts in), hidden on the public production build until it is signed off.
 */
const PUBLIC_HOSTS = ["warehousewizard.app", "www.warehousewizard.app", "threeplmgmt.lovable.app"];
const OVERRIDE_KEY = "wms.copilot.preview";

export function isCopilotPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(OVERRIDE_KEY) === "on") return true;
  } catch {
    // ignore
  }
  return !PUBLIC_HOSTS.includes(window.location.hostname);
}

export function setCopilotPreviewOverride(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(OVERRIDE_KEY, "on");
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // ignore
  }
}

export {
  describeErrorForReport,
  onCopilotReportRequest,
  requestCopilotReport,
  type CopilotReportRequest,
} from "@/features/copilot/report-request";

function articleToText(articleId: string) {
  const article = getArticleById(articleId);
  if (!article) return null;
  const text = article.sections
    .map((section) => `${section.title}\n${section.content.join("\n")}`)
    .join("\n")
    .slice(0, 2500);
  return { id: article.id, title: article.title, module: article.module, text };
}

/** Help-centre extracts for the current screen plus anything matching the question. */
export function buildProcedureContext(pathname: string, question: string) {
  const picked = new Map<string, { id: string; title: string; module?: string; text: string }>();

  const routeHelp = getRouteHelp(pathname);
  if (routeHelp) {
    picked.set(`route:${routeHelp.id}`, {
      id: routeHelp.id,
      title: `${routeHelp.title} — screen overview`,
      module: routeHelp.id,
      text: [
        routeHelp.summary,
        `Key actions: ${routeHelp.keyActions.join("; ")}`,
        `Common mistakes: ${routeHelp.commonMistakes.join("; ")}`,
        `Permissions: ${routeHelp.permissions}`,
      ].join("\n"),
    });
    for (const id of routeHelp.wikiArticleIds.slice(0, 3)) {
      const article = articleToText(id);
      if (article) picked.set(article.id, article);
    }
  }

  const matches = question.trim() ? (searchHelpArticles(question) as typeof helpArticles) : [];
  for (const match of matches.slice(0, 4)) {
    const article = articleToText(match.id);
    if (article) picked.set(article.id, article);
  }

  return Array.from(picked.values()).slice(0, 8);
}

function appVersion() {
  try {
    return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "unknown";
  } catch {
    return "unknown";
  }
}

export function copilotMessageText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function copilotMessageTrace(message: UIMessage): CopilotTraceEntry[] {
  return message.parts.flatMap((part) => {
    const value = part as unknown as Record<string, unknown>;
    const type = String(value.type ?? "");
    if (type !== "dynamic-tool" && !type.startsWith("tool-")) return [];
    const output = value.output as { count?: number; note?: string } | undefined;
    return [{
      tool: type === "dynamic-tool" ? String(value.toolName ?? "tool") : type.slice(5),
      input: value.input,
      outcome: value.state === "output-error" ? "error" : "ok",
      rows: typeof output?.count === "number" ? output.count : undefined,
    }];
  });
}

export function createCopilotTransport() {
  return new DefaultChatTransport<CopilotMessage>({
    api: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/copilot`,
    prepareSendMessagesRequest: async ({ messages, body, headers }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Please sign in again to use Copilot.");
      return {
        headers: {
          ...Object.fromEntries(new Headers(headers).entries()),
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: { ...body, messages },
      };
    },
  });
}

export function copilotRequestBody(params: {
  pathname: string;
  question: string;
  selection?: Record<string, unknown>;
  conversationId?: string | null;
}) {
  return {
    context: {
      screen: params.pathname,
      selection: params.selection ?? {},
      appVersion: appVersion(),
      habits: localHabitSummary(),
      breadcrumbs: recentActions(20),
    },
    procedures: buildProcedureContext(params.pathname, params.question),
    conversationId: params.conversationId ?? null,
  };
}

export async function loadCopilotConversations(userId: string): Promise<CopilotConversation[]> {
  const { data, error } = await supabase
    .from("copilot_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    updatedAt: conversation.updated_at,
  }));
}

export async function loadCopilotMessages(conversationId: string): Promise<CopilotMessage[]> {
  const { data, error } = await supabase
    .from("copilot_messages")
    .select("id, role, content, citations")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      id: message.id,
      role: message.role as CopilotMessage["role"],
      parts: [
        { type: "text" as const, text: message.content },
        ...(Array.isArray(message.citations) && message.citations.length
          ? [{ type: "data-saved-trace" as const, data: message.citations }]
          : []),
      ],
    }));
}

export async function createCopilotConversation(params: {
  userId: string;
  warehouseId?: string | null;
  title: string;
}): Promise<CopilotConversation> {
  const { data, error } = await supabase
    .from("copilot_conversations")
    .insert({ user_id: params.userId, warehouse_id: params.warehouseId ?? null, title: params.title.slice(0, 100) })
    .select("id, title, updated_at")
    .single();
  if (error) throw error;
  return { id: data.id, title: data.title, updatedAt: data.updated_at };
}

export async function saveCopilotMessage(params: {
  conversationId: string;
  userId: string;
  message: CopilotMessage;
}) {
  const { error } = await supabase.from("copilot_messages").insert({
    id: params.message.id,
    conversation_id: params.conversationId,
    user_id: params.userId,
    role: params.message.role,
    content: copilotMessageText(params.message),
    citations: JSON.parse(JSON.stringify(copilotMessageTrace(params.message))),
  });
  if (error) throw error;

  const { error: touchError } = await supabase
    .from("copilot_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.conversationId);
  if (touchError) throw touchError;
}

/** One signed-in operator keeps one current vote per rendered answer. */
export async function saveCopilotFeedback(params: {
  userId: string;
  conversationId?: string | null;
  messageId: string;
  vote: CopilotFeedbackVote;
}) {
  const { error } = await (supabase as any)
    .from("copilot_message_feedback")
    .upsert(
      {
        user_id: params.userId,
        conversation_id: params.conversationId ?? null,
        message_id: params.messageId,
        vote: params.vote,
      },
      { onConflict: "user_id,message_id" },
    );
  if (error) throw error;
}
