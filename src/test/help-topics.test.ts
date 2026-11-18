import { describe, expect, it } from "vitest";

import { helpArticles } from "@/lib/help-content";
import {
  HELP_TOPIC_GROUPS,
  getVisibleHelpGroups,
  helpArticleIdFromPath,
  visibleSections,
} from "@/features/help/help-topics";

const allOn = () => true;
const operator = { isAdmin: false, isEnabled: allOn };
const admin = { isAdmin: true, isEnabled: allOn };

describe("help topics", () => {
  it("assigns every article to exactly one topic group", () => {
    const assigned = HELP_TOPIC_GROUPS.flatMap((group) => group.articleIds);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual(helpArticles.map((a) => a.id).sort());
  });

  it("lists floor work first for operators", () => {
    expect(getVisibleHelpGroups(operator)[0].id).toBe("floor-work");
  });

  it("hides internal admin docs from non-admins", () => {
    const operatorIds = getVisibleHelpGroups(operator).flatMap((g) => g.articles.map((a) => a.id));
    expect(getVisibleHelpGroups(operator).some((g) => g.adminOnly)).toBe(false);
    expect(operatorIds).not.toContain("release-control");
    expect(operatorIds).not.toContain("netsuite-integration");
    expect(getVisibleHelpGroups(admin).some((g) => g.id === "admin")).toBe(true);
  });

  it("strips internal design notes from operator articles", () => {
    const article = helpArticles.find((a) => a.id === "operational-dead-ends")!;
    const titles = visibleSections(article, operator).map((s) => s.title);
    expect(titles).not.toContain("System Flow Gaps To Resolve");
    expect(visibleSections(article, admin).length).toBe(article.sections.length);
  });

  it("parses article ids from help routes", () => {
    expect(helpArticleIdFromPath("/help")).toBeNull();
    expect(helpArticleIdFromPath("/help/pick-flow")).toBe("pick-flow");
  });
});
