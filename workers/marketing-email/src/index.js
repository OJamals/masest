import { adminClient } from '../../../functions/_lib/supabase.js';
import { recordAutomationRun } from '../../../functions/_lib/automation-runs.js';
import { applyEmailLifecycleEvent } from '../../../functions/_lib/email-events.js';
import { sweepNewsletterPreparation } from '../../../functions/_lib/newsletter-preparation.js';
import { syncSesSuppressions } from '../../../functions/_lib/ses-email.js';
import { createEmailOctopusWebhook, runEmailOctopusSync } from './emailoctopus.js';
import {
  consumeMarketingDeliveryBatch,
  scheduleMarketingDeliveryWork,
} from './core.js';
import {
  normalizeSesNotification,
  snsConfirmationUrl,
  verifySnsEnvelope,
} from './sns.js';

const SNS_BODY_MAX_BYTES = 300 * 1024;

function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function readSnsEnvelope(request) {
  const declared = Number(request.headers.get('content-length')) || 0;
  if (declared > SNS_BODY_MAX_BYTES) throw Object.assign(new Error('sns_body_too_large'), { status: 413 });
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let received = 0;
  try {
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > SNS_BODY_MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw Object.assign(new Error('sns_body_too_large'), { status: 413 });
      }
      raw += decoder.decode(chunk.value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    reader?.releaseLock();
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('invalid_sns_json'), { status: 400 });
  }
}

async function applySubscriptionEvent(env, event) {
  const { data, error } = await adminClient(env).rpc('apply_ses_subscription_event', {
    p_event_id: event.eventId,
    p_recipient: event.recipient,
    p_enabled: event.enabled,
    p_occurred_at: event.occurredAt,
    p_source: event.source,
  });
  if (error) throw error;
  return data;
}

export function createSesSnsHandler({
  verifyEnvelope = verifySnsEnvelope,
  normalizeNotification = normalizeSesNotification,
  applyLifecycle = applyEmailLifecycleEvent,
  applySubscription = applySubscriptionEvent,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function handleSesSns(request, env) {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    let envelope;
    try {
      envelope = await readSnsEnvelope(request);
      await verifyEnvelope(envelope, env, { fetchImpl });
      if (envelope.Type === 'SubscriptionConfirmation') {
        const url = snsConfirmationUrl(
          envelope.SubscribeURL,
          env.SES_SNS_TOPIC_ARN,
          env.AWS_SES_REGION || 'us-east-1',
        );
        const response = await fetchImpl(url, { redirect: 'manual' });
        if (!response.ok) throw new Error('sns_confirmation_failed');
        return json(200, { ok: true, confirmed: true });
      }
      if (envelope.Type !== 'Notification') throw new Error('unsupported_sns_type');
      const message = JSON.parse(envelope.Message);
      const events = normalizeNotification(envelope, message, {
        contactListName: env.AWS_SES_CONTACT_LIST || 'masest-marketing',
        topicName: env.AWS_SES_CONTACT_TOPIC || 'marketing',
      });
      for (const event of events) {
        if (event.kind === 'subscription') await applySubscription(env, event);
        else await applyLifecycle(env, event);
      }
      return json(200, { ok: true, processed: events.length });
    } catch (error) {
      const code = String(error?.code || error?.message || 'sns_event_failed');
      const clientError = code.startsWith('invalid_')
        || code.startsWith('unsupported_')
        || code.endsWith('_not_configured');
      console.error(JSON.stringify({ event: 'ses_sns_rejected', error: code.slice(0, 200) }));
      return json(Number(error?.status) || (clientError ? 401 : 503), { error: code });
    }
  };
}

const handleSesSns = createSesSnsHandler();
const handleEmailOctopusWebhook = createEmailOctopusWebhook();

export async function runMarketingProviders(controller, env, {
  runSes = runMarketingSchedule, runCompanion = runEmailOctopusSync,
} = {}) {
  const results = await Promise.allSettled([runSes(controller, env), runCompanion(env)]);
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    if (result.value?.ok === false) throw new Error('emailoctopus_sync_failed');
  }
}

export async function runMarketingSchedule(controller, env, {
  createClient = adminClient,
  syncSuppressions = syncSesSuppressions,
  schedule = scheduleMarketingDeliveryWork,
  sweep = sweepNewsletterPreparation,
  recordRun = recordAutomationRun,
} = {}) {
  if (controller?.cron === '0 */6 * * *') {
    const suppression = await syncSuppressions(env, createClient(env));
    if (!suppression.ok) throw new Error(suppression.error || 'ses_suppression_sync_failed');
    return { suppression, queued: [] };
  }
  const sb = createClient(env);
  let campaignSweep;
  let campaignError = null;
  try {
    campaignSweep = await recordRun(sb, 'newsletter_sweep', () => sweep(env, { createClient }));
    if (campaignSweep?.ok === false) {
      campaignError = new Error(campaignSweep.error || 'newsletter_sweep_failed');
    }
  } catch (error) {
    campaignError = error;
  }

  let queued;
  let deliveryError = null;
  try {
    queued = await schedule(env);
  } catch (error) {
    deliveryError = error;
  }
  if (deliveryError) throw deliveryError;
  if (campaignError) throw campaignError;
  return { suppression: null, campaignSweep, queued };
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/health' && request.method === 'GET') return json(200, { ok: true });
    if (path === '/v1/emailoctopus/events') return handleEmailOctopusWebhook(request, env);
    if (path !== '/v1/ses/events') return json(404, { error: 'not_found' });
    return handleSesSns(request, env);
  },

  async queue(batch, env) {
    await consumeMarketingDeliveryBatch(batch, env);
  },

  async scheduled(controller, env) {
    await runMarketingProviders(controller, env);
  },
};
