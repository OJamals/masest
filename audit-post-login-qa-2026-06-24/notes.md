# Post-login QA pass - 2026-06-24

Scope: buyer dashboard, business hub, account menu role gating, notification/message routing, and Stripe portal handoff after the post-login state improvements.

## Evidence

- `01-dashboard-overview-desktop.png` - signed-in buyer dashboard overview.
- `02-account-menu-admin-hidden.png` - signed-in account dropdown with no Admin console item for a non-staff buyer.
- `03-dashboard-notifications-before-click.png` - notifications tab with actionable rows.
- `04-dashboard-message-opened-from-notification.png` - message panel after opening an unread message notification.
- `05-dashboard-payment-new-tab-state.png` - dashboard payment portal launch state after handoff.
- `06-business-hub-desktop.png` - business hub with dashboard return paths.
- `07-business-payment-new-tab-state.png` - business payment setup portal launch state after handoff.
- `08-business-hub-mobile.png` - mobile business hub.
- `09-dashboard-notifications-mobile.png` - mobile notifications layout.
- `browser-summary.json` - structured browser assertions from the mocked-auth local run.

## Verified

- Account dropdown uses `can_admin` and hides Admin console for a normal buyer.
- Dashboard and business surfaces both expose back-and-forth navigation between account dashboard and business tools.
- Message notification rows are clickable and keyboard-addressable; clicking the unread message notification switched to `dashboard.html#messages` without a page reload.
- Notification read state updates visually and badge counts decrement in-place.
- Stripe portal handoff now opens a reserved tab that navigates to the returned portal URL, keeps the dashboard/business page in place, and restores the original button after launch.
- Desktop and mobile captures show no blocking overlap or broken layout in the reviewed states.

## Product Gap

The current Stripe portal behavior is an interim mitigation, not the preferred target. Stripe Customer Portal sessions are redirect URL based; Stripe documents creating a portal session and redirecting customers to its short-lived `url`. For a truly inline dashboard experience, build a MASEST billing panel backed by Stripe APIs, using Stripe Elements or embedded Checkout where Stripe supports embedded payment UI.

Useful Stripe references:

- Customer Portal integration: https://docs.stripe.com/customer-management/integrate-customer-portal
- Customer Portal session object: https://docs.stripe.com/api/customer_portal/sessions/object
- Embedded Checkout: https://docs.stripe.com/checkout/embedded/quickstart
- Checkout/Elements options: https://docs.stripe.com/payments/checkout

## Verification

- `node --test tests/post-login-experience.test.mjs tests/payment-portal-states.test.mjs tests/account-nav.test.mjs tests/account-setup.test.mjs` - 22 passed.
- `npm run verify` - JS check passed; 638 tests passed; build copied 219 static files; site verification passed.
