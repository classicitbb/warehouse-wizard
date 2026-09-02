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
const developerGrantorMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260708183000_developer_role_grantor_controls.sql"),
  "utf8",
);
const preventSelfDisableMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260708184500_prevent_self_disable.sql"),
  "utf8",
);
const cancelCycleCountMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260823142641_cancel_cycle_count.sql"),
  "utf8",
);
const warehouseIntelligencePhaseOneMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260830021615_warehouse_intelligence_phase_one_scope.sql"),
  "utf8",
);
const receivingPutawayLifecycleMigration = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260901155226_receiving_putaway_lifecycle_integrity.sql"),
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

describe("cycle-count cancellation migration", () => {
  it("authorizes managers and defines every cancellable lifecycle state", () => {
    expect(cancelCycleCountMigration).toContain("public.has_min_role(v_actor_id, 'warehouse_manager')");
    expect(cancelCycleCountMigration).toContain("('draft', 'frozen', 'counting', 'review', 'approved')");
    expect(cancelCycleCountMigration).toContain("Archived cycle counts are immutable");
  });

  it("atomically releases inventory, clears claims, and records an audit event", () => {
    expect(cancelCycleCountMigration).toContain("update public.inventory_balances");
    expect(cancelCycleCountMigration).toContain("update public.pallets");
    expect(cancelCycleCountMigration).toContain("update public.inventory_freezes");
    expect(cancelCycleCountMigration).toContain("set claimed_by_user_id = null");
    expect(cancelCycleCountMigration).toContain("'cycle_count_cancelled'");
  });

  it("prevents creation from adding work after a concurrent cancellation", () => {
    expect(cancelCycleCountMigration).toContain("function private.assert_cycle_count_accepts_work");
    expect(cancelCycleCountMigration).toContain("for key share");
    expect(cancelCycleCountMigration).toContain("cycle_count_lines_require_active_header");
    expect(cancelCycleCountMigration).toContain("inventory_freezes_require_active_header");
  });

  it("keeps the privileged implementation private and exposes an invoker wrapper", () => {
    expect(cancelCycleCountMigration).toContain("function private.cancel_cycle_count");
    expect(cancelCycleCountMigration).toContain("function public.cancel_cycle_count");
    expect(cancelCycleCountMigration).toContain("security invoker");
    expect(cancelCycleCountMigration).toContain("revoke execute on function public.cancel_cycle_count(uuid, text) from public, anon");
  });
});

describe("Warehouse Intelligence Phase 1 migration", () => {
  it("appends warehouse_id without reordering existing occupancy view columns", () => {
    expect(warehouseIntelligencePhaseOneMigration).toContain("(count(ib.id) >= l.max_pallets) as is_full,\n  l.warehouse_id");
    expect(warehouseIntelligencePhaseOneMigration).not.toContain("l.id as location_id,\n  l.warehouse_id,\n  l.code as location_code");
  });
});

describe("receiving and Put-Away lifecycle migration", () => {
  it("owns receiving confirmation and cancellation in guarded atomic RPCs", () => {
    expect(receivingPutawayLifecycleMigration).toContain("function public.confirm_receiving_draft_labels_printed");
    expect(receivingPutawayLifecycleMigration).toContain("function public.cancel_receiving_draft");
    expect(receivingPutawayLifecycleMigration).toContain("security definer");
    expect(receivingPutawayLifecycleMigration).toContain("for update");
    expect(receivingPutawayLifecycleMigration).toContain("receiving_labels_confirmed");
    expect(receivingPutawayLifecycleMigration).toContain("revoke all on function public.confirm_receiving_draft_labels_printed(uuid) from public, anon");
  });

  it("reconciles only location-less receiving stock without active work into same-barcode drafts", () => {
    expect(receivingPutawayLifecycleMigration).toContain("orphan_receiving_reconciliation");
    expect(receivingPutawayLifecycleMigration).toContain("p.current_location_id is null");
    expect(receivingPutawayLifecycleMigration).toContain("pt.status in ('draft', 'queued', 'assigned', 'in_progress', 'exception')");
    expect(receivingPutawayLifecycleMigration).toContain("rd.status = 'draft'");
    expect(receivingPutawayLifecycleMigration).toContain("candidate.pallet_barcode");
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

describe("developer role grantor controls migration", () => {
  it("tracks the role grantor and limits developer unassignment to that grantor", () => {
    expect(developerGrantorMigration).toContain("ADD COLUMN IF NOT EXISTS assigned_by");
    expect(developerGrantorMigration).toContain("CREATE OR REPLACE FUNCTION public.set_user_role_assigned_by()");
    expect(developerGrantorMigration).toContain("NEW.assigned_by := auth.uid()");
    expect(developerGrantorMigration).toContain("CREATE OR REPLACE FUNCTION public.enforce_developer_role_unassigner()");
    expect(developerGrantorMigration).toContain("auth.uid() IS DISTINCT FROM OLD.assigned_by");
    expect(developerGrantorMigration).toContain("Only the developer who assigned this role can unassign it");
  });
});

describe("self-disable prevention migration", () => {
  it("blocks users from deactivating their own profile", () => {
    expect(preventSelfDisableMigration).toContain("CREATE OR REPLACE FUNCTION public.prevent_self_disable()");
    expect(preventSelfDisableMigration).toContain("OLD.id = auth.uid()");
    expect(preventSelfDisableMigration).toContain("NEW.active = false");
    expect(preventSelfDisableMigration).toContain("Users cannot disable their own account");
    expect(preventSelfDisableMigration).toContain("CREATE TRIGGER trg_prevent_self_disable");
  });
});

describe("plpgsql variable conflict migration", () => {
  const variableConflictMigration = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260902143104_55a4eb55-9e7e-4b6f-838b-c1a8201686d6.sql"),
    "utf8",
  );

  // RETURNS TABLE output names (pallet_id, pallet_barcode, location_id, ...)
  // shadow real table columns inside the body and raise 42702. Every function
  // below must keep the `#variable_conflict use_column` directive.
  const patchedFunctions = [
    "public.confirm_receiving_draft_labels_printed(uuid)",
    "public.return_putaway_to_receiving_draft(uuid)",
    "public.save_inventory_pallet_correction_as_draft(uuid,numeric,date,boolean)",
    "public.begin_inventory_pallet_correction(uuid)",
    "public.complete_inventory_pallet_correction(uuid,numeric,date,boolean)",
    "public.complete_inventory_pallet_correction_in_place(uuid,numeric)",
    "public.recover_missing_pallet_to_putaway(uuid)",
    "public.recover_missing_pallet_to_draft(uuid,numeric)",
  ];

  it("applies the use_column directive to every pallet-returning function", () => {
    expect(variableConflictMigration).toContain("#variable_conflict use_column");
    for (const signature of patchedFunctions) {
      expect(variableConflictMigration).toContain(signature);
    }
  });

  it("skips non-plpgsql functions so SQL-language routines are left alone", () => {
    expect(variableConflictMigration).toContain("position('LANGUAGE plpgsql' in def) = 0");
    expect(variableConflictMigration).not.toContain("directed_putaway_candidates");
  });
});
