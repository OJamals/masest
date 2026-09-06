import { adminClient } from './supabase.js';
import { renderNewsletterEmail, nextRunAt, dueNewsletters } from './newsletter.js';
import {
  materializeDeliverySource,
  getDeliverySource,
} from './newsletter-delivery.js';
import { enqueueMarketingDelivery } from './marketing-delivery-queue.js';
import { loadMarketingAudience } from './marketing-subscribers.js';

const SENDABLE_NEWSLETTER_STATES = ['draft', 'scheduled', 'failed'];

function preparationLeaseToken() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('preparation_lease_crypto_unavailable');
  return globalThis.crypto.randomUUID();
}

export async function claimNewsletter(sb, id, allowedStatuses = SENDABLE_NEWSLETTER_STATES, { scheduled = false } = {}) {
  const statuses = [...new Set(allowedStatuses)].filter((status) => typeof status === 'string' && status);
  if (!id || !statuses.length) return { newsletter: null, error: new Error('newsletter_claim_invalid') };
  const { data, error } = await sb.from('newsletters')
    .update({
      status: 'queueing',
      provider_error: null,
      preparation_lease_token: preparationLeaseToken(),
      preparation_lease_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      preparation_attempts: 1,
      preparation_scheduled: Boolean(scheduled),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('status', statuses)
    .select('*')
    .maybeSingle();
  return { newsletter: data || null, error: error || null };
}

export async function recoverNewsletterPreparation(sb, id, leaseToken = preparationLeaseToken()) {
  const { data, error } = await sb.rpc('claim_newsletter_preparation', {
    p_id: id,
    p_lease_token: leaseToken,
    p_lease_seconds: 600,
  });
  return { newsletter: Array.isArray(data) ? data[0] || null : data || null, error: error || null };
}

function sourceIdFor(newsletter) {
  if (newsletter.preparation_source_id) return String(newsletter.preparation_source_id);
  if (newsletter.schedule?.mode !== 'recurring') return String(newsletter.id);
  const occurrence = newsletter.schedule.next_run_at || newsletter.schedule.send_at || newsletter.updated_at;
  return `${newsletter.id}:${String(occurrence || 'recurring')}`;
}

async function failQueue(sb, newsletterId, error, leaseToken) {
  await sb.from('newsletters').update({
    provider: 'ses',
    status: 'failed',
    provider_status: 'failed_to_queue',
    provider_error: String(error || 'newsletter_queue_failed').slice(0, 500),
    preparation_lease_expires_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', newsletterId).eq('status', 'queueing')
    .eq('preparation_lease_token', leaseToken);
}

export async function queueNewsletter(env, sb, newsletter, { scheduled = false } = {}) {
  let emails;
  try {
    emails = await loadMarketingAudience(sb);
  } catch (error) {
    await failQueue(sb, newsletter.id, error.message, newsletter.preparation_lease_token);
    return { error: error.message || 'marketing_audience_unavailable', retryable: true };
  }
  const rendered = renderNewsletterEmail(newsletter);
  const sourceId = sourceIdFor(newsletter);
  const sourceLookup = await getDeliverySource(sb, 'newsletter', sourceId);
  if (sourceLookup.error) {
    await failQueue(sb, newsletter.id, 'newsletter_delivery_source_lookup_failed', newsletter.preparation_lease_token);
    return { error: 'newsletter_delivery_source_lookup_failed', retryable: true };
  }
  const sourceMetadata = sourceLookup.source?.metadata || null;
  const intendedSchedule = newsletter.preparation_schedule || newsletter.schedule || {};
  const nextSchedule = newsletter.preparation_scheduled && intendedSchedule.mode === 'recurring'
    ? { ...intendedSchedule, next_run_at: sourceMetadata?.next_schedule?.next_run_at || nextRunAt(intendedSchedule, Date.now()) }
    : null;
  const materialized = await materializeDeliverySource(sb, {
    sourceType: 'newsletter',
    sourceId,
    parentId: newsletter.id,
    subject: rendered.subject,
    html: rendered.html,
    category: 'newsletter',
    metadata: { next_schedule: nextSchedule },
    emails,
    leaseToken: newsletter.preparation_lease_token,
  });
  if (materialized.error) {
    await failQueue(sb, newsletter.id, 'newsletter_delivery_materialize_failed', newsletter.preparation_lease_token);
    return { error: 'newsletter_delivery_materialize_failed', retryable: true };
  }

  const empty = materialized.total === 0;
  const { data: saved, error: updateError } = await sb.from('newsletters').update({
    provider: 'ses',
    provider_campaign_id: null,
    provider_message_id: null,
    provider_template_id: null,
    provider_status: empty ? 'complete' : 'processing',
    provider_error: null,
    status: empty ? (nextSchedule ? 'scheduled' : 'sent') : 'sending',
    schedule: nextSchedule || newsletter.schedule || {},
    delivery_source_id: empty ? null : sourceId,
    delivery_summary: empty ? {
      total: 0, pending: 0, processing: 0, retry: 0,
      sent: 0, suppressed: 0, dead: 0, terminal: 0, complete: true,
    } : {},
    recipient_count: 0,
    preparation_lease_token: null,
    preparation_lease_expires_at: null,
    preparation_scheduled: null,
    preparation_schedule: null,
    preparation_source_id: null,
    ...(empty && !nextSchedule ? { sent_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq('id', newsletter.id).eq('status', 'queueing')
    .eq('preparation_lease_token', newsletter.preparation_lease_token)
    .select('id').maybeSingle();
  if (updateError || !saved) return { error: updateError ? 'newsletter_queue_state_save_failed' : 'newsletter_preparation_lease_lost', retryable: true };

  let wake = { ok: true, queued: false };
  if (!empty) {
    wake = await enqueueMarketingDelivery(env, { sourceType: 'newsletter', sourceId });
  }
  return {
    queued: !empty,
    provider: 'ses',
    source_id: sourceId,
    total: materialized.total,
    processed: 0,
    queue_wake: wake.ok,
    ...(wake.ok ? {} : { queue_error: wake.error, retryable: wake.retryable }),
    provider_status: empty ? 'complete' : 'processing',
  };
}

export async function sweepNewsletterPreparation(env, {
  createClient = adminClient,
  claim = claimNewsletter,
  recover = recoverNewsletterPreparation,
  queue = queueNewsletter,
  now = Date.now(),
} = {}) {
  const sb = createClient(env);
  const dueAt = new Date(now).toISOString();
  const [scheduledNextResult, scheduledOnceResult, recoveryQueueingResult, recoveryFailedResult] = await Promise.all([
    sb.from('newsletters').select('*').eq('status', 'scheduled')
      .not('schedule->>next_run_at', 'is', null).lte('schedule->>next_run_at', dueAt).limit(50),
    sb.from('newsletters').select('*').eq('status', 'scheduled')
      .is('schedule->>next_run_at', null).lte('schedule->>send_at', dueAt).limit(50),
    sb.from('newsletters').select('*').eq('status', 'queueing')
      .or(`preparation_lease_expires_at.lte.${dueAt},preparation_lease_expires_at.is.null`).limit(50),
    sb.from('newsletters').select('*').eq('status', 'failed').eq('provider_status', 'failed_to_queue')
      .or(`preparation_lease_expires_at.lte.${dueAt},preparation_lease_expires_at.is.null`).limit(50),
  ]);
  const results = [scheduledNextResult, scheduledOnceResult, recoveryQueueingResult, recoveryFailedResult];
  const data = results.flatMap((result) => result.data || []);
  const error = results.find((result) => result.error)?.error;
  if (error) return { ok: false, error: 'unavailable', queued: [], failed: [], drained: [] };
  const queued = [];
  const failed = [];
  const candidates = (data || []).filter((candidate) => (
    dueNewsletters([candidate], now).length
    || (['queueing', 'failed'].includes(candidate.status)
      && (!candidate.preparation_lease_expires_at || Date.parse(candidate.preparation_lease_expires_at) <= now)
      && (candidate.status !== 'failed' || candidate.provider_status === 'failed_to_queue'))
  ));
  for (const candidate of candidates) {
    const claimed = candidate.status === 'scheduled'
      ? await claim(sb, candidate.id, ['scheduled'], { scheduled: true })
      : await recover(sb, candidate.id);
    if (claimed.error) {
      failed.push({ id: candidate.id, error: 'newsletter_claim_failed', retryable: true });
      continue;
    }
    if (!claimed.newsletter) continue;
    const result = await queue(env, sb, claimed.newsletter, {
      scheduled: candidate.status === 'scheduled' || claimed.newsletter.preparation_schedule?.mode === 'recurring',
    });
    if (result.error) failed.push({ id: candidate.id, ...result });
    else queued.push({ id: candidate.id, ...result });
  }
  return {
    ok: failed.length === 0,
    ...(failed.length ? { error: 'newsletter_sweep_failed' } : {}),
    queued,
    failed,
    drained: [],
  };
}
