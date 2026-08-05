import { describe, expect, it } from "vitest";

import { NAVIGATION } from "@/lib/wms-core";
import { getAllRouteHelpDefinitions, getArticleById, getRouteHelp, searchHelpArticles } from "@/lib/help-content";

describe("help content", () => {
  it("maps detail routes to the correct contextual help", () => {
    expect(getRouteHelp("/inventory/123").id).toBe("inventory");
    expect(getRouteHelp("/pick-lists/abc").id).toBe("pick-lists");
  });

  it("maps every navigation route to contextual help", () => {
    const routeSamples = new Map([
      ["/inventory/:balanceId", "/inventory/example"],
      ["/pick-lists/:pickListId", "/pick-lists/example"],
    ]);

    for (const item of NAVIGATION) {
      const route = routeSamples.get(item.to) ?? item.to;
      const help = getRouteHelp(route);
      expect(help.title, item.to).toBeTruthy();
      if (item.to !== "/dashboard") {
        expect(help.id, item.to).not.toBe("dashboard");
      }
    }
  });

  it("keeps every route help article link valid", () => {
    for (const help of getAllRouteHelpDefinitions()) {
      expect(help.wikiArticleIds.length, help.id).toBeGreaterThan(0);
      for (const articleId of help.wikiArticleIds) {
        expect(getArticleById(articleId), `${help.id} links ${articleId}`).toBeTruthy();
      }
    }
  });

  it("finds wiki articles by operational keywords", () => {
    const results = searchHelpArticles("transfer");

    expect(results.some((article) => article.id === "transfer-flow")).toBe(true);
  });

  it("documents enterprise setup topics", () => {
    expect(searchHelpArticles("netsuite").some((article) => article.id === "netsuite-integration")).toBe(true);
    expect(searchHelpArticles("zpl").some((article) => article.id === "zebra-printing")).toBe(true);
    expect(searchHelpArticles("warehouse brain").some((article) => article.id === "warehouse-brain")).toBe(true);
  });

  it("documents client, location move, system log, and email log topics", () => {
    expect(searchHelpArticles("mixed stock").some((article) => article.id === "client-ownership")).toBe(true);
    expect(searchHelpArticles("same warehouse").some((article) => article.id === "location-move-flow")).toBe(true);
    expect(searchHelpArticles("record-count snapshots").some((article) => article.id === "system-log-operations")).toBe(true);
    expect(searchHelpArticles("delivery status").some((article) => article.id === "email-log-operations")).toBe(true);
  });

  it("documents badges, lean controls, templates, and references", () => {
    expect(searchHelpArticles("badge").some((article) => article.id === "user-management")).toBe(true);
    expect(searchHelpArticles("csv").some((article) => article.id === "product-mastery")).toBe(true);
    expect(searchHelpArticles("5s").some((article) => article.id === "lean-standard-work")).toBe(true);
    expect(searchHelpArticles("gs1").some((article) => article.references?.some((reference) => reference.url.includes("gs1.org")))).toBe(true);
  });

  it("documents the receiving scanner and commit flow", () => {
    expect(searchHelpArticles("iso 6346").some((article) => article.id === "receiving-flow")).toBe(true);
    expect(searchHelpArticles("commit arrow").some((article) => article.id === "receiving-flow")).toBe(true);
    expect(getRouteHelp("/receiving").keyActions.some((action) => action.includes("container camera scanner"))).toBe(true);
  });
});
