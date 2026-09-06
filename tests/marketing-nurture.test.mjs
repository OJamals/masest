import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NURTURE_DELAY_DAYS,
  enrollMarketingNurture,
} from '../functions/_lib/marketing-nurture.js';
import { renderAllNurtureFlowEmails } from '../functions/_lib/scrolly-marketing-emails.js';

test('nurture templates are provider-neutral and SES-ready', () => {
  const rendered = renderAllNurtureFlowEmails();
  assert.equal(rendered.length, 3);
  for (const email of rendered) {
    assert.match(email.html, /\{\{unsubscribe_url\}\}/);
    assert.doesNotMatch(email.html, /klaviyo|first_name\|default|\{%/i);
    assert.doesNotMatch(email.text, /klaviyo|first_name\|default|\{%/i);
  }
});

test('nurture enrollment skips every write without explicit form consent', async () => {
  let calls = 0;
  const result = await enrollMarketingNurture({}, {}, {
    email: 'buyer@example.test',
    quoteId: 'quote-1',
    consented: false,
  }, {
    setPreference: async () => { calls += 1; },
    materialize: async () => { calls += 1; },
    enqueue: async () => { calls += 1; },
  });
  assert.deepEqual(result, { ok: true, skipped: 'consent_required', queued: 0 });
  assert.equal(calls, 0);
});

test('nurture enrollment materializes three scheduled SES deliveries from frozen consent', async () => {
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscribed: true }, error: null }) }) }) }) };
  const sources = [];
  const queueJobs = [];
  const result = await enrollMarketingNurture({ EMAIL_UNSUB_SECRET: 'secret' }, sb, {
    email: ' Buyer@Example.test ',
    quoteId: 'quote-42',
    name: 'Buyer',
    industry: 'Marine',
    consented: true,
    consentAt: '2026-09-03T12:00:00.000Z',
  }, {
    materialize: async (_sb, value) => { sources.push(value); return { created: true, total: 1, error: null }; },
    enqueue: async (_env, value) => { queueJobs.push(value); return { ok: true, queued: true }; },
  });

  assert.deepEqual(NURTURE_DELAY_DAYS, [0, 3, 8]);
  assert.equal(sources.length, 3);
  assert.deepEqual(sources.map((source) => source.sourceType), ['nurture', 'nurture', 'nurture']);
  assert.deepEqual(sources.map((source) => source.sourceId), [
    'quote-42:strength-hmis',
    'quote-42:compare-match',
    'quote-42:cost-trial',
  ]);
  assert.deepEqual(sources.map((source) => source.metadata.available_at), NURTURE_DELAY_DAYS.map((days) => (
    new Date(now + days * 86400000).toISOString()
  )));
  assert.ok(sources.every((source) => source.category === 'lead_nurture'));
  assert.ok(sources.every((source) => source.emails[0] === 'buyer@example.test'));
  assert.deepEqual(queueJobs, [{ sourceType: 'nurture' }]);
  assert.deepEqual(result, { ok: true, provider: 'ses', queued: 3, started: 0 });
});

test('nurture enrollment fails closed without frozen consent timestamp', async () => {
  let materialized = false;
  const result = await enrollMarketingNurture({}, {}, {
    email: 'buyer@example.test', quoteId: 'quote-1', consented: true,
  }, {
    materialize: async () => { materialized = true; },
  });
  assert.deepEqual(result, {
    ok: false,
    provider: 'ses',
    queued: 0,
    retryable: false,
    error: 'nurture_consent_timestamp_required',
  });
  assert.equal(materialized, false);
});

test('nurture replay respects unsubscribe and performs no preference write', async () => {
  let materialized = false;
  const sb = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { subscribed: false }, error: null }) }) }) }) };
  const result = await enrollMarketingNurture({}, sb, {
    email: 'buyer@example.test', quoteId: 'quote-1', consented: true, consentAt: '2026-09-03T12:00:00Z',
  }, { materialize: async () => { materialized = true; } });
  assert.deepEqual(result, { ok: true, provider: 'ses', queued: 0, skipped: 'newer_unsubscribe' });
  assert.equal(materialized, false);
});
