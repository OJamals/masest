import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_STRIPE_WEBHOOK_EVENTS,
  stripeCredentialMode,
  stripeIntegrationStatus,
  stripeRuntimeError,
  stripeShippingRatesStatus,
} from '../functions/_lib/stripe-runtime.js';

test('Stripe credential mode never exposes credential material', () => {
  assert.equal(stripeCredentialMode('sk_live_secret'), 'live');
  assert.equal(stripeCredentialMode('rk_live_restricted'), 'live');
  assert.equal(stripeCredentialMode('sk_test_secret'), 'test');
  assert.equal(stripeCredentialMode('rk_test_restricted'), 'test');
  assert.equal(stripeCredentialMode(''), 'missing');
  assert.equal(stripeCredentialMode('unexpected'), 'unknown');
});

test('CMS shipping rates must exist, be active, and match production Stripe mode', async () => {
  const env = { APP_URL: 'https://masest.co', STRIPE_SECRET_KEY: 'sk_live_secret' };
  const entries = [{ slug: 'ground', payload: { active: true, stripe_rate_id: 'shr_ground' } }];
  const testMode = await stripeShippingRatesStatus(env, entries, {
    retrieveShippingRate: async () => ({ active: true, livemode: false }),
  });
  assert.equal(testMode.ready, false);
  assert.equal(testMode.rates[0].mode, 'test');
  const live = await stripeShippingRatesStatus(env, entries, {
    retrieveShippingRate: async () => ({ active: true, livemode: true }),
  });
  assert.equal(live.ready, true);
});

test('production checkout fails closed on test key or missing webhook secret', () => {
  assert.equal(stripeRuntimeError({
    APP_URL: 'https://masest.co',
    STRIPE_SECRET_KEY: 'rk_test_secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
  }), 'stripe_live_mode_required');
  assert.equal(stripeRuntimeError({
    APP_URL: 'https://www.masest.co',
    STRIPE_SECRET_KEY: 'sk_live_secret',
  }), 'stripe_webhook_not_configured');
  assert.equal(stripeRuntimeError({
    APP_URL: 'https://masest.co',
    STRIPE_SECRET_KEY: 'sk_live_secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_live',
  }), null);
});

test('Stripe admin status verifies production webhook URL and required events without secrets', async () => {
  const status = await stripeIntegrationStatus({
    APP_URL: 'https://masest.co/',
    STRIPE_SECRET_KEY: 'sk_live_secret',
    STRIPE_WEBHOOK_SECRET: 'whsec_live',
  }, {
    listWebhookEndpoints: async () => ({ data: [{
      id: 'we_live',
      livemode: true,
      status: 'enabled',
      url: 'https://masest.co/api/stripe-webhook',
      enabled_events: [...REQUIRED_STRIPE_WEBHOOK_EVENTS],
    }] }),
  });
  assert.equal(status.config.ready, true);
  assert.equal(status.webhook.ready, true);
  assert.deepEqual(status.webhook.missing_events, []);
  assert.equal(JSON.stringify(status).includes('sk_live_secret'), false);
  assert.equal(JSON.stringify(status).includes('whsec_live'), false);
});
