// One-to-one marketing automation gateway. Klaviyo flow must be configured on each
// metric and render event.message_html (safe), event.message_text, and subject fields.
import { categoryPolicy } from './email-policy.js';
import { klaviyoTrack } from './klaviyo.js';

const FLOW_METRIC_ENV = Object.freeze({
  offer: 'KLAVIYO_FLOW_METRIC_OFFER',
  review_request: 'KLAVIYO_FLOW_METRIC_REVIEW_REQUEST',
});

export async function queueMarketingEmail(env, {
  category,
  email,
  subject,
  html,
  text = '',
  idempotencyKey = '',
  properties = {},
  fetchImpl = globalThis.fetch,
} = {}) {
  if (categoryPolicy(category).stream !== 'marketing') {
    return { ok: false, queued: false, provider: 'klaviyo', retryable: false, error: 'marketing_category_required' };
  }
  const metricKey = FLOW_METRIC_ENV[String(category || '')];
  const metric = metricKey ? String(env?.[metricKey] || '').trim() : '';
  if (!metric) {
    return { ok: false, queued: false, provider: 'klaviyo', retryable: false, error: 'marketing_flow_not_configured' };
  }
  const result = await klaviyoTrack(env, {
    email: String(email || '').trim().toLowerCase(),
    metric,
    fetchImpl,
    properties: {
      ...properties,
      email_category: String(category),
      message_subject: String(subject || '').slice(0, 255),
      message_html: String(html || '').slice(0, 100000),
      message_text: String(text || '').slice(0, 50000),
      idempotency_key: String(idempotencyKey || '').slice(0, 255),
    },
  });
  if (!result.ok) {
    return {
      ok: false,
      queued: false,
      provider: 'klaviyo',
      retryable: result.status === 429 || Number(result.status) >= 500 || result.error === true,
      error: result.error || 'klaviyo_event_failed',
      ...(result.status ? { status: result.status } : {}),
    };
  }
  return { ok: true, queued: true, provider: 'klaviyo', status: result.status, metric };
}
