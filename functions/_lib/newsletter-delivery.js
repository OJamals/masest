import { sendEmailResult } from './supabase.js';

export const DELIVERY_CONCURRENCY = 5;
export const DELIVERY_BATCH_SIZE = 25;
export const DELIVERY_MAX_BATCH_SIZE = 500;
export const DELIVERY_LEASE_SECONDS = 5 * 60;
export const DELIVERY_MAX_ATTEMPTS = 5;
export const TERMINAL_DELIVERY_STATES = new Set(['sent', 'suppressed', 'dead']);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeDeliveryEmails(emails = []) {
  const seen = new Set();
  const normalized = [];
  for (const value of emails || []) {
    const email = String(value || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    normalized.push(email);
  }
  return normalized;
}

export function deliveryIdentity(sourceType, sourceId, value) {
  const email = String(value || '').trim().toLowerCase();
  if (!['newsletter', 'blog_post'].includes(sourceType)) throw new Error('invalid_delivery_source_type');
  if (!sourceId) throw new Error('delivery_source_id_required');
  if (!EMAIL_RE.test(email)) throw new Error('invalid_delivery_email');
  const prefix = sourceType === 'blog_post' ? 'blog-newsletter' : 'newsletter';
  return {
    sourceType,
    sourceId: String(sourceId),
    email,
    key: `${sourceType}:${sourceId}:${email}`,
    providerIdempotencyKey: `${prefix}:${sourceId}:${email}`,
  };
}

function retryableResult(result = {}) {
  const status = Number(result.status) || 0;
  return Boolean(result.retryable || result.network || status === 429 || status >= 500);
}

export function deliveryTransition(result = {}, attempts = 1, nowMs = Date.now()) {
  if (result.ok) {
    return {
      state: 'sent',
      provider_message_id: result.resendId || null,
      sent_at: new Date(nowMs).toISOString(),
    };
  }
  if (result.suppressed) {
    return {
      state: 'suppressed',
      last_error: result.error || 'all_recipients_suppressed',
    };
  }

  const error = String(result.error || (result.status ? `resend_${result.status}` : 'delivery_failed')).slice(0, 500);
  if (retryableResult(result) && attempts < DELIVERY_MAX_ATTEMPTS) {
    const delayMs = Math.min(60 * 60 * 1000, 60_000 * (2 ** Math.max(0, attempts - 1)));
    return {
      state: 'retry',
      last_error: error,
      available_at: new Date(nowMs + delayMs).toISOString(),
    };
  }
  return { state: 'dead', last_error: error };
}

export function deliverySummary(rows = []) {
  const summary = {
    total: 0,
    pending: 0,
    processing: 0,
    retry: 0,
    sent: 0,
    suppressed: 0,
    dead: 0,
    terminal: 0,
    complete: true,
  };
  for (const row of rows || []) {
    const state = typeof row === 'string' ? row : row?.state;
    summary.total += 1;
    if (Object.hasOwn(summary, state) && typeof summary[state] === 'number') summary[state] += 1;
    if (TERMINAL_DELIVERY_STATES.has(state)) summary.terminal += 1;
  }
  summary.complete = summary.terminal === summary.total;
  return summary;
}

async function mapConcurrent(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(items.length, Math.max(1, concurrency)) },
    () => consume(),
  ));
  return results;
}

