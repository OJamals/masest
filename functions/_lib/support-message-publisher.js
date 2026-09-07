import { appendSupportMessage } from './support-messages.js';
import {
  attemptSupportMessageDelivery,
  createSupportDeliveryWorkerId,
} from './support-delivery.js';

const EMAIL_DELIVERY_FAILURE = {
  state: 'dead',
  effect_id: null,
  reason: 'support_delivery_status_unavailable',
};

export async function publishSupportMessage(env, sb, input, dependencies = {}) {
  const append = dependencies.append || appendSupportMessage;
  const attemptDelivery = dependencies.attemptDelivery || attemptSupportMessageDelivery;
  const createWorkerId = dependencies.createWorkerId || createSupportDeliveryWorkerId;
  if (typeof sb?.rpc === 'function') {
    const { error } = await sb.rpc('assert_email_effects_ready');
    if (error) {
      const failure = new Error('durable_email_effects_not_ready');
      failure.code = 'durable_email_effects_not_ready';
      throw failure;
    }
  }
  const message = await append(sb, input);

  let emailDelivery;
  try {
    emailDelivery = await attemptDelivery({
      env,
      sb,
      message,
      workerId: createWorkerId(input?.source || 'message'),
    });
  } catch {
    emailDelivery = EMAIL_DELIVERY_FAILURE;
  }

  return { message, emailDelivery };
}
