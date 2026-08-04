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
