import { createClient } from 'npm:@supabase/supabase-js@2'

function getSupabaseSecretKey(): string | null {
  const directSecret = Deno.env.get('SUPABASE_SECRET_KEY')
  if (directSecret) return directSecret

  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw)
      if (typeof parsed?.default === 'string' && parsed.default.length > 0) {
        return parsed.default
      }
    } catch {
      // Ignore JSON parse failure
    }
  }

  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      },
    })
  }

  // 1. Resolve server secret key and Supabase URL
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const secretKey = getSupabaseSecretKey()

  if (!supabaseUrl || !secretKey) {
    return new Response(
      JSON.stringify({ error: 'Server misconfiguration: Supabase credentials unavailable' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 2. Validate caller Authorization bearer token against server-side secret key
  const authHeader = req.headers.get('Authorization') ?? ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  const token = match ? match[1].trim() : ''

  if (!token || token !== secretKey) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized: valid secret key bearer token required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // 3. Invoke public.purge_expired_trash_records() via privileged client
  try {
    const service = createClient(supabaseUrl, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data, error } = await service.rpc('purge_expired_trash_records')

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Purge failed' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        purged_at: new Date().toISOString(),
        details: data,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch {
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
