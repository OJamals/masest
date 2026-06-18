// POST /api/newsletter — subscribe an email to the Klaviyo newsletter list.
// Private key is server-side only. Double opt-in is governed by the list's Klaviyo settings.
import { json, readBody } from '../_lib/supabase.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';
import { klaviyoSubscribe } from '../_lib/klaviyo.js';

export async function onRequestPost({ request, env }) {
  const body = await readBody(request);
  const email = String(body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'invalid_email' });
  if (body.company) return json(200, { ok: true }); // honeypot — silently accept, do nothing

  // Per-IP throttle (no-op until a RATE_KV namespace is bound — see _lib/ratelimit.js).
  const rl = await rateLimit(env, 'newsletter', clientIp(request), { limit: 5, windowSec: 60 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  const r = await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID);
  if (r.skipped) return json(500, { error: 'newsletter_not_configured' });
  if (!r.ok) return json(502, { error: 'klaviyo_error', status: r.status });
  return json(200, { ok: true });
}
