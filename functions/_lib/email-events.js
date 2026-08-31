import { adminClient } from './supabase.js';

const EVENT_STATUS = new Map([
  ['cf.email.sending.message.delivered', 'delivered'],
  ['cf.email.sending.message.deferred', 'deferred'],
  ['cf.email.sending.message.bounced', 'bounced'],
  ['cf.email.sending.message.failed', 'failed'],
  ['cf.email.sending.message.rejected', 'rejected'],
  ['cf.email.sending.message.complained', 'complained'],
]);
const EMAIL_RE = /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/;

function fail(code) {
  throw new Error(code);
}

export function normalizeEmailLifecycleEvent(input, expectedDomain = 'send.masest.co') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid_email_event');
  if (input.source?.type !== 'email.sending') fail('invalid_email_event_source');
  if (String(input.source?.domain || '').toLowerCase() !== expectedDomain) fail('invalid_email_event_domain');
  const status = EVENT_STATUS.get(String(input.type || ''));
  if (!status) fail('invalid_email_event_type');
  const eventId = String(input.payload?.eventId || '').trim();
  const providerMessageId = String(input.payload?.messageId || '').trim();
  const recipient = String(input.payload?.recipient || '').trim().toLowerCase();
  if (!eventId || eventId.length > 160) fail('invalid_email_event_id');
  if (!providerMessageId || providerMessageId.length > 512) fail('invalid_email_message_id');
  if (!EMAIL_RE.test(recipient) || recipient.length > 254) fail('invalid_email_event_recipient');
  const occurred = new Date(String(input.metadata?.eventTimestamp || ''));
  if (!Number.isFinite(occurred.getTime())) fail('invalid_email_event_time');
  return {
    eventId,
    providerMessageId,
    recipient,
    status,
    terminal: input.payload?.terminal === true,
    occurredAt: occurred.toISOString(),
    suppressionReason: status === 'bounced' ? 'bounce'
      : status === 'complained' ? 'complaint' : null,
  };
}

export async function applyEmailLifecycleEvent(env, event) {
  const { data, error } = await adminClient(env).rpc('apply_email_delivery_event', {
    p_event_id: event.eventId,
    p_provider_message_id: event.providerMessageId,
    p_recipient: event.recipient,
    p_status: event.status,
    p_terminal: event.terminal,
    p_occurred_at: event.occurredAt,
    p_suppression_reason: event.suppressionReason,
  });
  if (error) throw error;
  return data;
}
