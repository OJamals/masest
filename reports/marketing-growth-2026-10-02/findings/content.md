# Content, buyer intent, and answer accessibility audit

Status: completed read-only specialist audit; live checks on 2026-10-02. No website source edits in this stream.

## Immediate improvement

The live `/proof` main content has 21 result/test cards and two contact links. It has no anchors to the detailed field records already published in `/blog`. Link the matching cards to those records so visitors and crawlers can move from a short result summary to methods, context, and evidence limitations.

| Proof card slug | Existing detailed record | Proposed anchor |
|---|---|---|
| `brevard-farm-hvac` | `/blog/hcr-brevard-hvac-rust-case-study` | Read the HVAC field record |
| `distribution-center-assessment` | `/blog/cr-hd-walmart-distribution-center-case-study` | Read the distribution-center assessment |
| `fire-pump-descaler` | `/blog/descaler-fire-pump-walmart-case-study` | Read the fire-pump field record |

All three destinations returned HTTP 200 and render article text in the supplied HTML. These links add navigation, not new efficacy or comparative claims.

Canonical shared card renderer: `js/proof-records.js` (`proofCardHtml`, lines 11–46; `proofRecordsHtml`, lines 48–53). Its callers include `tools/seo-inject.mjs` `injectProofRecords` (lines 384–391) and `productPage` (featured proof card at line 938). Therefore verify both `/proof` and matching product detail pages after regeneration.

The card inputs are `data/content/proof.json` → `proof_cards`; the relevant records start at lines 27, 176, and 196. The snapshot currently has no article-link field. CMS exports can overwrite direct snapshot edits. A small explicit mapping to verified existing records in the shared renderer avoids depending on an unshipped CMS schema change.

Current renderer exposes a collapsible “Read the story” narrative, but no detailed-record link. Put the proposed link after that narrative, or in the visible card body if discoverability should be immediate. Use absolute site paths so the same renderer works on nested `/products/*` pages. Avoid changing result titles, chemical claims, or publication notes as part of this link-only improvement.

Success criterion for this delivery: generated and rendered `/proof` cards expose three descriptive links with valid destinations; the matching HCR/HVAC HCR and CR HD featured cards retain the right destination when present. A build inspection should confirm links survive regeneration. Traffic success needs later measurement: card-to-record clicks, record-to-product/sample requests, accepted quotes, and paid orders. More links alone do not prove increased traffic.

## Existing content worth preserving

- `/private-label` already explains logo-on-VertKleen positioning, intended customers, application-first selection, request information, and quote-dependent packaging/minimum quantities/timing/delivery. It does not promise custom formulation or fixed MOQ.
- `/industries/hvac-water` distinguishes surface cleaning, isolated-system cleanout, and ongoing treatment. It already links current labels, product pages, pricing, technical support, and primary planning sources.
- `/blog/how-to-descale-heat-exchanger` already has an answer-first introduction, deposit/material checks, a selection table, and links to product guidance/resources/HVAC application guidance. A duplicate generic how-to would add little value.
- `/resources` includes product documents, comparisons, cleaning-plan guidance, test-record guidance, and whole-job cost tools. Generic new lead-magnet content would duplicate existing useful material.
- `/services` already has category links, what to send/receive, starting-price explanations, and final-scope approval copy. `/programs` clearly covers consolidation, pilot, training, resupply, private-label supply, and water-treatment support. Those paths need distribution and measurement more than generic new explanatory pages.

No new answer block is recommended in this pass. Existing private-label and HVAC pages already answer the proposed questions in plain visible text; repeating their answers as FAQs would offer little new information. Packaging formats, exact MOQ, lead time, and private-label eligibility by product remain commercial evidence gaps, so publish specific answers only after confirmation.

## Focus next content work

