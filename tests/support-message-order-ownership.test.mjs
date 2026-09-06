import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  resolveSupportOrderId,
  resolveSupportRecipient,
} from '../functions/_lib/support-messages.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function orderLookup(result) {
  const filters = [];
  const db = {
    from(table) {
      assert.equal(table, 'orders');
      return {
        select(columns) {
          assert.equal(columns, 'id,order_number,status,company_id,user_id,customer_email');
          return this;
        },
        eq(column, value) {
          filters.push([column, value]);
          return this;
        },
        async maybeSingle() {
          return result;
        },
      };
    },
  };
  return { db, filters };
}

test('general support messages do not query order ownership', async () => {
  let queried = false;
  const result = await resolveSupportOrderId({
    from() {
      queried = true;
      throw new Error('unexpected query');
    },
  }, { orderId: '', companyId: 'company-1' });

  assert.deepEqual(result, { ok: true, orderId: null });
  assert.equal(queried, false);
});

test('support order context resolves by id, then verifies authenticated ownership', async () => {
  const order = {
    id: ORDER_ID,
    order_number: 'MST-1042',
    status: 'paid',
    company_id: 'company-1',
    user_id: 'user-1',
    customer_email: 'buyer@example.com',
  };
  const { db, filters } = orderLookup({ data: order, error: null });

  const result = await resolveSupportOrderId(db, {
    orderId: ` ${ORDER_ID} `,
    companyId: 'company-1',
  });

  assert.deepEqual(filters, [['id', ORDER_ID]]);
  assert.equal(result.ok, true);
  assert.equal(result.orderId, ORDER_ID);
  assert.equal(result.recipientUserId, 'user-1');
  assert.equal(result.recipientEmail, 'buyer@example.com');
  assert.deepEqual(result.order, {
    id: ORDER_ID,
    reference: 'MST-1042',
    status: 'paid',
    buyer_url: `/dashboard.html?order=${ORDER_ID}#orders`,
    admin_url: `/admin.html?order=${ORDER_ID}#orders`,
  });
});

test('support recipient resolves an exact company user with Auth email', async () => {
  const filters = [];
  const sb = {
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select(columns) {
          assert.equal(columns, 'id,company_id,full_name,notify_messages,support_chat_open,support_chat_seen_at');
          return this;
        },
        eq(column, value) { filters.push([column, value]); return this; },
        async maybeSingle() {
          return {
            data: {
              id: 'user-1',
              full_name: 'Morgan Buyer',
              notify_messages: true,
              support_chat_open: false,
              support_chat_seen_at: null,
            },
            error: null,
          };
        },
      };
    },
    auth: {
      admin: {
        getUserById: async (id) => ({ data: { user: { id, email: 'buyer@example.com' } } }),
      },
    },
  };

  const recipient = await resolveSupportRecipient(sb, {
    companyId: 'company-1',
    userId: 'user-1',
  });

  assert.deepEqual(filters, [['id', 'user-1'], ['company_id', 'company-1']]);
  assert.deepEqual(recipient, {
    id: 'user-1',
    full_name: 'Morgan Buyer',
    notify_messages: true,
    support_chat_open: false,
    support_chat_seen_at: null,
    email: 'buyer@example.com',
  });
});

test('support recipient falls back from an unlinked order email to a company member', async () => {
  const profiles = [
    { id: 'user-1', full_name: 'First Buyer' },
    { id: 'user-2', full_name: 'Order Buyer' },
  ];
  const sb = {
    from(table) {
      assert.equal(table, 'profiles');
      return {
        select() { return this; },
        eq(column, value) {
          assert.deepEqual([column, value], ['company_id', 'company-1']);
          return this;
        },
        limit(value) { assert.equal(value, 1000); return this; },
        then(resolve) { return Promise.resolve({ data: profiles, error: null }).then(resolve); },
      };
    },
    auth: {
      admin: {
        getUserById: async (id) => ({
          data: { user: { id, email: id === 'user-2' ? 'order@example.com' : 'first@example.com' } },
        }),
      },
    },
  };

  const recipient = await resolveSupportRecipient(sb, {
    companyId: 'company-1',
    email: ' ORDER@example.com ',
  });

  assert.equal(recipient.id, 'user-2');
  assert.equal(recipient.email, 'order@example.com');
});

test('foreign or unknown support order context fails without disclosure', async () => {
  const { db } = orderLookup({ data: null, error: null });

  assert.deepEqual(await resolveSupportOrderId(db, {
    orderId: ORDER_ID,
    companyId: 'company-1',
  }), {
    ok: false,
    status: 404,
    error: 'order_not_found',
  });
});

test('support order lookup errors remain masked', async () => {
  const { db } = orderLookup({ data: null, error: new Error('orders relation detail') });

  assert.deepEqual(await resolveSupportOrderId(db, {
    orderId: ORDER_ID,
    companyId: 'company-1',
  }), {
    ok: false,
    status: 500,
    error: 'server_error',
  });
});

test('malformed support order ids fail before querying the database', async () => {
  let queried = false;
  const result = await resolveSupportOrderId({
    from() {
      queried = true;
      throw new Error('unexpected query');
    },
  }, { orderId: 'not-an-order-id', companyId: 'company-1' });

  assert.deepEqual(result, { ok: false, status: 404, error: 'order_not_found' });
  assert.equal(queried, false);
});

test('support order schema enforces exact participant or company thread ownership', () => {
  const sql = readFileSync(new URL('../supabase/migrate-support-participant-threads-2026-09-03.sql', import.meta.url), 'utf8');
  assert.match(sql, /foreign key \(order_id\) references public\.orders\(id\) on delete set null/i);
  assert.match(sql, /v_order\.user_id = v_thread\.participant_user_id/i);
  assert.match(sql, /v_order\.company_id = v_thread\.company_id/i);
  assert.match(sql, /support_order_thread_mismatch/i);
});

test('buyer message route inserts only the resolved order id', () => {
  const source = readFileSync(new URL('../functions/api/account/messages.js', import.meta.url), 'utf8');
  const publisher = readFileSync(new URL('../functions/_lib/support-message-publisher.js', import.meta.url), 'utf8');
  assert.match(source, /resolveSupportOrderId\(sb,/);
  assert.match(source, /publishSupportMessage\(/);
  assert.match(publisher, /appendSupportMessage/);
  assert.match(source, /orderId:\s*orderContext\.orderId/);
  assert.doesNotMatch(source, /order_id:\s*body\.order_id/);
});

test('staff replies validate and retain active order context', () => {
  const source = readFileSync(new URL('../functions/api/admin/messages.js', import.meta.url), 'utf8');
  const publisher = readFileSync(new URL('../functions/_lib/support-message-publisher.js', import.meta.url), 'utf8');
  const supportEmail = readFileSync(new URL('../functions/_lib/support-email.js', import.meta.url), 'utf8');
  assert.match(source, /resolveSupportOrderId\(sb,/);
  assert.match(source, /publishSupportMessage\(/);
  assert.match(source, /orderId:\s*orderContext\.orderId/);
  assert.match(source, /userId:\s*recipientUserId/);
  assert.match(source, /threadUserId:\s*recipientUserId/);
  assert.match(publisher, /assert_email_effects_ready/);
  assert.match(publisher, /emailDelivery: \{ ok: true, queued: true \}/);
  assert.doesNotMatch(publisher, /deliverSupportMessageEmail/);
  assert.match(supportEmail, /dashboard\.html\?order=\$\{encodeURIComponent\(order\.id\)\}#messages/);
  assert.doesNotMatch(source, /from\('messages'\)\.insert/);
});
