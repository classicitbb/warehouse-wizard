# Offline Reconnect & Putaway Conflict Resolution

**Status:** Approved design (2026-07-08) — ready for implementation
**Owner:** Russell
**Related:** [cycle-counts-architecture.md](./cycle-counts-architecture.md)
**Applies to:** RF/handheld operator app (putaway, picking, receiving, stock counts)

---

## 1. Problem statement

Operators work from RF devices on the warehouse floor where connectivity is not
guaranteed (deep racking, cold storage, dead aisles). If a device is allowed to
commit inventory moves while offline and those moves are replayed when it comes
back online, the device can write a pallet into a location that another (online)
operator already filled during the outage.

The result is a data conflict that has **no valid physical resolution after the
fact**: a single-pallet slot cannot hold two pallets, and the system cannot
"place" anything — the only way something enters a location is a person physically
putting it there. These conflicts should not occur, but the system must have a
defined, safe way to prevent and resolve them.

### Ground-truth principles

1. **Physical reality is authoritative.** The app never asserts what is in a
   location; it can only reflect what an operator physically confirms.
2. **The server is the single source of truth for system state.** A disconnected
   device holds a *snapshot*, not the truth.
3. **Nothing commits blindly.** No inventory move is written from a stale,
   pre-disconnect view.

---

## 2. Offline behavior model — freeze and resume

When a device loses connectivity, it does **not** continue committing work
offline. It freezes.

- **Scope:** Only the affected device freezes. Other operators keep working
  normally. The warehouse is not halted.
- **Blocked while offline:** Any action that commits an inventory state change —
  putaway confirmation, pick confirmation, receiving confirmation, count posting.
- **Allowed while offline:** Viewing the current task, holding task position
  locally, attempting to reconnect.
- **Task persistence:** The in-progress job (putaway, pick, receiving, stock
  count) is saved live and locally so the operator can resume from the last known
  step on reconnect. The task is a persistent, resumable job — the operator does
  not lose their place.

> **Distinction that must be enforced in code:** the device may resume its **task
> position** (which step, which pallet is on the forks) from the local snapshot,
> but it must **not** trust its cached **world state** (what is in each bin). See
> §4.

### Supervisor notification

When a device drops offline, a supervisor is alerted in real time so they can
watch or intervene. Unaffected operators continue working — the alert is
informational and does not pause any zone.

---

## 3. Reservation model — none; validate at commit

