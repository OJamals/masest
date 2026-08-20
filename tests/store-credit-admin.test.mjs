import assert from 'node:assert/strict';
import test from 'node:test';

import { createCompanyCreditsHandler } from '../functions/api/admin/company-credits.js';
import { companyDeletionState } from '../functions/api/admin/companies.js';

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

function request(body) {
  return new Request('https://masest.test/api/admin/company-credits', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('finance can issue an exact, reasoned, idempotent account-credit adjustment', async () => {
  const calls = [];
  const handler = createCompanyCreditsHandler({
    requireStaff: async () => ({ user: { id: USER_ID }, staff: true, role: 'finance' }),
    adminClient: () => ({ marker: 'db' }),
    adjustCompanyStoreCredit: async (sb, input) => {
      calls.push({ sb, input });
      return { balance_minor: 2550, reserved_minor: 0, available_minor: 2550, currency: 'usd', replay: false };
    },
    recordAudit: async () => {},
  });

  const response = await handler({
    request: request({
      company_id: COMPANY_ID,
      amount: '25.50',
      reason: 'Service recovery credit',
      request_id: REQUEST_ID,
    }),
    env: {},
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    store_credit: { balance_minor: 2550, reserved_minor: 0, available_minor: 2550, currency: 'usd', replay: false },
  });
  assert.deepEqual(calls[0].input, {
    companyId: COMPANY_ID,
    amountMinor: 2550,
    reason: 'Service recovery credit',
    requestId: REQUEST_ID,
    actorUserId: USER_ID,
    currency: 'usd',
  });
});

test('support staff cannot mutate Company account credit', async () => {
  const handler = createCompanyCreditsHandler({
    requireStaff: async () => ({ user: { id: USER_ID }, staff: true, role: 'support' }),
    adminClient: () => { throw new Error('DB must not run'); },
  });
  const response = await handler({
    request: request({ company_id: COMPANY_ID, amount: '25', reason: 'Service recovery credit', request_id: REQUEST_ID }),
    env: {},
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'forbidden' });
});

function companyDependencyDb(results) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(['from', table]);
      const query = {
        select(columns, options) { calls.push(['select', table, columns, options]); return query; },
        eq(column, value) { calls.push(['eq', table, column, value]); return query; },
        neq(column, value) { calls.push(['neq', table, column, value]); return query; },
        then(resolve, reject) {
          return Promise.resolve(results[table] || { count: 0, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

test('Company deletion preserves account-credit ledger and reservation history', async () => {
  const sb = companyDependencyDb({
    company_store_credit_entries: { count: 1, error: null },
  });

  assert.deepEqual(await companyDeletionState(sb, COMPANY_ID), { blocked: true, error: null });
  assert.deepEqual(sb.calls.filter(([name]) => name === 'from').map(([, table]) => table), [
    'profiles',
    'orders',
    'company_store_credit_entries',
    'company_store_credit_reservations',
  ]);
});

test('Company deletion dependency checks fail closed on database error', async () => {
  const sb = companyDependencyDb({
    company_store_credit_reservations: { count: null, error: new Error('db unavailable') },
  });

  assert.deepEqual(await companyDeletionState(sb, COMPANY_ID), {
    blocked: true,
    error: 'company_dependency_check_failed',
  });
});
