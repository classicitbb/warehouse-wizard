import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: 'Server configuration error' }, 500)
  }

  // Verify caller identity and roles using their own JWT
  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })

  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const { data: roleRows } = await callerClient
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', caller.id)

  const callerRoles: string[] = (roleRows ?? []).flatMap((r: any) => {
    const nested = r.roles
    if (Array.isArray(nested)) return nested.map((x: any) => String(x.code))
    return nested?.code ? [String(nested.code)] : []
  })

  if (!callerRoles.includes('admin') && !callerRoles.includes('developer')) {
    return json({ error: 'Only admins and developers can invite users' }, 403)
  }

  let body: {
    email?: string
    fullName?: string
    password?: string
    roleCode?: string
    warehouseId?: string
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const fullName = body.fullName?.trim() ?? ''
  const password = body.password ?? ''
  const roleCode = body.roleCode?.trim() || null
  const warehouseId = body.warehouseId?.trim() || null

  if (!email || !fullName || !password) {
    return json({ error: 'Email, full name, and password are required' }, 400)
  }

  if (password.length < 8) {
    return json({ error: 'Password must be at least 8 characters' }, 400)
  }

  // Check for duplicate email
  const { data: existing } = await callerClient
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    return json({ error: 'A user with that email already exists' }, 409)
  }

  // Create the user via admin API. This is the critical difference from the
  // admin_invite_user database RPC: admin.auth.admin.createUser() creates both
  // auth.users AND auth.identities, which GoTrue requires for email/password sign-in.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: { user: newUser }, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createError || !newUser) {
    console.error('Failed to create user', { error: createError?.message })
    return json({ error: createError?.message || 'Failed to create user' }, 500)
  }

  // Assign role using caller's JWT so RLS and triggers see the admin/developer uid.
  if (roleCode) {
    const { data: role } = await callerClient
      .from('roles')
      .select('id')
      .eq('code', roleCode)
      .maybeSingle()

    if (role?.id) {
      const { error: roleError } = await callerClient.from('user_roles').insert({
        id: crypto.randomUUID(),
        user_id: newUser.id,
        role_id: role.id,
        warehouse_id: warehouseId,
        is_hidden: false,
      })

      if (roleError) {
        console.error('Failed to assign role', { error: roleError.message })
      }
    }
  }

  // Approve and name the profile using caller's JWT.
  // The prevent_self_approval trigger checks auth.uid() (the caller), which must have
  // admin or developer role — already verified above.
  const { error: profileError } = await callerClient
    .from('profiles')
    .update({
      approved: true,
      active: true,
      full_name: fullName,
      email,
      updated_at: new Date().toISOString(),
    })
    .eq('id', newUser.id)

  if (profileError) {
    console.error('Failed to approve profile', { error: profileError.message })
    // User was created but could not be approved — non-fatal, admin can approve manually.
  }

  return json({ id: newUser.id })
})