function workerId() {
  return globalThis.crypto?.randomUUID?.()
    || `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function runDeliveryWorker({
  store,
  send,
  sourceType = null,
  limit = DELIVERY_BATCH_SIZE,
  concurrency = DELIVERY_CONCURRENCY,
  leaseSeconds = DELIVERY_LEASE_SECONDS,
  now = () => Date.now(),
  workerId: requestedWorkerId = null,
} = {}) {
  if (!store?.claim || !store?.finish || !store?.reconcile) throw new Error('delivery_store_required');
  const activeWorkerId = requestedWorkerId || workerId();
  const claimLimit = Math.min(DELIVERY_MAX_BATCH_SIZE, Math.max(1, Number(limit) || DELIVERY_BATCH_SIZE));
  const maxConcurrency = Math.min(DELIVERY_CONCURRENCY, Math.max(1, Number(concurrency) || DELIVERY_CONCURRENCY));
  const claimed = await store.claim({
    workerId: activeWorkerId,
    sourceType,
    limit: claimLimit,
    leaseSeconds: Math.max(30, Number(leaseSeconds) || DELIVERY_LEASE_SECONDS),
  });
  const sendDelivery = send || (async (row) => sendEmailResult(row.env || {}, {
    to: [row.normalized_email],
    subject: row.subject,
    html: row.html,
    category: row.category,
    idempotencyKey: row.provider_idempotency_key,
  }));

  await mapConcurrent(claimed || [], maxConcurrency, async (row) => {
    let result;
    try {
      result = await sendDelivery(row);
    } catch (error) {
      result = { network: true, error: String(error) };
    }
    const transition = deliveryTransition(result, row.attempts, now());
    await store.finish(row, transition, activeWorkerId);
  });

  const sources = new Map();
  for (const row of claimed || []) {
    const key = `${row.source_type}:${row.source_id}`;
    if (!sources.has(key)) sources.set(key, row);
  }
  const summaries = [];
  for (const row of sources.values()) {
    summaries.push(await store.reconcile(row.source_type, row.source_id));
  }
  return { claimed: claimed?.length || 0, workerId: activeWorkerId, summaries };
}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

export async function getDeliverySource(sb, sourceType, sourceId) {
  const { data, error } = await sb.from('newsletter_delivery_sources')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) return { source: null, error };
  return { source: data || null, error: null };
}

export async function materializeDeliverySource(sb, {
  sourceType,
  sourceId,
  parentId = sourceId,
  subject,
  html,
  category,
  metadata = {},
  emails = [],
}) {
  const normalized = normalizeDeliveryEmails(emails);
  const { data, error } = await sb.rpc('materialize_newsletter_deliveries', {
    p_source_type: sourceType,
    p_source_id: String(sourceId),
    p_parent_id: String(parentId),
    p_subject: String(subject || ''),
    p_html: String(html || ''),
    p_category: String(category || ''),
    p_metadata: metadata,
    p_emails: normalized,
  });
  if (error) return { created: false, total: 0, error };
  const row = firstRow(data) || {};
  return {
    created: Boolean(row.created),
    total: Number(row.total_count) || 0,
    error: null,
  };
}

function numericSummary(row = {}) {
  const summary = {
    total: Number(row.total) || 0,
    pending: Number(row.pending) || 0,
    processing: Number(row.processing) || 0,
    retry: Number(row.retry) || 0,
    sent: Number(row.sent) || 0,
    suppressed: Number(row.suppressed) || 0,
    dead: Number(row.dead) || 0,
    terminal: Number(row.terminal) || 0,
    complete: Boolean(row.complete),
  };
  return summary;
}

export function createSupabaseDeliveryStore(sb) {
  return {
    async claim({ workerId: activeWorkerId, sourceType, limit, leaseSeconds }) {
      const { data, error } = await sb.rpc('claim_newsletter_deliveries', {
        p_worker_id: activeWorkerId,
        p_source_type: sourceType,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(`newsletter_delivery_claim_failed:${error.message || error}`);
      return data || [];
    },

    async finish(row, transition, activeWorkerId) {
      const { data, error } = await sb.rpc('finish_newsletter_delivery', {
        p_id: row.id,
        p_worker_id: activeWorkerId,
        p_state: transition.state,
        p_error: transition.last_error || null,
        p_available_at: transition.available_at || null,
        p_provider_message_id: transition.provider_message_id || null,
        p_sent_at: transition.sent_at || null,
      });
      if (error) throw new Error(`newsletter_delivery_finish_failed:${error.message || error}`);
      return Boolean(data);
    },

    async reconcile(sourceType, sourceId) {
      const [{ data: summaryData, error: summaryError }, { source, error: sourceError }] = await Promise.all([
        sb.rpc('newsletter_delivery_summary', {
          p_source_type: sourceType,
          p_source_id: sourceId,
        }),
        getDeliverySource(sb, sourceType, sourceId),
      ]);
      if (summaryError || sourceError || !source) {
        throw new Error(`newsletter_delivery_reconcile_failed:${summaryError?.message || sourceError?.message || 'source_missing'}`);
      }
      const summary = numericSummary(firstRow(summaryData));
      const completedAt = summary.complete ? new Date().toISOString() : null;
      const { error: sourceUpdateError } = await sb.from('newsletter_delivery_sources').update({
        status: summary.complete ? 'complete' : 'processing',
        total_count: summary.total,
        sent_count: summary.sent,
        suppressed_count: summary.suppressed,
        dead_count: summary.dead,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      }).eq('source_type', sourceType).eq('source_id', sourceId);
      if (sourceUpdateError) throw new Error(`newsletter_delivery_source_update_failed:${sourceUpdateError.message || sourceUpdateError}`);

      if (sourceType === 'newsletter') {
        const nextSchedule = source.metadata?.next_schedule || null;
        const patch = {
          status: summary.complete ? (nextSchedule ? 'scheduled' : 'sent') : 'sending',
          recipient_count: summary.sent,
          delivery_summary: summary,
          delivery_source_id: summary.complete ? null : sourceId,
          updated_at: new Date().toISOString(),
          ...(summary.complete && !nextSchedule ? { sent_at: completedAt } : {}),
          ...(summary.complete && nextSchedule ? { schedule: nextSchedule } : {}),
        };
        const { error } = await sb.from('newsletters').update(patch)
          .eq('id', source.parent_id)
          .eq('delivery_source_id', sourceId);
        if (error) throw new Error(`newsletter_delivery_parent_update_failed:${error.message || error}`);
      } else if (sourceType === 'blog_post' && summary.complete) {
        const { error } = await sb.from('blog_newsletter_sends').upsert({
          slug: source.parent_id,
          sent_at: completedAt,
          recipient_count: summary.sent,
          delivery_source_id: sourceId,
          delivery_total: summary.total,
          suppressed_count: summary.suppressed,
          dead_count: summary.dead,
        }, { onConflict: 'slug' });
        if (error) throw new Error(`blog_delivery_parent_update_failed:${error.message || error}`);
      }
      return { sourceType, sourceId, ...summary };
    },
  };
}

function envNumber(env, name, fallback) {
  const value = Number(env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function runSupabaseDeliveryWorker(env, sb, { sourceType } = {}) {
  return runDeliveryWorker({
    store: createSupabaseDeliveryStore(sb),
    sourceType,
    limit: envNumber(env, 'NEWSLETTER_DELIVERY_BATCH_SIZE', DELIVERY_BATCH_SIZE),
    concurrency: envNumber(env, 'NEWSLETTER_DELIVERY_CONCURRENCY', DELIVERY_CONCURRENCY),
    leaseSeconds: envNumber(env, 'NEWSLETTER_DELIVERY_LEASE_SECONDS', DELIVERY_LEASE_SECONDS),
    send: (row) => sendEmailResult(env, {
      to: [row.normalized_email],
      subject: row.subject,
      html: row.html,
      category: row.category,
      idempotencyKey: row.provider_idempotency_key,
    }),
  });
}
