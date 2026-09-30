# MASEST / VertKleen — Search Console and measurement follow-up

Reviewed September 28, 2026. Property: `sc-domain:masest.co`.

**Finding:** the five priority pages inspected are indexed. Google's live test accepts the released return-policy markup. Organic reach remains small, and the database contains no stored quotes or orders created during the audited period. Several analytics defects made the existing dashboard unreliable for evaluating that reach.

**Deployment update:** the user subsequently authorized deployment of the SEO optimizations. Measurement corrections and shared asset-cache references were committed and deployed as `7b0b7b8aa8afdba65a02359da861775604564414` at September 28, 9:44 PM EDT. CI and live verification passed; see the [deployment record](seo-deployment-2026-09-28.md). The earlier landing pages, simplified forms, supplier documents, and Matthew email routing remain in their existing held checkout. No migration, live payment, test lead, or email was submitted.

## Current Google evidence

Read from the signed-in Search Console UI; no Google MCP setup was resumed.

- Performance: selected **3 months**, chart actually covers **July 30–September 25, 2026**. **24 clicks**, **1.31K impressions** as rounded by Google, **1.8% CTR**, **17.4 average position**. The earlier export ended September 24. One additional click is not evidence of a trend or a measured repair effect.
- Indexing overview: **105 indexed / 499 not indexed**. This is not a count of broken commercial pages; the September 26 exclusion analysis still applies.
- Sitemap: `https://masest.co/sitemap.xml`, **Success**, last read **September 27**, **101 discovered pages**. URL Inspection showed a temporary sitemap-processing message for several indexed URLs, while the property-level sitemap report showed success. No new submission was needed.
- Product snippets: **5 valid / 0 invalid**. Merchant listings: **5 valid / 0 invalid**. Breadcrumbs: **6 valid / 0 invalid**. HTTPS: **15 HTTPS / 0 non-HTTPS**. Core Web Vitals still has insufficient field data.

All five inspected URLs were indexed, fetched successfully, allowed crawling/indexing, and had matching declared and Google-selected canonicals:

| URL | Last indexed crawl shown by Google |
|---|---|
| `/about` | September 24, 6:21:22 PM |
| `/blog/how-to-descale-heat-exchanger` | September 25, 8:20:13 PM |
| `/blog/commercial-gym-cleaning-checklist` | September 26, 9:34:34 AM |
| `/blog/commercial-kitchen-degreasing-guide` | September 27, 7:10:00 AM |
| `/products/hcr` | September 18, 2:54:57 PM |

Times are transcribed as displayed by Search Console. These five inspections do not establish that every sitemap URL is indexed.

### Released schema accepted by Google's live fetch

HCR's indexed copy predates the September 26 repair. A fresh Google live test on September 28 at **8:46:29 AM** showed:

- URL available to Google and eligible for indexing.
- One valid Product item, one valid Merchant listing item, and one valid Breadcrumb item.
- Merchant listing contains the published return policy on both offers: US, 30 days, mail return, customer-paid return shipping, and the shipping/returns policy link.
- The only merchant warnings in that live result were **two optional `shippingDetails` warnings**, one per offer. No missing return-policy warning remained in the live test.