1. **Make existing evidence verifiable.** Three detailed case posts above identify facilities, products, methods, and field outcomes. Their bodies contain no external source-document links. Supply a public approved field record, customer attribution/permission, report date, method, and limits where available. Keep ordinary result summaries available while improving provenance. Do not infer that narrative explanations or modeled savings were directly measured.
2. **Bring a real reviewer into technical guidance.** The 35-post snapshot uses only `MASEST Team` and `MASEST` authors. Add named author/reviewer identity, actual qualifications, and a real review process when supplied. Do not invent a chemist, credential, review date, or biography. Generic organization authorship is not inherently invalid, but readers of equipment/chemical guidance benefit from knowing who checked it.
3. **Deepen one useful existing cluster before expanding sectors.** The snapshot contains 35 posts; 18 have no more than 450 whitespace-delimited words in their body. Word count is a rough coverage diagnostic, not a Google ranking factor. Prioritize real customer questions for HVAC cleanout, private-label quoting, and distribution-center degreasing; add documented examples/checklists only where they change a buyer’s decision. Avoid making another industry page solely for keyword coverage.
4. **Reuse existing assets for acquisition.** Use the field record, application guide, and sample/test plan together for an industrial distributor or contractor audience. A useful sequence is job question → detailed field record → current documents/application review → sample or quote. Any outreach, directory submission, campaign launch, or spend needs explicit channel authority; this audit sends nothing.

Canonical paths for later work: `private-label.html` for that landing-page body; `tools/hvac-water-page.mjs` `renderHvacWaterHub` (lines 29–77) for the generated system hub; published CMS blog entries for case/guide body and author data, exported into `data/content/blog.json` → `blog_posts`; `tools/build-blog.mjs` (`postPage`, lines 298–391) for shared article presentation. Edit the owning content source/generator, then regenerate pages. A direct generated HTML edit is not a durable fix.

## Buyer-intent sample and claim boundaries

Search samples used “heat exchanger descaling chemical” and “private label cleaning chemicals manufacturer logo packaging MOQ.” They surfaced primary manufacturer pages emphasizing equipment-specific cleaning plans, compatible product choice, packaging options, labeling, sample review, and commercial terms. This supports those questions as plausible buyer tasks. It does not establish their relative demand, difficulty, or MASEST ranking.

- Chemex’s private-label page organizes its own offer around product selection, packaging/labeling, ordering, and supporting documents. MASEST should answer the same practical purchasing questions using its own confirmed capabilities; Chemex’s formula count, manufacturing, custom formulation, packaging sizes, or commercial promises cannot establish MASEST capabilities.
- Goodway’s published plate-heat-exchanger cleaning instructions are equipment/product-specific and include isolation, circulation, effectiveness checks, rinsing, and discharge conditions. They show why method and compatibility questions matter. Do not transplant their ratios, timing, or disposal instructions to VertKleen.
- The AI SEO skill has useful extraction and measurement prompts, but its general crawler and performance claims are not a verified site diagnosis. Google’s primary guidance explicitly distinguishes Googlebot’s Search control from Google-Extended controls for other uses. This content stream makes no crawler-policy change and claims no AI citation result.

## Measurement limits

This content audit inspected live HTML and primary source pages. It did not access private analytics, Search Console queries, indexed-page reports, keyword volumes, AI answer citation rates, or customer interviews. No ranking/traffic improvement is claimed. Search result samples indicate buyer questions, not search volume or market size.

## Sources

- [MASEST results](https://masest.co/proof)
- [MASEST private label](https://masest.co/private-label)
- [MASEST HVAC and water systems](https://masest.co/industries/hvac-water)
- [MASEST heat exchanger descaling guide](https://masest.co/blog/how-to-descale-heat-exchanger)
- [Google AI features and websites](https://developers.google.com/search/docs/appearance/ai-features): Google recommends crawlability, internal links, useful textual content, and structured data that matches visible content. No special AI file or markup is required for its AI features.
- [Chemex private-label chemicals](https://chemexofni.com/private-label-chemicals/)
- [Goodway Multistack chiller cleaning instructions](https://www.goodway.com/sites/default/files/documents/2019-05/mutlistack_instruction.pdf)

Skills applied: `content-strategy`, `ai-seo`, and `codex-seo:seo-content`. Their scores, word-count suggestions, and vendor visibility statistics are heuristic prompts; none are reported as measured Google ranking signals.

Graft audit discovery: 8 calls; estimated savings 232,643 tokens. No dollar estimate was supplied.
