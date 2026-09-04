import { verify as verifySignature, X509Certificate } from 'node:crypto';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const CERT_MAX_BYTES = 32 * 1024;
const SNS_TYPES = new Set(['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation']);
const certCache = new Map();

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function bounded(value, max, code) {
  const clean = String(value || '').trim();
  if (!clean || clean.length > max) fail(code);
  return clean;
}

function signedValue(value, max, code) {
  if (typeof value !== 'string' || !value.length || value.length > max) fail(code);
  return value;
}

export function snsCertificateUrl(value, region = 'us-east-1') {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail('invalid_sns_certificate_url');
  }
  const host = `sns.${String(region || '').toLowerCase()}.amazonaws.com`;
  if (url.protocol !== 'https:'
    || url.hostname !== host
    || url.port
    || url.username
    || url.password
    || url.search
    || url.hash
    || !/^\/SimpleNotificationService-[A-Za-z0-9_-]+\.pem$/.test(url.pathname)) {
    fail('invalid_sns_certificate_url');
  }
  return url;
}

export function snsConfirmationUrl(value, topicArn, region = 'us-east-1') {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    fail('invalid_sns_confirmation_url');
  }
  const host = `sns.${String(region || '').toLowerCase()}.amazonaws.com`;
  if (url.protocol !== 'https:'
    || url.hostname !== host
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.searchParams.get('Action') !== 'ConfirmSubscription'
    || url.searchParams.get('TopicArn') !== topicArn
    || !url.searchParams.get('Token')) {
    fail('invalid_sns_confirmation_url');
  }
  return url;
}

export function canonicalSnsMessage(envelope = {}) {
  if (!SNS_TYPES.has(envelope.Type)) fail('invalid_sns_type');
  const notification = envelope.Type === 'Notification';
  const required = notification
    ? ['Message', 'MessageId', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  if (required.some((field) => !Object.hasOwn(envelope, field))) fail('invalid_sns_envelope');
  const fields = notification
    ? ['Message', 'MessageId', 'Subject', 'SubscribeURL', 'Timestamp', 'TopicArn', 'Type']
    : ['Message', 'MessageId', 'Subject', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return fields
    .filter((field) => Object.hasOwn(envelope, field))
    .map((field) => `${field}\n${signedValue(envelope[field], field === 'Message' ? 262_144 : 4096, 'invalid_sns_envelope')}\n`)
    .join('');
}

function verifyWithCertificate(canonical, signature, certificatePem) {
  const certificate = new X509Certificate(certificatePem);
  const now = Date.now();
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) return false;
  return verifySignature(
    'RSA-SHA256',
    Buffer.from(canonical, 'utf8'),
    certificate.publicKey,
    Buffer.from(signature, 'base64'),
  );
}

async function certificatePem(url, fetchImpl) {
  const cached = certCache.get(url.href);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const response = await fetchImpl(url, { redirect: 'manual' });
  if (!response.ok) fail('sns_certificate_fetch_failed');
  const declared = Number(response.headers.get('content-length')) || 0;
  if (declared > CERT_MAX_BYTES) fail('sns_certificate_too_large');
  const value = await response.text();
  if (new TextEncoder().encode(value).byteLength > CERT_MAX_BYTES
    || !value.includes('-----BEGIN CERTIFICATE-----')) fail('invalid_sns_certificate');
  certCache.set(url.href, { value, expiresAt: Date.now() + 60 * 60 * 1000 });
  return value;
}

export async function verifySnsEnvelope(envelope, env, {
  fetchImpl = globalThis.fetch,
  verifyImpl = verifyWithCertificate,
} = {}) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) fail('invalid_sns_envelope');
  const topicArn = bounded(env?.SES_SNS_TOPIC_ARN, 512, 'sns_topic_not_configured');
  if (envelope.TopicArn !== topicArn) fail('invalid_sns_topic');
  if (envelope.SignatureVersion !== '2') fail('invalid_sns_signature_version');
  bounded(envelope.MessageId, 160, 'invalid_sns_message_id');
  if (!Number.isFinite(Date.parse(String(envelope.Timestamp || '')))) fail('invalid_sns_timestamp');
  const signature = bounded(envelope.Signature, 4096, 'invalid_sns_signature');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature)) fail('invalid_sns_signature');
  const region = String(env?.AWS_SES_REGION || 'us-east-1').trim().toLowerCase();
  const certUrl = snsCertificateUrl(envelope.SigningCertURL, region);
  const canonical = canonicalSnsMessage(envelope);
  const pem = await certificatePem(certUrl, fetchImpl);
  if (!await verifyImpl(canonical, signature, pem)) fail('invalid_sns_signature');
  return true;
}

