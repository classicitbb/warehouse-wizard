// One-click unsubscribe landing for notification emails.
//
// GET  /email-unsubscribe?t=<token>  -> renders a confirmation page
// POST /email-unsubscribe { token }  -> same, as JSON
//
// verify_jwt is false: this is opened from an email client by someone who is
// not signed in, and often prefetched by the mail provider. The token is the
// only credential, which is why it is a 64-char random string issued by
// get_or_create_unsubscribe_token and never guessable.
//
// Suppression is written exactly the way handle-email-events writes it, so a
// manual unsubscribe and a provider complaint land in the same place and the
// existing send path already honours both.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function page(title: string, message: string, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="background:#0f172a;padding:20px 28px;"><span style="color:#ffffff;font-size:18px;font-weight:600;">Warehouse Wizard</span></td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 12px;font-size:19px;color:#0f172a;">${title}</h1>
<p style="margin:0;color:#334155;font-size:15px;line-height:1.5;">${message}</p>
</td></tr></table></td></tr></table></body></html>`
  return new Response(html, {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  let token = ''
  if (req.method === 'GET') {
    token = new URL(req.url).searchParams.get('t')?.trim() ?? ''
  } else if (req.method === 'POST') {
    try {
      const body = await req.json()
      token = String(body?.token ?? '').trim()
    } catch {
      token = ''
    }
  } else {
    return page('Not allowed', 'This link only supports opening in a browser.', 405)
  }

  if (!token) {
    return page('Link incomplete', 'This unsubscribe link is missing its token. Please use the link exactly as it appears in the email.', 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return page('Not available', 'Unsubscribe is temporarily unavailable. Please contact your warehouse administrator.', 500)
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  try {
    const { data: row, error } = await sb
      .from('email_unsubscribe_tokens')
      .select('email')
      .eq('token', token)
      .maybeSingle()
    if (error) throw new Error(error.message)

    const email = (row as { email?: string } | null)?.email
    if (!email) {
      return page('Link not recognised', 'This unsubscribe link is no longer valid. If you keep receiving these emails, contact your warehouse administrator.', 404)
    }

    // Same shape handle-email-events uses for bounces and complaints.
    const { error: suppressError } = await sb
      .from('suppressed_emails')
      .upsert({ email: email.toLowerCase(), reason: 'unsubscribe', metadata: null }, { onConflict: 'email' })
    if (suppressError) throw new Error(suppressError.message)

    await sb
      .from('email_unsubscribe_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('token', token)

    await sb.from('email_send_log').insert({
      template_name: 'system',
      recipient_email: email.toLowerCase(),
      status: 'suppressed',
      error_message: 'Unsubscribed via emailed link',
    })

    return page(
      'You are unsubscribed',
      `<strong>${email}</strong> will no longer receive Warehouse Wizard notification emails. In-app and push notifications are unaffected — you can change those in Settings.`,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Unsubscribe failed', { message })
    return page('Something went wrong', 'We could not complete the unsubscribe. Please try again, or contact your warehouse administrator.', 500)
  }
})
