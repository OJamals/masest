import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalSnsMessage,
  normalizeSesNotification,
  snsCertificateUrl,
  verifySnsEnvelope,
} from '../workers/marketing-email/src/sns.js';
import { createSesSnsHandler } from '../workers/marketing-email/src/index.js';

const TOPIC = 'arn:aws:sns:us-east-1:791359098991:masest-ses-events';
const BASE = {
  Type: 'Notification',
  MessageId: '11111111-2222-3333-4444-555555555555',
  TopicArn: TOPIC,
  Subject: 'Amazon SES Email Event Notification',
  Message: '{"eventType":"Delivery"}',
  Timestamp: '2026-09-03T12:00:00.000Z',
  SignatureVersion: '2',
  Signature: Buffer.from('signature').toString('base64'),
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem',
};

test('SNS canonical string follows AWS field order and preserves final newline', () => {
  assert.equal(canonicalSnsMessage(BASE), [
    'Message', BASE.Message,
    'MessageId', BASE.MessageId,
    'Subject', BASE.Subject,
    'Timestamp', BASE.Timestamp,
    'TopicArn', BASE.TopicArn,
    'Type', BASE.Type,
    '',
  ].join('\n'));
});

test('SNS canonical string preserves whitespace inside signed SES message values', () => {
  const message = `${BASE.Message}\n`;
  assert.equal(canonicalSnsMessage({ ...BASE, Message: message }), [
    'Message', message,
    'MessageId', BASE.MessageId,
    'Subject', BASE.Subject,
    'Timestamp', BASE.Timestamp,
    'TopicArn', BASE.TopicArn,
    'Type', BASE.Type,
    '',
  ].join('\n'));
});

test('SNS certificate and confirmation URLs reject SSRF variants', () => {
  assert.equal(snsCertificateUrl(BASE.SigningCertURL, 'us-east-1').hostname, 'sns.us-east-1.amazonaws.com');
  for (const url of [
    'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem',
    'https://sns.us-east-1.amazonaws.com.evil.test/SimpleNotificationService-test.pem',
    'https://sns.us-east-1.amazonaws.com/other.pem',
    'https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-test.pem',
  ]) assert.throws(() => snsCertificateUrl(url, 'us-east-1'), /invalid_sns_certificate_url/);
});

