// Unsubscribe API for notification emails.
//
// GET  /email-unsubscribe?t=<token>  -> 302 to the app's /unsubscribe page.
//      Older emails link here directly; the backend gateway serves HTML as
//      plain text, so we never render a page here. GET never writes, so mail
//      scanners that prefetch links cannot unsubscribe anyone.
// POST /email-unsubscribe { token }  -> performs the unsubscribe, JSON reply.
//
// verify_jwt is false: called by someone who is not signed in. The token is a
// 64-char random credential issued by get_or_create_unsubscribe_token.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const APP_URL = 'https://www.warehousewizard.app'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('t')?.trim() ?? ''
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${APP_URL}/unsubscribe?t=${encodeURIComponent(token)}` },
    })
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405)

  let token = ''
  try {
    const body = await req.json()
    token = String(body?.token ?? '').trim()
  } catch {
    token = ''
  }
  if (!token || token.length > 200) return json({ ok: false, error: 'This unsubscribe link is incomplete.' }, 200)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Unsubscribe is temporarily unavailable.' }, 200)

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
    const email = (row as { email?: string } | null)?.email?.toLowerCase()
    if (!email) {
      return json({ ok: false, error: 'This unsubscribe link is no longer valid. Contact your warehouse administrator.' }, 200)
    }

    const { error: suppressError } = await sb
      .from('suppressed_emails')
      .upsert({ email, reason: 'unsubscribe', metadata: null }, { onConflict: 'email' })
    if (suppressError) throw new Error(suppressError.message)

    await sb.from('email_unsubscribe_tokens').update({ used_at: new Date().toISOString() }).eq('token', token)
    await sb.from('email_send_log').insert({
      template_name: 'system',
      recipient_email: email,
      status: 'suppressed',
      error_message: 'Unsubscribed via emailed link',
    })

    return json({ ok: true, email })
  } catch (error) {
    console.error('Unsubscribe failed', { message: error instanceof Error ? error.message : String(error) })
    return json({ ok: false, error: 'We could not complete the unsubscribe. Please try again.' }, 200)
  }
})
