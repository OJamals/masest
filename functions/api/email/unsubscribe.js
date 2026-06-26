// /api/email/unsubscribe — one-click List-Unsubscribe target for marketing email.
// GET shows a confirm page (so email-scanner prefetches don't auto-unsubscribe);
// POST (the RFC 8058 one-click action) suppresses the 'marketing' stream only, so the
// buyer keeps order/billing receipts. Both require a valid HMAC token tied to the email.
import { recordSuppression } from '../../_lib/supabase.js';
import { verifyUnsubscribeToken } from '../../_lib/email.js';

const esc = (s) => String(s).replace(/[<>&"]/g, '');

function page(bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>MASEST email preferences</title></head>
<body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f4f6f7;margin:0;padding:40px 16px;color:#1c2430">
<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #e3e8ea;border-radius:12px;padding:28px">
<h1 style="font-size:18px;margin:0 0 12px;color:#0e7c86">MASEST email preferences</h1>${bodyHtml}</div></body></html>`;
}
const html = (body, status = 200) => new Response(page(body), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

async function resolve(request, env) {
  const url = new URL(request.url);
  const email = url.searchParams.get('email') || '';
  const token = url.searchParams.get('token') || '';
  const ok = await verifyUnsubscribeToken(email, token, env.EMAIL_UNSUB_SECRET);
  return { email, token, ok };
}

const INVALID = '<p>This unsubscribe link is invalid or expired.</p>';

export async function onRequestGet({ request, env }) {
  const { email, token, ok } = await resolve(request, env);
  if (!ok) return html(INVALID, 400);
  const action = `/api/email/unsubscribe?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  return html(`<form method="POST" action="${action}">
    <p>Unsubscribe <b>${esc(email)}</b> from MASEST marketing &amp; follow-up emails? You'll still receive order and billing notices.</p>
    <button type="submit" style="background:#0e7c86;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer">Unsubscribe</button></form>`);
}

export async function onRequestPost({ request, env }) {
  const { email, ok } = await resolve(request, env);
  if (!ok) return html(INVALID, 400);
  await recordSuppression(env, email, 'unsubscribe', 'marketing');
  return html('<p>Done — you’ve been unsubscribed from MASEST marketing emails. Order and billing notices will still reach you.</p>');
}
