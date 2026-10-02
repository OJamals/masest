# Acquisition measurement plan

Prepared 2026-10-02. New implementation is local and has not been deployed.

## What is measurable now

Existing first-party `mtrack` captures pageviews, source attribution, and funnel events. Quote submissions emit only after the API returns `ok: true`, `durable: true`, and a quote ID. Paid-order confirmation requires a live paid Checkout Session. The new Ahrefs bridge reuses these triggers and forwards only four event names, with no form properties or quote IDs. Ahrefs continues to own its automatic pageviews.

| Ahrefs custom event | Meaning | Use |
|---|---|---|
| `quote_submit` | Inquiry durably accepted | Acquisition-to-inquiry conversion; not revenue or a qualified lead |
| `checkout_start` | Checkout initiated | Diagnose intent loss; not a purchase |
| `order_confirmed` | Live paid order confirmed in browser | Purchase outcome; browser tracking is not the accounting ledger |
| `document_download` | Document link activated | Buyer research signal; not proof of completed file download |

Create these four Custom events in Ahrefs Web Analytics after release. Event names must match exactly. Ahrefs requires report configuration before they appear as tracked events. No Ahrefs dashboard configuration or historical data retrieval occurred here. [Provider instructions](https://help.ahrefs.com/en/articles/11381932-tracked-events-in-ahrefs-web-analytics).

The bridge queues up to 20 early events until the async provider script loads. Repeated accepted quote IDs reuse existing session deduplication. Missing or throwing providers cannot stop first-party tracking or form outcomes. Advertising blockers, closed tabs, and lost network requests can undercount; accepted inquiries and paid orders in the application remain authoritative.

Ahrefs reads the page URL and referrer itself. For forwarded custom events, the bridge sets `data-page-location` to the pathname and skips forwarding when the document referrer has a query string. Those events remain in first-party tracking. No query capabilities or form properties are added to custom-event payloads. The previously installed provider's automatic pageview behavior is separate from this bridge.

The release build also puts a pathname-only `data-page-location` on every Ahrefs script before its initial pageview and sets `Referrer-Policy: origin` for subsequent navigation. This preserves page-level reports while preventing current-page query capabilities and fragments from reaching Ahrefs. Campaign UTMs remain in the existing first-party attribution pipeline; pathname-only provider URLs do not retain those query parameters. An inbound referrer from an older open page or another site may still carry a query, so the custom-event guard remains necessary. Do not claim all historical provider payloads were sanitized.

## Decisions and evidence

1. **Which search queries bring relevant buyers?** Retrieve Search Console query and landing-page clicks, impressions, CTR, and position for the last complete 28 days and previous 28 days. Inspect priority URLs. Do not substitute a `site:` search for indexation or ranking data.
2. **Which pages create inquiries?** Compare Ahrefs organic/referral landing pages with `quote_submit`. Join first-party inquiry attribution to staff qualification; Ahrefs aggregate events alone do not establish lead quality.
3. **Which distribution effort works?** Use external campaign links with `utm_source`, `utm_medium`, and `utm_campaign`; evaluate accepted inquiries and qualified opportunities. Keep internal links untagged to preserve acquisition attribution.
4. **Which sources yield purchases?** Reconcile browser `order_confirmed` with the order/payment ledger; do not count checkout starts or direct confirmation-page visits as sales.
5. **Do AI assistants send useful traffic?** Examine identifiable referral sources and resulting inquiries. Citation presence and referral visits differ; no citation-rate or AEO rank baseline was collected.

## Current limitations

`claude-seo run google_auth.py --check --json` returned `Claude SEO runtime is not ready. Run /seo setup and retry.` This does not establish credential presence, API permission, or a tier. Repair the plugin through its supported `/seo setup` flow, then run the credential check once. Alternatively analyze an owner-provided Search Console export. No runtime installation was attempted.

Firecrawl URL discovery succeeded but reported low account credits. Public HTTP checks supplied the baseline; no paid enrichment or replenishment was performed.

## Reporting cadence

After release, establish one complete weekly baseline and compare subsequent complete weeks. Report visits by source and landing page, accepted inquiries, qualified opportunities, and paid orders separately. Record content or campaign changes alongside dates. This is an operator workflow, not a scheduled automation.