Task assignment does **not** reserve the target bin server-side. Bins are
first-come. This maximizes throughput at the cost of more reconnect "bumps"
(cases where the offline operator's intended bin was taken during the outage).

**Consequence to design for:** the reconnect bump is the **normal path, not a rare
edge case.** The directed re-putaway flow (§6) must therefore be a first-class,
fast, unmissable screen — never a buried error dialog.

---

## 4. Reconnect sequence

On regaining connectivity, the device runs this sequence **before it allows any
commit**:

1. **Hard-refresh world state.** Discard the cached pre-disconnect snapshot and
   pull current server truth. The local snapshot is treated as suspect the instant
   connectivity returns. A commit must never ride on the pre-disconnect snapshot.
2. **Re-validate the pending action** against freshly pulled server state at the
   commit gate (§5).
3. **Show the delta first (do not silently override).** If the world moved under
   the operator, present a short, explicit summary before routing them onward,
   e.g.:

   > *While you were offline: bin A3-04 was filled by another operator. Your
   > target is no longer available.*

   Then route to re-select. The operator is skilled — they get the reason, not a
   silent redirect that looks like the app overrode their decision.
4. **Resume task position.** The operator continues their job from the last known
   step, now against verified state.

---

## 5. The commit gate

The commit gate is the single control point where every conflict is caught. A
pending action is validated against live server state and rejected if invalid.

Conflicts in scope (all must be handled):

| Conflict | Server condition on reconnect | Resolution |
|---|---|---|
| **Bin full / capacity exceeded** | Target location has no remaining capacity | Route to directed re-putaway (§6) |
| **Pallet picked/moved online** | The pallet the task depends on was picked or relocated by another operator | Re-validate task; re-issue or cancel step with delta shown |
| **Location deactivated/blocked online** | Target location was damaged, blocked, or deactivated during the outage | Route to directed re-putaway; target excluded from selector |
| **Same pallet, two operators** | The same pallet/LPN was recorded as placed by another operator | Reject the duplicate commit; show delta; operator confirms true location |
| **Source stock mismatch** | Receiving qty or source-location contents changed online, invalidating the task's starting assumption | Re-validate; trigger cycle count if quantities/contents don't reconcile (§8) |

The disputed pallet is **never force-placed** and the correctly-recorded
(online-committed) pallet is **never evicted**. The offline operator re-directs
their **own** pallet.

---

## 6. Directed re-putaway flow

When the commit gate rejects a putaway (bin full or target invalid), the pallet
stays in a **putaway state** and the operator resolves it from the putaway screen:

1. Scan the pallet.
2. Open the bay selector.
3. Find a bin with available capacity.
4. Pick a bin and confirm placement (commits against live server state).

Design requirements:

- First-class flow, optimized for speed — this is the normal path.
- The rejected/target bin is excluded or flagged in the selector.
- The pallet remains blocked from allocation/picking until a new location is
  confirmed by scan (suspense/hold semantics, §7).

---

## 7. Suspense / hold semantics

A pallet awaiting re-direction is held in a **suspense/hold status**:

- It is **blocked from allocation and picking** while unresolved, so a picker is
  never directed to a pallet in dispute.
- It remains associated with the operator's active putaway task.
- It leaves suspense only when the operator confirms a new physical location by
  scan.

---

## 8. Stranded-operator fallback

If the operator is frozen offline at the bay, physically holding the pallet, and
cannot reconnect, they must not be stranded on the equipment:

1. The operator drops the pallet at the nearest **staging / suspense location**.
2. On reconnect, that placement becomes a fresh **directed-putaway task** in the
   queue (validated normally through the commit gate).

This keeps the operator and the equipment moving without committing anything
against stale state.

---

## 9. Cycle-count trigger

A cycle count is triggered **only when synced quantities or contents do not
reconcile** on sync — not for clean re-directs.

- Clean re-direct (operator simply picks a new empty bin): **no count** — nothing
  physically moved that isn't already recorded.
- Quantity/content mismatch (source stock, dual-placement, ambiguous height where
  the operator could not visually judge the true contents): **flag the affected
  location for a cycle count.**

Integrates with the existing count program — see
[cycle-counts-architecture.md](./cycle-counts-architecture.md).

---

## 10. Offline task-queue replay ordering

**Decided (2026-07-08).**

The freeze model normally leaves at most one uncommitted in-progress task, but a
device may reconnect with a small queue of pending steps. Resolving step 1 can
change the validity of step 2 (e.g., re-directing pallet A frees the bin that
step 2's rejection was about).

**Rule:** replay the queue in **capture order**, re-validating each step against
live server state immediately before its commit, and re-running the delta/re-select
flow per step as needed. Never "validate all, then commit" — later commits could
invalidate earlier decisions. Each step is validated against the state produced by
the previously committed step.

---

## 11. End-to-end walkthrough (worked example)

1. Operator is assigned putaway of pallet **P** and drives to bay **A3-04**
   (push-back rack) whose app view shows one open slot.
2. Mid-aisle the device loses connectivity. It **freezes** — the putaway cannot be
   committed. A supervisor is alerted; other operators keep working.
3. While offline, an online operator places the last pallet into **A3-04**,
   filling it.
4. Operator reconnects. Device **discards its snapshot** and pulls server truth.
5. Commit gate re-validates the pending putaway against live state → **A3-04 is
   full**.
6. Device shows the **delta**: *"While you were offline: A3-04 was filled by
   another operator. Your target is no longer available."*
7. Operator is routed to **directed re-putaway**: scan P, open bay selector, pick
   a bin with capacity, confirm.
8. Pallet P (in suspense until confirmed) commits to the new bin against live
   state. No eviction, no forced placement, no invalid stacking.
9. If the operator had been unable to reconnect at the bay, they would instead
   drop P at a **staging location** (step 8 fallback), and P would re-enter the
   queue as a fresh directed-putaway task on reconnect.

---

## 12. Design decisions log

| # | Decision | Choice |
|---|---|---|
| 1 | Disconnect behavior | Freeze the device; resume on reconnect (device-scoped, not warehouse-wide) |
| 2 | Supervisor response | Alert supervisor; other operators keep working |
| 3 | Reservation | None — validate at commit |
| 4 | Reconnect state | Hard-refresh world state; never commit on pre-disconnect snapshot |
| 5 | Conflict surfacing | Show delta first, then route to re-select (not silent) |
| 6 | Authority rule | Online-committed state wins; offline operator re-directs own pallet; never evict |
| 7 | Rejected pallet state | Stays in putaway state / suspense; blocked from allocation |
| 8 | Stranded fallback | Drop at staging/suspense; re-putaway on reconnect |
| 9 | Conflict scope | Bin full, pallet picked/moved online, location deactivated, dual placement, source mismatch |
| 10 | Cycle-count trigger | Only on quantity/content mismatch |
| 11 | Queue replay ordering | Capture-order; re-validate each step against live state immediately before its commit |
