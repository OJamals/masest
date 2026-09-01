import { deliverSupportMessageEmail } from './support-email.js';
import { appendSupportMessage } from './support-messages.js';

const EMAIL_DELIVERY_FAILURE = {
  ok: false,
  retryable: true,
  error: 'support_email_delivery_failed',
};

export async function publishSupportMessage(env, sb, input, dependencies = {}) {
  const append = dependencies.append || appendSupportMessage;
  const deliver = dependencies.deliver || deliverSupportMessageEmail;
  const message = await append(sb, input);

  let emailDelivery;
  try {
    emailDelivery = await deliver(env, sb, message);
  } catch {
    emailDelivery = EMAIL_DELIVERY_FAILURE;
  }

  return { message, emailDelivery };
}
