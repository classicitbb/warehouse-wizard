import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'

// Server-side WMS reset: verifies the caller is an admin/developer, then runs
// the reset with the service role. The database function is not client-callable.
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
  if (claimErr || !userId) return json({ error: 'Unauthorized' }, 401)

  const { data: roles } = await admin.from('user_roles').select('roles(code)').eq('user_id', userId)
  const codes = (roles ?? []).map((r: any) => r.roles?.code)
  if (!codes.some((c: string) => ['admin', 'developer'].includes(c))) {
    return json({ error: 'Only admins and developers can reset the WMS environment' }, 403)
  }

  const { data, error } = await admin.rpc('reset_wms_data_for_actor', { p_actor: userId })
  if (error) {
    console.error('reset_wms_data_for_actor failed', error)
    return json({ error: 'Reset failed' }, 500)
  }
  return json(data)
})
