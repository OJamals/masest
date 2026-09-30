# SAR review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

SAR now has a clear job: replacing sulfuric acid for process-water and industrial-liquid pH reduction. Buyers can understand its stated strength, plan a bench trial, identify compatible feed-system materials, and request a sample, technical documents, or bulk supply.

## Review judgment

The previous page presented SAR as a specialty rust and scale remover. Both the supplied label and technical sheet lead with sulfuric-acid replacement and pH control; the TDS explicitly places less emphasis on scale and paraffin removal. The product image also identifies it as a sulfuric acid replacement. The renovation aligns the page with that identity.

The [external research dossier](../research/sar-external-research-2026-09-25.md) traces SAR's EMS identity through an EMS naming notice preserved in an [official USPTO filing](https://ttabvue.uspto.gov/ttabvue-91256388-OPP-39.pdf). The current EMS catalog does not expose an exact SAR technical sheet. The supplied SAR documents remain the product-specific source; current Hydro+, Phix I, or other neighboring-product claims were not substituted.

## Changes

- Replaced the rust/scale story with pH reduction across the product page, metadata, catalog description, applications, and quote/sample actions.
- Moved SAR from the curated Descaling & Rust group to Water Treatment. Updated its directory title and removed the scale-removal filter tag while preserving the sulfuric-acid replacement facet.
- Added the technical sheet's comparison to 40% sulfuric acid as an attributed titration-strength statement. Kept the measured process demand and target pH beside it.
- Added a four-step workflow: define the process, bench-titrate a representative sample, check feed hardware, then add/mix/measure to the target.
- Displayed label-recommended 316 stainless steel, polypropylene, and Schedule 80 PVC, including the explicit exclusion of aluminum fittings and piping.
- Added a technical profile covering HMIS 0-0-0, non-fuming behavior, non-DOT transport, no VOCs/phosphates, biodegradability, and trial-to-bulk supply.
- Replaced generic surface-cleaning instructions with pH-control handling and recordkeeping: fluid volume/flow, starting and target pH, temperature, dose, and measured endpoint.
- Added prefilled technical-data/SDS requests. External technical links on earlier product pages retain their behavior; SAR's internal request links stay in the same tab.
- Removed the visibly synthetic, mismatched application scene from the page and logged its replacement brief in the [image replacement queue](image-replacement-queue-2026-09-25.md).

## Source and image decisions

Reviewed the supplied SAR TDS, SDS, legacy label, and new-studio label image. The 40% statement describes titration strength, not the formula's sulfuric-acid content or a universal gallon-for-gallon dose. Near-zero heat applies to dilution with water; the copy does not extend it to every process reaction. No fixed dilution, yield calculator, percentage cost saving, shelf-life number, or new certification badge was added.

The newer label recommends bench titration but also makes a broad reduced-consumption claim. The page uses the bench-trial guidance and source-supported titration comparison without promising that every system will consume less product. Supplied documents contain differing shelf-life and irritation language; those details are recorded in research rather than turned into contradictory customer-facing assurances.

The owner authorized use of EMS technical information. The existing site's local SDS/TDS request workflow remains in place; these request links are not represented as public downloads. No SAR-specific field result is present in the published proof catalog, so the page does not borrow another product's result or imply the removed illustration was evidence.

Flagged asset: `img/representative/applications/sar-application-engineering-v1.webp`. It looks synthetic and depicts a generic scale-testing scene. Its replacement should be real pH-dosing equipment, a process/sample vessel, a calibrated pH instrument, and compatible fittings. The asset and shared image registry remain intact for audit; only SAR's display reference was removed. The product rendering remains.

## Verification

- **91/91 scoped checks passed** in the detached local product-verification snapshot, covering SAR, Torque, AlumiBrite, product layout, catalog seed, industry cards, SEO metadata, commerce schema, and document review.
- **94/95 checks passed** in the shared checkout, including all four separate directory tests. The sole failure remains the pre-existing directory-copy expectation at `tests/catalog-seed.test.mjs:380`. It expects the previous Products-page introduction and passes unchanged in the isolated snapshot. This is not a full-repository CI claim.
- The isolated snapshot includes the earlier product renovations and their EMS-attribution policy dependency, but excludes unrelated directory changes. The main checkout's SAR directory title/filter update is exercised by the passing directory tests.
- JavaScript validation passed across 383 files. Static build passed: 282 files copied; CMS media linked in 127. Whitespace checks passed, and the context graph was refreshed.
- Browser QA passed at **320, 390, 768, 1024, and 1440 px** against the local production build with real product media and read-only live commerce APIs. No page JavaScript errors, duplicate IDs, or horizontal overflow.
- Verified canonical URL, metadata, image load, removal of the flagged scene, 1-gallon and 2.5-gallon selection, 55-gallon quote switching with size preserved, sample-form prefill by keyboard, and technical-data/SDS request prefill including the message.
- Observed prices: 1 gal $16.99; 2.5 gal $39.99; 4 × 1 gal case $61.16; 2 × 2.5 gal case $71.98. Drum and tote remain quote-only. No form submission, order, CMS write, or deployment occurred.

QA artifacts: [browser script](/tmp/sar-page-qa.mjs), [browser results](/tmp/sar-browser-qa.json), [scoped test log](/tmp/sar-isolated-tests.log), [desktop hero](/tmp/sar-hero-1440.png), [mobile application guide](/tmp/sar-application-390.png), [strength callout](/tmp/sar-strength-1440.png).

Implementation: [SAR page](../../products/sar.html), [catalog source](../../js/main/catalog-data.js), [product generator](../../tools/seo-inject.mjs), and [SAR regression checks](../../tests/sar-page.test.mjs). Earlier product work and unrelated shared-checkout changes remain intact.
