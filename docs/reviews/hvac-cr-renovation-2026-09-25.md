# VertKleen HVAC CR review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

HVAC CR now has a concrete drain and degreasing sales story: remove grease and organic buildup, choose the label dilution, allow contact time, rinse, and verify drainage. The page identifies its CR² / 60% caustic-replacement role and supports the buying decision with manufacturer information instead of a synthetic application scene.

## Research and judgment

Reviewed the current [manufacturer product page](https://www.phlexapeel.com/products), [CR² label](https://www.phlexapeel.com/s/pHlex-CR2-Label.pdf), official NSF listing, supplied EMS-CR2 PDF, current HVAC product label, water-treatment user guide, related patent material, and distributor sources. Citations and detailed decisions: [research dossier](../research/hvac-cr-external-research-2026-09-25.md).

- Current manufacturer information identifies CR² as a **60% sodium hydroxide replacement**. That strength is separate from the dilution used for cleaning and from system-specific pH-adjustment dosing.
- The exact HVAC label supplies **10:1 with 10–15 minutes** for light soil/mild odor, **5:1** for moderate soil/odor, and **2:1 with 20 minutes** for severe soil/odor. Every method finishes with rinsing. The page preserves these ratios without inventing a water/product convention, moderate dwell time, or ready-to-use yield calculation.
- The supplied Spanish EMS CR2 PDF is byte-identical to its online version but mixes high-pH and neutral-pH descriptions, different dilution schedules, and broad certification claims. Those conflicting details were not copied into the HVAC page.
- The current NSF listing names pHlex CR at 92 mg/L; it does not name CR². That treatment ceiling and certification were not transferred to this SKU. No CIP brewery trial was repurposed as an HVAC CR result.
- Practical distributor themes were retained where supported: concentrate-based maintenance, grease removal, rinsing, and simpler transport. No unsupported numerical cost or shipping guarantee was introduced.

## Changes

- Reworked hero, replacement statement, uses, metadata, catalog description, and sales benefits around condensate drains, pans, grease, and organic residue.
- Added an accessible dilution/contact-time table and a four-step work sequence covering preparation, application, rinsing, and restored drainage.
- Added a manufacturer-reference panel explaining CR²'s 60% replacement role and directing pH-adjustment inquiries toward the actual starting pH, target, and water analysis.
- Added label-backed HMIS 0-0-0, biodegradation, and manufacturer transport information, with a direct CR² manufacturer PDF link.
- Replaced generic handling copy with product choice, material checks, electrical protection, trial planning, and recurring supply guidance.
- Replaced “real job result” language with a caustic-replacement record. The evidence list now says **Caustic replacement / Product record**, accurately describing the available evidence.
- Removed blanket coil-use wording. The label's diluted-aluminum claim does not establish universal compatibility for every coil coating or mixed-metal assembly; the page asks for equipment-specific confirmation.
- Removed the synthetic HVAC application image and added a replacement brief to the [image queue](image-replacement-queue-2026-09-25.md). The original asset and registry remain intact.
- Updated the dependent municipality/water-utility product card through the industry generator.
- Fixed the contact-form alias: **VertKleen HVAC CR → VertKleen CR2** for quote selection and sample matching. The rule is exact and does not collapse CR, CR HD, or other variants into CR2.
- Refined a legacy claim test: product-specific timed biodegradation claims may follow an exact label; broad company/catalog pages remain prohibited from making that blanket statement. A new CR2 check requires the specific HVAC-label attribution.

## Verification

- **120/120 focused checks passed** across CR2, all preceding local product renovations, catalog/layout/industry/SEO/schema/document policy, and contact/quote behavior.
- Rechecked CR2 and SEO tests after the final metadata shortening. JavaScript validation covers **383 files**; static build copied **294 files**, linking CMS media in **127**. Whitespace checks passed and the context graph was refreshed. Date-only sitemap churn was removed.
- Local browser QA at **320, 390, 768, 1024, and 1440 px**: no horizontal overflow or duplicate IDs, one H1, loaded product image, correct canonical URL. Mobile dilution/contact-time table inspected visually. Final metadata reads as a complete sentence without automatic truncation.
- Verified 2.5-gallon price switching, 55-gallon quote link and freight message, keyboard sample navigation, **VertKleen CR2** product selection, **VertKleen CR2** sample checkbox, and application/SDS inquiry prefill. No forms submitted, cart changes, orders, or other external writes.
- Observed prices: **1 gal $25.99**, **2.5 gal $61.49**, **4 × 1 gal $93.56**, **2 × 2.5 gal $110.68**; drum and tote quoted. Preview used the local production build with read-only live commerce APIs. No warning/error logs observed during final page inspection.

Evidence: [focused checks](/tmp/cr2-tests.log), [final CR2/SEO checks](/tmp/cr2-final-tests.log), [JavaScript validation](/tmp/cr2-check.log), [build](/tmp/cr2-build.log). Browser observations and screenshots are recorded in this task's tool results. This is focused local verification, not a full-repository CI or live-release claim.

Implementation: [generated HVAC CR page](../../products/cr2.html), [catalog source](../../js/main/catalog-data.js), [contact prefill](../../js/main/engagement.js), [CR2 checks](../../tests/cr2-page.test.mjs). Previous renovations and unrelated working-tree changes remain intact.
