# SEO and private-label release — September 29, 2026

The release is live at [masest.co](https://masest.co). Private-label inquiries now have a dedicated landing page and a short contact flow; standard VertKleen shopping remains available.

## Release references

- SEO measurement release: [`7b0b7b8a`](https://github.com/OJamals/masest/commit/7b0b7b8aa8afdba65a02359da861775604564414).
- Private-label implementation: [`e19d1c6d`](https://github.com/OJamals/masest/commit/e19d1c6d74753e5db9520837cf9292508478c945).
- Verified production source: [`693a0867`](https://github.com/OJamals/masest/commit/693a086766d0a8771f5f68dde7d4f7d464e4b26f).
- [Successful verification and deployment workflow](https://github.com/OJamals/masest/actions/runs/36627603617), attempt 2.
- [Cloudflare deployment](https://ac363c8f.masest-commerce.pages.dev), completed September 29, 2026 at 20:56:03 UTC. Provider metadata identified the expected commit with no dirty source changes.

These references record the deployed application. This document adds no runtime changes.

## Shipped behavior

The homepage, navigation, private-label page, and HVAC guidance support customer-logo packaging of existing VertKleen products. Copy identifies the Florida base and shipping availability, without promising custom formulations, unconfirmed minimum quantities, or universal safety claims.

The [contact page](https://masest.co/contact?type=private-label) offers two paths:

| Choice | Required information | Follow-up |
| --- | --- | --- |
| Request a call, selected by default | Phone number | Matthew calls the lead |
| Add request details | Email address | Matthew replies by email; notes and project details are optional |

Both choices save through durable quote intake and the CRM. Internal notifications go to `matthew@masest.co` through Cloudflare Email Service. Valid lead phone numbers are callable in notifications and CRM views. Callback requests discard inactive email fields, send no email acknowledgement, and do not enter email nurture. Marketing consent remains optional and unchecked.

The contact form now loads the existing Turnstile configuration, renders verification after the asynchronous SDK loads, and refreshes tokens after attempts and edits. Compact verification fits narrow forms. Contact choices remain hidden until their handlers are attached. Server-side CAPTCHA validation, rate limits, and submission idempotency remain enforced.

The release retains the earlier SEO corrections: legacy URL redirects, product return-policy structured data, separate pageview/session counting, paginated traffic reads, session-entry attribution, quote-event deduplication, and explicit paid/live-mode confirmation tracking. Shared browser asset versions are coordinated at `20260929c`.

## Product documents

The document work covers 43 revised PDFs across 168 pages. MASEST branding and contact information replace supplier branding, and 16 shelf-life references across nine PDFs now state two years, following the owner's correction. Study durations, measurements, laboratory authorship, and historical SDS dates are preserved.

Existing distribution restrictions remain: 13 revised documents are public and 30 are request-only. Source archives, detailed research evidence, and private review records remain outside the deployed static site. Standalone concrete, Fusion, and Purgo N products are outside this release.

## Verification

- Final CI passed 3,083 unit tests, three database tests, 91 workspace browser regressions, 36 commerce checks, 83 interaction/accessibility checks, and four homepage/cart performance checks. Build and static-site verification passed.
- All 102 live sitemap URLs returned HTTP 200 with a self-canonical URL, one title, one nonempty description, and no `noindex` directive.
- Eight final scripts/styles matched the built release by SHA-256. Earlier release verification also matched all 25 public PDFs and confirmed that all 30 request-only document paths returned 404.
- Both live contact choices persisted one clearly labeled deployment-test lead and displayed the expected success confirmation. Automatic Cloudflare verification succeeded without manual challenge interaction or a verification bypass.
- Cloudflare accepted both internal notifications addressed to Matthew and the email request's acknowledgement. Retrieved provider message content confirmed the recipient and the callback's callable phone link. Recipient inbox placement was not observable from the sending service.
- Test requests used the published business contact details and explicitly requested no follow-up. Neither enabled marketing. No purchase, database migration, DNS change, or mail-MX change was part of this release.

The initial final-release CI attempt exceeded the existing 0.02 cold-cart layout-shift budget in two samples. The same application code passed the preceding workflow, an isolated local run passed all samples, and the unchanged retry passed. The performance budget was not relaxed. This intermittent first-load result remains a performance follow-up.

## Further optimization

Use the corrected measurement data to compare organic landing-page visits with saved lead requests. Review Search Console indexing and query changes after Google recrawls the new pages. Prioritize evidence-supported HVAC, maintenance, and private-label use cases when adding content; distinguish individual study results from general product claims.

Detailed account exports, database identifiers, provider message identifiers, and local research archives are intentionally omitted from this public release record.
