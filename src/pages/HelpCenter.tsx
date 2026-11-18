import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Lock, Search } from "lucide-react";

import { setupWizardSteps, getArticleById } from "@/lib/help-content";
import {
  articleMatchesQuery,
  canViewArticle,
  getVisibleHelpGroups,
  helpArticleIdFromPath,
  sectionSlug,
  visibleSections,
  type HelpViewer,
} from "@/features/help/help-topics";
import { useAuth } from "@/hooks/use-auth";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { useTenantPath } from "@/hooks/use-tenant-path";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function HelpCenterPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { toPath } = useTenantPath();
  const { roles } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const [query, setQuery] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  const viewer = useMemo<HelpViewer>(() => ({ isAdmin: roles.includes("admin"), isEnabled }), [roles, isEnabled]);
  const groups = useMemo(() => getVisibleHelpGroups(viewer), [viewer]);
  const orderedArticles = useMemo(() => groups.flatMap((group) => group.articles), [groups]);
  const filteredGroups = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, articles: group.articles.filter((article) => articleMatchesQuery(article, query)) }))
        .filter((group) => group.articles.length > 0),
    [groups, query],
  );

  const articleId = helpArticleIdFromPath(pathname);
  const requested = articleId ? getArticleById(articleId) : undefined;
  const article = requested && canViewArticle(requested, viewer) ? requested : undefined;
  const index = article ? orderedArticles.findIndex((a) => a.id === article.id) : -1;
  const prev = index > 0 ? orderedArticles[index - 1] : undefined;
  const next = index >= 0 && index < orderedArticles.length - 1 ? orderedArticles[index + 1] : undefined;

  // Each topic is its own page: start at the top when the route changes.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [articleId]);

  const articlePath = (id: string) => toPath(`/help/${id}`);
  const matchCount = filteredGroups.reduce((sum, group) => sum + group.articles.length, 0);

  return (
    <div className="help-center-light bg-background text-foreground flex h-full min-h-0 overflow-hidden">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border lg:flex" aria-label="Help topics">
        <div className="shrink-0 border-b border-border p-3">
          <Link to={toPath("/help")} className="mb-2 block text-lg font-semibold hover:underline">
            Help Center
          </Link>
          <SearchBox query={query} onChange={setQuery} />
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          {filteredGroups.map((group) => (
            <div key={group.id} className="mb-3">
              <p className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.adminOnly ? <Lock className="h-3 w-3" aria-label="Admins only" /> : null}
                {group.title}
              </p>
              <ul className="grid gap-0.5">
                {group.articles.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      to={articlePath(item.id)}
                      className={({ isActive }) =>
                        cn(
                          "block rounded-md px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground",
                          isActive && "bg-primary/10 font-medium text-primary",
                        )
                      }
                    >
                      {item.title}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {matchCount === 0 ? <p className="px-2 text-sm text-muted-foreground">No topics match “{query}”.</p> : null}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col min-h-0">
        {/* Phone/tablet: topic picker replaces the sidebar */}
        <div className="shrink-0 grid gap-2 border-b border-border p-3 lg:hidden">
          <Select value={article?.id ?? ""} onValueChange={(id) => navigate(articlePath(id))}>
            <SelectTrigger aria-label="Choose a help topic">
              <SelectValue placeholder="Choose a help topic" />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{group.title}</SelectLabel>
                  {group.articles.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
          {!article ? <SearchBox query={query} onChange={setQuery} /> : null}
        </div>

        <div ref={contentRef} id="help-articles" className="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
          {article ? (
            <article className="mx-auto grid max-w-3xl gap-6">
              <header className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{article.module}</Badge>
                  <Badge variant="outline">{article.audience}</Badge>
                </div>
                <h1 className="text-2xl font-semibold">{article.title}</h1>
                {article.acronyms ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(article.acronyms).map(([term, explanation]) => (
                      <Tooltip key={term}>
                        <TooltipTrigger asChild>
                          <Badge className="cursor-help" variant="outline">{term}</Badge>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                ) : null}
              </header>

              {visibleSections(article, viewer).map((section) => (
                <section key={section.title} id={`sect-${sectionSlug(section.title)}`} className="grid gap-2 scroll-mt-4">
                  <h2 className="text-lg font-medium">{section.title}</h2>
                  {article.id === "warehouse-setup" && section.title === "Step Sequence" ? (
                    <Accordion type="multiple" className="w-full">
                      {setupWizardSteps.map((step) => (
                        <AccordionItem key={step.number} value={`step-${step.number}`}>
                          <AccordionTrigger className="text-sm">
                            <span className="text-left">
                              <span className="font-medium">Step {step.number}: {step.title}</span>
                              <span className="ml-2 text-muted-foreground">{step.summary}</span>
                            </span>
                          </AccordionTrigger>
                          <AccordionContent>
                            <ul className="grid gap-2 pl-4 text-sm text-muted-foreground">
                              {step.details.map((detail) => (
                                <li key={detail} className="list-disc">{detail}</li>
                              ))}
                            </ul>
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  ) : (
                    section.content.map((line) => (
                      <p key={line} className="text-sm leading-6 text-muted-foreground">{line}</p>
                    ))
                  )}
                </section>
              ))}

              {article.references?.length ? (
                <section className="grid gap-2 border-t border-border pt-4">
                  <h2 className="font-medium">References and search links</h2>
                  {article.references.map((reference) => (
                    <a
                      key={reference.url}
                      className="rounded-md border border-border px-3 py-2 text-sm text-primary underline-offset-4 hover:underline"
                      href={reference.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {reference.label}
                      <span className="block text-xs text-muted-foreground">{reference.reason}</span>
                    </a>
                  ))}
                </section>
              ) : null}

              <nav className="flex flex-wrap justify-between gap-2 border-t border-border pt-4" aria-label="Previous and next topic">
                {prev ? (
                  <Button asChild variant="outline" className="max-w-full">
                    <Link to={articlePath(prev.id)}>
                      <ChevronLeft className="h-4 w-4" />
                      <span className="truncate">{prev.title}</span>
                    </Link>
                  </Button>
                ) : <span />}
                {next ? (
                  <Button asChild variant="outline" className="max-w-full">
                    <Link to={articlePath(next.id)}>
                      <span className="truncate">{next.title}</span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
              </nav>
            </article>
          ) : (
            <div className="mx-auto grid max-w-4xl gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Help Center</h1>
                <p className="text-sm text-muted-foreground">
                  {articleId
                    ? "That topic isn't available for your role or active modules. Pick another topic below."
                    : "Pick a topic. Floor workflows are listed first."}
                </p>
              </div>
              {filteredGroups.map((group) => (
                <Card key={group.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {group.adminOnly ? <Lock className="h-4 w-4" aria-label="Admins only" /> : null}
                      {group.title}
                    </CardTitle>
                    <CardDescription>{group.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-1 sm:grid-cols-2">
                    {group.articles.map((item) => (
                      <Link
                        key={item.id}
                        to={articlePath(item.id)}
                        className="rounded-md px-2 py-1.5 text-sm text-primary underline-offset-4 hover:bg-accent hover:underline"
                      >
                        {item.title}
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              ))}
              {matchCount === 0 ? <p className="text-sm text-muted-foreground">No topics match “{query}”.</p> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchBox({ query, onChange }: { query: string; onChange: (value: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        className="pl-9"
        placeholder="Search topics"
        aria-label="Search help topics"
        value={query}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
