# Next-session entry prompt — after 2026-09-15 session 8 (afternoon)

Continue the MASEST website renovation — transforming masest.co from an informational
site into a high-trust, conversion-optimized platform that sells the VertKleen line,
merging an Apple-grade aesthetic with industrial credibility.

Work in `/Users/omar/Claude/Projects/MASEST` on `main`. Other agents edit and push live (an
SES agent pushed during this session): `git fetch && git rebase origin/main` before every
push; build in a `git worktree` when the shared checkout holds someone else's work, and give
the worktree its own `node_modules` if you change dependencies. `.dev.vars` holds the
credentials.

Read, in order: `docs/handoff-2026-09-15b.md` (Stripe work, open items, traps), then
`docs/handoff-2026-09-15.md` (shipping and returns terms, destination gate, CMS dispatch),
then `docs/superpowers/specs/2026-09-15-embedded-checkout-design.md`.

## Verify state before trusting this prompt

```sh
git fetch && git status --short && git log --oneline -6 origin/main
gh run list -R OJamals/masest --limit 5 --json name,status,conclusion,headSha,event
node -e 'console.log(require("./node_modules/stripe/package.json").version)'   # expect 22.6.2
```

Confirm production answers `GET /api/order?session_id=cs_live_nonexistent` with a JSON 404
(`order_not_found`), which proves the Stripe v22 client loads (use `ctx_execute` for curl).

## 1. Open items, in value order

1. **Embedded checkout, spec steps 2–6.** Server sessions in `ui_mode: 'elements'`, the payment
   step on `checkout.html` with `initCheckoutElementsSdk` and the Payment Element (cards and ACH
   only), the "Have a code?" promo field, quote checkout reopening a session by client secret
   (confirm in Stripe's docs first), then tests. Replace the hosted page outright — no switch.
2. **One API version for events and calls.** The webhook endpoint pins none, so events use the
   account default `2026-05-27.dahlia` while the SDK pins `2026-08-26.dahlia`. Ask me to upgrade
   the account default in Stripe Workbench, then remove the dual-shape readers from `4efcff0c`.
3. Test the handlers that build Stripe clients inline and still lack SDK coverage:
   `programs/subscribe.js`, `account/billing-portal.js`, `admin/users.js` payment methods.
4. From the morning: `MerchantReturnPolicy` / `OfferShippingDetails` structured data, a real
   blog byline, and deeper blog posts.

## How I want you to work

- Grill me on decisions; give each option's cost and a recommendation. Money and policy calls
  are mine.
- Ground every Stripe claim in Stripe's current docs (`docs.stripe.com/<page>.md`) or the
  `stripe-node` source for the installed version, not memory.
- Probe discipline: never regex HTML; mutation-test every probe and guard test you add. `git grep
  -E` does not support `\s` or `\b` — scan with Node and check known positives.
- Stripe tests: stub `globalThis.fetch` before building a client; the SDK captures fetch at
  construction.
- `npm test` skips `tools/*.spec.mjs`; run the Playwright stages that cover what you changed
  before pushing. One Playwright owner at a time; never `npm test` beside Playwright.
- A push to `main` cancels an in-flight Verify, including another agent's; check `gh run list`
  and wait. A pushed range whose tip says `[skip ci]` runs no Verify.
- Public cache token `20260915a`, admin token `20260914a`; never reuse a spent token.
