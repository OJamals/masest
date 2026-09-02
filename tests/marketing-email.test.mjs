import assert from 'node:assert/strict';
import test from 'node:test';
import { queueMarketingEmail } from '../functions/_lib/marketing-email.js';

test('marketing automation fails closed until matching Klaviyo flow metric is configured', async () => {
  let calls = 0;
  const result = await queueMarketingEmail({ KLAVIYO_PRIVATE_KEY: 'k' }, {
    category: 'offer', email: 'a@b.co', subject: 'Offer', html: '<p>Offer</p>',
    fetchImpl: async () => { calls += 1; },
  });
  assert.deepEqual(result, {
    ok: false, queued: false, provider: 'klaviyo', retryable: false, error: 'marketing_flow_not_configured',
  });
  assert.equal(calls, 0);
});

test('configured marketing automation queues a truthful Klaviyo event', async () => {
  let request;
  const result = await queueMarketingEmail({
    KLAVIYO_PRIVATE_KEY: 'k',
    KLAVIYO_FLOW_METRIC_OFFER: 'MASEST Offer Email',
  }, {
    category: 'offer',
    email: 'A@B.CO',
    subject: 'Field offer',
    html: '<p>Offer</p>',
    text: 'Offer',
    idempotencyKey: 'offer/42/a@b.co',
    properties: { cta_url: 'https://masest.co/products.html' },
    fetchImpl: async (url, init) => {
      request = { url: String(url), body: JSON.parse(init.body) };
      return new Response(null, { status: 202 });
    },
  });
  assert.deepEqual(result, {
    ok: true, queued: true, provider: 'klaviyo', status: 202, metric: 'MASEST Offer Email',
  });
  assert.match(request.url, /\/api\/events/);
  assert.equal(request.body.data.attributes.profile.data.attributes.email, 'a@b.co');
  assert.equal(request.body.data.attributes.properties.message_subject, 'Field offer');
  assert.equal(request.body.data.attributes.properties.message_html, '<p>Offer</p>');
  assert.equal(request.body.data.attributes.properties.idempotency_key, 'offer/42/a@b.co');
  assert.equal(request.body.data.attributes.unique_id, 'offer/42/a@b.co');
});

test('transactional categories cannot enter Klaviyo marketing automation', async () => {
  const result = await queueMarketingEmail({ KLAVIYO_PRIVATE_KEY: 'k' }, {
    category: 'order', email: 'a@b.co', subject: 'Order', html: '<p>Order</p>',
  });
  assert.equal(result.error, 'marketing_category_required');
});

test('marketing automation requires stable provider idempotency', async () => {
  const result = await queueMarketingEmail({
    KLAVIYO_PRIVATE_KEY: 'k',
    KLAVIYO_FLOW_METRIC_OFFER: 'MASEST Offer Email',
  }, {
    category: 'offer', email: 'a@b.co', subject: 'Offer', html: '<p>Offer</p>',
  });
  assert.equal(result.error, 'marketing_idempotency_key_required');
});
