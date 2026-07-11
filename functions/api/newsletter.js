// POST /api/newsletter — subscribe an email to the Klaviyo newsletter list.
// Private key is server-side only. Double opt-in is governed by the list's Klaviyo settings.
import { json } from '../_lib/supabase.js';
import { rateLimit, clientIp } from '../_lib/ratelimit.js';
import { klaviyoSubscribe } from '../_lib/klaviyo.js';
import { RequestBodyTooLargeError, readBoundedJson } from '../_lib/request-body.js';

function clean(value, max = 180) {
  return String(value || '').trim().slice(0, max);
}

function newsletterProperties(body) {
  const out = {
    source: clean(body.source || 'footer_newsletter', 80),
    source_path: clean(body.source_path || body.path, 300),
    source_page: clean(body.source_page || body.page, 80),
    page_title: clean(body.page_title, 180),
    industry: clean(body.industry, 120),
    document: clean(body.document, 180),
  };
  if (body.document_notify === true || body.document_notify === 'true') out.document_notify = true;
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== ''));
}

export async function onRequestPost({ request, env }) {
  // Per-IP throttle (no-op until a RATE_KV namespace is bound — see _lib/ratelimit.js).
  const rl = await rateLimit(env, 'newsletter', clientIp(request), { limit: 5, windowSec: 60 });
  if (!rl.ok) return json(429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfter || 60) });

  let body;
  try {
    body = await readBoundedJson(request, 16 * 1024);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return json(413, { error: 'request_too_large' });
    }
    return json(400, { error: 'bad_request' });
  }

  const email = String(body.email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'invalid_email' });
  if (body.company) return json(200, { ok: true }); // honeypot — silently accept, do nothing

  const r = await klaviyoSubscribe(env, email, env.KLAVIYO_LIST_ID, newsletterProperties(body));
  if (r.skipped) return json(500, { error: 'newsletter_not_configured' });
  if (!r.ok) return json(502, { error: 'klaviyo_error', status: r.status });
  return json(200, { ok: true });
}
