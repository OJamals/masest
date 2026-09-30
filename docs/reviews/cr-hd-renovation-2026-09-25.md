# VertKleen CR HD review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

CR HD now leads with high-detergency, high-foam removal of heavy grease, petroleum oils, and food fats. The page shows original Fort Lauderdale kitchen before/after photographs, four exact label dilutions, an apply/agitate/rinse workflow, and a clear route to Low Foam for foam-sensitive equipment. Technical support, samples, small packs, and bulk inquiries remain prominent.

## Research judgment

Reviewed current EMS SynClean HD documentation, distributor materials, official NSF records, current Simple Green documentation, supplied label/TDS/SDS, comparison sheet, and field reports. Detailed citations and conflicts: [research dossier](../research/cr-hd-external-research-2026-09-25.md).

- [EMS SynClean HD TDS](https://www.enviromfg.com/s/syncleanhdwso-tds.pdf) matches the supplied CR HD technical story: high detergency and ample foam, solvent-/butyl-free grease lifting, hot/cold water, zero VOCs, non-flammability, and non-regulated transport. The page explains non-emulsifying grease removal without promising universal oil-separator performance.
- General label directions, visually verified: **40:1 floors**, **30:1 general cleaning**, **10:1 degreasing**, **3:1 heavy degreasing**, with agitation and fresh-water rinsing. Ratios remain as printed; no undefined ratio convention, RTU economics, or universal dwell time was invented. [Trident's distributor TDS](https://tridentcleanpro.com/wp-content/uploads/2024/10/SYNCLEAN-HD-TDS-7-29.pdf) corroborates that practical table and sequence.
- The kitchen report identifies Fort Lauderdale stainless equipment after three weeks without thorough cleaning. Original before/after assets match the supplied photographs. No elapsed cleaning time, dilution, or measured savings was added to the case.
- The distribution-center report supports customer use at three sites, but its low-foam and 50%-degreaser statements conflict with the CR HD TDS and comparison sheet. The renovation treats it as a use record rather than a formulation specification or controlled efficacy trial.
- Current [NSF EMS listing](https://info.nsf.org/USDA/Listings.asp?Company=C0146843) identifies Renovo HD, registration 148038, A1/K2. An exact SynClean/VertKleen CR HD registration crosswalk was not established. The product page links actual EMS technical material and does not relabel the Renovo registration as this SKU's certification.
- [Simple Green's current industrial page](https://simplegreen.com/industrial/products/industrial-cleaner-degreaser/) identifies its cleaner as butyl-/solvent-free and gives heavy, medium, and light cleaning ranges. Its [October 2025 US SDS](https://cdn.simplegreen.com/downloads/SDS_EN-US_SimpleGreenIndustrialCleanerDegreaser.pdf) records a formulation change. The historical comparison PDF's blanket butoxyethanol claim is unsuitable as current comparison evidence.

## Product-page changes

- Rewrote hero, mechanism, benefits, applications, metadata, and seed-catalog description around the supported high-foam formulation and jobs it serves.
- Corrected the previous “keeps grease suspended” explanation to intact grease lifting and collection, consistent with the non-emulsifying technical description.
- Added foam selection guidance, exact label table, practical cleaning steps, official EMS reference, product-specific technical profile, and a full-job trial checklist.
- Featured the original kitchen before/after pair, with a hero anchor and a direct Low Foam product link.
- Removed the synthetic industrial test scene. The [image replacement queue](image-replacement-queue-2026-09-25.md) records its visual problems and an authentic replacement brief. Original asset and registry remain.
- Removed the stale comparison PDF from this product's recommended downloads. Controlled file bytes and global document records remain intact for revision.
- Added a prefilled request for current CR HD SDS/TDS. Pricing, SKU identity, and purchasing behavior were preserved.

## Linked comparison corrections

The product page links to [CR HD vs Simple Green](../../comparisons/cr-hd-vs-simple-green.html), so its generator source was corrected in the same pass:

- Removed unsupported 50%-versus-15% claims and the inference that active percentage alone establishes cleaning superiority or near-neat competitor usage.
- Corrected Simple Green's current medium/light dilution ranges and recorded that its current US SDS also describes non-regulated transport.
- Recast the three-site account as documented customer use, without treating it as a controlled trial. Linked the approved assessment and current CR HD field result rather than an older article repeating the inconsistent percentage.
- Replaced the unverified competitor price range with a request to use the buyer's current supplier quote. Comparison remains based on concentrate used, labor, rinse water, recovery, and repeat work.
- Added direct current manufacturer/SDS references. Corrected quote/sample product parameters to select VertKleen CR HD in the contact form.

Only the CR HD comparison output changed when the shared comparison generator ran. Other legacy comparison articles and the retired blog copy were not rewritten in this product pass.

## Verification

- **133/133 focused checks passed**, covering CR HD, preceding product renovations, generated layout, catalog/industry references, SEO/offer schema, document rules, and contact/quote behavior. After the final comparison CTA adjustment, all **4 CR HD-specific checks** passed again.
- JavaScript validation passed across **387 files** in the current shared checkout. Static build copied **295 files**, linking CMS media in **127**. Industry generation rendered **26 pages**. Whitespace checks passed; graph refreshed; date-only sitemap churn removed.
- CR HD browser QA at **320, 390, 768, 1024, and 1440 px**: no horizontal overflow, duplicate IDs, or extra H1. Canonical URL and complete description verified. Product image loaded; both lazy-loaded kitchen photographs loaded when the result section was reached. Mobile proof and dilution layout visually inspected.
- Hero proof anchor lands approximately 80 px below the viewport top, clear of fixed navigation. Source images retain the correct before/after roles.
- Verified 2.5-gallon price switching and 55-gallon freight-quote routing. Sample request selects Sample Kit, VertKleen CR HD, and its sample checkbox. Technical request prefills the product and exact SDS/TDS message. The linked comparison's quote CTA also selects VertKleen CR HD.
- Observed prices: **1 gal $14.49**, **2.5 gal $33.99**, **4 × 1 gal $52.16**, **2 × 2.5 gal $61.18**; drums/totes quote-only. Local production build used read-only live commerce APIs.
- Comparison browser QA at **390 and 1440 px** showed no page overflow; wide editorial tables remain within their scrolling containers. Current dilution language is present and old percentage claims absent. No browser warning/error logs observed.
- General label returned HTTP 200 with `application/pdf` and valid PDF bytes. No forms, orders, or external writes were submitted.

Evidence: [focused checks](/tmp/crhd-tests.log), [final CR HD checks](/tmp/crhd-final-claims.log), [JavaScript validation](/tmp/crhd-js.log), [build](/tmp/crhd-build.log). Screenshots and browser observations are recorded in this task. Verification is local and focused, not full-repository CI or a live-release claim.

Implementation: [product source](../../js/main/catalog-data.js), [generated CR HD page](../../products/crhd.html), [comparison generator](../../tools/gen_comparisons.mjs), [regression checks](../../tests/crhd-page.test.mjs). Earlier renovations and unrelated shared working-tree changes were preserved.
