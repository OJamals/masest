import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadMarketingAudience,
  normalizeMarketingEmails,
  setMarketingPreference,
  setMarketingPreferences,
} from '../functions/_lib/marketing-subscribers.js';

test('marketing email normalization validates, lowercases, and deduplicates', () => {
  assert.deepEqual(
    normalizeMarketingEmails([' A@Example.com ', 'a@example.com', 'bad', 'b@example.com']),
    ['a@example.com', 'b@example.com'],
  );
});

test('marketing preference writes one atomic canonical RPC', async () => {
  const calls = [];
  let wakes = 0;
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  const result = await setMarketingPreference({}, {
    email: 'Reader@Example.com',
    enabled: false,
    source: 'email_unsubscribe',
    userId: '00000000-0000-4000-8000-000000000001',
  }, { sb, enqueueConsent: async () => { wakes += 1; return { ok: true, queued: true }; } });
  assert.deepEqual(result, { ok: true, count: 1 });
  assert.equal(wakes, 1);
  assert.deepEqual(calls, [{
    name: 'set_marketing_email_preferences',
    args: {
      p_emails: ['reader@example.com'],
      p_enabled: false,
      p_source: 'email_unsubscribe',
      p_user_id: '00000000-0000-4000-8000-000000000001',
      p_name: null,
      p_tags: [],
    },
  }]);
});

test('bulk marketing preference sync uses one RPC and fails closed on partial persistence', async () => {
  let calls = 0;
  const sb = {
    async rpc() {
      calls += 1;
      return { data: 1, error: null };
    },
  };
  const result = await setMarketingPreferences({}, {
    emails: ['a@example.com', 'b@example.com'], enabled: true, source: 'admin_import', tags: ['prospect'],
  }, { sb });
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, count: 1, retryable: true, error: 'marketing_preference_partial_write' });
});

test('audience loader pages only subscribed emails and rejects source failure/truncation', async () => {
  const ranges = [];
  const pages = [
    [{ email: 'A@example.com' }, { email: 'b@example.com' }],
    [{ email: 'b@example.com' }],
  ];
  const sb = {
    from(table) {
      assert.equal(table, 'newsletter_recipients');
      return {
        select(columns) {
          assert.equal(columns, 'email');
          return {
            eq(column, value) {
              assert.deepEqual([column, value], ['subscribed', true]);
              return {
                async range(start, end) {
                  ranges.push([start, end]);
                  return { data: pages.shift(), error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  assert.deepEqual(await loadMarketingAudience(sb, { pageSize: 2, maxPages: 5 }), ['a@example.com', 'b@example.com']);
  assert.deepEqual(ranges, [[0, 1], [2, 3]]);

  const broken = { from: () => ({ select: () => ({ eq: () => ({ range: async () => ({ error: new Error('down') }) }) }) }) };
  await assert.rejects(loadMarketingAudience(broken), /marketing_audience_unavailable/);
  const fullForever = { from: () => ({ select: () => ({ eq: () => ({ range: async () => ({ data: [{ email: 'a@b.co' }], error: null }) }) }) }) };
  await assert.rejects(loadMarketingAudience(fullForever, { pageSize: 1, maxPages: 1 }), /marketing_audience_truncated/);
});
