import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { STARTER_MODULES, type ModuleKey, useFeatureFlags } from "@/hooks/use-feature-flags";
import { getArticleById, getRouteHelp, type HelpArticle } from "@/lib/help-content";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const KNOWN_MODULE_KEYS = Object.keys(STARTER_MODULES) as ModuleKey[];

function articleModuleKey(mod: string): ModuleKey | null {
  if (KNOWN_MODULE_KEYS.includes(mod as ModuleKey)) return mod as ModuleKey;
  if (mod === "packaging-profiles") return "packaging";
  if (mod === "help" || mod === "setup-wizard" || mod === "dashboard") return null;
  return null;
}

function canShowArticle(article: HelpArticle, roles: string[], isEnabled: (key: ModuleKey) => boolean) {
  const modKey = articleModuleKey(article.module);
  if (modKey && !isEnabled(modKey)) return false;
  if (article.audience === "Admins" || article.audience === "Admins and IT") {
    return roles.includes("admin");
  }
  return true;
}

export function HelpSidebar({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  const help = getRouteHelp(pathname);
  const { roles } = useAuth();
  const { isEnabled } = useFeatureFlags();
  const linkedArticles = help.wikiArticleIds
    .map((articleId) => getArticleById(articleId))
    .filter((article): article is HelpArticle => Boolean(article))
    .filter((article) => canShowArticle(article, roles, isEnabled));

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <HelpCircle data-icon="inline-start" />
          Help
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{help.title}</SheetTitle>
          <SheetDescription>{help.summary}</SheetDescription>
        </SheetHeader>
        <ScrollArea className="mt-6 h-[calc(100vh-9rem)] pr-4">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Actions</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-muted-foreground">
                {help.keyActions.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Common Mistakes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-muted-foreground">
                {help.commonMistakes.map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Permissions</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">{help.permissions}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Related Wiki Articles</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {linkedArticles.map((article) => (
                  <div key={article?.id} className="rounded-lg border border-border p-3">
                    <p className="font-medium">{article?.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{article?.audience}</p>
                  </div>
                ))}
                <Button asChild className="w-full">
                  <Link to="/help" onClick={() => setOpen(false)}>Open Help Center</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
