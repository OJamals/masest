// POST /api/track — first-party pageview beacon (privacy-light: no cookies, no PII, no account id).
// Body: { path, referrer?, visitor? }  — visitor is a random per-session id minted client-side.
// Fails open: any error returns 204 so it never affects the page. Drops obvious bots.
import { adminClient, readBody } from '../lib/supabase.js';

function uaFamily(ua = '') {
  const s = ua.toLowerCase();
  if (/(bot|crawl|spider|slurp|bing|google|headless|lighthouse|preview)/.test(s)) return 'bot';
  if (s.includes('edg/')) return 'Edge';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('safari')) return 'Safari';
  if (s.includes('firefox')) return 'Firefox';
  return 'Other';
}

export default async (req) => {
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  try {
    const body = await readBody(req);
    const path = String(body.path || '').slice(0, 300);
    if (!path) return new Response(null, { status: 204 });
    const family = uaFamily(req.headers.get('user-agent') || '');
    if (family === 'bot') return new Response(null, { status: 204 }); // don't log crawlers

    const sb = adminClient();
    await sb.from('page_views').insert({
      path,
      referrer: String(body.referrer || '').slice(0, 300) || null,
      ua_family: family,
      visitor: String(body.visitor || '').slice(0, 64) || null,
    });
  } catch { /* fail open */ }
  return new Response(null, { status: 204 });
};

export const config = { path: '/api/track' };
