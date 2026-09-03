import { materializeDeliverySource, runSupabaseDeliveryWorker } from './newsletter-delivery.js';
import { setMarketingPreference } from './marketing-subscribers.js';
import { renderAllNurtureFlowEmails } from './scrolly-marketing-emails.js';

export const NURTURE_DELAY_DAYS = Object.freeze([0, 3, 8]);

const clean = (value, max) => String(value || '').trim().slice(0, max);

export async function enrollMarketingNurture(env, sb, {
  email,
  quoteId,
  name = '',
  industry = '',
  consented = false,
} = {}, {
  now = () => Date.now(),
  setPreference = setMarketingPreference,
  materialize = materializeDeliverySource,
  runWorker = runSupabaseDeliveryWorker,
} = {}) {
  if (!consented) return { ok: true, skipped: 'consent_required', queued: 0 };
  const normalizedEmail = clean(email, 320).toLowerCase();
  const parentId = clean(quoteId, 120);
  if (!normalizedEmail || !parentId) {
    return { ok: false, provider: 'ses', queued: 0, retryable: false, error: 'nurture_identity_required' };
  }

  const preference = await setPreference(env, {
    email: normalizedEmail,
    enabled: true,
    source: 'quote_marketing_consent',
    name: clean(name, 120) || null,
    tags: [clean(industry, 40)].filter(Boolean),
  }, { sb });
  if (!preference?.ok) {
    return {
      ok: false,
      provider: 'ses',
      queued: 0,
      retryable: preference?.retryable === true,
      error: preference?.error || 'marketing_preference_write_failed',
    };
  }

  const startedAt = now();
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

  let started = 0;
  try {
    started = (await runWorker(env, sb, { sourceType: 'nurture' })).claimed || 0;
  } catch {
    // Durable rows remain claimable by hourly sweep.
  }
  return { ok: true, provider: 'ses', queued, started };
}
