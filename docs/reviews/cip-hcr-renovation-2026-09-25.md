# VertKleen CIP HCR review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

The page now leads with beer stone, mineral scale, and rust removal in brewery CIP. It shows exact label doses, a mineral-dissolution comparison with its test conditions, Carib's rust-removal findings, and the combined CR/HCR brewery result. CR's organic wash and HCR's mineral wash remain distinct, with sample, technical-support, and bulk-supply paths.

## Research judgment

Reviewed current EMS technology and product materials, EMCO's EMS HCR listing, the supplied HCR label/TDS/SDS, Carib and Brewlando records, related guides, and official archived manufacturer evidence. Detailed citations: [research dossier](../research/cip-hcr-external-research-2026-09-25.md).

- The [current EMS technology page](https://www.enviromfg.com/our-juice2) identifies the SynTech acid-replacement platform. [EMCO's current SapH HCR page](https://www.emcochem.com/product/saph-hcr/) identifies the product under EMS and supports the sample → technical information → volume quote approach.
- The supplied VertKleen HCR TDS's calcium-carbonate table matches an EMS SapH HCR technical sheet preserved in an [official USPTO-hosted exhibit](https://ttabvue.uspto.gov/ttabvue/ttabvue-91256388-OPP-39.pdf), PDF page 13, EMS000375. This is historical manufacturer evidence, not a newly conducted test or a claim that the sheet was revised in 2026.
- Exact benchmark: one-inch calcium-carbonate cubes, **8 hours at 100°F**. Dissolution: HCR undiluted **100%**, HCR at 50% **97%**, HCR at 33% **54%**, HCl at 15% **87%**, HCl at 7.5% **46%**. Concentrations and conditions appear alongside the result.
- Current Foro documentation uses a different formulation strength and calcium-oxide test. Those numbers were not transferred to HCR. The HCR sheet's 30% HCl replacement language also does not establish a universal brewery dosing ratio.
- The source for a **280× corrosion** comparison was not located. The recovered HCR record gives a carbon-steel corrosion rate but lacks the HCl control needed to reproduce that multiplier. The old headline was replaced with directly supported brewery and mineral-removal evidence.
- Carib's December 2023 report compares measured HCR and incumbent acid samples at **7% and 15%**, applied as supplied to the same rusted heat-exchanger plate with mechanical cleaning. It reports complete rust removal with HCR and recommends an industrial trial. Those sample measurements are not presented as a universal dilution or cost saving.

## Changes

- Rewrote hero, product applications, metadata, catalog description, and benefits around non-fuming brewery mineral cleaning, zero VOCs, and non-DOT transport.
- Added a reusable, escaped performance-comparison table in the product generator, used here for the exact carbonate benchmark. Its source request prefills HCR and the benchmark details.
- Added the CIP label's **0.5 L / 1 L / 1.5 L per 10 gal** light/moderate/severe doses. The label specifies circulation and rinsing; no fixed cycle time or temperature was invented.
- Added a four-step cycle: remove organics with CR, rinse, circulate HCR for mineral deposits, inspect/rinse, and complete the brewery's sanitation/release procedure.
- Linked the approved Carib report in a dedicated comparison card, retaining controlled-document metadata and unchanged source PDF bytes.
- Featured the original approved brewery result photograph. The introduction credits the preceding CR wash and states Brewlando's actual HCR stage: **5 L in 55 gal water, 160–170°F, 30 minutes**, then rinse/drain. The paired CR page is linked directly.
- Added a product-specific technical profile and material/supply checklist. The page identifies 316 stainless/PVC neat-use guidance and the technical sheet's aluminum piping/fittings exclusion.
- Removed the already flagged synthetic CIP skid scene from HCR; both CR and HCR now omit that shared scene. The asset and registry remain intact.
- Regenerated **15 dependent industry product cards**. No manual generated-page edits.

## Image and artwork flags

The [image replacement queue](image-replacement-queue-2026-09-25.md) records the completed review of the synthetic shared CIP scene and a new label-artwork issue. The current CIP HCR PDF still contains a “cert listing pending EMS verification” footer, while its diluted-aluminum language differs from the technical sheet's piping/fitting exclusion. These need a controlled artwork and material-guidance reconciliation. No PDF, approval record, or release hash was changed. The page does not reproduce the pending-status footer as marketing copy.

## Verification

- **123/123 focused checks passed**, covering HCR, the six preceding local product renovations, generated-page layout, catalog/industry references, SEO, commerce schema, document policy, and contact/quote behavior.
- JavaScript validation passed across **383 files**. Static build copied **294 files**, linking CMS media in **127**. Whitespace checks passed; context graph refreshed; date-only sitemap churn removed.
- Local browser QA passed at **320, 390, 768, 1024, 1440 px**: no horizontal overflow, duplicate IDs, or extra H1; product and real brewery photographs loaded. Canonical and complete metadata verified. Mobile comparison table visually inspected. No warning/error logs observed during final page review.
- Hero evidence link lands on the brewery result heading, clear of the fixed navigation. Verified pack switching, 55-gallon freight quote message, keyboard sample navigation, HCR product prefill, HCR sample checkbox, and the benchmark-request message.
- Carib report and CIP HCR label returned HTTP 200 with valid PDF bytes. No form submissions, orders, or external writes.
- Observed prices: **1 gal $28.99**, **2.5 gal $68.49**, **4 × 1 gal $104.36**, **2 × 2.5 gal $123.28**; drum/tote quote-only. Browser used the local production build with read-only live commerce APIs.

Evidence: [focused checks](/tmp/hcr-tests.log), [JavaScript check](/tmp/hcr-check.log), [build](/tmp/hcr-build.log). Browser observations and screenshots are recorded in this task's tool results. This is focused local verification, not full-repository CI or a live-release claim.

Implementation: [generated HCR page](../../products/hcr.html), [catalog source](../../js/main/catalog-data.js), [generator](../../tools/seo-inject.mjs), [HCR regression checks](../../tests/hcr-page.test.mjs). Previous renovations and unrelated working-tree changes remain intact.