test('SNS envelope requires exact topic + SignatureVersion 2 before certificate fetch', async () => {
  let fetched = 0;
  let redirect;
  const deps = {
    fetchImpl: async (_url, init) => {
      fetched += 1;
      redirect = init?.redirect;
      return new Response('-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----');
    },
    verifyImpl: async () => true,
  };
  await assert.rejects(
    verifySnsEnvelope({ ...BASE, TopicArn: `${TOPIC}-evil` }, { SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1' }, deps),
    /invalid_sns_topic/,
  );
  assert.equal(fetched, 0);
  await assert.rejects(
    verifySnsEnvelope({ ...BASE, SignatureVersion: '1' }, { SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1' }, deps),
    /invalid_sns_signature_version/,
  );
  assert.equal(fetched, 0);
  assert.equal(await verifySnsEnvelope(BASE, {
    SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1',
  }, deps), true);
  assert.equal(redirect, 'manual');
});

function sesMessage(eventType, detail = {}, destination = ['buyer@example.com']) {
  return {
    eventType,
    mail: { messageId: 'ses-message-1', destination, timestamp: '2026-09-03T12:00:00.000Z' },
    ...detail,
  };
}

test('SES delivery events normalize into provider-neutral lifecycle records', () => {
  const envelope = { ...BASE, MessageId: 'sns-event-1' };
  const [delivery] = normalizeSesNotification(envelope, sesMessage('Delivery', {
    delivery: { timestamp: '2026-09-03T12:01:00.000Z', recipients: ['buyer@example.com'] },
  }));
  assert.deepEqual(delivery, {
    kind: 'lifecycle',
    eventId: 'ses:sns-event-1:0',
    providerMessageId: 'ses-message-1',
    recipient: 'buyer@example.com',
    status: 'delivered',
    terminal: true,
    occurredAt: '2026-09-03T12:01:00.000Z',
    suppressionReason: null,
  });

  const [bounce] = normalizeSesNotification(envelope, sesMessage('Bounce', {
    bounce: {
      bounceType: 'Permanent', timestamp: '2026-09-03T12:02:00.000Z',
      bouncedRecipients: [{ emailAddress: 'BOUNCE@example.com' }],
    },
  }));
  assert.equal(bounce.status, 'bounced');
  assert.equal(bounce.suppressionReason, 'bounce');

  const [transient] = normalizeSesNotification(envelope, sesMessage('Bounce', {
    bounce: {
      bounceType: 'Transient', timestamp: '2026-09-03T12:02:00.000Z',
      bouncedRecipients: [{ emailAddress: 'retry@example.com' }],
    },
  }));
  assert.equal(transient.status, 'failed');
  assert.equal(transient.suppressionReason, null);

  const [complaint] = normalizeSesNotification(envelope, sesMessage('Complaint', {
    complaint: {
      timestamp: '2026-09-03T12:03:00.000Z',
      complainedRecipients: [{ emailAddress: 'complaint@example.com' }],
    },
  }));
  assert.equal(complaint.status, 'complained');
  assert.equal(complaint.suppressionReason, 'complaint');
});

test('SES Subscription events become canonical consent updates', () => {
  const message = sesMessage('Subscription', {
    subscription: {
      timestamp: '2026-09-03T12:04:00.000Z',
      contactList: 'masest-marketing',
      source: 'UnsubscribeHeader',
      newTopicPreferences: {
        unsubscribeAll: false,
        topicSubscriptionStatus: [{ topicName: 'marketing', subscriptionStatus: 'OptOut' }],
      },
      oldTopicPreferences: {
        unsubscribeAll: false,
        topicSubscriptionStatus: [{ topicName: 'marketing', subscriptionStatus: 'OptIn' }],
      },
    },
  });
  const [event] = normalizeSesNotification(
    { ...BASE, MessageId: 'sns-subscription-1' },
    message,
    { contactListName: 'masest-marketing', topicName: 'marketing' },
  );
  assert.deepEqual(event, {
    kind: 'subscription',
    eventId: 'ses:sns-subscription-1:0',
    recipient: 'buyer@example.com',
    enabled: false,
    occurredAt: '2026-09-03T12:04:00.000Z',
    source: 'ses_subscription',
  });

  message.subscription.newTopicPreferences = {
    unsubscribeAll: true,
    topicSubscriptionStatus: [{ topicName: 'marketing', subscriptionStatus: 'OptIn' }],
  };
  assert.equal(normalizeSesNotification(
    { ...BASE, MessageId: 'sns-subscription-2' }, message,
    { contactListName: 'masest-marketing', topicName: 'marketing' },
  )[0].enabled, false);
});

test('SES Subscription parser rejects wrong list, missing topic, and ambiguous topic state', () => {
  const baseMessage = sesMessage('Subscription', {
    subscription: {
      timestamp: '2026-09-03T12:04:00.000Z',
      contactList: 'other-list',
      newTopicPreferences: {
        unsubscribeAll: false,
        topicSubscriptionStatus: [{ topicName: 'marketing', subscriptionStatus: 'OptIn' }],
      },
    },
  });
  const config = { contactListName: 'masest-marketing', topicName: 'marketing' };
  assert.throws(() => normalizeSesNotification(BASE, baseMessage, config), /invalid_ses_subscription_list/);

  baseMessage.subscription.contactList = 'masest-marketing';
  baseMessage.subscription.newTopicPreferences.topicSubscriptionStatus = [];
  assert.throws(() => normalizeSesNotification(BASE, baseMessage, config), /invalid_ses_subscription_preferences/);

  baseMessage.subscription.newTopicPreferences.topicSubscriptionStatus = [
    { topicName: 'marketing', subscriptionStatus: 'OptIn' },
    { topicName: 'marketing', subscriptionStatus: 'OptOut' },
  ];
  assert.throws(() => normalizeSesNotification(BASE, baseMessage, config), /invalid_ses_subscription_preferences/);
});

test('SNS HTTP handler ACKs only after verified lifecycle persistence', async () => {
  const applied = [];
  const handler = createSesSnsHandler({
    verifyEnvelope: async () => true,
    applyLifecycle: async (_env, event) => applied.push(event),
  });
  const envelope = {
    ...BASE,
    Message: JSON.stringify(sesMessage('Delivery', {
      delivery: { timestamp: '2026-09-03T12:01:00.000Z', recipients: ['buyer@example.com'] },
    })),
  };
  const response = await handler(new Request('https://worker.test/v1/ses/events', {
    method: 'POST',
    body: JSON.stringify(envelope),
  }), { SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, processed: 1 });
  assert.equal(applied.length, 1);
  assert.equal(applied[0].status, 'delivered');
});

test('SNS HTTP handler passes exact configured SES contact list and topic', async () => {
  let receivedConfig;
  const handler = createSesSnsHandler({
    verifyEnvelope: async () => true,
    normalizeNotification: (_envelope, _message, config) => {
      receivedConfig = config;
      return [];
    },
  });
  const response = await handler(new Request('https://worker.test/v1/ses/events', {
    method: 'POST', body: JSON.stringify(BASE),
  }), {
    SES_SNS_TOPIC_ARN: TOPIC,
    AWS_SES_REGION: 'us-east-1',
    AWS_SES_CONTACT_LIST: 'masest-marketing',
    AWS_SES_CONTACT_TOPIC: 'marketing',
  });
  assert.equal(response.status, 200);
  assert.deepEqual(receivedConfig, {
    contactListName: 'masest-marketing',
    topicName: 'marketing',
  });
});

test('SNS subscription confirmation rejects redirects using Worker-compatible manual mode', async () => {
  let redirect;
  const handler = createSesSnsHandler({
    verifyEnvelope: async () => true,
    fetchImpl: async (_url, init) => {
      redirect = init?.redirect;
      return new Response('<ConfirmSubscriptionResponse/>', { status: 200 });
    },
  });
  const response = await handler(new Request('https://worker.test/v1/ses/events', {
    method: 'POST',
    body: JSON.stringify({
      ...BASE,
      Type: 'SubscriptionConfirmation',
      SubscribeURL: `https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=${encodeURIComponent(TOPIC)}&Token=test-token`,
    }),
  }), { SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1' });
  assert.equal(response.status, 200);
  assert.equal(redirect, 'manual');
});

test('SNS HTTP handler returns retryable failure when durable persistence fails', async () => {
  const handler = createSesSnsHandler({
    verifyEnvelope: async () => true,
    applyLifecycle: async () => { throw new Error('db_down'); },
  });
  const envelope = {
    ...BASE,
    Message: JSON.stringify(sesMessage('Delivery', {
      delivery: { timestamp: '2026-09-03T12:01:00.000Z', recipients: ['buyer@example.com'] },
    })),
  };
  const response = await handler(new Request('https://worker.test/v1/ses/events', {
    method: 'POST',
    body: JSON.stringify(envelope),
  }), { SES_SNS_TOPIC_ARN: TOPIC, AWS_SES_REGION: 'us-east-1' });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'db_down' });
});

test('SNS HTTP handler stops reading oversized chunked bodies at the byte limit', async () => {
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls += 1;
      if (pulls <= 3) controller.enqueue(new Uint8Array(200 * 1024));
      else controller.close();
    },
  });
  const response = await createSesSnsHandler()(new Request('https://worker.test/v1/ses/events', {
    method: 'POST',
    body,
    duplex: 'half',
  }), {});
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'sns_body_too_large' });
  assert.equal(pulls, 2);
});