function recipient(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) fail('invalid_ses_event_recipient');
  return email;
}

function occurredAt(value, fallback) {
  const date = new Date(String(value || fallback || ''));
  if (!Number.isFinite(date.getTime())) fail('invalid_ses_event_timestamp');
  return date.toISOString();
}

function recipientsFor(type, message) {
  if (type === 'Bounce') return (message.bounce?.bouncedRecipients || []).map((item) => item.emailAddress);
  if (type === 'Complaint') return (message.complaint?.complainedRecipients || []).map((item) => item.emailAddress);
  if (type === 'Delivery') return message.delivery?.recipients || message.mail?.destination || [];
  return message.mail?.destination || [];
}

function lifecycle(type, message) {
  if (type === 'Delivery') return ['delivered', true, null, message.delivery?.timestamp];
  if (type === 'DeliveryDelay') return ['deferred', false, null, message.deliveryDelay?.timestamp];
  if (type === 'Complaint') return ['complained', true, 'complaint', message.complaint?.timestamp];
  if (type === 'Bounce') {
    const permanent = String(message.bounce?.bounceType || '').toLowerCase() === 'permanent';
    return [permanent ? 'bounced' : 'failed', true, permanent ? 'bounce' : null, message.bounce?.timestamp];
  }
  if (type === 'Reject') return ['rejected', true, null, message.reject?.timestamp];
  if (type === 'Rendering Failure' || type === 'RenderingFailure') {
    return ['failed', true, null, message.failure?.timestamp];
  }
  if (type === 'Send') return ['sent', false, null, message.send?.timestamp];
  fail('unsupported_ses_event_type');
}

function preferenceStatus(item) {
  const status = String(item?.subscriptionStatus || item?.SubscriptionStatus || '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (status === 'OPTIN') return 'OPT_IN';
  if (status === 'OPTOUT') return 'OPT_OUT';
  return '';
}

export function normalizeSesNotification(envelope, message, {
  contactListName = 'masest-marketing',
  topicName = 'marketing',
} = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) fail('invalid_ses_notification');
  const eventType = String(message.eventType || message.notificationType || '').trim();
  const messageId = bounded(message.mail?.messageId, 512, 'invalid_ses_message_id');
  const snsMessageId = bounded(envelope?.MessageId, 120, 'invalid_sns_message_id');
  const addresses = recipientsFor(eventType, message).map(recipient);
  if (!addresses.length) fail('invalid_ses_event_recipient');

  if (eventType === 'Subscription') {
    const subscription = message.subscription;
    const expectedList = bounded(contactListName, 64, 'ses_contact_list_not_configured');
    const expectedTopic = bounded(topicName, 64, 'ses_contact_topic_not_configured');
    if (bounded(subscription?.contactList, 64, 'invalid_ses_subscription_list') !== expectedList) {
      fail('invalid_ses_subscription_list');
    }
    const preferences = subscription?.newTopicPreferences;
    if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)
      || typeof preferences.unsubscribeAll !== 'boolean') {
      fail('invalid_ses_subscription_preferences');
    }
    const topics = preferences.topicSubscriptionStatus;
    const matches = Array.isArray(topics)
      ? topics.filter((item) => String(item?.topicName || '') === expectedTopic)
      : [];
    if (!preferences.unsubscribeAll && matches.length !== 1) fail('invalid_ses_subscription_preferences');
    if (matches.length > 1) fail('invalid_ses_subscription_preferences');
    const status = matches.length === 1 ? preferenceStatus(matches[0]) : '';
    if (!preferences.unsubscribeAll && !status) fail('invalid_ses_subscription_preferences');
    const enabled = preferences.unsubscribeAll ? false : status === 'OPT_IN';
    const time = occurredAt(message.subscription?.timestamp, message.mail?.timestamp);
    return addresses.map((email, index) => ({
      kind: 'subscription',
      eventId: `ses:${snsMessageId}:${index}`,
      recipient: email,
      enabled,
      occurredAt: time,
      source: 'ses_subscription',
    }));
  }

  const [status, terminal, suppressionReason, timestamp] = lifecycle(eventType, message);
  const time = occurredAt(timestamp, message.mail?.timestamp);
  return addresses.map((email, index) => ({
    kind: 'lifecycle',
    eventId: `ses:${snsMessageId}:${index}`,
    providerMessageId: messageId,
    recipient: email,
    status,
    terminal,
    occurredAt: time,
    suppressionReason,
  }));
}
