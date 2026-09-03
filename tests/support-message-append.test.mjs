import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { appendSupportMessage, supportOrderContextsById } from '../functions/_lib/support-messages.js';

const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';

test('canonical support append delegates one atomic database call', async () => {
  let call;
  const sb = {
    async rpc(name, args) {
      call = { name, args };
      return {
        data: {
          id: '44444444-4444-4444-8444-444444444444',
          created_at: '2026-08-30T12:00:00.000Z',
          company_id: COMPANY_ID,
          order_id: ORDER_ID,
          sender_role: 'buyer',
          body: 'Need help with delivery',
          source: 'customer_chat',
          previous_sender_role: 'staff',
          prior_thread_status: 'complete',
          company_name: 'Acme',
        },
        error: null,
      };
    },
  };

  const message = await appendSupportMessage(sb, {
    companyId: COMPANY_ID,
    userId: USER_ID,
    senderRole: 'buyer',
    body: 'Need help with delivery',
    orderId: ORDER_ID,
    source: 'customer_chat',
  });

  assert.deepEqual(call, {
    name: 'append_support_message',
    args: {
      p_company_id: COMPANY_ID,
      p_user_id: USER_ID,
      p_recipient_user_id: null,
      p_thread_user_id: USER_ID,
      p_sender_role: 'buyer',
      p_body: 'Need help with delivery',
      p_order_id: ORDER_ID,
      p_source: 'customer_chat',
      p_reopen: null,
    },
  });
  assert.equal(message.order_id, ORDER_ID);
  assert.equal(message.previous_sender_role, 'staff');
});

test('canonical support append never masks an atomic write failure', async () => {
  const error = Object.assign(new Error('append failed'), { code: 'P0001' });
  await assert.rejects(() => appendSupportMessage({
    async rpc() { return { data: null, error }; },
  }, {
    companyId: COMPANY_ID,
    senderRole: 'staff',
    body: 'Reply',
  }), error);
});

test('support order hydration bounds large thread-list lookups', async () => {
  const chunks = [];
  const ids = Array.from({ length: 205 }, (_, index) => `order-${index}`);
  const sb = {
    from(table) {
      assert.equal(table, 'orders');
      let selected = [];
      return {
        select() { return this; },
        in(column, values) {
          assert.equal(column, 'id');
          selected = values;
          chunks.push(values);
          return this;
        },
        then(resolve) {
          resolve({ data: selected.map((id) => ({ id, order_number: id, status: 'paid' })), error: null });
        },
      };
    },
  };

  const contexts = await supportOrderContextsById(sb, ids);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [100, 100, 5]);
  assert.equal(contexts.size, 205);
});

test('support integration migration owns message, projection, order request, and grants atomically', () => {
  const sql = readFileSync(new URL('../supabase/migrate-support-participant-threads-2026-09-03.sql', import.meta.url), 'utf8');

  assert.match(sql, /create or replace function public\.append_support_message\s*\(/i);
  assert.match(sql, /insert into public\.messages/i);
  assert.match(sql, /create trigger messages_project_support_thread[\s\S]*after insert on public\.messages/i);
  assert.match(sql, /create or replace function public\.project_support_message\s*\(/i);
  assert.match(sql, /update public\.support_threads/i);
  assert.match(sql, /update public\.companies/i);
  assert.match(sql, /last_order_id/i);
  assert.match(sql, /recipient_user_id/i);
  assert.match(sql, /email_message_id/i);
  assert.match(sql, /support_order_thread_mismatch/i);
  assert.match(sql, /create or replace function public\.create_order_support_request\s*\(/i);
  assert.match(sql, /insert into public\.order_requests/i);
  assert.match(sql, /public\.append_support_message\s*\(/i);
  assert.match(sql, /v_order\.user_id = p_requested_by/i);
  assert.match(sql, /'chat_linked', true/i);
  assert.match(sql, /on conflict \(order_id, type\) where status = 'open' do nothing/i);
  assert.match(sql, /revoke all on function public\.append_support_message[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.append_support_message[\s\S]*to service_role/i);
  const inboundEmail = sql.match(/create or replace function public\.upsert_email_inbound_message[\s\S]*?grant execute on function public\.upsert_email_inbound_message/i)?.[0] || '';
  assert.match(inboundEmail, /'email_reply'/i);
  assert.match(inboundEmail, /p_external_message_id/);
  assert.match(inboundEmail, /p_email_references/);
  assert.match(inboundEmail, /v_message\.order_id is distinct from p_order_id/i);
  assert.match(inboundEmail, /v_message\.user_id is distinct from p_user_id/i);
  assert.match(inboundEmail, /v_message\.recipient_user_id is distinct from p_recipient_user_id/i);
  assert.match(sql, /revoke all on function public\.upsert_email_inbound_message[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.upsert_email_inbound_message[\s\S]*to service_role/i);
});
