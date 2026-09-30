# VertKleen Descaler review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

Descaler now leads with calcium, lime, and mineral-scale removal for coils, pumps, and heat exchangers. The page explains detergent-assisted mineral cleaning, shows the three HVAC label dilutions, separates coil care from isolated circulation/component cleaning, and tells the documented two-stage fire-pump service story. Small packs, samples, technical inquiries, and bulk supply remain easy to reach.

## Research and judgment

Reviewed current EMS manufacturer material, official classification sources, distributor presentations, supplied product label/TDS/SDS, equipment guides, and AC/fire-pump field reports. Complete citations and discrepancies are in the [research dossier](../research/descaler-external-research-2026-09-25.md).

- [EMS's current descaler page](https://www.enviromfg.com/descaler) and [BlowOut TDS](https://www.enviromfg.com/s/blowout-tds.pdf) support mineral cleaning and the detergent-assisted product story. Supplied VertKleen documents remain the dosing and handling references for this SKU.
- Distributor exploration reinforced useful merchandising: equipment-specific applications, concentrated supply, straightforward rinsing, and accessible technical support. Numerical claims were traced back to the manufacturer rather than copied from distributor headlines.
- Added a qualitative hydrochloric-acid comparison covering metal compatibility, odor, and shipping identity. The conventional-acid column cites [CDC/NIOSH](https://www.cdc.gov/niosh/npg/npgd0332.html); Descaler's column uses its label, TDS, and SDS. No corrosion or dissolution multiplier was invented.
- The supplied comparison artwork conflicts with itself and the current TDS: 9.8 versus 8.1 dissolution entries, carbonate versus oxide substrate descriptions, and a 280× headline that does not match its own corrosion values. The current manufacturer chart also lacks the complete corrosion protocol. These discrepancies are flagged internally rather than turned into a sales claim.
- Exact HVAC label ratios: **20:1 light/regular**, **3:1 moderate**, **1:1 severe**, followed by circulation and rinsing. The label gives neither ratio order nor a fixed duration. No RTU-cost calculation or universal contact time was added.
- Fire-pump report: 30-minute solenoid treatment restored startup; a separate 24-hour cavity treatment under Siemens/MASEST direction preceded rinsing, reassembly, and a 30-minute test that restored proper flow/pressure. The page preserves those stages as a case history, not a universal maintenance recipe.
- AC report supports the photographed cleaning outcome near Boca Raton. The owner's uncontrolled $75 electricity-bill anecdote is not promoted as a savings promise.
- Current NSF/EPA checks did not establish a finished-product Descaler listing for the proposed badges. The page highlights supported HMIS 0-0-0, zero-VOC, biodegradable/phosphate-free, and transport facts. It links potable-water buyers to WaterSafe60.

## Changes

- Rewrote hero, benefits, use cases, metadata, and seed-catalog description; retained product identity, SKU, pricing, and purchasing behavior.
- Added two application sections, a compact comparison table, exact label dilution table, AC case summary, technical profile, and job-planning checklist.
- Added a direct hero link to the fire-pump service result and a prefilled Descaler SDS/TDS inquiry.
- Removed the synthetic shared descaling-loop scene from this final referencing product. Original asset and registry remain intact.
- Added an opt-out for featured-result media. Descaler uses it to publish the field narrative without a mislabeled image. Other products retain their existing photographs. The shared proof renderer now avoids a whitespace-only line when a result has no media.
- Regenerated product and industry output through their owners. No generated HTML was edited manually.

## Image and artwork findings

The [replacement queue](image-replacement-queue-2026-09-25.md) now records:

- Shared synthetic loop scene: removed from both HVAC HCR and Descaler; authentic replacement still pending.
- Fire-pump proof image: matches the source PDF's **new-system installation** photo, not its cleaned-component photo. The featured product-page result omits it.
- AC proof image: rotated relative to the supplied report and apparently taken from a different source role than the report's cleaned-fin close-ups. Not promoted into this page's featured imagery.
- Fire-pump blog hero: synthetic-looking equipment scene, flagged for authenticity review/replacement; not reused here.
- HVAC label: certification-verification footer flagged for controlled artwork reconciliation.
- Sales comparison artwork: contradictory values, units/protocol gaps, and arithmetic flagged for correction.

Existing shared proof records, source PDF bytes, remote image bytes, and release hashes were preserved. The global photo corrections remain queued; this page does not depend on those images.

## Verification

- **129/129 focused checks passed**, covering this page, preceding product renovations, generated layout, catalog/industry references, SEO, offer schema, document rules, and contact/quote behavior.
- JavaScript validation passed across **383 files**. Static build copied **294 files** and linked CMS media in **127**. Industry generator rendered **26 pages**. Whitespace checks passed; context graph refreshed; date-only sitemap churn removed.
- Browser QA passed at **320, 390, 768, 1024, and 1440 px**: no horizontal overflow, duplicate IDs, extra H1, or broken main image. Canonical URL and complete description verified. Mobile comparison/dilution tables and result section visually inspected.
- Hero result link lands approximately 80 px below the viewport top, clear of fixed navigation. Result story contains no misleading result photograph.
- Verified 2.5-gallon price switching and 55-gallon freight quote URL/message. Sample navigation selects Sample Kit, VertKleen Descaler, and its sample checkbox. Technical inquiry selects VertKleen Descaler and prefills the exact SDS/TDS request. No submissions, orders, or external writes.
- Observed prices: **1 gal $20.49**, **2.5 gal $47.99**, **4 × 1 gal $73.76**, **2 × 2.5 gal $86.38**; drums/totes quote-only. Local production build used read-only live commerce APIs.
- HVAC label returned HTTP 200 with `application/pdf` and valid PDF bytes. No browser warning/error logs observed during final checks.

Evidence: [focused tests](/tmp/descaler-tests.log), [JavaScript check](/tmp/descaler-js.log), [build](/tmp/descaler-build.log). Browser observations/screenshots are recorded in this task. This is focused local verification, not full-repository CI or live-release QA.

Implementation: [generated page](../../products/descaler.html), [catalog source](../../js/main/catalog-data.js), [generator](../../tools/seo-inject.mjs), [proof renderer](../../js/proof-records.js), [Descaler checks](../../tests/descaler-page.test.mjs). Earlier product work and unrelated dirty changes remain intact.
