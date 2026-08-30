// Audio is held only for this request, transcribed by Lovable AI server-side,
// and never put in Storage or sent to Copilot until the operator reviews it.
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const MAX_BASE64_CHARS = 10_700_000 // about 8 MB of source audio
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

function asBytes(audio: string) {
  const binary = atob(audio)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const apiKey = Deno.env.get('LOVABLE_API_KEY')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!apiKey || !supabaseUrl) return json({ error: 'Transcription is not configured on this environment.' }, 503)
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not authenticated' }, 401)
  const sb = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } })
  const token = authHeader.slice('Bearer '.length).trim()
  const { data: claimsData, error: claimsError } = await sb.auth.getClaims(token)
  const userId = typeof claimsData?.claims?.sub === 'string' ? claimsData.claims.sub : null
  if (claimsError || !userId) return json({ error: 'Not authenticated' }, 401)
  const { data: profile } = await sb.from('profiles').select('default_warehouse_id').eq('id', userId).maybeSingle()
  if (!profile?.default_warehouse_id) return json({ error: 'Select an active warehouse before using dictation.' }, 403)
  let body: { audio?: string; mimeType?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const audio = typeof body.audio === 'string' ? body.audio : ''
  if (!audio) return json({ error: 'No audio was provided.' }, 400)
  if (audio.length > MAX_BASE64_CHARS) return json({ error: 'Recording is too long. Keep it under one minute.' }, 413)
  const rawMime = (body.mimeType ?? '').split(';')[0]
  const mimeType = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg'].includes(rawMime) ? rawMime : 'audio/webm'
  let bytes: Uint8Array
  try { bytes = asBytes(audio) } catch { return json({ error: 'The recording could not be decoded.' }, 400) }
  if (bytes.byteLength < 1500) return json({ error: 'That recording was too short to transcribe.' }, 400)
  const extension = mimeType.includes('wav') ? 'wav' : mimeType.includes('mpeg') ? 'mp3' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
  const form = new FormData()
  form.append('model', 'openai/gpt-4o-mini-transcribe')
  form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: mimeType }), `warehouse-dictation.${extension}`)
  form.append('prompt', 'Transcribe warehouse operations faithfully. Preserve pallet codes, SKUs, quantities, location codes, task numbers, and spoken uncertainty. Return only the transcript.')
  const started = Date.now()
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form })
    if (response.status === 429) return json({ error: 'Transcription is rate limited. Try again shortly.' }, 429)
    if (response.status === 402) return json({ error: 'AI credits are exhausted for this workspace.' }, 402)
    if (!response.ok) { console.error('[copilot-transcribe] gateway error', response.status, (await response.text()).slice(0, 500)); return json({ error: 'Transcription service failed.' }, 502) }
    const transcript = String((await response.json().catch(() => null))?.text ?? '').trim().slice(0, 12_000)
    if (!transcript) return json({ error: 'Nothing was recognised. Try again or type your question.' }, 422)
    // Metadata only: the audit never stores audio or the transcript.
    if (serviceRoleKey) {
      const audit = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
      await audit.from('copilot_tool_calls').insert({ user_id: userId, warehouse_id: profile.default_warehouse_id, tool_name: 'voice_transcribe', tool_input: { mimeType, audioBytes: bytes.byteLength }, outcome: 'ok', row_count: 1, latency_ms: Date.now() - started }).then(({ error }) => { if (error) console.error('[copilot-transcribe] audit write failed:', error.message) })
    }
    return json({ transcript })
  } catch (error) { console.error('[copilot-transcribe] failure:', error); return json({ error: 'Transcription service failed.' }, 502) }
})
