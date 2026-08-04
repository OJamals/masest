import assert from 'node:assert/strict';
import test from 'node:test';

import { createStripeAdminHandler } from '../functions/api/admin/stripe.js';

const request = (method = 'GET') => new Request('https://masest.co/api/admin/stripe', { method });

test('Stripe admin status is staff-gated, redacted, and includes CMS shipping-rate health', async () => {
  const handler = createStripeAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true }),
    status: async () => ({
      connected: true,
      config: { secret_key: 'present', webhook_secret: 'present', mode: 'live' },
      webhook: { ready: true, url: 'https://masest.co/api/stripe-webhook' },
    }),
    loadShippingEntries: async () => [{ slug: 'ground', payload: { stripe_rate_id: 'shr_live_ground' } }],
    shippingStatus: async (_env, entries) => ({ ready: true, configured: entries.length, rates: [] }),
  });

  const response = await handler({ request: request(), env: {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.connected, true);
  assert.equal(body.shipping_rates.ready, true);
  assert.equal(JSON.stringify(body).includes('sk_live_'), false);
  assert.equal(JSON.stringify(body).includes('whsec_'), false);

  const denied = createStripeAdminHandler({
    requireStaff: async () => ({ user: null, staff: false }),
    status: async () => assert.fail('status must not run before auth'),
  });
  assert.equal((await denied({ request: request(), env: {} })).status, 401);
  assert.equal((await handler({ request: request('POST'), env: {} })).status, 405);
});

test('Stripe admin status returns a stable redacted provider error', async () => {
  const handler = createStripeAdminHandler({
    requireStaff: async () => ({ user: { id: 'staff-1' }, staff: true }),
    status: async () => { throw new Error('provider included sk_live_do_not_leak'); },
    loadShippingEntries: async () => [],
  });
  const response = await handler({ request: request(), env: {} });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'stripe_status_failed' });
});

test('Stripe payout view requires finance capability and returns no-store redacted preview', async () => {
  for (const auth of [
    { user: null, staff: false },
    { user: { id: 'buyer-1' }, staff: false },
  ]) {
    const authDenied = createStripeAdminHandler({
      requireStaff: async () => auth,
      payouts: async () => assert.fail('payouts must not run before staff auth'),
    });
    const authResponse = await authDenied({ request: new Request('https://masest.co/api/admin/stripe?view=payouts'), env: {} });
    assert.equal(authResponse.status, auth.user ? 403 : 401);
    assert.equal(authResponse.headers.get('cache-control'), 'no-store');
  }

  const denied = createStripeAdminHandler({
    requireStaff: async () => ({ user: { id: 'support-1' }, staff: true, role: 'support' }),
    payouts: async () => assert.fail('support must not read payouts'),
  });
  const deniedResponse = await denied({ request: new Request('https://masest.co/api/admin/stripe?view=payouts'), env: {} });
  assert.equal(deniedResponse.status, 403);
  assert.equal(deniedResponse.headers.get('cache-control'), 'no-store');

  const handler = createStripeAdminHandler({
    requireStaff: async () => ({ user: { id: 'finance-1' }, staff: true, role: 'finance' }),
    payouts: async (_env, options) => ({ limit: options.limit, payouts: [{ id: 'po_1' }], payouts_has_more: false }),
    mappingStatus: () => ({ posting_ready: false, mappings: {}, missing: ['QBO_BANK_ACCOUNT_ID'] }),
  });
  const response = await handler({
    request: new Request('https://masest.co/api/admin/stripe?view=payouts&limit=4'),
    env: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    limit: 4,
    payouts: [{ id: 'po_1' }],
    payouts_has_more: false,
    qbo_mapping: { posting_ready: false, mappings: {}, missing: ['QBO_BANK_ACCOUNT_ID'] },
  });
  const mutation = await handler({
    request: new Request('https://masest.co/api/admin/stripe?view=payouts', { method: 'POST' }),
    env: {},
  });
  assert.equal(mutation.status, 405);
  assert.equal(mutation.headers.get('cache-control'), 'no-store');
});

test('Stripe payout provider failures return stable errors without secret detail', async () => {
  const handler = createStripeAdminHandler({
    requireStaff: async () => ({ user: { id: 'finance-1' }, staff: true, role: 'finance' }),
    payouts: async () => { throw Object.assign(new Error('sk_live_secret leaked by provider'), { code: 'stripe_payouts_failed', status: 502 }); },
  });
  const response = await handler({ request: new Request('https://masest.co/api/admin/stripe?view=payouts'), env: {} });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'stripe_payouts_failed' });
});
