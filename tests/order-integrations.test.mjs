import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  linkOrderProviderObject,
  orderReference,
} from '../functions/_lib/order-integrations.js';

const schema = readFileSync(new URL('../supabase/schema-commerce-integrations.sql', import.meta.url), 'utf8');
const rollback = readFileSync(new URL('../supabase/rollback-commerce-integrations.sql', import.meta.url), 'utf8');
const adminOrders = readFileSync(new URL('../functions/api/admin/orders.js', import.meta.url), 'utf8');
const stripeWebhook = readFileSync(new URL('../functions/api/stripe-webhook.js', import.meta.url), 'utf8');
const qboSync = readFileSync(new URL('../functions/api/qbo-sync.js', import.meta.url), 'utf8');
const reversalSchema = readFileSync(new URL('../supabase/schema-order-reversals.sql', import.meta.url), 'utf8');

test('orderReference prefers the immutable public order number and retains UUID fallback', () => {
  assert.equal(orderReference({ order_number: 'MST-00000123', id: 'internal-uuid' }), 'MST-00000123');
  assert.equal(orderReference({ id: 'internal-uuid' }), 'internal-uuid');
  assert.equal(orderReference(null), '');
});

test('linkOrderProviderObject uses the service-only idempotent registry RPC', async () => {
  const calls = [];
  const sb = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: 'link-uuid', error: null };
    },
  };
  const result = await linkOrderProviderObject(sb, {
    orderId: 'order-uuid',
    provider: 'stripe',
    objectType: 'payment_intent',
    providerObjectId: 'pi_123',
    metadata: { livemode: true },
  });

  assert.equal(result, 'link-uuid');
  assert.deepEqual(calls, [{
    name: 'link_order_provider_object',
    args: {
      p_order_id: 'order-uuid',
      p_provider: 'stripe',
      p_object_type: 'payment_intent',
      p_provider_object_id: 'pi_123',
      p_metadata: { livemode: true },
    },
  }]);
});

test('linkOrderProviderObject skips absent provider IDs and preserves RPC error identity', async () => {
  let called = false;
  assert.equal(await linkOrderProviderObject({ rpc() { called = true; } }, {
    orderId: 'order-uuid', provider: 'stripe', objectType: 'payment_intent', providerObjectId: '',
  }), null);
  assert.equal(called, false);

  const providerError = { code: '23505', message: 'provider_object_already_claimed' };
  await assert.rejects(
    linkOrderProviderObject({ async rpc() { return { data: null, error: providerError }; } }, {
      orderId: 'order-uuid', provider: 'stripe', objectType: 'payment_intent', providerObjectId: 'pi_123',
    }),
    (error) => error === providerError,
  );
});

test('commerce schema allocates immutable MST numbers and a globally unique provider ledger', () => {
  assert.match(schema, /create sequence if not exists public\.masest_order_number_seq/i);
  assert.match(schema, /MST-["']?\s*\|\|\s*lpad/i);
  assert.match(schema, /row_number\(\) over \(order by created_at, id\)/i);
  assert.match(schema, /alter column order_number set not null/i);
  assert.match(schema, /orders_order_number_uidx[\s\S]*unique/i);
  assert.match(schema, /prevent_order_number_change/i);
  assert.match(schema, /create table if not exists public\.order_provider_links/i);
  assert.match(schema, /unique\s*\(provider, object_type, provider_object_id\)/i);
  assert.match(schema, /provider_object_already_claimed/i);
  assert.match(schema, /enable row level security/i);
  assert.match(schema, /revoke all on function public\.link_order_provider_object/i);
  assert.match(schema, /grant execute on function public\.link_order_provider_object[\s\S]*to service_role/i);
});

test('commerce rollback removes all new integration objects in dependency order', () => {
  assert.match(rollback, /drop trigger if exists orders_order_number_immutable/i);
  assert.match(rollback, /drop table if exists public\.order_provider_links/i);
  assert.match(rollback, /alter table public\.orders drop column if exists order_number/i);
  assert.match(rollback, /drop sequence if exists public\.masest_order_number_seq/i);
  assert.match(rollback, /begin;[\s\S]*commit;\s*$/i);
});

test('refund and credit-memo objects join the same cross-provider order ledger', () => {
  assert.match(adminOrders, /queueRefundCommand/);
  assert.match(reversalSchema, /record_order_refund_provider_success[\s\S]*link_order_provider_object\([\s\S]*'stripe', 'refund'/i);
  assert.match(stripeWebhook, /objectType:\s*'refund'[\s\S]*providerObjectId:\s*refund\.id/);
  assert.match(qboSync, /provider:\s*'quickbooks'[\s\S]*objectType:\s*'credit_memo'[\s\S]*providerObjectId:\s*result\.creditMemoId/);
});
