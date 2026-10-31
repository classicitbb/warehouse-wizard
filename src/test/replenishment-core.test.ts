import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  faceState,
  fillPercent,
  policyBasisLabel,
  projectedQuantity,
  reasonLabel,
  sortTasks,
  triggerLevel,
  validateMaxPallets,
} from "@/features/replenishment/replenishment-core";

const migration = readFileSync("supabase/migrations/20261031150000_forward_pick_replenishment.sql", "utf8");

describe("pick face state", () => {
  // Fill 151 (one full pallet), trigger 50 % = 75.5.
  const face = { product_id: "p", on_hand_quantity: 151, demand_quantity: 0, full_quantity: 151, trigger_pct: 50 };

  it("subtracts the open demand from on hand", () => {
    expect(projectedQuantity({ on_hand_quantity: 30, demand_quantity: 12 })).toBe(18);
  });

  it("takes the trigger level as a % of the fill", () => {
    expect(triggerLevel(face)).toBe(75.5);
    expect(triggerLevel({ ...face, trigger_pct: 75 })).toBe(113.25);
    // Stock above the recorded fill raises the fill.
    expect(triggerLevel({ ...face, on_hand_quantity: 200 })).toBe(100);
  });

  it("is OK above the trigger level", () => {
    expect(faceState(face)).toBe("ok");
    expect(faceState({ ...face, on_hand_quantity: 111, demand_quantity: 35 })).toBe("ok");
  });

  it("needs a refill at or below the trigger level, with or without demand", () => {
    expect(faceState({ ...face, on_hand_quantity: 111, demand_quantity: 60 })).toBe("refill");
    expect(faceState({ ...face, on_hand_quantity: 70 })).toBe("refill");
  });

  it("is short when the face cannot cover the open demand", () => {
    expect(faceState({ ...face, demand_quantity: 200 })).toBe("short");
  });

  it("is free when no SKU is in the face", () => {
    expect(faceState({ ...face, product_id: null, on_hand_quantity: 0 })).toBe("empty");
  });

  it("shows the fill as a percentage", () => {
    expect(fillPercent({ on_hand_quantity: 70, full_quantity: 151 })).toBe(46);
    expect(fillPercent({ on_hand_quantity: 0, full_quantity: 0 })).toBeNull();
  });
});

describe("replenishment queue order", () => {
  it("puts urgent tasks first, then the oldest", () => {
    const tasks = [
      { id: "a", priority: "normal" as const, created_at: "2026-10-31T08:00:00Z" },
      { id: "b", priority: "urgent" as const, created_at: "2026-10-31T09:00:00Z" },
      { id: "c", priority: "normal" as const, created_at: "2026-10-31T07:00:00Z" },
      { id: "d", priority: "urgent" as const, created_at: "2026-10-31T08:30:00Z" },
    ];
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(["d", "b", "c", "a"]);
  });

  it("labels each reason for the floor", () => {
    expect(reasonLabel("short")).toBe("Picker short");
    expect(reasonLabel("min")).toBe("Fill level");
    expect(reasonLabel("demand")).toBe("Open orders");
  });

  it("says where the policy comes from", () => {
    expect(policyBasisLabel("learning")).toBe("Learning: minimum");
    expect(policyBasisLabel("learned")).toBe("Learned (30 days)");
    expect(policyBasisLabel(null)).toBe("");
  });
});

describe("pick face size", () => {
  it("accepts 1 to 10 pallets", () => {
    expect(validateMaxPallets(5)).toBeNull();
    expect(validateMaxPallets(0)).toMatch(/1 to 10/);
    expect(validateMaxPallets(11)).toMatch(/1 to 10/);
    expect(validateMaxPallets(2.5)).toMatch(/1 to 10/);
  });
});

describe("forward pick replenishment migration", () => {
  it("only adds to the schema", () => {
    expect(migration).not.toMatch(/\bdrop\s+(table|column)\b/i);
    expect(migration).toContain("create table if not exists public.pick_face_slots");
  });

  it("makes a pick face a bin status, not a zone or a fixed SKU", () => {
    expect(migration).not.toContain("is_forward_pick");
    expect(migration).toContain("status = 'pick_face'");
  });

  it("counts open, not aged fulfillments, less what WW picked, as demand", () => {
    expect(migration).toMatch(/f\.external_status in \('A', 'B'\)/);
    expect(migration).toContain("current_date - w.replen_demand_max_age_days");
    expect(migration).toContain("greatest(ofl.quantity - coalesce(pk.picked, 0), 0)");
  });

  it("sources only from active bins, never a face, staging, dispatch, quarantine or a frozen bin", () => {
    expect(migration).toContain("and l.status = 'active'");
    expect(migration).toContain("not coalesce(z.is_staging or z.is_dispatch or z.is_quarantine, false)");
    expect(migration).toMatch(/inventory_freezes fz\s+where fz\.status = 'active'/);
  });

  it("learns the trigger and pallets from 30 days of use, with the minimum until then", () => {
    expect(migration).not.toContain("velocity_class");
    expect(migration).toContain(") > current_date - 30 then null");
    expect(migration).toContain("case when l.pallets_per_day >= 1 then 75 else 50 end");
    expect(migration).toContain("case when l.pallets_per_day >= 1 then least(greatest(ceil(l.pallets_per_day)::int, 2), 5) else 1 end");
    expect(migration).toContain("when l.daily_use is null then 'learning'");
  });

  it("closes the task from the move, records the fill, and schedules the check", () => {
    expect(migration).toContain("create trigger sync_replenishment_from_move");
    expect(migration).toContain("insert into public.pick_face_slots (location_id, product_id, warehouse_id, full_quantity, filled_at)");
    expect(migration).toContain("'evaluate-forward-pick-replenishment'");
  });
});
