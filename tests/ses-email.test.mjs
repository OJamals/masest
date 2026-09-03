import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listSesSuppressions,
  personalizeMarketingContent,
  marketingEmailViewUrl,
  sendSesMarketingEmail,
  sesMarketingConfigured,
  syncSesSuppressions,
} from '../functions/_lib/ses-email.js';
import { verifyEmailViewToken } from '../functions/_lib/email.js';

const ENV = {
  AWS_SES_ACCESS_KEY_ID: 'AKIA_TEST',
  AWS_SES_SECRET_ACCESS_KEY: 'secret-test-value',
  AWS_SES_REGION: 'us-east-1',
  AWS_SES_FROM_EMAIL: 'dev@masest.co',
  AWS_SES_FROM_NAME: 'MASEST · VertKleen',
  AWS_SES_REPLY_TO: 'dev@masest.co',
  AWS_SES_CONFIGURATION_SET: 'masest-marketing',
  EMAIL_UNSUB_SECRET: 'unsubscribe-secret',
};

function fakeSigner(calls) {
  return {
    async sign(url, init) {
      calls.push({ url: String(url), init });
      return new Request(url, init);
    },
  };
}

test('SES marketing config requires signing credentials plus unsubscribe secret', () => {
  assert.equal(sesMarketingConfigured(ENV), true);
  assert.equal(sesMarketingConfigured({ ...ENV, AWS_SES_SECRET_ACCESS_KEY: '' }), false);
  assert.equal(sesMarketingConfigured({ ...ENV, EMAIL_UNSUB_SECRET: '' }), false);
});

