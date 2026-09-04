export const MARKETING_DELIVERY_SOURCE_TYPES = Object.freeze([
  'newsletter',
  'blog_post',
  'nurture',
  'offer',
  'review',
  'test',
]);

const SOURCE_TYPES = new Set(MARKETING_DELIVERY_SOURCE_TYPES);
const DELIVERY_JOB_KEYS = new Set(['version', 'kind', 'sourceType', 'sourceId']);
const CONSENT_JOB_KEYS = new Set(['version', 'kind']);
const SWEEP_JOB_KEYS = new Set(['version', 'kind']);

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function normalizeMarketingDeliveryJob(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_marketing_delivery_job');
  if (input.version !== 1) fail('invalid_marketing_delivery_job');
  if (input.kind === 'marketing_consent.sync') {
    if (Object.keys(input).some((key) => !CONSENT_JOB_KEYS.has(key))) fail('invalid_marketing_delivery_job_fields');
    return { version: 1, kind: 'marketing_consent.sync' };
  }
  if (input.kind === 'marketing_delivery.sweep') {
    if (Object.keys(input).some((key) => !SWEEP_JOB_KEYS.has(key))) fail('invalid_marketing_delivery_job_fields');
    return { version: 1, kind: 'marketing_delivery.sweep' };
  }
  if (input.kind !== 'marketing_delivery.drain') fail('invalid_marketing_delivery_job');
  if (Object.keys(input).some((key) => !DELIVERY_JOB_KEYS.has(key))) fail('invalid_marketing_delivery_job_fields');
  const sourceType = String(input.sourceType || '');
  if (!SOURCE_TYPES.has(sourceType)) fail('invalid_marketing_delivery_source_type');
  const sourceId = String(input.sourceId || '').trim();
  if (sourceId.length > 200) fail('invalid_marketing_delivery_source_id');
  return {
    version: 1,
    kind: 'marketing_delivery.drain',
    sourceType,
    ...(sourceId ? { sourceId } : {}),
  };
}

async function enqueueJob(env, body, delaySeconds) {
  if (!env?.MARKETING_EMAIL_QUEUE || typeof env.MARKETING_EMAIL_QUEUE.send !== 'function') {
    return { ok: false, queued: false, retryable: false, error: 'marketing_queue_not_configured' };
  }
  const delay = Math.min(43_200, Math.max(0, Math.floor(Number(delaySeconds) || 0)));
  try {
    await env.MARKETING_EMAIL_QUEUE.send(body, {
      contentType: 'json',
      ...(delay ? { delaySeconds: delay } : {}),
    });
    return { ok: true, queued: true };
  } catch {
    return { ok: false, queued: false, retryable: true, error: 'marketing_queue_enqueue_failed' };
  }
}

export async function enqueueMarketingConsentSync(env, { delaySeconds = 0 } = {}) {
  return enqueueJob(env, { version: 1, kind: 'marketing_consent.sync' }, delaySeconds);
}

export async function enqueueMarketingSweep(env, { delaySeconds = 0 } = {}) {
  return enqueueJob(env, { version: 1, kind: 'marketing_delivery.sweep' }, delaySeconds);
}

export async function enqueueMarketingDelivery(env, {
  sourceType,
  sourceId = '',
} = {}, {
  delaySeconds = 0,
} = {}) {
  let body;
  try {
    body = normalizeMarketingDeliveryJob({
      version: 1,
      kind: 'marketing_delivery.drain',
      sourceType,
      ...(sourceId ? { sourceId } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      queued: false,
      retryable: false,
      error: String(error?.code || error?.message || 'invalid_marketing_delivery_job'),
    };
  }
  return enqueueJob(env, body, delaySeconds);
}
