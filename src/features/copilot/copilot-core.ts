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

export type CopilotTraceEntry = {
  tool: string;
  input: unknown;
  outcome: string;
  rows?: number;
};

export type CopilotMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  trace?: CopilotTraceEntry[];
  error?: boolean;
};

export type CopilotConversation = {
  id: string;
  title: string | null;
  updatedAt: string;
};

export type CopilotAnswer = {
  answer: string;
  trace: CopilotTraceEntry[];
  context?: { warehouse?: string; roles?: string[]; screen?: string };
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

export async function askCopilot(params: {
  question: string;
  pathname: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  selection?: Record<string, unknown>;
  conversationId?: string | null;
  signal?: AbortSignal;
}): Promise<CopilotAnswer> {
  const { data, error } = await supabase.functions.invoke("copilot", {
    body: {
      message: params.question,
      history: params.history,
      context: { screen: params.pathname, selection: params.selection ?? {} },
      procedures: buildProcedureContext(params.pathname, params.question),
      conversationId: params.conversationId ?? null,
    },
    signal: params.signal,
  });

  if (error) {
    let detail = error.message;
    const context = (error as { context?: { text?: () => Promise<string> } }).context;
    if (context?.text) {
      try {
        const body = await context.text();
        const parsed = JSON.parse(body) as { error?: string };
        if (parsed?.error) detail = parsed.error;
      } catch {
        // keep the original message
      }
    }
    throw new Error(detail || "The copilot is unavailable right now.");
  }

  const payload = (data ?? {}) as Partial<CopilotAnswer> & { error?: string };
  if (payload.error) throw new Error(payload.error);
  return {
    answer: payload.answer ?? "",
    trace: payload.trace ?? [],
    context: payload.context,
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
      content: message.content,
      trace: Array.isArray(message.citations) ? message.citations as CopilotTraceEntry[] : undefined,
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
    conversation_id: params.conversationId,
    user_id: params.userId,
    role: params.message.role,
    content: params.message.content,
    citations: JSON.parse(JSON.stringify(params.message.trace ?? [])),
  });
  if (error) throw error;

  const { error: touchError } = await supabase
    .from("copilot_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", params.conversationId);
  if (touchError) throw touchError;
}
