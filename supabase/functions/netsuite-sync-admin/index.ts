import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  MAX_SUMMARY_JOBS,
  SUMMARY_SYSTEM_PROMPT,
  buildSummaryInput,
  buildSummaryPrompt,
  netsuiteIdFromResult,
  parseSummaryReply,
  type SummaryJob,
  type SummaryLog,
} from '../_shared/netsuite-sync-summary.ts'

// Admin/developer-only read access to NetSuite sync jobs, plus an on-demand AI
// summary of run outcomes through the Lovable AI Gateway. Reads use the service
// role after the caller's role has been verified.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const MODEL = 'google/gemini-3.6-flash'
const JOB_COLUMNS = 'id, job_type, status, attempts, error_message, result, idempotency_key, created_at, updated_at'
const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'dead_letter']

type Body = {
  action?: 'list' | 'detail' | 'summarize'
  jobId?: string
  status?: string
  jobType?: string
  from?: string
  to?: string
  limit?: number
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Unauthorized' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: 'Server configuration error' }, 500)

  const callerClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return json({ error: 'Unauthorized' }, 401)

  const { data: roleRows } = await callerClient
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', caller.id)
  const callerRoles: string[] = (roleRows ?? []).flatMap((r: any) => {
    const nested = r.roles
    if (Array.isArray(nested)) return nested.map((x: any) => String(x.code))
    return nested?.code ? [String(nested.code)] : []
  })
  if (!callerRoles.some((r) => ['admin', 'developer', 'dev'].includes(r))) {
    return json({ error: 'Only admins and developers can view sync jobs' }, 403)
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  function jobQuery(limit: number) {
    let q = admin.from('integration_sync_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).limit(limit)
    if (body.status && STATUSES.includes(body.status)) q = q.eq('status', body.status)
    if (typeof body.jobType === 'string' && body.jobType) q = q.eq('job_type', body.jobType)
    const from = validDate(body.from)
    const to = validDate(body.to)
    if (from) q = q.gte('created_at', from)
    if (to) q = q.lte('created_at', to)
    return q
  }

  const decorate = (job: any) => ({
    ...job,
    netsuiteId: netsuiteIdFromResult(job.result),
    alreadyPosted: Boolean((job.result as { alreadyPosted?: boolean } | null)?.alreadyPosted),
  })

  try {
    if (body.action === 'list') {
      const limit = Math.min(Math.max(Number(body.limit) || 100, 1), 200)
      const { data, error } = await jobQuery(limit)
      if (error) throw new Error(error.message)
      return json({ jobs: (data ?? []).map(decorate) })
    }

    if (body.action === 'detail') {
      if (!body.jobId) return json({ error: 'jobId is required' }, 400)
      const { data: job, error } = await admin.from('integration_sync_jobs').select(`${JOB_COLUMNS}, payload`).eq('id', body.jobId).maybeSingle()
      if (error) throw new Error(error.message)
      if (!job) return json({ error: 'Job not found' }, 404)
      const [{ data: logs }, { data: dead }] = await Promise.all([
        admin.from('integration_payload_logs').select('id, direction, payload, response, http_status, created_at').eq('sync_job_id', body.jobId).order('created_at', { ascending: true }),
        admin.from('integration_dead_letters').select('id, reason, resolved_at, created_at').eq('sync_job_id', body.jobId).order('created_at', { ascending: false }),
      ])
      return json({ job: decorate(job), logs: logs ?? [], deadLetters: dead ?? [] })
    }

    if (body.action === 'summarize') {
      const apiKey = Deno.env.get('LOVABLE_API_KEY')
      if (!apiKey) return json({ error: 'AI is not configured' }, 500)

      let jobs: SummaryJob[]
      if (body.jobId) {
        const { data, error } = await admin.from('integration_sync_jobs').select(JOB_COLUMNS).eq('id', body.jobId)
        if (error) throw new Error(error.message)
        jobs = (data ?? []) as SummaryJob[]
      } else {
        const { data, error } = await jobQuery(MAX_SUMMARY_JOBS * 4)
        if (error) throw new Error(error.message)
        jobs = (data ?? []) as SummaryJob[]
      }
      if (jobs.length === 0) return json({ error: 'No sync jobs match that selection' }, 404)

      const { data: logRows, error: logErr } = await admin
        .from('integration_payload_logs')
        .select('sync_job_id, direction, payload, response, http_status, created_at')
        .in('sync_job_id', jobs.slice(0, MAX_SUMMARY_JOBS).map((j) => j.id))
        .order('created_at', { ascending: true })
      if (logErr) throw new Error(logErr.message)

      const input = buildSummaryInput(jobs, (logRows ?? []) as SummaryLog[])
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Lovable-API-Key': apiKey },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
            { role: 'user', content: buildSummaryPrompt(input) },
          ],
        }),
      })
      if (response.status === 429) return json({ error: 'AI rate limit reached. Try again shortly.' }, 429)
      if (response.status === 402) return json({ error: 'AI credits exhausted.' }, 402)
      if (!response.ok) {
        console.error('netsuite-sync-admin gateway error', response.status, await response.text())
        return json({ error: 'AI summary failed' }, 502)
      }
      const payload = await response.json()
      const text = String(payload?.choices?.[0]?.message?.content ?? '')
      return json({ ...parseSummaryReply(text), stats: input.stats, truncated: input.truncated })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (err) {
    console.error('netsuite-sync-admin error', err)
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500)
  }
})
