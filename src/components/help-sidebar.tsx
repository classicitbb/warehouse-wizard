import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ExternalLink, HelpCircle, LifeBuoy, Search, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import {
  articleMatchesQuery,
  canViewArticle,
  getVisibleHelpGroups,
  visibleSections,
  type HelpViewer,
} from "@/features/help/help-topics";
import { getArticleById, getRouteHelp, type HelpArticle } from "@/lib/help-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/** Floor troubleshooting article: surfaced on every page so a stuck operator is one tap from it. */
const STUCK_ARTICLE_ID = "operational-dead-ends";

export function HelpSidebar({ pathname, toolbar }: { pathname: string; toolbar?: "desktop" | "tablet" }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [readingId, setReadingId] = useState<string | null>(null);
  const { toPath } = useTenantPath();
  const { roles } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const help = getRouteHelp(pathname);

  const viewer = useMemo<HelpViewer>(() => ({ isAdmin: roles.includes("admin"), isEnabled }), [roles, isEnabled]);
  const linkedArticles = help.wikiArticleIds
    .map((id) => getArticleById(id))
    .filter((article): article is HelpArticle => Boolean(article) && canViewArticle(article as HelpArticle, viewer));
  const stuckArticle = getArticleById(STUCK_ARTICLE_ID);
  const stuckSections =
    stuckArticle && canViewArticle(stuckArticle, viewer)
      ? visibleSections(stuckArticle, viewer).filter((section) => section.title.startsWith("If "))
      : [];

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return getVisibleHelpGroups(viewer)
      .flatMap((group) => group.articles)
      .filter((article) => articleMatchesQuery(article, query))
      .slice(0, 12);
  }, [query, viewer]);

  const reading = readingId ? getArticleById(readingId) : undefined;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setReadingId(null);
      setQuery("");
    }
  };
  const close = () => onOpenChange(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button
          variant={toolbar === "desktop" ? "ghost" : "outline"}
          className={
            toolbar === "desktop"
              ? "h-full rounded-none border-l border-border px-2.5 text-sm focus-visible:ring-inset data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
              : toolbar === "tablet"
                ? "h-[43px] rounded-none border-y-0 border-r-0 border-l border-border bg-transparent px-3 text-sm leading-5 hover:bg-accent focus-visible:ring-inset"
                : undefined
          }
        >
          <HelpCircle data-icon="inline-start" />
          Help
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="shrink-0 space-y-3 border-b border-border p-4 pr-12 text-left">
          <div>
            <SheetTitle>{reading ? reading.title : `Help: ${help.title}`}</SheetTitle>
            <SheetDescription className="mt-1">{reading ? reading.audience : help.summary}</SheetDescription>
          </div>
          {!reading ? (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-9"
                placeholder="Search all help"
                aria-label="Search all help"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          ) : null}
        </SheetHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-5 p-4">
            {reading ? (
              <ArticleReader
                article={reading}
                viewer={viewer}
                fullPath={toPath(`/help/${reading.id}`)}
                onBack={() => setReadingId(null)}
                onNavigate={close}
              />
            ) : query.trim() ? (
              <section className="grid gap-2" aria-label="Search results">
                <p className="text-xs text-muted-foreground">
                  {searchResults.length ? `${searchResults.length} topic${searchResults.length === 1 ? "" : "s"}` : `No topics match “${query}”.`}
                </p>
                {searchResults.map((article) => (
                  <ArticleButton key={article.id} article={article} onClick={() => setReadingId(article.id)} />
                ))}
              </section>
            ) : (
              <>
                {help.keyActions.length ? (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-semibold">How to use this page</h3>
                    <ol className="grid gap-2">
                      {help.keyActions.map((item, i) => (
                        <li key={item} className="flex gap-3 text-sm">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {i + 1}
                          </span>
                          <span className="text-muted-foreground">{item}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                ) : null}

                {help.commonMistakes.length ? (
                  <section className="grid gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      Avoid these mistakes
                    </h3>
                    <ul className="grid gap-1.5 pl-5 text-sm text-muted-foreground">
                      {help.commonMistakes.map((item) => (
                        <li key={item} className="list-disc">{item}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {stuckSections.length ? (
                  <section className="grid gap-1">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <LifeBuoy className="h-4 w-4 text-primary" />
                      Stuck? Quick fixes
                    </h3>
                    <Accordion type="single" collapsible className="w-full">
                      {stuckSections.map((section) => (
                        <AccordionItem key={section.title} value={section.title}>
                          <AccordionTrigger className="py-2 text-left text-sm">{section.title}</AccordionTrigger>
                          <AccordionContent className="grid gap-1.5">
                            {section.content.map((line) => (
                              <p key={line} className="text-sm text-muted-foreground">{line}</p>
                            ))}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </section>
                ) : null}

                {linkedArticles.length ? (
                  <section className="grid gap-2">
                    <h3 className="text-sm font-semibold">Read more</h3>
                    {linkedArticles.map((article) => (
                      <ArticleButton key={article.id} article={article} onClick={() => setReadingId(article.id)} />
                    ))}
                  </section>
                ) : null}

                <p className="flex items-start gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {help.permissions}
                </p>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="shrink-0 border-t border-border p-3">
          <Button asChild variant="outline" className="w-full">
            <Link to={toPath("/help")} onClick={close}>Browse all help topics</Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ArticleButton({ article, onClick }: { article: HelpArticle; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="text-sm font-medium text-primary">{article.title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{article.sections[0]?.content[0] ?? article.audience}</p>
    </button>
  );
}

function ArticleReader({
  article,
  viewer,
  fullPath,
  onBack,
  onNavigate,
}: {
  article: HelpArticle;
  viewer: HelpViewer;
  fullPath: string;
  onBack: () => void;
  onNavigate: () => void;
}) {
  return (
    <article className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Button asChild variant="link" size="sm">
          <Link to={fullPath} onClick={onNavigate}>
            Open full page
            <ExternalLink className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      <Badge variant="secondary" className="w-fit">{article.module}</Badge>
      {visibleSections(article, viewer).map((section) => (
        <section key={section.title} className="grid gap-1.5">
          <h3 className="text-sm font-semibold">{section.title}</h3>
          {section.content.map((line) => (
            <p key={line} className="text-sm leading-6 text-muted-foreground">{line}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
