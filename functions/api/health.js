// GET /api/health — liveness + env presence + key-kind diagnostic (no secrets leaked).
// keyKind only reveals a key's TYPE and its public role/ref claims, never the key itself.
// `Buffer` requires the `nodejs_compat` compatibility flag (set in wrangler.toml).
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

// Checkout has hard dependencies that fail closed and look identical to "no rates
// available" from the browser. Surface them by name so a missing production secret is a
// one-request diagnosis instead of a debugging session.
export function checkoutReadiness(env = {}) {
  const quoteSecret = String(env.SHIPPING_QUOTE_SECRET || '').trim();
  const dedicatedAddressKey = Boolean(String(env.GC_ADDRESS_VALIDATION_API_KEY || '').trim());
  const fallbackAddressKey = Boolean(String(env.GC_AUTOCOMPLETE_API_KEY || '').trim());
  const checks = {
    // Under 32 chars the HMAC import throws and every rate request 503s.
    shipping_quote_secret: quoteSecret.length >= 32 ? 'ready' : quoteSecret ? 'too_short' : 'missing',
    // The browser Places key is referrer- and API-restricted; it is only a valid fallback
    // if Address Validation API was added to that key's allowed APIs.
    address_validation_key: dedicatedAddressKey
      ? 'ready'
      : fallbackAddressKey ? 'browser_key_fallback' : 'missing',
    shipstation_api_key: String(env.SHIPSTATION_API_KEY || '').trim() ? 'ready' : 'missing',
    shipstation_warehouse: String(env.SHIPSTATION_WAREHOUSE_ID || '').trim() ? 'ready' : 'missing',
    shipstation_webhook_token: String(env.SHIPSTATION_WEBHOOK_TOKEN || '').trim() ? 'ready' : 'missing',
    stripe_secret: String(env.STRIPE_SECRET_KEY || '').trim() ? 'ready' : 'missing',
    stripe_webhook_secret: String(env.STRIPE_WEBHOOK_SECRET || '').trim() ? 'ready' : 'missing',
    resend_api_key: String(env.RESEND_API_KEY || '').trim() ? 'ready' : 'missing',
  };
  const blocking = Object.entries(checks)
    .filter(([, state]) => state === 'missing' || state === 'too_short')
    .map(([name]) => name);
  return { ready: blocking.length === 0, blocking, checks };
}

export async function onRequestGet({ env }) {
  return new Response(
    JSON.stringify({
      ok: true,
      service: 'masest-commerce',
      phase: 1,
      env: {
        supabase_url: env.SUPABASE_URL || null,
        supabase_anon: Boolean(env.SUPABASE_ANON_KEY),
        supabase_service: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      },
      keys: {
        service_role: keyKind(env.SUPABASE_SERVICE_ROLE_KEY || ''),
        anon: keyKind(env.SUPABASE_ANON_KEY || ''),
      },
      checkout: checkoutReadiness(env),
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }
  );
}
