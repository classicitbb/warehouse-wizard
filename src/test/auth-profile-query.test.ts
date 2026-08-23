import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const authHook = readFileSync(
  path.resolve(process.cwd(), "src/hooks/use-auth.tsx"),
  "utf8",
);

describe("auth profile bootstrap query", () => {
  it("does not request service-only profile credentials", () => {
    const query = authHook.match(/\.from\("profiles"\)[\s\S]*?\.select\(\s*"([^"]+)"/i)?.[1];

    expect(query).toBeDefined();
    expect(query?.split(/,\s*/)).not.toContain("badge_code");
    expect(query?.split(/,\s*/)).not.toContain("pin_hash");
  });
});
