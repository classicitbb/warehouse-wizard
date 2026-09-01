// App-side notification email sender.
//
// Owns every notification email the app sends (reorder alerts, operator
// tickets/feedback). The database no longer composes or enqueues these — it
// only records that a notification is due, and this function builds the
// recipient list, renders the template, applies suppression/unsubscribe
// handling, and hands the message to the email queue.
//
// POST { kind: 'reorder_alert' | 'operator_ticket', id: uuid }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'
import {
  normaliseRecipients,
  renderOperatorTicket,
  renderReorderAlert,
  shell,
} from './templates.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FROM = 'Warehouse Wizard <noreply@mail.warehousewizard.app>'
const SENDER_DOMAIN = 'mail.warehousewizard.app'
const OPS_EMAIL = 'wms@simplextrading.net'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type Client = ReturnType<typeof createClient>

async function emailsForRoles(sb: Client, codes: string[]): Promise<string[]> {
  if (codes.length === 0) return []
  const { data: roleRows, error: roleError } = await sb
    .from('user_roles')
    .select('user_id, is_hidden, roles!inner(code)')
    .in('roles.code', codes)
  if (roleError) {
    console.error('Could not read notification roles', roleError)
    return []
  }
  const userIds = (roleRows ?? [])
    .filter((row: { is_hidden?: boolean | null }) => row.is_hidden !== true)
    .map((row: { user_id: string }) => row.user_id)
  if (userIds.length === 0) return []

  const { data: profiles, error: profileError } = await sb
    .from('profiles')
    .select('email, active')
    .in('id', userIds)
  if (profileError) {
    console.error('Could not read notification recipients', profileError)
    return []
  }
  return (profiles ?? [])
    .filter((row: { email?: string | null; active?: boolean | null }) => row.active !== false && row.email)
    .map((row: { email?: string | null }) => row.email ?? '')
}


async function suppressed(sb: Client, recipients: string[]): Promise<Set<string>> {
  if (recipients.length === 0) return new Set()
  const { data, error } = await sb.from('suppressed_emails').select('email').in('email', recipients)
  if (error) {
    console.error('Could not read suppression list', error)
    return new Set()
  }
  return new Set((data ?? []).map((row: { email: string }) => String(row.email).toLowerCase()))
}

async function queue(
  sb: Client,
  input: { to: string; subject: string; title: string; bodyHtml: string; text: string; label: string },
): Promise<boolean> {
  const messageId = crypto.randomUUID()
  let unsubscribeToken: string | null = null
  let unsubscribeUrl: string | null = null
  try {
    const { data } = await sb.rpc('get_or_create_unsubscribe_token', { in_email: input.to })
    if (typeof data === 'string' && data) {
      unsubscribeToken = data
      unsubscribeUrl = `https://warehousewizard.app/email/unsubscribe?token=${encodeURIComponent(data)}`
    }
  } catch (error) {
    console.error('Unsubscribe token unavailable', error)
  }

  await sb.from('email_send_log').insert({
    message_id: messageId,
    template_name: input.label,
    recipient_email: input.to,
    status: 'pending',
  })

  const { error } = await sb.rpc('enqueue_email', {
    queue_name: 'transactional_emails',
    payload: {
      message_id: messageId,
      idempotency_key: messageId,
      unsubscribe_token: unsubscribeToken,
      to: input.to,
      from: FROM,
      sender_domain: SENDER_DOMAIN,
      subject: input.subject,
      html: shell(input.title, input.bodyHtml, unsubscribeUrl),
      text: input.text,
      purpose: 'transactional',
      label: input.label,
      queued_at: new Date().toISOString(),
    },
  })

  if (error) {
    console.error('Could not enqueue notification email', { label: input.label, error })
    await sb.from('email_send_log').insert({
      message_id: messageId,
      template_name: input.label,
      recipient_email: input.to,
      status: 'failed',
      error_message: error.message ?? 'Failed to enqueue email',
    })
    return false
  }
  return true
}

