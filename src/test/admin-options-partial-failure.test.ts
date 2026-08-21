import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failRolePermissions: true,
  attempts: 0,
}));

function tableStub(table: string) {
  const rows =
    table === "role_permissions"
      ? [{ role_id: "r1", feature_id: "f1", can_view: true }]
      : [{ id: `${table}-1` }];

  const builder: any = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    is: () => builder,
    or: () => builder,
    range: async () => {
      if (table === "role_permissions") {
        state.attempts += 1;
        if (state.failRolePermissions) {
          return {
            data: null,
            error: {
              message: 'column role_permissions.id does not exist',
              code: "42703",
              hint: "Perhaps you meant role_id",
              details: null,
            },
          };
        }
      }
      return { data: rows, error: null };
    },
    then: (resolve: (value: any) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => tableStub(table) },
}));

import { fetchOptions } from "@/features/admin/admin-core";

describe("fetchOptions partial failure", () => {
  beforeEach(() => {
    state.failRolePermissions = true;
    state.attempts = 0;
  });

  it("keeps healthy sections loaded and reports the failing table with a correlation id", async () => {
    const options = await fetchOptions(false);

    expect(options.profiles.length).toBeGreaterThan(0);
    expect(options.roles.length).toBeGreaterThan(0);
    expect(options.loadErrors).toHaveLength(1);
    const failure = options.loadErrors[0];
    expect(failure.key).toBe("rolePermissions");
    expect(failure.table).toBe("role_permissions");
    expect(failure.message).toContain("role_permissions.id does not exist");
    expect(failure.correlationId).toMatch(/^UR-/);
  });

  it("retries only the failed table", async () => {
    await fetchOptions(false);
    state.failRolePermissions = false;
    const attemptsBefore = state.attempts;

    const retry = await fetchOptions(false, undefined, ["rolePermissions"]);

    expect(retry.loadErrors).toHaveLength(0);
    expect(retry.rolePermissions.length).toBeGreaterThan(0);
    expect(state.attempts).toBe(attemptsBefore + 1);
  });
});
