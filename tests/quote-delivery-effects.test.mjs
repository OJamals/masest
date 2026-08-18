import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  deliverIntegrationEffect,
  quoteOfferEffects,
  toIntegrationEffectRows,
} from '../functions/_lib/integration-effects.js';

const QUOTE_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';

test('one offer commit plans exactly one durable notification, message, and email', () => {
  const rows = toIntegrationEffectRows(quoteOfferEffects({
    quoteId: QUOTE_ID,
    companyId: COMPANY_ID,
    email: ' BUYER@example.com ',
    product: 'VertKleen HCR',
  }));
  assert.deepEqual(rows.map(({ effect_key, effect_type }) => ({ effect_key, effect_type })), [
    { effect_key: 'quote-notification', effect_type: 'company_notification' },
    { effect_key: 'quote-message', effect_type: 'quote_message' },
    { effect_key: 'quote-email', effect_type: 'quote_offer_email' },
  ]);
  assert.ok(rows.every((row) => row.aggregate_type === 'quote' && row.aggregate_id === QUOTE_ID));
  assert.equal(rows[2].payload.email, 'buyer@example.com');
});

test('local Buyer message delivery uses the leased idempotent database projection', async () => {
  const calls = [];
  const result = await deliverIntegrationEffect({
    env: {},
    sb: {
      async rpc(name, input) {
        calls.push([name, input]);
        return { data: { message_id: 'message-1', inserted: true }, error: null };
      },
    },
    effect: {
      id: 'effect-message',
      lease_owner: 'worker-1',
      provider: 'masest',
      effect_type: 'quote_message',
      payload: { quote_id: QUOTE_ID, company_id: COMPANY_ID },
    },
  });
  assert.deepEqual(calls, [[
    'deliver_quote_message_effect',
    { p_effect_id: 'effect-message', p_worker_id: 'worker-1' },
  ]]);
  assert.deepEqual(result, {
    providerRecorded: true,
    providerResult: { message_id: 'message-1', inserted: true },
    skipped: false,
  });
});

test('notification and email delivery route the Buyer to the real Orders workspace', async () => {
  let notification;
  await deliverIntegrationEffect({
    env: {},
    sb: {
      async rpc(name, input) {
        assert.equal(name, 'deliver_integration_notification_effect');
        notification = input.p_notification;
        return { data: { notification_id: 'notification-1' }, error: null };
      },
    },
    effect: {
      id: 'effect-notification',
      lease_owner: 'worker-1',
      provider: 'masest',
      effect_type: 'company_notification',
      payload: { kind: 'quote_ready', company_id: COMPANY_ID },
    },
  });
  assert.equal(notification.link, '/dashboard.html#orders');

  let email;
  const emailResult = await deliverIntegrationEffect({
    env: { APP_URL: 'https://masest.test' },
    sb: {},
    effect: {
      id: 'effect-email',
      lease_owner: 'worker-1',
      provider: 'masest',
      provider_event_id: `quote:${QUOTE_ID}:offer-1`,
      effect_key: 'quote-email',
      effect_type: 'quote_offer_email',
      payload: { quote_id: QUOTE_ID, email: 'buyer@example.com', product: 'HCR' },
    },
  }, {
    sendEmail: async (_env, input) => { email = input; return { ok: true }; },
  });
  assert.match(email.html, /https:\/\/masest\.test\/dashboard\.html#orders/);
  assert.equal(email.idempotencyKey, `masest/quote:${QUOTE_ID}:offer-1/quote-email`);
  assert.deepEqual(emailResult, { providerRecorded: false, providerResult: {}, skipped: false });
});

test('offer and all three delivery effects are one SQL transaction boundary', () => {
  const sql = readFileSync(new URL('../supabase/schema-quote-lifecycle.sql', import.meta.url), 'utf8');
  const commit = sql.slice(sql.indexOf('create or replace function public.commit_quote_offer'));
  assert.match(commit, /jsonb_array_length\(p_effects\) <> 3/);
  assert.match(commit, /public\.ingest_integration_event\(/);
  assert.match(commit, /update public\.quotes[\s\S]*offer_delivery_event_id/);
  assert.match(sql, /begin;[\s\S]*commit;/);
});