async function sendReorderAlert(sb: Client, alertId: string) {
  const { data: alert, error } = await sb
    .from('reorder_alerts')
    .select(
      'id, email_queued_at, available_quantity, reorder_point, recommended_quantity, products(sku, name), warehouses(name)',
    )
    .eq('id', alertId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!alert) return { skipped: 'alert not found', sent: 0 }
  if (alert.email_queued_at) return { skipped: 'already notified', sent: 0 }

  const { data: settings } = await sb
    .from('reorder_forecast_settings')
    .select('email_enabled')
    .eq('id', true)
    .maybeSingle()
  if (settings && settings.email_enabled === false) return { skipped: 'email disabled', sent: 0 }

  const product = (alert.products ?? {}) as { sku?: string | null; name?: string | null }
  const warehouse = (alert.warehouses ?? {}) as { name?: string | null }
  const rendered = renderReorderAlert({
    sku: product.sku ?? null,
    productName: product.name ?? null,
    warehouseName: warehouse.name ?? null,
    available: Number(alert.available_quantity ?? 0),
    reorderPoint: Number(alert.reorder_point ?? 0),
    recommended: Number(alert.recommended_quantity ?? 0),
  })

  const recipients = normaliseRecipients(await emailsForRoles(sb, ['admin', 'warehouse_manager']))
  const blocked = await suppressed(sb, recipients)

  let sent = 0
  for (const to of recipients) {
    if (blocked.has(to)) continue
    if (
      await queue(sb, {
        to,
        subject: rendered.subject,
        title: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        text: rendered.text,
        label: 'reorder-alert',
      })
    ) {
      sent += 1
    }
  }

  await sb.from('reorder_alerts').update({ email_queued_at: new Date().toISOString() }).eq('id', alertId)
  return { sent, recipients: recipients.length }
}

async function sendOperatorTicket(sb: Client, ticketId: string) {
  const { data: ticket, error } = await sb
    .from('operator_tickets')
    .select(
      'id, ticket_number, kind, severity, status, title, summary, actual_behavior, expected_behavior, steps_to_reproduce, route, module, app_version, clarifications, screenshot_path, reported_by, warehouse_id',
    )
    .eq('id', ticketId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!ticket) return { skipped: 'ticket not found', sent: 0 }
  if (ticket.status === 'draft') return { skipped: 'ticket is still a draft', sent: 0 }

  const { data: reporter } = await sb
    .from('profiles')
    .select('email, full_name')
    .eq('id', ticket.reported_by)
    .maybeSingle()

  let warehouseName: string | null = null
  if (ticket.warehouse_id) {
    const { data: warehouse } = await sb
      .from('warehouses')
      .select('name')
      .eq('id', ticket.warehouse_id)
      .maybeSingle()
    warehouseName = warehouse?.name ?? null
  }

  const isFeedback = ticket.kind === 'feedback' || ticket.kind === 'request'
  const clarifications = Array.isArray(ticket.clarifications)
    ? (ticket.clarifications as Array<{ question?: string; answer?: string }>)
    : []

  const rendered = renderOperatorTicket({
    ticketRef: ticket.ticket_number ?? String(ticket.id).slice(0, 8),
    kind: String(ticket.kind ?? 'report'),
    severity: String(ticket.severity ?? 'normal'),
    title: ticket.title ?? null,
    summary: ticket.summary ?? null,
    actual: ticket.actual_behavior ?? null,
    expected: ticket.expected_behavior ?? null,
    steps: ticket.steps_to_reproduce ?? null,
    route: ticket.route ?? null,
    module: ticket.module ?? null,
    appVersion: ticket.app_version ?? null,
    warehouseName,
    reporterName: reporter?.full_name ?? null,
    reporterEmail: reporter?.email ?? null,
    clarifications,
    hasScreenshot: Boolean(ticket.screenshot_path),
  })

  const devEmails = await emailsForRoles(sb, ['dev', 'developer'])
  const adminEmails = isFeedback ? await emailsForRoles(sb, ['admin']) : []
  const recipients = normaliseRecipients([
    reporter?.email ?? null,
    OPS_EMAIL,
    ...devEmails,
    ...adminEmails,
  ])
  const blocked = await suppressed(sb, recipients)

  let sent = 0
  for (const to of recipients) {
    if (blocked.has(to)) continue
    if (
      await queue(sb, {
        to,
        subject: rendered.subject,
        title: rendered.subject,
        bodyHtml: rendered.bodyHtml,
        text: rendered.text,
        label: 'operator-ticket',
      })
    ) {
      sent += 1
    }
  }

  await sb.from('operator_ticket_events').insert({
    ticket_id: ticketId,
    actor_kind: 'system',
    event: 'notified',
    detail: { recipients: recipients.length, sent },
  })

  return { sent, recipients: recipients.length }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Email sending is not configured' }, 500)

  let body: { kind?: string; id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const id = String(body.id ?? '').trim()
  if (!id) return json({ error: 'id is required' }, 400)

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    if (body.kind === 'reorder_alert') return json(await sendReorderAlert(sb, id))
    if (body.kind === 'operator_ticket') return json(await sendOperatorTicket(sb, id))
    return json({ error: `Unknown notification kind: ${body.kind ?? '(none)'}` }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Notification email failed', { kind: body.kind, id, message })
    // Never fail the operation that triggered the notification.
    return json({ error: message, sent: 0 }, 200)
  }
})
