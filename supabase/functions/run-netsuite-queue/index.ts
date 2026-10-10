import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

// One-off admin runner: invokes process-netsuite-queue server-side with the
// service-role key and returns its exact status and body. Only admins or
// developers may call it; the key itself is never returned.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'Unauthorized' }, 401)

  const admin = createClient(url, serviceKey)
  const { data: claimData, error: claimErr } = await admin.auth.getClaims(token)
  const userId = claimData?.claims?.sub
  if (claimErr || !userId) return json({ error: 'Unauthorized', detail: claimErr?.message ?? 'no user' }, 401)

  const { data: roles } = await admin
    .from('user_roles')
    .select('roles(code)')
    .eq('user_id', userId)
  const codes = (roles ?? []).map((r: any) => r.roles?.code)
  if (!codes.some((c: string) => ['admin', 'developer', 'dev'].includes(c))) {
    return json({ error: 'Forbidden' }, 403)
  }

  const res = await fetch(`${url}/functions/v1/process-netsuite-queue`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
    body: '{}',
  })
  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* keep raw text */ }
  return json({ upstream_status: res.status, upstream_body: body })
})
