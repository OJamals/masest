import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CommerceContextError,
  resolveCommerceContextSnapshot,
} from '../functions/_lib/commerce-context.js';

function query(result) {
  return {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return result; },
  };
}

function database({ profile = null, profileError = null, company = null, companyError = null } = {}) {
  const reads = [];
  return {
    reads,
    from(table) {
      reads.push(table);
      if (table === 'profiles') return query({ data: profile, error: profileError });
      if (table === 'companies') return query({ data: company, error: companyError });
      throw new Error(`unexpected table ${table}`);
    },
  };
}

const request = new Request('https://masest.test/api/checkout');
const user = { id: 'buyer-1', email: 'buyer@example.test' };

test('commerce context keeps guests and successful profileless Buyers as explicit retail states', async () => {
  let adminCalls = 0;
  const guest = await resolveCommerceContextSnapshot({
    request,
    env: {},
    userFromRequest: async () => ({ user: null, token: null }),
    adminClient: () => { adminCalls += 1; return database(); },
  });
  assert.deepEqual({ kind: guest.kind, tier: guest.tier, user: guest.user }, {
    kind: 'guest', tier: 'retail', user: null,
  });
  assert.equal(adminCalls, 1, 'the snapshot still owns the one database client used downstream');

  const sb = database({ profile: null });
  const retail = await resolveCommerceContextSnapshot({
    request,
    env: {},
    userFromRequest: async () => ({ user }),
    adminClient: () => sb,
  });
  assert.equal(retail.kind, 'retail_user');
  assert.equal(retail.user, user);
  assert.equal(retail.profile, null);
  assert.equal(retail.company, null);
  assert.equal(retail.companyId, null);
  assert.equal(retail.tier, 'retail');
  assert.deepEqual(sb.reads, ['profiles']);
});

test('commerce context treats a successfully missing Company as retail but preserves one approved Company snapshot', async () => {
  const missing = database({ profile: { company_id: 'company-1', role: 'buyer' }, company: null });
  const retail = await resolveCommerceContextSnapshot({
    request,
    env: {},
    userFromRequest: async () => ({ user }),
    adminClient: () => missing,
  });
  assert.equal(retail.kind, 'retail_user');
  assert.equal(retail.companyId, null);
  assert.equal(retail.tier, 'retail');

  const company = {
    id: 'company-1', name: 'Acme HVAC', status: 'approved', price_tier: 'dealer',
    tax_exempt: true, stripe_customer_id: 'cus_shared',
  };
  const approved = await resolveCommerceContextSnapshot({
    request,
    env: {},
    userFromRequest: async () => ({ user }),
    adminClient: () => database({ profile: { company_id: company.id, role: 'buyer' }, company }),
  });
  assert.equal(approved.kind, 'company_user');
  assert.equal(approved.company, company);
  assert.equal(approved.companyId, company.id);
  assert.equal(approved.role, 'buyer');
  assert.equal(approved.tier, 'dealer');
  assert.equal(approved.taxExempt, true);
  assert.equal(approved.stripeCustomerId, 'cus_shared');
});

test('commerce context fails closed with a typed retryable outcome for profile or Company read errors', async () => {
  for (const fixture of [
    { profileError: { code: '08006' }, stage: 'profile' },
    { profile: { company_id: 'company-1' }, companyError: { code: '08006' }, stage: 'company' },
  ]) {
    await assert.rejects(
      resolveCommerceContextSnapshot({
        request,
        env: {},
        userFromRequest: async () => ({ user }),
        adminClient: () => database(fixture),
      }),
      (error) => error instanceof CommerceContextError
        && error.code === 'commerce_context_unavailable'
        && error.status === 503
        && error.retryable === true
        && error.stage === fixture.stage,
    );
  }
});

test('commerce context wraps database-client construction as the same typed outage', async () => {
  await assert.rejects(
    resolveCommerceContextSnapshot({
      request,
      env: {},
      userFromRequest: async () => ({ user: null }),
      adminClient: () => { throw new Error('configuration unavailable'); },
    }),
    (error) => error instanceof CommerceContextError
      && error.code === 'commerce_context_unavailable'
      && error.stage === 'database'
      && error.retryable === true,
  );
});

test('a bearer token with no resolved Auth user cannot silently downgrade to guest', async () => {
  await assert.rejects(
    resolveCommerceContextSnapshot({
      request,
      env: {},
      userFromRequest: async () => ({ user: null, token: 'present', error: null }),
      adminClient: () => database(),
    }),
    (error) => error instanceof CommerceContextError
      && error.code === 'commerce_context_unavailable'
      && error.stage === 'auth'
      && error.retryable === true,
  );
});

test('malformed profile and Company read shapes cannot masquerade as missing rows', async () => {
  await assert.rejects(
    resolveCommerceContextSnapshot({
      request,
      env: {},
      userFromRequest: async () => ({ user }),
      adminClient: () => ({ from: () => query(undefined) }),
    }),
    (error) => error instanceof CommerceContextError && error.stage === 'profile',
  );
  await assert.rejects(
    resolveCommerceContextSnapshot({
      request,
      env: {},
      userFromRequest: async () => ({ user }),
      adminClient: () => ({
        from(table) {
          return table === 'profiles'
            ? query({ data: { company_id: 'company-1' }, error: null })
            : query(undefined);
        },
      }),
    }),
    (error) => error instanceof CommerceContextError && error.stage === 'company',
  );
});

test('paid Order ownership references the Auth Buyer even when no profile row exists', () => {
  const schema = readFileSync(new URL('../supabase/schema-checkout-shipping-quotes.sql', import.meta.url), 'utf8');
  assert.match(schema, /foreign key \(user_id\) references auth\.users\(id\) on delete set null/);
  assert.doesNotMatch(
    schema.slice(schema.indexOf('alter table public.orders drop constraint if exists orders_user_id_fkey')),
    /foreign key \(user_id\) references public\.profiles/,
  );
});
