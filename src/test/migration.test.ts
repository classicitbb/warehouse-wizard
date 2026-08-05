import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/_archive/20260402093000_init_wms.sql"),
  "utf8",
);
const helpMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/_archive/20260402193000_help_archive_reset_setup.sql"),
  "utf8",
);
const approvalRlsMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/_archive/20260402195000_fix_profile_approval_and_admin_rls.sql"),
  "utf8",
);
const enterpriseSchemaMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/_archive/20260507123000_enterprise_wms_extensions_part1_schema.sql"),
  "utf8",
);
const enterprisePoliciesSeedMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/_archive/20260507123100_enterprise_wms_extensions_part2_policies_seed.sql"),
  "utf8",
);
const demoSeed = readFileSync(
  path.resolve(process.cwd(), "supabase/seed.example.sql"),
  "utf8",
);
const profileLoginCodesMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260528000000_restore_profile_login_codes.sql"),
  "utf8",
);
const adminUpdatePasswordMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260528001000_admin_update_user_password.sql"),
  "utf8",
);
const cleanSlateResetMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260606090000_harden_reset_all_clean_slate.sql"),
  "utf8",
);

describe("init_wms migration", () => {
  it("creates the core warehouse tables", () => {
    expect(migration).toContain("create table public.warehouses");
    expect(migration).toContain("create table public.locations");
    expect(migration).toContain("create table public.products");
    expect(migration).toContain("create table public.pallets");
    expect(migration).toContain("create table public.inventory_balances");
    expect(migration).toContain("create table public.pick_tasks");
  });

  it("enables row level security and role-based policies", () => {
    expect(migration).toContain("alter table public.pallets enable row level security");
    expect(migration).toContain("create policy \"putaway tasks read assigned\"");
    expect(migration).toContain("create policy \"pick tasks read assigned\"");
    expect(migration).toContain("create policy \"roles admin manage\"");
  });

  it("defines helper views and RPCs for operations", () => {
    expect(migration).toContain("create or replace function public.directed_putaway_candidates");
    expect(migration).toContain("create or replace view public.inventory_search_view");
    expect(migration).toContain("create or replace view public.location_occupancy_view");
    expect(migration).toContain("insert into storage.buckets");
  });
});

describe("help/archive/setup migration", () => {
  it("adds archive fields and admin rpc entry points", () => {
    expect(helpMigration).toContain("add column if not exists is_hidden boolean not null default false");
    expect(helpMigration).toContain("create or replace function public.reset_wms_data()");
    expect(helpMigration).toContain("create or replace function public.run_warehouse_setup");
  });
});

describe("profile approval and admin rls migration", () => {
  it("adds profile approval fields needed by the app", () => {
    expect(approvalRlsMigration).toContain("add column if not exists phone text");
    expect(approvalRlsMigration).toContain("add column if not exists approved boolean not null default false");
    expect(approvalRlsMigration).toContain("update public.profiles p");
  });

  it("restores admin write access to user_roles under RLS", () => {
    expect(approvalRlsMigration).toContain("create policy \"Admins can insert user_roles\"");
    expect(approvalRlsMigration).toContain("create policy \"Admins can update user_roles\"");
    expect(approvalRlsMigration).toContain("create policy \"Admins can delete user_roles\"");
  });
});

describe("enterprise WMS extension migration", () => {
  it("adds integration, printing, reporting, AI, and advanced workflow tables", () => {
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.integration_connections");
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.external_record_links");
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.print_jobs");
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.ai_recommendations");
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.staging_loads");
    expect(enterpriseSchemaMigration).toContain("create table if not exists public.replenishment_tasks");
  });

  it("keeps enterprise policies and seed data in the second migration part", () => {
    expect(enterprisePoliciesSeedMigration).toContain("enable row level security");
    expect(enterprisePoliciesSeedMigration).toContain("Approved users read");
    expect(enterprisePoliciesSeedMigration).toContain("insert into public.report_definitions");
    expect(enterprisePoliciesSeedMigration).toContain("insert into public.label_templates");
  });
});

describe("demo seed", () => {
  it("includes full-flow operational demo records and paperwork references", () => {
    expect(demoSeed).toContain("PO-BIM-2026-0509");
    expect(demoSeed).toContain("WW-MAN-2026-0509");
    expect(demoSeed).toContain("TRF-INTRA-0509");
    expect(demoSeed).toContain("APPT-IN-0509");
    expect(demoSeed).toContain("FULL-FLOW-DEMO-RECEIVE");
  });
});

describe("profile login codes migration", () => {
  it("restores user and badge code columns for self-serve access", () => {
    expect(profileLoginCodesMigration).toContain("add column if not exists user_code text");
    expect(profileLoginCodesMigration).toContain("add column if not exists badge_code text");
    expect(profileLoginCodesMigration).toContain("idx_profiles_badge_code_unique");
    expect(profileLoginCodesMigration).toContain("public.resolve_login_code");
  });
});

describe("admin password update migration", () => {
  it("adds an admin-only RPC for direct credential updates", () => {
    expect(adminUpdatePasswordMigration).toContain("create or replace function public.admin_update_user_password");
    expect(adminUpdatePasswordMigration).toContain("public.has_role(auth.uid(), 'admin')");
    expect(adminUpdatePasswordMigration).toContain("encrypted_password = extensions.crypt(in_password, extensions.gen_salt('bf'::text))");
    expect(adminUpdatePasswordMigration).toContain("grant execute on function public.admin_update_user_password(uuid, text) to authenticated");
  });
});

describe("clean slate reset migration", () => {
  it("preserves developer access while clearing seeded users and newer reset tables", () => {
    expect(cleanSlateResetMigration).toContain("create or replace function public.reset_wms_data()");
    expect(cleanSlateResetMigration).toContain("public.has_role(actor_user, 'developer')");
    expect(cleanSlateResetMigration).toContain("lower(coalesce(p.email, '')) = 'russelljhunte@gmail.com'");
    expect(cleanSlateResetMigration).toContain("delete from auth.users");
    expect(cleanSlateResetMigration).toContain("public.user_device_trust");
    expect(cleanSlateResetMigration).toContain("public.email_send_log");
    expect(cleanSlateResetMigration).toContain("grant execute on function public.reset_wms_data() to authenticated");
  });
});