This establishes live acceptance for the sampled HCR page, not a completed property-wide report refresh. No bulk indexing requests or repeated submissions were made. Google says recrawling can take days to weeks and does not guarantee inclusion; optional structured-data warnings are distinct from errors that prevent rich-result eligibility. [Recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl), [merchant listing requirements](https://developers.google.com/search/docs/appearance/structured-data/merchant-listing).

Keep shipping markup tied to actual supported destinations, carrier rates, and handling estimates. Do not insert fabricated free shipping or transit promises merely to clear optional warnings.

## Production measurement baseline

Read-only Supabase queries, fixed cutoff **2026-09-28T12:44:19.624Z**. Start dates are inclusive; cutoff exclusive. Paginated results were reconciled to exact database counts. No visitor IDs, contact data, credentials, or checkout capabilities were exported.

| Metric | July 30 to cutoff | September 1 to cutoff |
|---|---:|---:|
| All recorded browser events | 1,886 | 908 |
| Pageviews | 1,869 | 904 |
| Distinct session IDs with a pageview | 848 | 567 |
| Checkout-start events | 11 | 0 |
| Document-download events | 6 | 4 |
| Quote-submission events | 0 | 0 |
| Order-confirmation events | 0 | 0 |
| Stored quotes created in period | 0 | 0 |
| Stored orders created in period | 0 | 0 |

September referrer evidence includes 23 pageviews from `www.google.com`, 4 from `www.bing.com`, and 1 from `duckduckgo.com`. Another 224 carry an internal MASEST referrer; 652 have no referrer. Existing tracking did not preserve entry referrers through navigation, so these cannot be converted into exact organic-session totals. No referrer does not prove direct acquisition. UTM tags were absent on 891 of 904 September pageviews.

These are browser events and session IDs, not verified people or prospective customers. Internal visits, testing, unrecognized automation, and repeat visits can contribute. The dataset includes dashboard traffic. The 11 checkout starts occurred August 4–5; their commercial intent is unknown. Recorded quotes/orders do not cover off-site calls, email conversations, other sales channels, or deleted records. The site uses first-party `/api/track` data; this was not a GA4 audit.

## Measurement fixes completed and subsequently deployed

1. **Correct view and visitor counts.** The overview previously counted all event rows as views and counted rows with a visitor ID as unique visitors. It now counts pageviews and distinct session IDs with pageviews. An event-only window stays at zero pageviews.
2. **Remove silent database truncation.** Reproduced against production: the old `.limit(10000)` query returned **1,000 rows despite 1,886 matches**. The replacement paginates using stable timestamp/ID ordering and a fixed end time. Its read-only production check loaded **all 1,886 rows**, including **1,869 pageviews / 848 session IDs**. A deliberate 10,000-event bound is explicitly marked partial; unavailable data is identified separately.
3. **Preserve entry search attribution.** Future browser events retain the session's entry referrer origin through internal navigation. URL paths, query strings, and fragments are removed from that referrer. Recognized search sources are grouped as organic; absent and historical internal referrers are labeled as unknown rather than confidently classified as direct.
4. **Deduplicate quote acknowledgements.** Repeated acknowledgements of the same durable quote ID emit once per browser session. The ID remains in local session storage and is not copied into the tracking payload.
5. **Exclude unpaid and test confirmations.** `order_confirmed` now requires an explicit paid status and live-mode result from the server's Stripe lookup. An unpaid ACH return does not consume the later paid event; reloads remain deduplicated.
6. **Label event metrics accurately.** The admin report identifies session IDs and browser events, directs staff to Quotes/Orders for business outcomes, and discloses partial windows. Rates remain event-per-pageview diagnostics, not an attributable customer conversion rate.

The beacon endpoint remains a public, best-effort collection endpoint. Browser deduplication is not a server idempotency guarantee; beacons can be missed or forged. Paid confirmation views omit payments that settle after the buyer leaves. **Use the durable quote/order records for business totals, not these events.** Historical attribution cannot be repaired from missing data.

## Audit-stage verification

The following records the initial local audit stage. The later release passed the complete production workflow; its final checks and live results are in the [deployment record](seo-deployment-2026-09-28.md).

- 34 focused tests passed, including pagination beyond the response cap, lower server caps, window boundaries, unavailable data, session deduplication, referrer minimization, quote retries, unpaid/test payments, confirmation reloads, and shared admin asset-version consistency.
- JavaScript syntax check passed for 386 files.
- Local Cloudflare Pages Functions bundle compiled successfully with Wrangler 4.131.2; no deploy command ran.
- Read-only production comparison confirmed that the new loader matches the complete fixed snapshot.
- Full `npm test`: **3,098 tests; 3,097 initially passed**. The sole failure caught a mismatched admin asset token introduced in this slice. Restored the shared token; all 10 tests in that file passed, and the subsequent 34-test focused run passed. The full suite was not repeated after that correction.
- Final code diff reviewed; `git diff --check` passed. The final admin source changes also passed individual syntax checks.

No full production release gate or live lead/email/payment test had run at the initial audit stage. The subsequent measurement release passed the full production gate and refreshed the shared script version to `20260928a`; live lead/email/payment tests remain unperformed. Before releasing the held UI work later, reconcile its shared `js/main/engagement.js`, tracking, and admin code with this deployed commit. Follow the shared asset-release-token workflow; a single admin import must not receive a different token from the rest of its module graph. Review documents are local artifacts, not public site content.

## Next optimization scope

Keep the business model **lead-first B2B with ordering available for standard products**. Lead with the job, product fit, available evidence, and an easy conversation. White-label prospects need branding, packaging, volume, and supply answers; ordinary maintenance buyers need application guidance and product selection. Preserve those distinct paths without expanding the inquiry form.

Prioritize the three existing CMS-owned articles below. Their demand signals come from the September 26 Search Console export, not estimates of market-wide search volume. Prepare edits in the canonical CMS draft workflow; publication remains held.

| Priority | Existing page and observed opportunity | Draft scope and conversion purpose |
|---|---|---|
| 1 | Heat-exchanger guide: 243 impressions, position 34.72, no clicks | Answer equipment/material compatibility, scale type, product selection, and what information is needed to recommend a process. Put evidence-backed HCR/CR/CR HD comparison and one application-help CTA near that decision. Preserve use-specific directions; obtain matched supplier evidence before changing concentrations or safety claims. |
| 2 | Commercial-kitchen degreasing guide: 102 impressions, position 21.80, no clicks | Organize by grease problem and surface. Explain product fit, compatibility checks, relevant TDS/SDS access, and rinsing requirements only where supported. Offer product-selection help with one clear CTA. |
| 3 | Gym-cleaning checklist: 138 impressions, position 8.91, no clicks | Improve title/snippet specificity and provide a useful, scannable checklist. Separate cleaning from disinfectant claims, retain label-supported use, and place Purgo/Multiwash links where the task calls for selection. Do not imply every gym reader is a private-label buyer. |

Across the eventual commercial pages, make Florida location, supported shipping, logo/label options, sample/application support, and an identifiable contact easy to find. Confirm packaging options, minimums, lead times, and response promises before publishing them. Avoid blanket “safe,” “non-toxic,” occupied-space, or universal-material claims without matching product/use evidence.

The live HCR product description currently emphasizes brewery CIP. For HVAC searchers, align the heat-exchanger guide and held HVAC landing page with the correct application evidence and product-selection path; do not assume brewery-focused copy answers their equipment questions.

For the next measurement slice, attach a non-sensitive acquisition record to each durable lead, separate call/email requests and samples, record qualification/quote-issued outcomes in the CRM, and derive paid-order reporting from canonical payment state. Add an explicit testing/staff exclusion and server-side conversion deduplication before using attribution to justify ad spend. Do not present browser form starts or CTA clicks as leads.

After sufficient post-release data accumulates, compare equal 28-day windows by landing page and available query intent. Review qualified inquiries, quotes issued, and paid orders alongside clicks. At current volume, manual review of each genuine inquiry matters more than small percentage changes. Manufacturer/partner references and legitimate trade visibility can broaden discovery; no outreach or external messages were sent.
