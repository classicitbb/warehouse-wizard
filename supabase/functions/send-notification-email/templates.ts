// App-side notification email templates.
//
// These used to be composed in SQL (`evaluate_reorder_alert`,
// `notify_operator_ticket_submitted`). They now live in code so the database
// never builds or sends email.

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const LABEL = 'color:#64748b;font-size:14px;padding:6px 0;'
const VALUE = 'color:#0f172a;font-size:14px;padding:6px 0;text-align:right;'
const PARA = 'margin:0 0 16px;color:#334155;font-size:14px;line-height:1.5;'
const H2 = 'margin:0 0 6px;font-size:15px;color:#0f172a;'

/** Outer HTML shell shared by every notification (mirrors notification_email_shell). */
export function shell(title: string, bodyHtml: string, unsubscribeUrl?: string | null): string {
  const footer = unsubscribeUrl
    ? `<p style="margin:24px 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">You are receiving this because you manage this warehouse. <a href="${escapeHtml(
        unsubscribeUrl,
      )}" style="color:#0f766e;">Unsubscribe</a>.</p>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
<tr><td style="padding:24px;">
<h1 style="margin:0 0 16px;font-size:18px;color:#0f172a;">${escapeHtml(title)}</h1>
${bodyHtml}
${footer}
</td></tr></table></body></html>`
}

function row(label: string, value: unknown): string {
  return `<tr><td style="${LABEL}">${escapeHtml(label)}</td><td style="${VALUE}">${escapeHtml(
    value ?? '—',
  )}</td></tr>`
}

function section(heading: string, text: unknown): string {
  const body = String(text ?? '').trim()
  if (!body) return ''
  return `<h2 style="${H2}">${escapeHtml(heading)}</h2><p style="${PARA}">${escapeHtml(body)}</p>`
}

export type RenderedEmail = { subject: string; html: string; text: string }

export type ReorderAlertInput = {
  sku: string | null
  productName: string | null
  warehouseName: string | null
  available: number
  reorderPoint: number
  recommended: number
}

export function renderReorderAlert(input: ReorderAlertInput): Omit<RenderedEmail, 'html'> & {
  bodyHtml: string
} {
  const label = `${input.sku ?? 'Product'}${input.productName ? ` — ${input.productName}` : ''}`
  const subject = `Reorder alert — ${input.sku ?? 'product'}${
    input.warehouseName ? ` at ${input.warehouseName}` : ''
  }`
  const bodyHtml =
    `<p style="${PARA}">Stock for <strong>${escapeHtml(label)}</strong> has reached its reorder point${
      input.warehouseName ? ` at ${escapeHtml(input.warehouseName)}` : ''
    }.</p>` +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">' +
    row('Available', round(input.available)) +
    row('Reorder point', round(input.reorderPoint)) +
    row('Recommended order', round(input.recommended)) +
    '</table>' +
    `<p style="${PARA}">Raise a replenishment order or adjust the product's stock levels in Warehouse Wizard.</p>`

  const text =
    `${subject}\n\n${label}\n` +
    (input.warehouseName ? `Warehouse: ${input.warehouseName}\n` : '') +
    `Available: ${round(input.available)}\nReorder point: ${round(input.reorderPoint)}\n` +
    `Recommended order: ${round(input.recommended)}\n\n— Warehouse Wizard (automated notification)`

  return { subject, bodyHtml, text }
}

function round(value: number): string {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'
}

export type TicketInput = {
  ticketRef: string
  kind: string
  severity: string
  title: string | null
  summary: string | null
  actual: string | null
  expected: string | null
  steps: string | null
  route: string | null
  module: string | null
  appVersion: string | null
  warehouseName: string | null
  reporterName: string | null
  reporterEmail: string | null
  clarifications: Array<{ question?: string; answer?: string }>
  hasScreenshot: boolean
}

export function renderOperatorTicket(input: TicketInput): Omit<RenderedEmail, 'html'> & {
  bodyHtml: string
} {
  const title = input.title?.trim() || 'Operator report'
  const subject = `[${input.severity.toUpperCase()}] ${capitalize(input.kind)} report ${input.ticketRef} — ${title}`
  const who = input.reporterName?.trim() || input.reporterEmail || 'an operator'

  const clarHtml = input.clarifications
    .map(
      (item) =>
        `<p style="margin:0 0 10px;color:#334155;font-size:14px;line-height:1.5;"><strong>${escapeHtml(
          item.question ?? '',
        )}</strong><br>${escapeHtml(item.answer ?? '')}</p>`,
    )
    .join('')

  const shotHtml = input.hasScreenshot
    ? `<p style="${PARA}">A screenshot of the screen was captured with this report. Open it in <a href="https://warehousewizard.app/settings?tab=support-requests" style="color:#0f766e;">Settings → Support Requests</a>.</p>`
    : ''

  const bodyHtml =
    `<p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.5;"><strong>${escapeHtml(
      title,
    )}</strong> filed by ${escapeHtml(who)}${
      input.warehouseName ? ` at ${escapeHtml(input.warehouseName)}` : ''
    }.</p>` +
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;">' +
    row('Ticket', input.ticketRef) +
    row('Kind', input.kind) +
    row('Severity', input.severity) +
    row('Screen', input.route) +
    row('Module', input.module) +
    row('App version', input.appVersion) +
    '</table>' +
    section('Summary', input.summary) +
    section('What happened', input.actual) +
    section('Expected', input.expected) +
    section('Steps', input.steps) +
    (clarHtml ? `<h2 style="${H2}">Questions asked</h2>${clarHtml}` : '') +
    shotHtml

  const clarText = input.clarifications
    .map((item) => `${item.question ?? ''}\n  ${item.answer ?? ''}\n`)
    .join('')

  const text =
    `${subject}\n\n` +
    `Filed by: ${input.reporterName || '—'} (${input.reporterEmail || '—'})\n` +
    `Screen: ${input.route || '—'}   Module: ${input.module || '—'}   App version: ${input.appVersion || '—'}\n` +
    (input.warehouseName ? `Warehouse: ${input.warehouseName}\n` : '') +
    textSection('Summary', input.summary) +
    textSection('What happened', input.actual) +
    textSection('Expected', input.expected) +
    textSection('Steps', input.steps) +
    (clarText ? `\nQuestions asked:\n${clarText}` : '') +
    (input.hasScreenshot
      ? '\nA screenshot of the screen was captured with this report. View it in Settings > Support Requests.\n'
      : '') +
    '\n— Warehouse Wizard (automated notification)'

  return { subject, bodyHtml, text }
}

function textSection(heading: string, value: unknown): string {
  const body = String(value ?? '').trim()
  return body ? `\n${heading}:\n${body}\n` : ''
}

function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

/** Recipients, lowercased, trimmed, de-duplicated, empties removed. */
export function normaliseRecipients(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  for (const value of values) {
    const email = String(value ?? '').trim().toLowerCase()
    if (email) seen.add(email)
  }
  return Array.from(seen)
}
