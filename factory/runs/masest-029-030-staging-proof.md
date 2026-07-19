# MASEST 029–030 isolated staging proof

Date: 2026-07-19
Operator: Codex
Scope: staging only; no production schema, secret, deployment, webhook, worker, or data mutation

## Isolation boundary

- Supabase organization: existing `Masest` organization (`lzdjlbwypjlaqmbcwvko`)
- Supabase staging project: `masest-staging`
- Supabase staging ref: `qmvzytwdsgfuysgosbhj`
- Supabase production ref: `mvfxzvkzcqmnwcoblvfc`
- Cloudflare staging project: `masest-commerce-staging`
- Cloudflare staging production branch: `staging`
- Stable staging URL: `https://masest-commerce-staging.pages.dev`
- Proof deployment URL: `https://0750fe30.masest-commerce-staging.pages.dev`
- Production Pages project remained `masest-commerce`, branch `main`
- Production `https://masest.co/api/health` and `https://masest.co/js/config.js`
  continued to report `mvfxzvkzcqmnwcoblvfc`.
- Staging health and public configuration reported `qmvzytwdsgfuysgosbhj`.
- The generated staging artifact disabled the live Stripe publishable key.
- Staging secrets are stored in macOS Keychain and Cloudflare secret bindings; no
  secret value is persisted in this evidence.

## Clean staging bootstrap

The first clean `supabase/schema.sql` application rolled back because
`profiles_self_update` referenced `profiles.is_staff` before the column existed.
The base schema now creates the column and includes an idempotent `add column if not
exists` before the policy. `tests/base-schema-bootstrap.test.mjs` captures this
ordering contract.

After the repair:

- `supabase/schema.sql`: transaction committed
- `supabase/schema-phase5.sql`: transaction committed
- previously applied staging-only newsletter, blog-newsletter, and Stripe-effects
  additive schemas remained available
- `profiles.is_staff`: `NOT NULL`, default `false`
- staging Pages deployment compiled the Functions bundle and uploaded 408 static files
- staging `/api/health`: HTTP 200 with staging service-role and anon refs

## masest-029: Stripe replay and interrupted worker

Synthetic signed event:

- event: `evt_masest029_staging_1784469855239`
- type: `charge.dispute.created`
- delivery 1: HTTP 200, `{"received":true}`
- delivery 2: HTTP 200, `{"received":true}`
- ledger rows after both deliveries: exactly 1
- effect: `dispute-alert` / `dispute_alert`
- effect id: `dc85fda3-edab-4088-afea-9e0c47874cd5`

Interrupted attempt:

- worker claimed the effect with a 15-second lease
- attempt count at claim: 1
- Resend test delivery returned HTTP 200
- provider message id: `f2b707ed-57af-4724-ab9a-23b029fa7ba7`
- process terminated after provider success and before
  `record_stripe_webhook_effect_success` or `complete_stripe_webhook_effect`
- provider idempotency identity:
  `stripe/evt_masest029_staging_1784469855239/dispute-alert`

Recovery:

- expired lease was reclaimed by the deployed
  `POST /api/admin/stripe-effects?limit=1` worker
- worker result: claimed 1, completed 1, retried 0, dead 0
- terminal row: `completed`
- terminal attempt count: 2
- `provider_succeeded_at` and `completed_at` are populated
- a provider replay with the same production idempotency-key path returned the same
  Resend message id `f2b707ed-57af-4724-ab9a-23b029fa7ba7`

Result: duplicate webhook delivery produced one effect, an expired lease was
reclaimable, and provider success followed by process loss did not duplicate the email.

## masest-030: disposable campaign interruption and retry

Disposable campaign:

- newsletter/source id: `8366fdbe-5fc9-4f45-addf-0761494e79c7`
- input recipient variants: 3 (original, uppercase, whitespace-padded)
- materialized delivery rows: exactly 1
- delivery id: `412f0133-28e1-442e-b7a1-dc35fb276438`
- queue result: created `true`, total `1`

Interrupted attempt:

- worker claimed the delivery with a 30-second lease
- attempt count at claim: 1
- Resend test delivery returned HTTP 200
- provider message id: `503dc861-31bc-4169-b915-b458d6257c7c`
- process terminated after provider success and before
  `finish_newsletter_delivery`
- the materialized `provider_idempotency_key` remained unchanged

Recovery:

- production `runSupabaseDeliveryWorker` code reclaimed the expired lease
- worker result: claimed 1
- terminal attempt count: 2
- delivery state: `sent`
- source state: `complete`, total 1, sent 1, suppressed 0, dead 0
- parent newsletter state: `sent`, recipient count 1, terminal ledger summary
- terminal provider message id:
  `503dc861-31bc-4169-b915-b458d6257c7c`
- terminal provider message id matched the pre-crash provider message id

Result: normalized overlap deduplicated before transport, the interrupted delivery was
reclaimable, the provider idempotency identity survived the retry, and campaign
completion derived from terminal ledger truth.

## Verification

- Base-schema regression: 1/1 passed
- masest-029 frontmatter-focused suite: 55/55 passed
- masest-030 frontmatter-focused suite: 38/38 passed
- `npm run check`: passed; 221 JavaScript files checked
- `npm run verify`: exited successfully, including full Node tests, static build,
  built-site verification, commerce Playwright smoke, and critical UI Playwright
- scoped `git diff --check`: clean
- post-gate isolation probe:
  - production health/config: HTTP 200, ref `mvfxzvkzcqmnwcoblvfc`
  - staging health/config: HTTP 200, ref `qmvzytwdsgfuysgosbhj`
- live browser smoke:
  - staging homepage reached `document.readyState = complete`
  - expected title, navigation, main landmark, and hero heading rendered
  - 1280px viewport had no horizontal overflow
  - browser console contained zero errors or warnings

## Rollback and cleanup

- Production rollback was unnecessary because production was never targeted.
- Staging deployment rollback is deletion or replacement of
  `masest-commerce-staging`; it has no production custom domain.
- Staging database rollback is deletion of `masest-staging`; production uses a
  different project ref.
- Independent read-only review accepted both specs on 2026-07-19 and confirmed
  the recorded terminal states, attempt counts, released leases, bootstrap fix,
  and staging/production isolation.
- The disposable proof rows were deleted after acceptance. Post-cleanup staging
  counts are zero for the Stripe effect, newsletter delivery, delivery source,
  and parent newsletter. The provider's test-message artifacts remain outside
  the application database.
