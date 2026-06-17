// POST /api/track — first-party pageview beacon. Privacy-light, fails open (always 204), drops bots.
import { adminClient, readBody } from '../_lib/supabase.js';

function uaFamily(ua = '') {
  const s = ua.toLowerCase();
  if (/(bot|crawl|spider|slurp|bing|google|headless|lighthouse|preview)/.test(s)) return 'bot';
  if (s.includes('edg/')) return 'Edge';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('safari')) return 'Safari';
  if (s.includes('firefox')) return 'Firefox';
  return 'Other';
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    const path = String(body.path || '').slice(0, 300);
    if (!path) return new Response(null, { status: 204 });
    const family = uaFamily(request.headers.get('user-agent') || '');
    if (family === 'bot') return new Response(null, { status: 204 });
    const sb = adminClient(env);
    await sb.from('page_views').insert({
      path,
      referrer: String(body.referrer || '').slice(0, 300) || null,
      ua_family: family,
      visitor: String(body.visitor || '').slice(0, 64) || null,
    });
  } catch { /* fail open */ }
  return new Response(null, { status: 204 });
}
