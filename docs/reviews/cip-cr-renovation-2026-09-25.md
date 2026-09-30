# VertKleen CIP CR review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

The page now sells CR as a brewery CIP replacement for 50% caustic soda, with clear soil-based dosing, practical circulation and rinse guidance, real brewery evidence, and current EMS technical data. It distinguishes CR's organic-soil wash from HCR's mineral-cleaning step without burying the sales message in qualifications.

## Research judgment

- The exact CIP CR label says **50% caustic soda replacement**. Current [EMS product information](https://www.enviromfg.com/products1) corroborates that strength for Elevate; its [brewery cleaning page](https://www.enviromfg.com/descaler) explicitly identifies **Elevate/CR** for beer-line and vat cleaning.
- The [current EMS Elevate technical sheet](https://www.enviromfg.com/s/elevate-tds.pdf), copyright 2026, is byte-identical to the supplied local PDF. It supports no conventional hydroxides, water-rinse neutralization, zero VOCs, non-flammability, non-DOT transport, HMIS 0-0-0, and biodegradation claims. The page links it directly.
- Reviewed the image-only CIP label, CR TDS/SDS, Brewlando trial, Carib laboratory report, related pHlex material, official NSF records, official USPTO grant, and distributor positioning. Full citations and source distinctions: [research dossier](../research/cip-cr-external-research-2026-09-25.md).
- pHlex CR's 40%/60% source inconsistencies do not override the exact brewery SKU's 50% label. NSF's pHlex CR potable-water treatment entry is kept separate from this CIP page. The related synthetic-base patent has no confirmed public CIP CR formulation crosswalk, so no patent number was promoted as SKU proof.
- Adopted manufacturer-corroborated distributor benefits: easier water rinsing, reduced dependence on neutralization chemicals, and non-hazmat transport. No fixed freight saving or universal one-for-one dose was invented.

## Changes

- Rewrote hero, replacement statement, applications, catalog summary, and metadata around krausen, yeast, protein, fat, and brewery CIP.
- Added exact label doses: **0.5 L, 1 L, or 1.5 L per 10 gal**, by soil load. The light/krausen direction retains hot circulation **above 140°F**. No inferred solution yield or per-gallon savings calculation.
- Added the **Brewlando 25-minute CR wash** with its actual conditions: 5 L into 55 gal water at 160–170°F. The separate 30-minute HCR stage remains explicit. This is a trial example, not a universal cycle-time promise.
- Linked the approved Brewlando PDF within the trial card, with controlled-document metadata. Industry case-study routes retain their existing summary links.
- Added an equipment setup, circulation, rinse, and verification sequence. No separate acid-neutralization step is required for CR; HCR still serves mineral deposits. The brewery's sanitation/release procedure remains a distinct step.
- Featured the approved brewery field result and original photograph, crediting both CR and HCR. The hero evidence link now targets the section heading rather than skipping directly to its image. It no longer counts a caustic-equivalency record as another customer job.
- Added current EMS technical benefits and a brewery-specific first-trial checklist. Whole-cycle cost includes chemical, water, heat, labor, and downtime.
- Refreshed six dependent industry pages: breweries, food/beverage, education, healthcare, HVAC/water, and manufacturing.
- Fixed an existing contact-form mismatch found during browser QA: `VertKleen CIP CR` now resolves to the form's `VertKleen CR` option and sample checkbox. The exact CIP HCR alias is normalized by the same bounded rule; other CR variants remain distinct.

## Image and source flags

The synthetic CIP skid scene was removed from CR and recorded in the [replacement queue](image-replacement-queue-2026-09-25.md). Its empty screen, repeated pipework, unlabeled containers, and stylized exterior wash marks weaken credibility. The shared HCR reference and source asset remain for that product's review. A real brewery installation or clearly labeled schematic is the replacement brief.

The published label says “Aluminum-Safe (Diluted),” while the CR and EMS Elevate technical sheets exclude aluminum piping and fittings. The page follows that equipment-specific exclusion. Controlled PDF artwork and hashes were not modified; reconciliation is flagged.

Carib's laboratory comparison supports similar cleaning performance and a handling advantage, not a sweeping superiority or numerical cost-reduction claim. It is part of the research foundation, while the page's detailed field example is Brewlando.

## Verification

- **97/97 focused product and document checks passed**, including the new CR cases, the four previous renovations, generated-page layout, catalog seed, industry cards, SEO metadata, commerce schema, and document distribution.
- **20/20 contact, request-detail, and quote-handler checks passed** after the alias fix. Total: **117 focused checks**; this is not a full-repository CI claim.
- JavaScript validation: **383 files**. Static build: **294 files**, CMS media linked in **127**. Whitespace check passed. Context graph refreshed. Date-only sitemap churn removed.
- Browser checks used the local production build and read-only live commerce API. Widths **320, 390, 768, 1024, 1440 px**: no horizontal overflow, duplicate IDs, or extra H1; product and real brewery images loaded. Canonical URL was correct. No browser warning/error logs observed in the final page review.
- Verified the revised evidence anchor, mobile dosing table, 2.5-gallon pack selection, 55-gallon freight-quote link, keyboard sample navigation, CR product prefill, sample checkbox, and application/SDS inquiry prefill. No forms submitted and no cart/order mutation.
- Observed retail prices: **1 gal $25.99**, **2.5 gal $61.49**; cases **$93.56** and **$110.68**. Drum/tote quote-only. The Brewlando PDF returned HTTP 200 and valid PDF bytes.

Local evidence: [product tests](/tmp/cr-tests.log), [contact tests](/tmp/cr-contact-tests.log), [JavaScript check](/tmp/cr-check.log), [build](/tmp/cr-build.log). Browser observations were captured in this task's tool results. The temporary preview server allowed only GET/HEAD requests.

Implementation: [generated CR page](../../products/cr.html), [catalog source](../../js/main/catalog-data.js), [generator](../../tools/seo-inject.mjs), [contact prefill](../../js/main/engagement.js), [CR checks](../../tests/cr-page.test.mjs). Existing unrelated working-tree changes remain intact.
