// Help Center navigation: groups every help article into operator-priority
// topics, decides which articles and sections each user may read, and resolves
// /help/:articleId routes. Pure functions only so it can be unit tested.

import { STARTER_MODULES, type ModuleKey } from "@/hooks/use-feature-flags";
import { helpArticles, type HelpArticle, type HelpSection } from "@/lib/help-content";

export type HelpTopicGroup = {
  id: string;
  title: string;
  description: string;
  /** Internal docs: setup, integrations and system administration. Admins only. */
  adminOnly?: boolean;
  articleIds: string[];
};

/**
 * Ordered by how often operators reach for them: live floor work first,
 * stock lookups next, office planning after that, then orientation. Internal
 * admin documentation sits last and is hidden from everyone but admins.
 */
export const HELP_TOPIC_GROUPS: HelpTopicGroup[] = [
  {
    id: "floor-work",
    title: "Floor Work",
    description: "Daily scan workflows and what to do when a task gets stuck.",
    articleIds: [
      "operational-dead-ends",
      "trip-dispatch-flow",
      "pick-flow",
      "pick-alternate-pallet",
      "receiving-flow",
      "netsuite-receiving",
      "putaway-flow",
      "replenishment-flow",
      "location-move-flow",
      "transfer-flow",
      "operational-status-and-transfers",
      "cycle-counts",
    ],
  },
  {
    id: "stock",
    title: "Stock and Labels",
    description: "Find stock, control its status, print labels and look up products.",
    articleIds: ["inventory-search", "status-controls", "label-printing", "product-mastery", "packaging-profiles"],
  },
  {
    id: "office",
    title: "Office and Planning",
    description: "Orders, customers, clients, dashboards and reporting.",
    articleIds: [
      "orders-inbox",
      "customers-directory",
      "client-ownership",
      "enterprise-dashboard-modes",
      "reporting-basics",
      "warehouse-brain",
      "lean-standard-work",
      "warehouse-copilot",
    ],
  },
  {
    id: "getting-around",
    title: "Getting Around",
    description: "Finding your way, notifications and connected assistants.",
    articleIds: ["public-product-pages", "help-center", "notification-bell", "notifications-settings", "ai-assistants-mcp"],
  },
  {
    id: "admin",
    title: "Admin and Internal",
    description: "Warehouse setup, users, integrations, printers and system controls.",
    adminOnly: true,
    articleIds: [
      "warehouse-setup",
      "warehouse-structure-tool",
      "zone-design",
      "location-generation",
      "user-management",
      "zebra-printing",
      "netsuite-integration",
      "netsuite-bin-sync",
      "release-control",
      "system-log-operations",
      "email-log-operations",
      "settings-reset",
    ],
  },
];

/** Design notes inside operator articles that only admins should see. */
const INTERNAL_SECTION_TITLES = new Set(["Current System Design To-Do for Operators", "System Flow Gaps To Resolve"]);

const ADMIN_ONLY_ARTICLE_IDS = new Set(HELP_TOPIC_GROUPS.filter((g) => g.adminOnly).flatMap((g) => g.articleIds));

const KNOWN_MODULE_KEYS = Object.keys(STARTER_MODULES) as ModuleKey[];

export function articleModuleKey(mod: string): ModuleKey | null {
  if (KNOWN_MODULE_KEYS.includes(mod as ModuleKey)) return mod as ModuleKey;
  if (mod === "packaging-profiles") return "packaging";
  return null;
}

export type HelpViewer = {
  isAdmin: boolean;
  isEnabled: (key: ModuleKey) => boolean;
};

export function isInternalArticle(article: HelpArticle) {
  return ADMIN_ONLY_ARTICLE_IDS.has(article.id) || /^Admins( and IT| and developers)?$/.test(article.audience);
}

export function canViewArticle(article: HelpArticle, viewer: HelpViewer) {
  const modKey = articleModuleKey(article.module);
  if (modKey && !viewer.isEnabled(modKey)) return false;
  if (isInternalArticle(article)) return viewer.isAdmin;
  return true;
}

export function visibleSections(article: HelpArticle, viewer: HelpViewer): HelpSection[] {
  if (viewer.isAdmin) return article.sections;
  return article.sections.filter((section) => !INTERNAL_SECTION_TITLES.has(section.title));
}

export type ResolvedHelpGroup = HelpTopicGroup & { articles: HelpArticle[] };

/** Groups the viewer can see, each with its visible articles in priority order. */
export function getVisibleHelpGroups(viewer: HelpViewer): ResolvedHelpGroup[] {
  const byId = new Map(helpArticles.map((article) => [article.id, article]));
  const assigned = new Set(HELP_TOPIC_GROUPS.flatMap((g) => g.articleIds));
  const unassigned = helpArticles.filter((article) => !assigned.has(article.id)).map((article) => article.id);
  const groups: HelpTopicGroup[] = unassigned.length
    ? [...HELP_TOPIC_GROUPS, { id: "more", title: "More Topics", description: "Other reference articles.", articleIds: unassigned }]
    : HELP_TOPIC_GROUPS;

  return groups
    .filter((group) => !group.adminOnly || viewer.isAdmin)
    .map((group) => ({
      ...group,
      articles: group.articleIds
        .map((id) => byId.get(id))
        .filter((article): article is HelpArticle => Boolean(article) && canViewArticle(article as HelpArticle, viewer)),
    }))
    .filter((group) => group.articles.length > 0);
}

/** Extracts the article id from a /help/:articleId path (tenant prefix tolerant). */
export function helpArticleIdFromPath(pathname: string): string | null {
  const match = /\/help\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function articleMatchesQuery(article: HelpArticle, query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [article.title, article.module, article.audience, ...article.keywords, ...article.sections.flatMap((s) => [s.title, ...s.content])]
    .join(" ")
    .toLowerCase()
    .includes(trimmed);
}

export function sectionSlug(title: string): string {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
