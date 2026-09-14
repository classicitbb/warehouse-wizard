# Let managers, admins and supervisors delete packaging profiles

Today the Packaging Profiles screen only lets you hide (archive) a profile. The
permanent-delete action that warehouses, zones, locations, products and clients
have is not wired up for packaging profiles, and the database rule currently
allows deletes for managers/admins only — supervisors are excluded, and
supervisors cannot even open the Packaging Profiles screen.

## What changes

- A trash action appears on each packaging profile row for admins, warehouse
  managers, warehouse supervisors and developers.
- Clicking it opens the same confirmation used elsewhere: it explains the delete
  is permanent and asks the person to type `DELETE`.
- If the profile is still referenced by real work — pallets built to it, or
  receipt lines that used it — the delete is refused and the dialog lists what
  is blocking it. Archiving stays the right move in that case.
- Supervisors gain access to the Packaging Profiles screen (view, create, edit,
  delete), matching the delete permission they are being given.
- No change to the archive/hide behaviour or to any other screen.

## Technical notes

- Migration (additive):
  - Replace the `Managers delete product_packaging_profiles` policy with one
    using `has_min_role(auth.uid(), 'warehouse_supervisor')`; do the same for
    the UPDATE and INSERT policies so a supervisor who can delete can also
    create and edit. `is_approved()` stays in every policy.
  - Add `public.delete_packaging_profile_cascade(in_id uuid) returns jsonb`,
    security definer, `set search_path = public`, mirroring
    `delete_product_cascade`: count referencing rows in `pallets` and
    `receipt_lines`, return `{ blocked_by: [{table, count}] }` when non-empty,
    otherwise clear `superseded_by_id` back-references, delete the row and
    return `{ deleted: true }`. Guard with the same `has_min_role`
    (`warehouse_supervisor`) check so the RPC cannot be used to bypass RLS.
    Grant execute to `authenticated` only.
- `deleteResourceCascade` in `src/features/setup/setup-core.ts`: add the
  `product_packaging_profiles` case calling the new RPC.
- `src/features/resources/resource-page.tsx`: add
  `product_packaging_profiles` to `cascadeSupported`, and widen the row-level
  delete gate from admin/developer to also allow `warehouse_manager` and
  `warehouse_supervisor` **for this table only** — the existing
  warehouses/zones/locations/products/clients gate stays admin/developer.
- `src/features/shared/core-types.ts`: add `warehouse_supervisor` to the
  `packagingProfiles.roles` list.
- Tests: extend the resource-page delete coverage with a packaging-profile case
  (blocked-by list rendered, `DELETE` challenge required) and a
  `src/test/migration.test.ts` assertion for the new function.
- Version bump to 1.29.6 with release notes, What's New and the packaging help
  topic mentioning who can delete.
