// The one place Pages Functions build a Stripe client, so every call uses the same API
// version and the Workers fetch transport.
//
// The version is pinned here on purpose. Without it the SDK's own default applies, which
// moves whenever the package is upgraded; a Stripe API upgrade should be a deliberate edit
// to this constant, checked against the changelog, not a side effect of `npm update`.
// tests/stripe-client.test.mjs keeps it equal to the version the installed SDK was
// generated for, and forbids building a client anywhere else.
//
// Webhook events are rendered in the webhook endpoint's API version, which Stripe sets
// separately (the endpoint currently pins none, so events use the account default).
import Stripe from 'stripe';

export const STRIPE_API_VERSION = '2026-08-26.dahlia';

export function createStripeClient(secretKey) {
  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(),
  });
}
