import { adminClient } from '../../../functions/_lib/supabase.js';
import {
  enqueueMarketingConsentSync,
  enqueueMarketingDelivery,
  enqueueMarketingSweep,
  normalizeMarketingDeliveryJob,
} from '../../../functions/_lib/marketing-delivery-queue.js';
import { runSupabaseDeliveryWorker } from '../../../functions/_lib/newsletter-delivery.js';
import { syncSesMarketingContact } from '../../../functions/_lib/ses-email.js';

const RETRY_DELAY_SECONDS = 60;
const CONTINUATION_DELAY_SECONDS = 1;

export async function runMarketingConsentSync(env, sb, {
  syncContact = syncSesMarketingContact,
  workerId = crypto.randomUUID(),
} = {}) {
  const { data, error } = await sb.rpc('claim_marketing_consent_sync_events', {
    p_worker_id: workerId,
    p_limit: 1,
    p_lease_seconds: 120,
  });
  if (error) throw new Error('marketing_consent_sync_claim_failed');
  const events = Array.isArray(data) ? data : [];
  let synced = 0;
  let failed = 0;
  for (const event of events) {
    const result = await syncContact(env, {
      email: event.recipient,
      enabled: event.enabled,
    });
    const finished = await sb.rpc('finish_marketing_consent_sync_event', {
      p_event_id: event.event_id,
      p_worker_id: workerId,
      p_success: result.ok,
      p_retryable: Boolean(result.retryable),
      p_error: result.ok ? null : String(result.error || 'ses_contact_sync_failed').slice(0, 500),
    });
    if (finished.error || !finished.data) throw new Error('marketing_consent_sync_finish_failed');
    if (result.ok) synced += 1;
    else failed += 1;
  }
  return { claimed: events.length, synced, failed };
}

export async function consumeMarketingDeliveryBatch(batch, env, {
  runWorker = runSupabaseDeliveryWorker,
  createClient = adminClient,
  enqueue = enqueueMarketingDelivery,
  enqueueSweep = enqueueMarketingSweep,
  enqueueConsent = enqueueMarketingConsentSync,
  runConsentSync = runMarketingConsentSync,
} = {}) {
  const sb = createClient(env);
  for (const message of batch?.messages || []) {
    let job;
    try {
      job = normalizeMarketingDeliveryJob(message.body);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'marketing_queue_poison_message',
        error: String(error?.code || error?.message || 'invalid_marketing_delivery_job'),
      }));
      message.ack();
      continue;
    }

    try {
      if (job.kind === 'marketing_consent.sync') {
        const result = await runConsentSync(env, sb);
        if (result.claimed > 0) {
          const continuation = await enqueueConsent(env, { delaySeconds: CONTINUATION_DELAY_SECONDS });
          if (!continuation.ok) throw new Error(continuation.error || 'marketing_queue_enqueue_failed');
        }
        message.ack();
        continue;
      }
      if (job.kind === 'marketing_delivery.sweep') {
        const result = await runWorker(env, sb, {
          sourceType: null,
          sourceId: null,
          limit: 1,
          concurrency: 1,
        });
        if (result.claimed > 0) {
          const continuation = await enqueueSweep(env, { delaySeconds: CONTINUATION_DELAY_SECONDS });
          if (!continuation.ok) throw new Error(continuation.error || 'marketing_queue_enqueue_failed');
        }
        message.ack();
        continue;
      }
      const result = await runWorker(env, sb, {
        sourceType: job.sourceType,
        sourceId: job.sourceId || null,
        limit: 1,
        concurrency: 1,
      });
      if (result.claimed > 0) {
        const continuation = await enqueue(env, {
          sourceType: job.sourceType,
          ...(job.sourceId ? { sourceId: job.sourceId } : {}),
        }, { delaySeconds: CONTINUATION_DELAY_SECONDS });
        if (!continuation.ok) throw new Error(continuation.error || 'marketing_queue_enqueue_failed');
      }
      message.ack();
    } catch (error) {
      console.error(JSON.stringify({
        event: 'marketing_queue_delivery_failed',
        kind: job.kind,
        ...(job.sourceType ? { source_type: job.sourceType } : {}),
        error: String(error?.message || error).slice(0, 200),
      }));
      if (error?.deliverySourceType && error?.deliverySourceId) {
        try {
          const recovery = await enqueue(env, {
            sourceType: error.deliverySourceType,
            sourceId: error.deliverySourceId,
          }, { delaySeconds: RETRY_DELAY_SECONDS });
          if (recovery.ok) {
            message.ack();
            continue;
          }
        } catch {
          // Fall through to native Queue retry when recovery enqueue is unavailable.
        }
      }
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS });
    }
  }
}

export async function scheduleMarketingDeliveryWork(env, {
  enqueueSweep = enqueueMarketingSweep,
  enqueueConsent = enqueueMarketingConsentSync,
} = {}) {
  const consent = await enqueueConsent(env);
  if (!consent.ok) throw new Error(consent.error || 'marketing_queue_enqueue_failed');
  const delivery = await enqueueSweep(env);
  if (!delivery.ok) throw new Error(delivery.error || 'marketing_queue_enqueue_failed');
  return ['all'];
}
