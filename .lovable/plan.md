# Copilot reports and feedback: log + email ticket

## What happens today

Filing a problem report or feedback from the Copilot chat creates an `operator_tickets`
row (with a ticket number) and an `operator_ticket_events` entry. Nothing is written to
System Logs, and nobody is emailed — so a report sits in a table that no one watches.

## Recommendation

Do both, with each doing the job it is good at:

- **System Logs** — one `info` entry per submitted ticket, so admins see reports in the
  same place they already watch for errors, and can correlate a report with the errors
  logged around the same time.
- **Email** — the actual notification, sent on submit to the reporter, the developer
  address, and `wms@simplextrading.net`, so a report reaches someone even when nobody
  is looking at the app.

The ticket record stays the source of truth. The log entry and the email are copies
that point back at the ticket number.

## What gets built

1. **Ticket submitted → System Log entry**
   - `log_type: info` (or `bug` for `kind = bug`), severity mapped from ticket severity
     (`critical` → critical, `high` → error, otherwise info).
   - Title: `Report WW-xxxx-xxxx — <ticket title>`; source: `copilot.report`.
   - Details carry ticket id, number, kind, severity, route/module, reporter, app version.

2. **Ticket submitted → email**
   - New edge function `operator-ticket-email` queues an email through the existing
     email queue (`enqueue_email`) so sending is retried and logged like every other
     app email.
   - Recipients: the reporter's own email (confirmation with the ticket number), plus
     the dev address and `wms@simplextrading.net` on the ticket copy.
   - Body: ticket number, kind, severity, who filed it, screen/module, app version,
     title, what happened, expected, steps, and the clarifying Q&A trail.
   - Suppressed/unsubscribed addresses are respected by the existing queue.

3. **Where it fires**
   - Inside the copilot function's `submit_problem_report` step, right after the ticket
     flips to `open`, so it covers both the chat interview and any future form entry.
   - Failure to log or email never fails the submission — the operator still gets their
     ticket number; the failure is recorded and retried by the queue.

4. **In-chat form (optional add-on)**
   - The chat interview stays the default. If you want it, a "Fill in a form instead"
     card in the panel collects title / what happened / expected / steps / severity in
     one screen and submits the same ticket. Say the word and I'll include it.

## Technical notes

- Reuses `enqueue_email` + `process-email-queue`; no new mail provider.
- Dev recipient stored as a secret (`OPS_TICKET_DEV_EMAIL`) rather than hardcoded, with
  `wms@simplextrading.net` as a fixed second recipient.
- System log written server-side via `write_system_log` under the service role, so the
  entry exists even if the operator's own role could not write it.
- Tests: a unit test for the log payload mapping and one for recipient assembly
  (reporter always included, duplicates removed).
