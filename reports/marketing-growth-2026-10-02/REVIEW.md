# MASEST marketing and search improvement batch

Prepared and approved for release 2026-10-02 on `codex/marketing-seo`, based on production commit `fb593aadbfb2d6e202c5aa4ca6016cf0bac0b205`. The primary checkout's unrelated edits were preserved. The checks below describe the preparation baseline; final commit, CI, and production evidence are recorded separately after deployment.

## Result

All 50 installed marketing skill entrypoints were reviewed. Relevant supporting references informed the buyer interview, worksheet, distribution drafts, attribution process, and calculator specification. The library's SaaS assumptions and unsourced growth multipliers were not adopted as MASEST facts.

The public baseline does not indicate a basic crawl failure: all 102 sitemap URLs returned HTTP 200, each had one matching self-canonical and H1, unique titles and descriptions, and parseable JSON-LD. This proves accessible page contracts, not Google indexation, rankings, demand, sales, or AI citations. Those measurements were not retrieved.

The site already has useful application, procurement, and heat-exchanger guidance. This batch improves discovery of existing evidence and measurement rather than publishing redundant sector pages or unconfirmed chemistry claims.

## Website changes

1. **Evidence links:** Three matching result cards now link directly to the distribution-center assessment, fire-pump field record, and Brevard HVAC record. The shared renderer supplies generated HTML, relevant product/industry cards, and CMS-refreshed proof cards. Links remain visible without opening disclosures or enabling JavaScript. Record wording and chemical claims are unchanged.
2. **Ahrefs conversions:** The existing first-party funnel events now forward `quote_submit`, `checkout_start`, `order_confirmed`, and `document_download` to Ahrefs. Accepted-inquiry and live-paid-order gates remain authoritative. Existing quote deduplication and async provider loading are handled; pageviews are not duplicated. No form details, quote IDs, or arbitrary event properties are forwarded.
3. **Tracking URL controls:** Every compiled Ahrefs tag receives a pathname-only page-location override before its initial pageview. Custom forwarding skips query-bearing incoming referrers. The published referrer policy changes to `origin` for subsequent navigation. Current-page checkout capabilities and fragments are excluded from provider page-location payloads. Inbound referrers from older/external pages remain a documented limitation; this is not a claim of universal historical redaction.
4. **Cache consistency:** Updated public entrypoint/module versions and content-hashed first-party tracker references ensure browsers fetch the new behavior. Generated page changes primarily propagate the shared release version. Pricing module references preserve the existing shared-cache contract.
5. **Sitemap provenance:** The build/deploy checkout now fetches full Git history. Shallow history incorrectly attributed an unchanged page to a test-only commit; full history recovers the actual file change date. The performance-only checkout is unchanged.
6. **Research isolation:** The static build excludes `reports/`, including the new machine-readable audit evidence.

Implementation: `js/proof-records.js`, `js/track.js`, `js/main.js`, related module/version references, `tools/cf-build.mjs`, `.github/workflows/verify.yml`, and generated outputs.

## Marketing deliverables

- [Shared product marketing context](../../.agents/product-marketing.md): v1 draft separating source-backed capabilities, audience hypotheses, and missing owner inputs.
- [All-skills review and distribution kit](skills-and-distribution.md): 50-skill application matrix; non-leading interview questions; printable side-by-side test worksheet; four social drafts; partner workshop concept; contributed-article pitch; inbound replies; qualified-inquiry handoff; cost-comparison tool specification.
- [Measurement plan](measurement-plan.md): exact event definitions, dashboard setup, attribution decisions, source-to-qualified-inquiry reporting, and current access limitations.
- [Technical findings](findings/technical.md), [content findings](findings/content.md), and [implementation review](findings/content-implementation-review.md).

The shared context is a draft for correction, not owner-certified positioning. The kit contains drafts only. No outreach, account posting, ad spend, automation, or third-party endorsement was performed.

## Verification

- `npm run build` passed. Final static rebuild passed after privacy and artifact-exclusion edits.
- Targeted conversion, cache-release, build/deployment, CMS pricing/snapshot, public-document, and UI-structure tests passed. No full-suite or CI claim is made for this unpushed batch.
- Ten existing Playwright contact and CMS-proof regressions passed.
- Mobile proof links passed with JavaScript enabled and disabled: all three visible, correct destinations, no horizontal overflow.
- Source verification passed: 131 HTML, 11 CSS, and 302 JavaScript files checked.
- Compiled verification passed: 120 published HTML pages, exactly one correctly configured Ahrefs script in each head; all 90 first-party tracker references use current content hash `7bfc59223419`; no internal research artifacts in `dist/`.
- Real current provider code was exercised with a fake key and intercepted transport: initial pageviews omit current-page queries/fragments; immediate/delayed custom events preserve privacy guards, deduplication, and first-party delivery. No production test inquiry, payment, or custom analytics event was sent.
- Full-vs-shallow Git reproduction and YAML validation confirm the sitemap-history fix.
- `git diff --check` passed.

## Measurement and release limits

Google plugin preflight returned `Claude SEO runtime is not ready. Run /seo setup and retry.` Credential tier and Search Console permissions remain unestablished. Firecrawl discovery reported low account credits. No keyword volumes, search positions, conversion-rate lift, backlinks, AI citation rates, or current Ahrefs dashboard values are claimed.

After deployment, create the four named Custom events in the Ahrefs report. Existing first-party attribution retains campaign UTMs; pathname-only Ahrefs URLs omit those query parameters. Accepted inquiries and the paid-order ledger should be used for qualification and financial reconciliation.

Google says its AI features use the same SEO fundamentals and require no special AI text file or schema. Accessible text, relevant internal links, reliable evidence, and valid matching structured data therefore precede speculative AEO formats. [Google AI search guidance](https://developers.google.com/search/docs/appearance/ai-features).

The owner approved push and deployment of this batch in chat. Release completion requires the scoped push, successful CI/deployment, and production verification of field-record links, tracker version, page-location overrides, and headers. Local success is not production proof.

## Next priorities

1. Obtain current Search Console/Ahrefs exports and a qualified-inquiry baseline; choose the strongest actual buyer lane.
2. Confirm field-record public provenance and an appropriate named technical reviewer before adding new attribution or authority claims.
3. Publish the reviewed ungated worksheet and one evidence-backed distribution asset, then measure qualified inquiries from external campaign links. Drafting does not authorize distribution.
4. Deepen existing successful buyer pages using real objections and application evidence. Avoid expanding page counts without distinct buyer value.
