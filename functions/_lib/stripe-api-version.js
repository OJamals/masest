// The Stripe API version every request from Pages Functions uses: SDK clients
// (stripe-client.js) and the raw fetch calls (stripe-runtime.js, stripe-payouts.js).
// Kept free of imports so a module that only needs the version does not load the SDK.
// tests/stripe-client.test.mjs keeps it equal to the installed SDK's pinned version.
export const STRIPE_API_VERSION = '2026-08-26.dahlia';
