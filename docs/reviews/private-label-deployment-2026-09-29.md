# MASEST private-label and lead-request deployment — September 29, 2026

Status: deployed and verified. Both live request paths save leads, and Cloudflare accepted their notifications addressed to `matthew@masest.co`. Recipient inbox placement is not observable from the sending service.

- Authorization: the owner's request, “deploy the rest,” releases the previously held implementation from this chat.
- Release commit: `e19d1c6d74753e5db9520837cf9292508478c945`.
- [Production verification and deployment](https://github.com/OJamals/masest/actions/runs/36617227129).
- Contact repair commit: `5ebc4e1a44eed41a1ea8f14566dfda25c4ec909b`.
- [Contact repair verification and deployment](https://github.com/OJamals/masest/actions/runs/36620670071).
- Initialization-race repair commit: `20aa86ca106d2732f67e5562cce55220b2fd489f`.
- [Superseded initialization-fix verification](https://github.com/OJamals/masest/actions/runs/36622231850) was cancelled before deployment to include the mobile sizing correction.
- Mobile/initialization release commit: `4a90e6556fb080bc8bfd5e9f3f00c37e7c3f8221`.
- [Mobile/initialization verification and deployment](https://github.com/OJamals/masest/actions/runs/36622724366) passed all gates and deployed [6991d9f9](https://6991d9f9.masest-commerce.pages.dev) at 20:11:20 UTC with matching clean provider metadata.
- Final SDK-loader commit: `c1781301e376589d4474ae537e55ef674ba4d784`.
- [SDK-loader verification](https://github.com/OJamals/masest/actions/runs/36625203041) passed unit, database, workspace, and commerce gates, then stopped on a subpixel precision assertion in the interaction suite; it did not deploy.
- Final release commit: `693a086766d0a8771f5f68dde7d4f7d464e4b26f`.
- [Final verification and deployment](https://github.com/OJamals/masest/actions/runs/36627603617).
- Final Cloudflare deployment: [ac363c8f](https://ac363c8f.masest-commerce.pages.dev), completed September 29, 2026 at 20:56:03 UTC. Clean provider metadata matches local HEAD and remote `main` at `693a086766d0a8771f5f68dde7d4f7d464e4b26f`.
- Initial Cloudflare deployment: [7aa93e18](https://7aa93e18.masest-commerce.pages.dev), completed September 29, 2026 at 19:24:12 UTC; provider metadata matches `e19d1c6d` with `commit_dirty: false`.
- Previous production source / rollback baseline: `7b0b7b8aa8afdba65a02359da861775604564414`.
- Integration checkout: `/Users/omar/.codex/worktrees/seo-measurement/MASEST`, branch `codex/private-label-release-20260929`.
- The original held checkout and the primary workspace were preserved. No database migration, DNS change, or mail-MX change was required.

## Final release verification

- Workflow attempt 2 passed: 3,083 unit tests, three database tests, 91 workspace browser regressions, 36 commerce checks, 83 interaction/accessibility checks, and four homepage/cart performance checks. Build and static-site verification passed. The initial performance failure and unchanged retry are recorded below.
- All 102 live sitemap pages pass HTTP 200, self-canonical, title, description, and indexability checks. Eight final scripts/styles match the local built release by SHA-256; the contact page loads `20260929c`.
- Real Cloudflare verification generated tokens automatically. Both forms returned their expected success headings and persisted exactly one labeled quote each. No manual CAPTCHA interaction or verification bypass was used.
- Callback quote `b23a39ba-3ad8-490b-8c55-beb559effbfe`, saved at 20:56:56 UTC: phone preference, no email, marketing disabled. Its internal email completed on the first attempt at 20:57:04 UTC, with provider message ID `<31jY1735i6MrRtTO7wVr7XySH3dL9V6YGijJ@send.masest.co>`. Provider MIME retrieval confirms Matthew as recipient, the deployment-test marker, and `tel:+18134063852`. The callback autoreply was intentionally skipped with `callback_no_email_requested`.
- Email quote `4d21bff6-4cf6-425c-bd2b-8ff1867b529a`, saved at 20:57:28 UTC: email preference, marketing disabled. Internal email completed on the first attempt at 20:58:01 UTC with ID `<HwsmTNobBhBRRupNPL4xSwbX7vb5MXYwpvGG@send.masest.co>`; provider MIME confirms Matthew and the deployment-test marker. Its acknowledgement completed at 20:58:03 UTC with ID `<YDU0gs2eppqFrGvf2HuzsOmIcMapkz5TfQkv@send.masest.co>`.
- Tests used the published business number and Matthew's supplied email, explicitly labeled “Deployment verification e19d1c6d - no follow-up needed.” No customer data, purchase, marketing enrollment, or unrelated queued email was created or manually processed.
- [Deployed request page](https://masest.co/contact?type=private-label) · [Saved production screenshot](/Users/omar/.codex/worktrees/seo-measurement/MASEST/output/playwright/private-label-production-20260929.png).

## Release scope

The homepage and navigation now introduce private-label supply while retaining direct VertKleen ordering. The private-label page, HVAC application guidance, and product/resource links are included. The contact page defaults to a phone-only callback request. Its email alternative requires an email address and keeps notes and additional project fields optional.

Both choices retain durable, idempotent quote intake and CRM records. Internal notifications address `matthew@masest.co` through the existing Cloudflare transactional email service. Valid lead phone numbers are callable in notifications and the CRM. Callback requests discard inactive email fields, do not enter email nurture, and do not send email acknowledgements. CAPTCHA, rate limits, and acknowledgement after persistence remain enforced.

The preceding SEO measurement release remains intact: correct pageview/session aggregation, paginated traffic reads, session entry attribution, quote-event deduplication, and explicit paid/live-mode confirmation tracking. Cache versions progressed from `20260929a` to `20260929b`; the final SDK-loader correction refreshes all shared scripts/styles and the icon font to `20260929c`.

## Supplier documents and media

- 43 revised PDFs across 168 pages match the supplier-evidence manifest and preserved copies. MASEST branding/contact changes and 16 corrected shelf-life lines follow the owner's instructions. Study observations, laboratory authorship, measurements, and historical SDS dates are preserved.
- Existing distribution policy remains: 13 PDFs are public; 30 are request-only. Original source files, research, review captures, and private review metadata are excluded from the deployed static root.
- The supplier-evidence agent found no residual EMS identity/domain, one-year shelf-life wording, or excluded product entries. Torque's Fusion ingredient reference and Purgo's 12-month study observation are preserved because neither is an excluded standalone product or shelf-life claim.
- Five new image objects were uploaded to `masest-site-images`: three hero sizes and two navigation-logo derivatives. All five canonical public URLs match their registry MIME type, byte count, and SHA-256 (270,540 bytes total). Only these five URLs were purged to remove cached pre-upload 404 responses.

## Pre-release verification

- Initial local full unit run: 3,080 tests; 3,079 passed. The single failure identified an outdated icon-font cache token. That token was corrected; all five font tests then passed. The complete initial release subsequently passed CI with 3,080/3,080 unit tests.
- Database/support checks and three provider-retirement database tests passed.
- Build passed: 284 static files; managed media links in 128 files. Site verification passed: 131 HTML, 8 CSS, 288 JavaScript files.
- Workspace/browser regressions: 91 passed. Commerce smoke tests: 36 passed. Interaction/accessibility suite: 83 passed.
- Homepage performance: 4 passed. Retained historical story performance: 1 passed, all three samples within budget.
- Production dependency audit: zero vulnerabilities.
- Browser preview confirmed the callback and email choices, updated homepage, and new navigation.
- Read-only production schema inspection confirmed nullable name/email fields and the existing quote-intake/readiness RPCs. Cloudflare production Pages retains its `EMAIL_SERVICE` binding to `masest-email-service`; `send.masest.co` is enabled.
- Reviewed 267 staged paths: 142 contain only cache-token changes, 43 are PDF revisions, and five are new image assets. Staged additions contained no detected credential patterns, conflict markers, or research/review artifacts.

## Production verification

Verified against the deployed initial release:

- All 102 sitemap URLs return 200 with a self-canonical URL, one title, one nonempty description, and no noindex directive. The live URL set matches the generated sitemap.
- All 33 sampled static assets match local SHA-256: eight critical scripts/styles and all 25 public PDFs, including all 13 revised supplier PDFs. All 30 request-only supplier PDF paths return 404.
- Fifteen product pages retain 30 offers with return-policy structured data; no offer is missing it.
- `/product?id=hcr` redirects with 301 to `/products/hcr`; `/products/contact` redirects with 301 to `/contact`.
- Live browser inspection confirmed the homepage, private-label page, contact choices, hero imagery, and correct visible logo variant. The labeled callback test did not persist a quote: it reached the honest email-draft fallback.
- Direct validation probes returned `valid_phone_required` for an invalid phone and `captcha_failed` for a valid phone without a CAPTCHA token. Production's read-only `assert_email_effects_ready` RPC returns true.

The live callback failure exposed a missing client integration: the contact page loaded neither public Turnstile config nor a widget, while the API required verification. The repair loads the existing public config, renders the existing managed widget, prevents submission before verification, refreshes tokens after attempts and edits, and excludes transport tokens from fallback email drafts. No widget, secret, domain, backend verification policy, or other infrastructure setting was changed.

The CAPTCHA repair passed JavaScript checks, build/site verification, and 15 focused tests. New production-origin browser cases cover both request choices, fresh tokens on retries, script failure, preserved input, and exclusion of CAPTCHA tokens from fallback drafts. It contains three functional/test files plus 175 coordinated cache-token-only updates.

Its first full CI run passed 3,081 of 3,082 unit tests and found an initialization race in the private-label journey. `.request-mode-chooser` used `display: grid` without honoring its initial `hidden` state; an early click could arrive before handlers were attached and disappear when initialization selected the default callback mode. A deterministic test with a deliberately delayed module reproduced the bug. The follow-up adds the missing hidden-state rule; all 21 targeted contact/private-label/cache tests now pass. The `20260929b` version remains appropriate because the failed CI run never deployed it.

The narrow-screen browser check measured a 256px form at a 320px viewport. Cloudflare's flexible widget has a documented 300px minimum width. The final correction uses its 150px compact widget with `appearance: "interaction-only"`, so verification is visible only when interaction is required. A browser fixture models the documented visible challenge dimensions; both mobile and desktop requests pass, and all 21 focused tests remain green. Existing managed-mode and backend token validation stay unchanged. References: [Cloudflare widget configuration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/), [client integration](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

The mobile/initialization release passed full CI: 3,083 unit tests, three database tests, 91 workspace regressions, 36 commerce smoke tests, 83 interaction/accessibility tests, and four homepage performance tests. Its live browser check then exposed an SDK contract that the initial mock did not enforce: `TurnstileError: [Cloudflare Turnstile] Remove async/defer from the Turnstile api.js script tag before using turnstile.ready()..`.

The final correction calls `turnstile.render()` directly from the async script's load callback. The regression mock now rejects the unsupported `ready()` call. All 21 focused tests, JavaScript checks, build, and site verification pass. A temporary, no-store browser response override of only the contact script validated direct rendering against the real Cloudflare SDK: a verification token was generated automatically and no browser errors occurred. No request was submitted during that diagnostic. Interception was cleared, debugging was disabled, and the browser navigated away, removing the override. The final committed code subsequently passed CI and the live checks recorded above; inbox placement remains unverified.

The SDK-loader workflow measured an existing 44px disclosure button as 43.999755859375px. Commit `693a0867` gives that browser geometry assertion a 0.001px floating-point tolerance while retaining the 44px target requirement. It changes one test only; ten repeated focused browser runs pass. The shared asset token stays `20260929c` because neither preceding failed workflow deployed it.

The first `693a0867` workflow attempt stopped in the cart performance gate: two cold-cart samples measured CLS 0.02649, above the 0.02 budget; the third was 0.01321, and all warm samples were 0.00269. No cart behavior changed in this release, and the identical application code passed this gate in the preceding `c1781301` workflow. An isolated local reproduction passed all three cold samples at 0.01126 and all warm samples below 0.00041. With no repeatable local failure, the failed CI jobs were rerun once without code changes or budget changes. This records the observed runner/timing variance rather than treating the first run as a pass.

## Rollback

To restore the preceding measurement release, revert `693a0867`, `c1781301`, `4a90e655`, `20aa86ca`, `5ebc4e1a`, and then `e19d1c6d`, and deploy through the normal production workflow. No schema rollback is needed. The five new media objects can remain unused; do not delete source documents or reset either original workspace. Reverting only the repairs would restore known contact-form defects.
