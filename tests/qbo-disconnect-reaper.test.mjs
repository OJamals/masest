import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revokeQboToken } from '../functions/_lib/qbo-oauth.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const env = { QBO_CLIENT_ID: 'cid', QBO_CLIENT_SECRET: 'sec' };

test('revokeQboToken posts the token to Intuit revoke with basic auth', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true }; };
  const ok = await revokeQboToken(env, 'refresh-123', { fetchImpl });
  assert.equal(ok, true);
  assert.match(captured.url, /tokens\/revoke$/);
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.authorization, `Basic ${btoa('cid:sec')}`);
  assert.deepEqual(JSON.parse(captured.opts.body), { token: 'refresh-123' });
});

test('revokeQboToken short-circuits to false when there is no token', async () => {
  let called = false;
  await revokeQboToken(env, '', { fetchImpl: async () => { called = true; return { ok: true }; } });
  assert.equal(called, false);
});

test('revokeQboToken needs oauth credentials', async () => {
  await assert.rejects(() => revokeQboToken({}, 'tok', { fetchImpl: async () => ({ ok: true }) }), /qbo_oauth_not_configured/);
});

test('disconnect endpoint revokes then clears local tokens', () => {
  const src = read('functions/api/admin/qbo/disconnect.js');
  assert.match(src, /revokeQboToken/);
  assert.match(src, /staffCanWrite/);
  assert.match(src, /refresh_token: null/);
  assert.match(src, /access_token: null/);
});

test('reaper claim reclaims stuck processing rows via a visibility-timeout lease', () => {
  const sql = read('supabase/schema-qbo-reaper.sql');
  for (const fn of ['claim_qbo_orders', 'claim_qbo_refunds']) {
    assert.match(sql, new RegExp(`function public\\.${fn}`));
  }
  // both claims must now consider 'processing' (not just 'pending') and stamp a lease
  const inClause = sql.match(/qbo_sync_status in \('pending', 'processing'\)/g) || [];
  assert.equal(inClause.length, 2, 'both claim fns reclaim processing');
  const lease = sql.match(/qbo_next_attempt_at = now\(\) \+ interval '15 minutes'/g) || [];
  assert.equal(lease.length, 2, 'both claim fns stamp a lease');
});

test('worker alerts staff on dead-letter for both queues', () => {
  const src = read('functions/api/qbo-sync.js');
  assert.match(src, /async function alertDeadLetter/);
  assert.match(src, /sendEmail/);
  assert.match(src, /alertDeadLetter\(env, 'orders'/);
  assert.match(src, /alertDeadLetter\(env, 'refunds'/);
  assert.match(src, /deadLettered/);
});
