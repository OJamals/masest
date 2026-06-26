// POST /api/resend-webhook — Resend (Svix) delivery-event sink.
// Configure in Resend Dashboard → Webhooks → endpoint <domain>/api/resend-webhook,
// subscribe to delivered / bounced / complained / failed / delivery_delayed.
// Set RESEND_WEBHOOK_SECRET in CF env.
// Returns 200 for accepted/duplicate/unknown events (avoid Resend retry storms),
// 400 only on signature failure. No-op (200) if the secret is unset.
import { json, recordSuppression, updateEmailStatus } from '../_lib/supabase.js';
import { verifySvixSignature, mapResendEvent, isSuppressingEvent } from '../_lib/email.js';

export async function onRequestPost({ request, env }) {
  const secret = env.RESEND_WEBHOOK_SECRET;
  const raw = await request.text();
  if (!secret) return json(200, { ok: true, note: 'webhook unconfigured' });

  const ok = await verifySvixSignature(secret, {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }, raw);
  if (!ok) return json(400, { error: 'invalid_signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return json(200, { ok: true, note: 'unparseable' }); }

  const type = event?.type;
  const resendId = event?.data?.email_id || event?.data?.id || null;
  const email = Array.isArray(event?.data?.to) ? event.data.to[0] : event?.data?.to || null;

  const status = mapResendEvent(type);
  if (status && resendId) await updateEmailStatus(env, resendId, status);
  if (isSuppressingEvent(type) && email) {
    await recordSuppression(env, email, type === 'email.complained' ? 'complaint' : 'hard_bounce');
  }
  return json(200, { ok: true });
}
