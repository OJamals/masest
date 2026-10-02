# Implementation review and privacy finding resolution

Reviewed on 2026-10-02. This specialist changed only this report, not website source.

## Verdict

The new proof-record links and custom-event bridge are correct within their stated scope. Custom-event URL handling and initial automatic-pageview URL handling are now verified against the real provider. Incoming referrers from older or external pages retain the limitation described below.

## Resolved P1: provider reads URLs independently

The initial bridge passed only an event name to `window.AhrefsAnalytics.sendEvent`, but the actual provider script attached its own full current URL and referrer. A network-free VM reproduction using the real fetched provider script and a fake project key showed `order_confirmed` carrying a query-bearing `session_id`, email, and fragment. The first-party packet stripped those values. API-argument stubs alone did not detect this difference.

Latest repair in `flushAhrefsEvents`:

- Sets the real provider script's `data-page-location` to `location.pathname` before sending custom events.
- Drops the optional-provider queue when the incoming referrer has a nonempty query string.
- Preserves the first-party event and its existing deduplication, accepted-quote/paid-order gates, and attribution behavior.

Additional repair in `tools/cf-build.mjs` sets pathname-only `data-page-location` on every provider script before it can execute, protecting the initial automatic pageview as well. The built header now uses `Referrer-Policy: origin`, reducing referrer disclosure on navigations from the updated site.

## Real-provider verification

Executed the provider source from `https://analytics.ahrefs.com/analytics.js` in a VM with intercepted `XMLHttpRequest` and `sendBeacon`, a fake project key, and fake capabilities/email. No analytics event reached Ahrefs. The latest rerun populated the provider script attributes directly from compiled `dist/order-confirmed.html`. Provider source SHA-256: `b270afc5f9df7bcd9239c22857fb1511bba1398a28b1c3548272d720cb433c62`.

Current URL for all cases: `https://masest.co/order-confirmed?session_id=capability-token&email=buyer%40example.com#private`.

| Provider timing | Referrer | Custom event outcome | First-party outcome |
|---|---|---|---|
| Already loaded | `https://checkout.stripe.com/` | One `order_confirmed`; URL `https://masest.co/order-confirmed` | One order event; path `/order-confirmed` |
| Delayed loading | `https://checkout.stripe.com/` | One after load; repeated load notifications do not repeat it; path-only URL | One order event |
| Already loaded | `https://masest.co/contact?email=buyer%40example.com` | Zero custom events | One order event |
| Delayed loading | `https://masest.co/contact?email=buyer%40example.com` | Zero custom events after load | One order event |

Each case called the same local acknowledgement twice using one dedupe key. Query, fragment, and local order ID were absent from the safe custom-event payload. The provider supplied its ordinary language/screen/title metadata independently.

With the compiled script override, every matrix case's initial automatic pageview used `https://masest.co/order-confirmed`, excluding the current query and fragment. Both safe-referrer custom-event timing cases still emitted exactly once. Both query-referrer cases still omitted custom events while retaining one first-party order event.

Focused regression result: `node --test tests/conversion-behavior.test.mjs` → 13 passed, zero failed. The added regression explicitly checks canonical custom-event location and first-party-only handling of query-bearing referrers.

Earlier in-memory mutations removed the event allowlist or load flush. They respectively produced unwanted pageview/unknown events or lost early custom events, showing that these tested behaviors distinguish the intended implementation.

## Incoming-referrer boundary

The initial automatic pageview now excludes the current URL's query and fragment. However, the provider still reads `document.referrer` itself. The VM's deliberately supplied older-page referrer `https://masest.co/contact?email=buyer%40example.com` remained in that automatic pageview's referrer field, while the custom-event guard skipped optional events. An incoming referrer is determined by the sending page's policy; setting the new receiving page's header cannot retroactively rewrite it. The updated site's origin policy limits subsequent navigations from updated pages, but does not establish a global or historical guarantee for older/external sources. Do not describe all Ahrefs payloads or historical requests as PII-free.

Query-bearing-referrer visits are intentionally undercounted in optional-provider funnel reports; first-party conversions remain the complete source within the existing tracking contract.

## Proof links and cache review

Build output inspected before the privacy repair:

- All three matching `/proof` cards expose descriptive absolute links to existing article files.
- HVAC HCR's featured proof card retains its matching field-record link.
- Shared `proofCardHtml` keeps generated HTML and CMS-refreshed cards aligned. The new mapped URLs/labels are fixed approved literals rather than input-derived HTML.
- All 117 source HTML `js/main.js` references use `20261002a`; both nested module imports point at the updated snapshot/card modules.
- Latest privacy rebuild: all 120 compiled HTML files contain exactly one provider script with the expected static pathname override; no mismatches.
- All 90 latest compiled tracking references use `7bfc59223419`, matching the SHA-256 prefix of the current `js/track.js`.
- Latest built `_headers` contains `Referrer-Policy: origin`.

No dependency, source-escaping, broken-link, or cache-import blocker was found in the reviewed change.

Primary API contract: [Ahrefs tracked events](https://help.ahrefs.com/en/articles/11381932-tracked-events-in-ahrefs-web-analytics) documents `sendEvent` and separate dashboard event configuration. This review validates emitted requests, not dashboard configuration or recorded traffic.

Graft implementation-review discovery: 4 calls, estimated savings 32,616 tokens. The latest initial-pageview review added 1 call and 6,477 tokens. No dollar estimate supplied.
