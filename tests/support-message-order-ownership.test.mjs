import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveSupportOrderId } from '../functions/_lib/support-messages.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

function orderLookup(result) {
  const filters = [];
  const db = {
    from(table) {
      assert.equal(table, 'orders');
      return {
        select(columns) {
          assert.equal(columns, 'id');
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

test('support order context resolves only inside the authenticated company', async () => {
  const { db, filters } = orderLookup({ data: { id: ORDER_ID }, error: null });

  const result = await resolveSupportOrderId(db, {
    orderId: ` ${ORDER_ID} `,
    companyId: 'company-1',
  });

  assert.deepEqual(filters, [
    ['id', ORDER_ID],
    ['company_id', 'company-1'],
  ]);
  assert.deepEqual(result, { ok: true, orderId: ORDER_ID });
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

test('support order schema enforces the company relationship', () => {
  const sql = readFileSync(new URL('../supabase/schema-support-message-order-ownership.sql', import.meta.url), 'utf8');
  assert.match(sql, /unique\s*\(id,\s*company_id\)/i);
  assert.match(sql, /foreign key\s*\(order_id,\s*company_id\)/i);
  assert.match(sql, /references\s+public\.orders\s*\(id,\s*company_id\)/i);
  assert.match(sql, /on delete set null\s*\(order_id\)/i);
});

test('buyer message route inserts only the resolved order id', () => {
  const source = readFileSync(new URL('../functions/api/account/messages.js', import.meta.url), 'utf8');
  assert.match(source, /resolveSupportOrderId\(sb,/);
  assert.match(source, /order_id:\s*orderContext\.orderId/);
  assert.doesNotMatch(source, /order_id:\s*body\.order_id/);
});
