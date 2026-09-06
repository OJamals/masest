import { appendSupportMessage } from './support-messages.js';

export async function publishSupportMessage(env, sb, input, dependencies = {}) {
  const append = dependencies.append || appendSupportMessage;
  if (typeof sb?.rpc === 'function') {
    const { error } = await sb.rpc('assert_email_effects_ready');
    if (error) {
      const failure = new Error('durable_email_effects_not_ready');
      failure.code = 'durable_email_effects_not_ready';
      throw failure;
    }
  }
  const message = await append(sb, input);

  return { message, emailDelivery: { ok: true, queued: true } };
}
