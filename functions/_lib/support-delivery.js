import { processClaimedIntegrationEffect } from './integration-effects.js';

const LEASE_SECONDS = 60;

function safeReason(value, fallback) {
  const reason = String(value || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '_')
    .slice(0, 80);
  return reason || fallback;
}

async function claimEffect(sb, { messageId, workerId, leaseSeconds }) {
  const { data, error } = await sb.rpc('claim_support_message_email_effect', {
    p_message_id: messageId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new Error('support_delivery_claim_failed');
  return data;
}

function completedState(effect) {
  const result = effect?.provider_result || {};
  if (result.skipped) {
    return {
      state: 'skipped',
      effect_id: effect.id,
      reason: safeReason(result.skipped, 'support_email_not_required'),
    };
  }
  if (result.provider_message_id || result.delivery_state === 'delivered') {
    return { state: 'delivered', effect_id: effect.id };
  }
  return {
    state: 'dead',
    effect_id: effect?.id || null,
    reason: 'support_delivery_result_missing',
  };
}

export function createSupportDeliveryWorkerId(source = 'request') {
  const label = String(source || 'request').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32) || 'request';
  return `support-immediate/${label}/${crypto.randomUUID()}`;
}

export async function attemptSupportMessageDelivery({
  env,
  sb,
  message,
  workerId,
}, dependencies = {}) {
  if (!message?.id || !workerId) {
    return { state: 'dead', effect_id: null, reason: 'support_delivery_identity_missing' };
  }
  let claimed;
  try {
    claimed = await (dependencies.claimEffect || claimEffect)(sb, {
      messageId: message.id,
      workerId,
      leaseSeconds: LEASE_SECONDS,
    });
  } catch {
    return { state: 'dead', effect_id: null, reason: 'support_delivery_status_unavailable' };
  }
  const effect = claimed?.effect || null;
  switch (claimed?.state) {
    case 'claimed': {
      let result;
      try {
        result = await (dependencies.processEffect || processClaimedIntegrationEffect)({
          env,
          sb,
          effect,
          workerId,
        });
      } catch {
        return {
          state: 'dead',
          effect_id: effect?.id || null,
          reason: 'support_delivery_status_unavailable',
        };
      }
      return {
        state: result?.state || 'queued',
        effect_id: result?.effectId || effect?.id || null,
        ...(result?.reason ? { reason: safeReason(result.reason, 'support_delivery_failed') } : {}),
      };
    }
    case 'processing':
    case 'pending':
    case 'retry':
      return effect?.id
        ? { state: 'queued', effect_id: effect.id }
        : { state: 'dead', effect_id: null, reason: 'support_delivery_status_unavailable' };
    case 'completed':
      return completedState(effect);
    case 'dead':
      return {
        state: 'dead',
        effect_id: effect?.id || null,
        reason: safeReason(effect?.last_error_code, 'support_delivery_dead'),
      };
    case 'legacy':
      return { state: 'dead', effect_id: null, reason: 'legacy_delivery_effect_missing' };
    default:
      return { state: 'dead', effect_id: effect?.id || null, reason: 'support_delivery_status_unavailable' };
  }
}
