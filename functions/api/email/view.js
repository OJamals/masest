// Signed browser rendering for a snapshotted newsletter or blog email.
import { adminClient } from '../../_lib/supabase.js';
import { verifyEmailViewToken } from '../../_lib/email.js';
import { marketingEmailViewUrl, personalizeMarketingContent } from '../../_lib/ses-email.js';

const SOURCE_TYPES = new Set(['newsletter', 'blog_post', 'nurture']);

async function loadSource(env, sourceType, sourceId) {
  const { data, error } = await adminClient(env).from('newsletter_delivery_sources')
    .select('source_type,source_id,html')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .maybeSingle();
  return { source: data || null, error: error || null };
}

function response(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; img-src https://media.masest.co; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

export function createEmailViewHandler({ getSource = loadSource } = {}) {
  return async function emailView({ request, env }) {
    const url = new URL(request.url);
    const sourceType = String(url.searchParams.get('source_type') || '');
    const sourceId = String(url.searchParams.get('source_id') || '').slice(0, 300);
    const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
    const token = String(url.searchParams.get('token') || '');
    if (!SOURCE_TYPES.has(sourceType) || !sourceId || !email || !await verifyEmailViewToken(
      email, sourceType, sourceId, token, env.EMAIL_UNSUB_SECRET,
    )) {
      return response('<p>Invalid or expired email link.</p>', 400);
    }
    const { source, error } = await getSource(env, sourceType, sourceId);
    if (error) return response('<p>Email view temporarily unavailable.</p>', 503);
    if (!source) return response('<p>Email not found.</p>', 404);
    const webViewUrl = await marketingEmailViewUrl(env, { email, sourceType, sourceId });
    try {
      const personalized = await personalizeMarketingContent(env, {
        email, html: source.html, webViewUrl,
      });
      return response(personalized.html, 200);
    } catch {
      return response('<p>Email view temporarily unavailable.</p>', 503);
    }
  };
}

export const onRequestGet = createEmailViewHandler();
