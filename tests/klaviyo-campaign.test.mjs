import assert from 'node:assert/strict';
import test from 'node:test';
import {
  KLAVIYO_REVISION,
  getKlaviyoCampaignStatus,
  klaviyoUnsubscribe,
  publishKlaviyoCampaign,
} from '../functions/_lib/klaviyo.js';

const env = {
  KLAVIYO_PRIVATE_KEY: 'pk_test',
  KLAVIYO_LIST_ID: 'LIST_MAIN',
  KLAVIYO_FROM_EMAIL: 'noreply@send.masest.co',
  KLAVIYO_FROM_LABEL: 'MASEST · VertKleen',
  KLAVIYO_REPLY_TO: 'dev@masest.co',
};

function response(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('publishKlaviyoCampaign creates template + campaign, assigns, queues send', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/api/templates')) return response(201, { data: { type: 'template', id: 'T1' } });
    if (String(url).endsWith('/api/campaigns')) return response(201, { data: { type: 'campaign', id: 'C1' } });
    if (String(url).includes('/relationships/campaign-messages')) {
      return response(200, { data: [{ type: 'campaign-message', id: 'M1' }] });
    }
    if (String(url).endsWith('/api/campaign-message-assign-template')) return response(201, { data: { id: 'M1' } });
    if (String(url).endsWith('/api/campaign-send-jobs')) return response(202, { data: { type: 'campaign-send-job', id: 'C1', attributes: { status: 'queued' } } });
    throw new Error(`unexpected ${url}`);
  };
  const result = await publishKlaviyoCampaign(env, {
    name: 'Newsletter 42',
    subject: 'Field notes',
    previewText: 'Latest field notes',
    html: '<html><a href="{% unsubscribe_link %}">Unsubscribe</a></html>',
    text: 'Field notes',
    listId: 'LIST_MAIN',
    fetchImpl,
  });

  assert.deepEqual(result, {
    ok: true,
    queued: true,
    provider: 'klaviyo',
    campaignId: 'C1',
    messageId: 'M1',
    templateId: 'T1',
    status: 'queued',
  });
  assert.equal(calls.length, 5);
  assert.equal(calls[1].init.headers.revision, '2026-07-15.pre');
  assert.ok([calls[0], calls[2], calls[3], calls[4]]
    .every((call) => call.init.headers.revision === KLAVIYO_REVISION));
  assert.equal(calls[1].body.data.attributes.audiences.included[0], 'LIST_MAIN');
  assert.equal(calls[1].body.data.attributes['campaign-messages'].data[0].attributes.definition.content.from_email, 'noreply@send.masest.co');
  assert.equal(calls[3].body.data.id, 'M1');
  assert.equal(calls[3].body.data.relationships.template.data.id, 'T1');
  assert.equal(calls[4].body.data.id, 'C1');
});

test('publishKlaviyoCampaign fails closed without marketing unsubscribe control', async () => {
  let calls = 0;
  const result = await publishKlaviyoCampaign(env, {
    name: 'Bad', subject: 'Bad', html: '<p>No unsubscribe</p>',
    fetchImpl: async () => { calls += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'marketing_unsubscribe_required');
  assert.equal(calls, 0);
});

test('publishKlaviyoCampaign requires unsubscribe_link in an actual href', async () => {
  let calls = 0;
  const result = await publishKlaviyoCampaign(env, {
    name: 'Bad', subject: 'Bad', html: '<p>{% unsubscribe_link %}</p>',
    fetchImpl: async () => { calls += 1; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'marketing_unsubscribe_required');
  assert.equal(calls, 0);
});

test('klaviyoUnsubscribe uses bulk delete subscription job', async () => {
  let seen;
  const result = await klaviyoUnsubscribe(env, 'USER@EXAMPLE.COM', 'LIST_MAIN', {
    fetchImpl: async (url, init) => {
      seen = { url: String(url), body: JSON.parse(init.body) };
      return response(202);
    },
  });
  assert.equal(result.ok, true);
  assert.match(seen.url, /profile-subscription-bulk-delete-jobs/);
  assert.equal(seen.body.data.attributes.profiles.data[0].attributes.email, 'user@example.com');
  assert.equal(seen.body.data.relationships.list.data.id, 'LIST_MAIN');
});

test('klaviyoUnsubscribe retries retryable failures before reporting pending sync', async () => {
  let calls = 0;
  const result = await klaviyoUnsubscribe(env, 'user@example.com', 'LIST_MAIN', {
    fetchImpl: async () => {
      calls += 1;
      return calls < 3 ? response(503) : response(202);
    },
    sleepImpl: async () => {},
  });
  assert.deepEqual(result, { ok: true, status: 202 });
  assert.equal(calls, 3);
});

test('getKlaviyoCampaignStatus reports provider job state', async () => {
  const result = await getKlaviyoCampaignStatus(env, 'C1', {
    fetchImpl: async () => response(200, { data: { id: 'C1', attributes: { status: 'complete' } } }),
  });
  assert.deepEqual(result, { ok: true, campaignId: 'C1', status: 'complete' });
});
