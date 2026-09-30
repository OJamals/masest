# Homepage product-selection release — September 30, 2026

The homepage now leads with VertKleen product selection. Buyers can choose a cleaning category directly after the hero, before reviewing the documented HVAC field result.

## Changes

- Product-focused title, description, headline, and primary action.
- Removed the redundant two-route introduction; moved existing job choices ahead of field proof.
- “Help me choose” and closing product advice open the general quote inquiry with a product-selection message. Email and callback modes preserve that context; replacement-cleaner intent is not selected.
- Added purchasing guidance and a prefilled bulk-supply quote link without hardcoded prices, quantities, or availability promises.
- Kept private-label promotion compact and the existing direct Private Label navigation entry visible. Shared chrome remains byte-identical to the preceding release.
- Added homepage-only conversion events through the existing `window.mtrack` transport. Events distinguish product, job, advice, bulk-quote, and private-label choices by placement. Static action/placement allowlists prevent arbitrary event context; no query strings, contact details, or form contents are captured.
- Versioned homepage CSS and its new tracking module as `20260930a`; updated the private-label page's reference to the same CSS release.

Existing illustration disclosure, packaging qualification, field-result conditions, product documentation, no-JS navigation, keyboard access, and reduced-motion behavior remain intact. No new dependency, backend route, database migration, or CRM change is included.

## Verification

Three new browser contracts cover earlier job selection/direct private-label discovery, product-advice intent across email/callback modes, and one conversion event per mouse/keyboard activation. The existing field-proof ordering contract now follows product selection.

Local source-tree inspection at 390 px measured the selector at approximately 742 px, compared with 2,700 px in the reviewed diff. Full-page height fell from approximately 7,088 px to 6,378 px. These are layout measurements, not conversion or loading-speed claims.

Local release gates passed:

- JavaScript syntax checks and all 3,166 unit tests.
- Support-ticket and marketing-provider-retirement database harnesses.
- Production build and site verification: 131 HTML, 8 CSS, and 301 JavaScript files.
- 91 workspace, 37 commerce, and 87 interaction browser checks.
- Four homepage performance checks.
- Staged-diff whitespace and credential-pattern review.

CI, exact-commit Pages deployment, and live homepage verification are recorded in the release response after publication.

## Deployment and rollback

Production uses the existing GitHub Verify workflow: homepage performance checks, core verification, then Cloudflare Pages deployment of the exact main-branch commit to `masest-commerce`.

Previous production commit: `d04799bb8a16d3cb4169dde1405efbf8b287e850`. If homepage navigation or intake regresses, revert the scoped release commit and run the same verification/deployment workflow. No data rollback is needed.
