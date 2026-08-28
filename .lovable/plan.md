# Email move to app-side sends, in-target scanning, and three UI fixes

## 1. Move notification emails out of the database

Today two database paths build and send email themselves:

- `evaluate_reorder_alert()` — reorder alert emails.
- `notify_operator_ticket_submitted()` trigger on `operator_tickets` — support ticket,
  feedback, and report notifications (reporter + dev + `wms@simplextrading.net` + admins).

Both call `enqueue_email` and build their own unsubscribe links via
`get_or_create_unsubscribe_token`. This is exactly what blocked the managed email update.

What changes:

- A new edge function `send-notification-email` owns all app notification email. It builds
  recipients, renders the template, applies suppression/unsubscribe handling, and sends.
- Unsubscribe handling moves into the send flow: for every non-critical notification the
  send path fetches/creates the recipient's unsubscribe token, skips suppressed addresses,
  and adds the unsubscribe link to the footer and the `List-Unsubscribe` header.
- The two database functions stop composing and enqueuing email. They keep their real jobs
  (writing the alert row, the system log, and the ticket event) and instead record that a
  notification is due, which the app-side sender picks up.
- Reorder alerts: the client hook that already refreshes alerts invokes the sender for newly
  raised alerts; ticket sends are invoked from the copilot/ticket submit path right after the
  ticket flips to `open`, so both chat and form entry are covered.
- Failures never block the underlying operation — they are logged to `email_send_log`
  and `system_logs` only.

Templates (reorder alert, ticket filed, feedback/request) are re-authored as typed
template modules in the function so subject/body live in code, not SQL.

### Integration tests

New tests covering, per notification type:

- happy path — correct recipients, subject, and body variables;
- missing recipient (no reporter email / no admin configured) — send is skipped, no throw;
- missing template variables (no warehouse, no title, no clarifications) — renders with
  safe fallbacks;
- suppressed/unsubscribed recipient — excluded from the send;
- duplicate recipients (reporter is also an admin) — deduplicated.

### Then retry the update

Once the database no longer sends email, retry the email-sending update so the project can
move to Lovable-managed delivery, and leave it unpublished for review.

## 2. Scanner: only capture inside the target square

Currently the first decoded frame is accepted regardless of where the code sits in the frame.

- A decoded code whose bounding box is **not** fully inside the reticle is recognised but not
  captured: the reticle glows green and a hint reads "Move the code into the square".
- Capture (and any dwell/cooldown) only starts once the code's bounds sit inside the target
  area, with a small tolerance margin.
- Applies to every scan surface site-wide (pallet, location, order, container) since they all
  use the shared scan button; container OCR keeps its portrait target.

## 3. Blank expiry dates on Greenware products

Direct data edit (no schema change): clear `expiry_date` on the 29 `inventory_balances` rows
and 5 `inventory_lots` rows belonging to Greenware products (`products.name ilike
'%GREENWARE%'`). Inventory Search will then show "—" for those rows.

## 4. Calendar always 6 rows

The date popup changes height between months. Fix the grid at 7 columns x 6 rows by enabling
fixed weeks and reserving the row height, so switching months never resizes the popup.

## 5. "Cancel Move" button on Location Moves

- Add a **Cancel Move** button next to **Complete Move**.
- When Location Moves was opened from an inventory product view (the "Go to Location Moves"
  link that passes `?pallet=...&bay=STG-01-A`), the button carries the originating inventory
  detail back with it and returns there on click.
- When opened directly, it clears the pallet/bay fields and stays on the page.

## Technical notes

- New: `supabase/functions/send-notification-email/index.ts` plus shared template modules;
  migration to strip the email bodies from `evaluate_reorder_alert` and
  `notify_operator_ticket_submitted` (tables `email_send_log`, `suppressed_emails`,
  `email_unsubscribe_tokens` are kept).
- `src/components/barcode-scan-button.tsx` — compare `getDetectedRegion` bounds against the
  reticle rect; add an "in-frame but outside target" state to the overlay.
- `src/components/ui/calendar.tsx` — `fixedWeeks` + fixed row sizing.
- `src/features/moves/moves-page.tsx` — Cancel Move button, `from` search param handling.
- Version bump, release notes, What's New, and help topics on publish per project policy.
