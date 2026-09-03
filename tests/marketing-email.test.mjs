import assert from 'node:assert/strict';
import test from 'node:test';
import { queueMarketingEmail } from '../functions/_lib/marketing-email.js';

test('marketing automation fails closed until SES is configured', async () => {
  let calls = 0;
  const result = await queueMarketingEmail({}, {
    category: 'offer', email: 'a@b.co', subject: 'Offer', html: '<p>Offer</p>',
    idempotencyKey: 'offer/test/a@b.co',
    suppressionLoader: async () => new Map(),
    fetchImpl: async () => { calls += 1; },
  });
  assert.deepEqual(result, {
    ok: false, queued: false, provider: 'ses', retryable: false, error: 'ses_not_configured',
  });
  assert.equal(calls, 0);
});

test('configured marketing automation sends one truthful SES message', async () => {
  let request;
  const result = await queueMarketingEmail({
    AWS_SES_ACCESS_KEY_ID: 'AKIA_TEST',
    AWS_SES_SECRET_ACCESS_KEY: 'secret',
    EMAIL_UNSUB_SECRET: 'unsub-secret',
  }, {
    category: 'offer',
    email: 'A@B.CO',
    subject: 'Field offer',
    html: '<p>Offer</p><!--WEB_VIEW_START--><a href="{{web_view_url}}">View in browser</a><!--WEB_VIEW_END--><a href="{{unsubscribe_url}}">Unsubscribe</a>',
    text: 'Offer\nUnsubscribe: {{unsubscribe_url}}',
    idempotencyKey: 'offer/42/a@b.co',
    properties: { cta_url: 'https://masest.co/products.html' },
    signer: fakeSigner([]),
    suppressionLoader: async () => new Map(),
    fetchImpl: async (req) => {
      request = { url: req.url, body: JSON.parse(await req.text()) };
      return Response.json({ MessageId: 'ses-message' });
    },
  });
  assert.deepEqual(result, {
    ok: true, queued: true, provider: 'ses', status: 200, providerMessageId: 'ses-message',
  });
  assert.match(request.url, /email\.us-east-1\.amazonaws\.com/);
  assert.deepEqual(request.body.Destination.ToAddresses, ['a@b.co']);
  assert.equal(request.body.Content.Simple.Subject.Data, 'Field offer');
  assert.doesNotMatch(request.body.Content.Simple.Body.Html.Data, /View in browser/);
});

test('transactional categories cannot enter SES marketing automation', async () => {
  const result = await queueMarketingEmail({}, {
    category: 'order', email: 'a@b.co', subject: 'Order', html: '<p>Order</p>',
    suppressionLoader: async () => new Map(),
  });
  assert.equal(result.error, 'marketing_category_required');
});

test('marketing automation requires stable provider idempotency', async () => {
  const result = await queueMarketingEmail({
    AWS_SES_ACCESS_KEY_ID: 'AKIA_TEST',
    AWS_SES_SECRET_ACCESS_KEY: 'secret',
    EMAIL_UNSUB_SECRET: 'unsub-secret',
  }, {
    category: 'offer', email: 'a@b.co', subject: 'Offer', html: '<p>Offer</p>',
    suppressionLoader: async () => new Map(),
  });
  assert.equal(result.error, 'marketing_idempotency_key_required');
});

function fakeSigner(calls) {
  return {
    async sign(url, init) {
      calls.push({ url, init });
      return new Request(url, init);
    },
  };
}
