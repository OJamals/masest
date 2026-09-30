# WaterSafe60 review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment. WaterSafe60 is the final product in the current public catalog order.

## Buyer outcome

The page now leads with potable-water pH adjustment, scale and corrosion control, pipe cleaning, and well rehabilitation. It separates metered treatment from offline cleaning, puts the official NSF listing within reach of the buying decision, and routes technical questions into a prefilled water-treatment request.

## Review judgment and sources

The previous page centered cooling towers, closed loops, heavy-metal inhibitors, and Legionella program language. Its strongest product-specific evidence is broader and more concrete: potable-water certification, defined treatment functions, offline cleaning instructions, and an actual titration report.

The [official NSF listing](https://info.nsf.org/Certified/PwsChemicals/Listings.asp?Company=C0284921&Standard=060), current September 25, 2026, lists **Watersafe 60** and **pHlex Watersafe 60** under Environmental Manufacturing Solutions. Metered treatment functions carry an **80 mg/L maximum use level**. The separate offline listing requires flushing before drinking-water service. The [manufacturer-linked pHlex product page](https://www.phlexapeel.com/products) provides a current product-identity bridge and water-treatment positioning.

Reviewed the supplied WaterSafe60 TDS, revised March 5, 2026; the water-treatment guide, revised February 4, 2026; SDS; current public label; new-studio label artwork; and the October 28, 2024 Sigma sample titration sheet. Full sources and distributor findings: [research dossier](../research/watersafe60-external-research-2026-09-25.md).

## Changes

- Reworked hero, metadata, replacement statement, applications, and catalog description around certified potable-water treatment and system cleaning.
- Added a prominent certification panel with exact listed uses, the 80 mg/L ceiling, the offline flushing condition, and a direct NSF link.
- Changed the hero evidence link to “See certification & use limits,” targeting the certification panel instead of presenting certification as a customer job result.
- Added separate metered-treatment and offline-cleaning cards. The normal-hardness 2–10 mg/L range stays within the treatment discussion; 80 mg/L is clearly the maximum, not a default dose.
- Added pH titration and upstream/downstream measurement guidance, isolated cleaning steps, minimum contact-time context, and return-to-service flushing checks.
- Brought the approved Sigma titration report into the application discussion. Its additions remain sample-specific; no universal dosing or yield calculator was invented.
- Added technical characteristics and prefilled technical-data/SDS requests.
- Replaced generic surface-cleaning preparation with water-analysis, equipment-compatibility, treatment, and supply planning. The label's aluminum exclusion remains visible.
- Removed the synthetic-looking application scene. Product rendering and documentary evidence now carry the page.
- Refreshed six industry references: data centers, education, healthcare, HVAC/water, mechanical contractors/water treatment, and municipalities/water utilities.
- Added scroll spacing so the certification heading remains visible below fixed navigation.

## Source decisions

The NSF record certifies the listed treatment chemical under NSF/ANSI/CAN 60. It is not a Legionella-control approval. The renovation removes the old unexplained Legionella/ASHRAE application bullet rather than implying antimicrobial performance from potable-water certification.

The supplied TDS includes both low-dose treatment and much stronger isolated-cleaning directions. The page keeps those operating modes distinct. A sample titration curve cannot override the applicable maximum use level. The study is linked for review and clearly identified as the Sigma sample.

Manufacturer collateral contains a 15%-faster scale-dissolution claim but does not provide enough product-specific test conditions for a new comparison graphic. That number was not promoted into additional page copy. No new EPA Safer Choice, unrestricted-discharge, universal compatibility, or numerical freight-saving claim was added.

The owner authorized EMS materials and attribution. A legacy test still prohibited SynTech/SynClean names after the unrelated directory work was removed from this checkout. It now checks that every public product retains its canonical orderable name in its main heading. Other document-distribution and claim tests remain active. Local study links carry the same controlled-document metadata as existing downloads; unpublished technical sheets remain on the existing request path.

## Image and artwork flags

The [image replacement queue](image-replacement-queue-2026-09-25.md) records two WaterSafe60 items:

1. **Replace the application scene:** distorted markings, unclear feed connections, an unlabeled tank, and a blank instrument make the cooling-tower image look synthetic. Its page reference was removed; the source asset and registry remain intact. Replacement brief calls for real treatment or well-service photography with identifiable, compatible equipment.
2. **Correct the label PDF layout:** net-content/company footer text overlaps its caution line. The separate supplied label PNG does not have that overlap. This is flagged for a controlled-artwork revision; the PDF and release hashes were not changed.

## Verification

- **94/94 focused checks passed** across WaterSafe60, SAR, Torque, AlumiBrite, product layout, catalog seed, industry cards, metadata, commerce schema, and public-document review. This passing run used the shared checkout; the previous directory-copy failure is no longer present. This is focused verification, not a claim of full-repository CI.
- JavaScript validation passed across 383 files. Static build passed: 282 files copied; CMS media linked in 127. Whitespace checks passed; context graph refreshed.
- Browser QA passed at **320, 390, 768, 1024, and 1440 px**, using the local production build, real product media, and read-only live commerce APIs. No horizontal overflow, duplicate IDs, or JavaScript page errors.
- Verified pricing/pack switching, 55-gallon quote size, sample prefill by keyboard, technical-data/SDS request prefill, certification anchor, official listing URL, PDF response bytes, canonical URL, metadata, and removal of the flagged scene.
- Observed prices: 1 gal $18.99; 2.5 gal $44.99; 4 × 1 gal case $68.36; 2 × 2.5 gal case $80.98. Drum and tote remain quote-only. No form submission, order, external write, or deployment occurred.

QA artifacts: [browser script](/tmp/watersafe60-page-qa.mjs), [browser results](/tmp/watersafe60-browser-qa.json), [focused test log](/tmp/ws60-tests.log), [desktop hero](/tmp/watersafe60-hero-1440.png), [mobile certification panel](/tmp/watersafe60-certification-390.png), [treatment modes](/tmp/watersafe60-application-1440.png).

Implementation: [WaterSafe60 page](../../products/watersafe60.html), [catalog source](../../js/main/catalog-data.js), [product generator](../../tools/seo-inject.mjs), and [WaterSafe60 regression checks](../../tests/watersafe60-page.test.mjs). Earlier product renovations and unrelated work remain intact.
