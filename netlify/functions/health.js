// GET /api/health — liveness + env presence + key-kind diagnostic (no secrets leaked).
// keyKind only reveals a key's TYPE and its public role/ref claims, never the key itself.
function keyKind(token) {
  if (!token) return { kind: 'empty' };
  if (token.startsWith('sb_secret_')) return { kind: 'sb_secret' };
  if (token.startsWith('sb_publishable_')) return { kind: 'sb_publishable' };
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return { kind: 'jwt', role: claims.role || null, ref: claims.ref || null };
  } catch {
    return { kind: 'unknown' };
  }
}

export default async () =>
  new Response(
    JSON.stringify({
      ok: true,
      service: 'masest-commerce',
      phase: 1,
      env: {
        supabase_url: process.env.SUPABASE_URL || null,
        supabase_anon: Boolean(process.env.SUPABASE_ANON_KEY),
        supabase_service: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      keys: {
        service_role: keyKind(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
        anon: keyKind(process.env.SUPABASE_ANON_KEY || ''),
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

export const config = { path: '/api/health' };