test('marketing personalization injects local unsubscribe and optional web view links', async () => {
  const template = '<a href="{{unsubscribe_url}}">Unsubscribe</a>'
    + '<!--WEB_VIEW_START--><a href="{{web_view_url}}">View online</a><!--WEB_VIEW_END-->';
  const withView = await personalizeMarketingContent(ENV, {
    email: 'Reader@Example.com',
    html: template,
    text: 'Unsubscribe: {{unsubscribe_url}}\nView online: {{web_view_url}}',
    webViewUrl: 'https://masest.co/blog/example',
  });
  assert.match(withView.html, /\/api\/email\/unsubscribe\?email=reader%40example\.com&amp;token=/);
  assert.match(withView.html, /https:\/\/masest\.co\/blog\/example/);
  assert.doesNotMatch(withView.html, /\{\{|\{%/);

  const withoutView = await personalizeMarketingContent(ENV, {
    email: 'reader@example.com',
    html: template,
    text: 'Unsubscribe: {{unsubscribe_url}}\n<!--WEB_VIEW_START-->View online: {{web_view_url}}<!--WEB_VIEW_END-->',
  });
  assert.doesNotMatch(withoutView.html, /View online|web_view_url/);
  assert.doesNotMatch(withoutView.text, /View online|web_view_url/);
});

test('online-view URL binds recipient and delivery source', async () => {
  const url = new URL(await marketingEmailViewUrl(ENV, {
    email: 'reader@example.com', sourceType: 'newsletter', sourceId: 'campaign-42',
  }));
  assert.equal(url.origin, 'https://masest.co');
  assert.equal(url.pathname, '/api/email/view');
  assert.equal(await verifyEmailViewToken(
    url.searchParams.get('email'),
    url.searchParams.get('source_type'),
    url.searchParams.get('source_id'),
    url.searchParams.get('token'),
    ENV.EMAIL_UNSUB_SECRET,
  ), true);
  assert.equal(await verifyEmailViewToken(
    'other@example.com', 'newsletter', 'campaign-42', url.searchParams.get('token'), ENV.EMAIL_UNSUB_SECRET,
  ), false);
});

test('SES sends one signed multipart marketing message with RFC 8058 unsubscribe headers', async () => {
  const signed = [];
  let outbound;
  const result = await sendSesMarketingEmail(ENV, {
    to: 'Reader@Example.com',
    subject: 'Field briefing',
    html: '<p>Briefing</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
    text: 'Briefing\nUnsubscribe: {{unsubscribe_url}}',
    category: 'newsletter',
    idempotencyKey: 'newsletter:42:reader@example.com',
    webViewUrl: 'https://masest.co/blog',
    signer: fakeSigner(signed),
    fetchImpl: async (request) => {
      outbound = request;
      return Response.json({ MessageId: '010001-message' }, { status: 200 });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    provider: 'ses',
    providerMessageId: '010001-message',
    status: 200,
    retryable: false,
  });
  assert.equal(signed.length, 1);
  assert.equal(signed[0].url, 'https://email.us-east-1.amazonaws.com/v2/email/outbound-emails');
  assert.equal(outbound.method, 'POST');
  const payload = JSON.parse(await outbound.text());
  assert.deepEqual(payload.Destination, { ToAddresses: ['reader@example.com'] });
  assert.equal(payload.FromEmailAddress, 'MASEST · VertKleen <dev@masest.co>');
  assert.deepEqual(payload.ReplyToAddresses, ['dev@masest.co']);
  assert.equal(payload.ConfigurationSetName, 'masest-marketing');
  assert.equal(payload.Content.Simple.Subject.Data, 'Field briefing');
  assert.equal(payload.Content.Simple.Body.Text.Charset, 'UTF-8');
  assert.equal(payload.Content.Simple.Body.Html.Charset, 'UTF-8');
  const headers = Object.fromEntries(payload.Content.Simple.Headers.map(({ Name, Value }) => [Name, Value]));
  assert.match(headers['List-Unsubscribe'], /^<https:\/\/masest\.co\/api\/email\/unsubscribe\?/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(headers['X-MASEST-Idempotency-Key'], 'newsletter:42:reader@example.com');
  assert.deepEqual(payload.EmailTags, [
    { Name: 'stream', Value: 'marketing' },
    { Name: 'category', Value: 'newsletter' },
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /secret-test-value|\{%|\{\{/);
});

test('SES marketing send fails closed for invalid shape, missing placeholders, and missing config', async () => {
  const base = {
    to: 'reader@example.com',
    subject: 'Briefing',
    html: '<a href="{{unsubscribe_url}}">Unsubscribe</a>',
    category: 'newsletter',
    idempotencyKey: 'stable-key',
  };
  assert.equal((await sendSesMarketingEmail({}, base)).error, 'ses_not_configured');
  assert.equal((await sendSesMarketingEmail(ENV, { ...base, to: ['a@b.co', 'b@c.co'] })).error, 'ses_single_recipient_required');
  assert.equal((await sendSesMarketingEmail(ENV, { ...base, html: '<p>No opt out</p>' })).error, 'marketing_unsubscribe_placeholder_required');
  assert.equal((await sendSesMarketingEmail(ENV, { ...base, idempotencyKey: '' })).error, 'marketing_idempotency_key_required');
});

test('SES classifies explicit provider failures as retryable but network ambiguity as terminal', async () => {
  const base = {
    to: 'reader@example.com',
    subject: 'Briefing',
    html: '<a href="{{unsubscribe_url}}">Unsubscribe</a>',
    category: 'newsletter',
    idempotencyKey: 'stable-key',
    signer: fakeSigner([]),
  };
  const throttled = await sendSesMarketingEmail(ENV, {
    ...base,
    fetchImpl: async () => Response.json({ message: 'Too many requests' }, { status: 429 }),
  });
  assert.deepEqual(throttled, {
    ok: false, provider: 'ses', status: 429, retryable: true, error: 'Too many requests',
  });

  const ambiguous = await sendSesMarketingEmail(ENV, {
    ...base,
    fetchImpl: async () => { throw new Error('socket closed'); },
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.provider, 'ses');
  assert.equal(ambiguous.network, true);
  assert.equal(ambiguous.ambiguous, true);
  assert.equal(ambiguous.retryable, false);
  assert.match(ambiguous.error, /socket closed/);
  assert.doesNotMatch(ambiguous.error, /secret-test-value/);
});

test('SES suppression listing is signed, paginated, normalized, and bounded', async () => {
  const signed = [];
  const requests = [];
  const pages = [
    {
      SuppressedDestinationSummaries: [
        { EmailAddress: 'Bounced@Example.com', Reason: 'BOUNCE' },
        { EmailAddress: 'invalid-address', Reason: 'BOUNCE' },
      ],
      NextToken: 'page-two',
    },
    {
      SuppressedDestinationSummaries: [
        { EmailAddress: 'Complaint@Example.com', Reason: 'COMPLAINT' },
        { EmailAddress: 'BOUNCED@example.com', Reason: 'BOUNCE' },
        { EmailAddress: 'ignored@example.com', Reason: 'UNKNOWN' },
      ],
    },
  ];
  const result = await listSesSuppressions(ENV, {
    signer: fakeSigner(signed),
    fetchImpl: async (request) => {
      requests.push(new URL(request.url));
      return Response.json(pages.shift(), { status: 200 });
    },
  });

  assert.deepEqual(result, {
    ok: true,
    provider: 'ses',
    pages: 2,
    suppressions: [
      { email: 'bounced@example.com', reason: 'bounce' },
      { email: 'complaint@example.com', reason: 'complaint' },
    ],
  });
  assert.equal(signed.length, 2);
  assert.equal(requests[0].pathname, '/v2/email/suppression/addresses');
  assert.equal(requests[0].searchParams.get('PageSize'), '1000');
  assert.equal(requests[0].searchParams.get('NextToken'), null);
  assert.equal(requests[1].searchParams.get('NextToken'), 'page-two');

  const truncated = await listSesSuppressions(ENV, {
    maxPages: 1,
    signer: fakeSigner([]),
    fetchImpl: async () => Response.json({ NextToken: 'still-more' }, { status: 200 }),
  });
  assert.equal(truncated.ok, false);
  assert.equal(truncated.error, 'ses_suppression_list_truncated');
  assert.equal(truncated.retryable, true);
});

test('SES suppression sync persists one canonical batch and fails closed', async () => {
  const rpcCalls = [];
  const sb = {
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  const result = await syncSesSuppressions(ENV, sb, {
    signer: fakeSigner([]),
    fetchImpl: async () => Response.json({
      SuppressedDestinationSummaries: [
        { EmailAddress: 'Bounced@Example.com', Reason: 'BOUNCE' },
      ],
    }, { status: 200 }),
  });
  assert.deepEqual(result, { ok: true, provider: 'ses', pages: 1, count: 1 });
  assert.deepEqual(rpcCalls, [{
    name: 'sync_ses_suppressions',
    args: { p_entries: [{ email: 'bounced@example.com', reason: 'bounce' }] },
  }]);

  const failedCalls = [];
  const failed = await syncSesSuppressions(ENV, {
    async rpc(...args) {
      failedCalls.push(args);
      return { data: 0, error: null };
    },
  }, {
    signer: fakeSigner([]),
    fetchImpl: async () => Response.json({ message: 'Unavailable' }, { status: 503 }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.retryable, true);
  assert.equal(failedCalls.length, 0);
});
