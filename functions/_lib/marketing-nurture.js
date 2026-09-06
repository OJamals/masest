import { materializeDeliverySource } from './newsletter-delivery.js';
import { enqueueMarketingDelivery } from './marketing-delivery-queue.js';
import { renderAllNurtureFlowEmails } from './scrolly-marketing-emails.js';

export const NURTURE_DELAY_DAYS = Object.freeze([0, 3, 8]);

const clean = (value, max) => String(value || '').trim().slice(0, max);

export async function enrollMarketingNurture(env, sb, {
  email,
  quoteId,
  consented = false,
  consentAt = null,
} = {}, {
  materialize = materializeDeliverySource,
  enqueue = enqueueMarketingDelivery,
} = {}) {
  if (!consented) return { ok: true, skipped: 'consent_required', queued: 0 };
  const normalizedEmail = clean(email, 320).toLowerCase();
  const parentId = clean(quoteId, 120);
  if (!normalizedEmail || !parentId) {
    return { ok: false, provider: 'ses', queued: 0, retryable: false, error: 'nurture_identity_required' };
  }

  if (typeof sb?.from === 'function') {
    const { data: currentRecipient, error: recipientError } = await sb.from('newsletter_recipients')
      .select('subscribed').eq('email', normalizedEmail).maybeSingle();
    if (recipientError) return { ok: false, provider: 'ses', queued: 0, retryable: true, error: 'marketing_preference_read_failed' };
    if (currentRecipient?.subscribed !== true) {
      return { ok: true, provider: 'ses', queued: 0, skipped: 'newer_unsubscribe' };
    }
  }

  const consentTimestamp = consentAt ? Date.parse(consentAt) : NaN;
  if (!Number.isFinite(consentTimestamp)) return { ok: false, provider: 'ses', queued: 0, retryable: false, error: 'nurture_consent_timestamp_required' };
  const startedAt = consentTimestamp;
  const emails = renderAllNurtureFlowEmails();
  let queued = 0;
  for (let index = 0; index < emails.length; index += 1) {
    const rendered = emails[index];
    const sourceId = `${parentId}:${rendered.id}`;
    const availableAt = new Date(startedAt + NURTURE_DELAY_DAYS[index] * 86400000).toISOString();
    const result = await materialize(sb, {
      sourceType: 'nurture',
      sourceId,
      parentId,
      subject: rendered.subject,
      html: rendered.html,
      category: 'lead_nurture',
      metadata: {
        available_at: availableAt,
        nurture_id: rendered.id,
        flow_slot: rendered.flowSlot,
      },
      emails: [normalizedEmail],
    });
    if (result?.error) {
      return { ok: false, provider: 'ses', queued, retryable: true, error: 'nurture_delivery_materialize_failed' };
    }
    queued += result?.created ? 1 : 0;
  }

  const wake = queued || emails.length ? await enqueue(env, { sourceType: 'nurture' }) : { ok: true };
  return {
    ok: wake.ok,
    provider: 'ses',
    queued,
    started: 0,
    ...(wake.ok ? {} : { retryable: wake.retryable, error: wake.error }),
  };
}
