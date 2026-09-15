// The one place Pages Functions build a Stripe client, so every call uses the same API
// version and the Workers fetch transport.
//
// The version is pinned on purpose, in functions/_lib/stripe-api-version.js. Without it the
// SDK's own default applies, which moves whenever the package is upgraded; a Stripe API
// upgrade should be a deliberate edit to that constant, checked against the changelog, not a
// side effect of `npm update`. tests/stripe-client.test.mjs keeps it equal to the version the
// installed SDK was generated for, and forbids building a client anywhere else.
//
// Webhook events are rendered in the account's default API version, because the webhook
// endpoint pins none. Keep that default on the same version (Stripe Workbench).
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from './stripe-api-version.js';

export { STRIPE_API_VERSION };

export function createStripeClient(secretKey) {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
