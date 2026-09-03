// One-to-one marketing gateway. Supabase owns consent; Amazon SES owns transport.
import { categoryPolicy } from './email-policy.js';
import { sendEmailResult } from './supabase.js';

export async function queueMarketingEmail(env, {
  category,
  email,
  subject,
  html,
  text = '',
  idempotencyKey = '',
  properties = {},
  fetchImpl = globalThis.fetch,
  signer = null,
  suppressionLoader,
} = {}) {
  if (categoryPolicy(category)?.stream !== 'marketing') {
    return { ok: false, queued: false, provider: 'ses', retryable: false, error: 'marketing_category_required' };
  }
  const uniqueId = String(idempotencyKey || '').trim().slice(0, 255);
  if (!uniqueId) {
    return { ok: false, queued: false, provider: 'ses', retryable: false, error: 'marketing_idempotency_key_required' };
  }
  const result = await sendEmailResult(env, {
    to: [String(email || '').trim().toLowerCase()],
    category,
    subject,
    html,
    text,
    idempotencyKey: uniqueId,
    webViewUrl: properties.web_view_url || '',
    fetchImpl,
    sesSigner: signer,
    ...(suppressionLoader ? { suppressionLoader } : {}),
  });
  if (!result.ok) {
    return {
      ok: false,
      queued: false,
      provider: 'ses',
      retryable: result.retryable === true,
      error: result.error || 'ses_send_failed',
      ...(result.status ? { status: result.status } : {}),
      ...(result.ambiguous ? { ambiguous: true } : {}),
    };
  }
  return {
    ok: true,
    queued: true,
    provider: 'ses',
    status: result.status,
    providerMessageId: result.providerMessageId,
  };
}
