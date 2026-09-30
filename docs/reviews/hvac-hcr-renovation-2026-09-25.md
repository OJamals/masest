# VertKleen HVAC HCR review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment.

## Buyer outcome

HVAC HCR now leads with calcium, mineral scale, and rust removal. Small packs are prominent, with bulk supply available for recurring maintenance. The page distinguishes exposed-surface cleaning from isolated heat-exchanger and boiler cleaning, and features the original Brevard County before/after photographs.

## Research judgment

Reviewed current EMS technology and product materials, EMCO's HCR listing, other EMS distributor presentations, the supplied HVAC label, HCR TDS/SDS, two equipment guides, and the Brevard County field report. Sources and exact distinctions appear in the [research dossier](../research/hvac-hcr-external-research-2026-09-25.md).

- The [current EMS SynTech page](https://www.enviromfg.com/our-juice2) supports the technology story; the supplied HCR TDS/SDS supports non-fuming, zero-VOC, HMIS 0-0-0, and non-DOT-regulated transport messaging. [EMCO's HCR listing](https://www.emcochem.com/product/saph-hcr/) supports a product-specific sample and technical-support path.
- Current BlowOut and Foro documents describe separate formulations. Their benchmark figures and approvals were not transferred to HCR. Historical EMS HCR material recovered in the preceding review remains useful archival manufacturer evidence.
- Brevard's result describes sprayed HCR, 30 minutes of contact, and a garden-hose rinse without scrubbing after previous CLR attempts failed. The page presents this as exposed-surface restoration; no measured energy saving or circulating-system result is invented.
- The HVAC label gives 10:1 for light soil with 10–15 minutes of contact, 5:1 for moderate soil without a fixed duration, and 2:1 for severe soil with 20 minutes of contact. Ratios are reproduced as printed. Their component order is not defined by the label, so no dilution-cost arithmetic was added.
- The system guides contain inconsistent volume/time and cooling-tower dose entries. The page uses their isolation, cleaning, monitoring, draining, and flushing workflow while asking for a plan matched to actual equipment and deposits.
- HCR's technical sheet excludes aluminum piping/fittings. This appears in material guidance rather than a blanket compatibility promise. The SDS does not support unrestricted storm-drain disposal.

## Changes

- Reworked the hero, applications, benefits, metadata, and catalog description around the actual HVAC cleaning job. Removed bulk-only positioning while keeping existing SKUs, prices, and pack options.
- Added separate application sections for exposed deposits and isolated heat exchangers/boilers, plus the exact label dilution table.
- Added an EMS technology reference, recurring-maintenance technical profile, and equipment/material checklist.
- Featured approved Brevard result imagery and linked the hero directly to that section. Linked HVAC CR for grease and organic buildup.
- Removed the synthetic descaling-loop scene from this product. The original asset and registry remain; the still-unreviewed Descaler reference is untouched.
- Added a bounded contact-product alias so HVAC HCR inquiries select the existing VertKleen HCR form option. Technical-request text preserves the HVAC product name.
- Regenerated product and dependent industry output through the existing generators. Updated focused checks and existing quote/proof expectations.

## Image and artwork flags

The [replacement queue](image-replacement-queue-2026-09-25.md) records the synthetic loop scene's ambiguous hose routing and incomplete circulation setup, with a brief for an authentic maintenance photograph. Actual approved before/after photos now carry the HVAC page's visual evidence.

The supplied HVAC label contains a certification-verification footer and diluted-aluminum wording that needs reconciliation with the TDS piping/fitting exclusion. These are recorded as source-artwork issues. No source PDF bytes, approval records, or document hashes were changed; no new NSF listing claim was added.

## Verification

- **126/126 focused checks passed**: HVAC HCR, preceding product renovations, generated layout, catalog/industry references, SEO and offer schema, document policy, and contact/quote behavior.
- JavaScript validation passed across **383 files**. Static build copied **294 files**, linking CMS media in **127**. Whitespace checks passed; context graph refreshed; date-only sitemap churn removed.
- Local browser QA at **320, 390, 768, 1024, and 1440 px** found no horizontal overflow, duplicate IDs, extra H1, or broken main images. Canonical URL and description verified. Mobile proof and dilution sections visually inspected.
- Hero evidence navigation lands approximately 80 px below the viewport top, clear of fixed navigation. The two authentic photographs render together with Before/After labels.
- Verified 2.5-gallon price switching and the 55-gallon freight-quote URL. Sample navigation selects Sample Kit and VertKleen HCR. Technical-data navigation selects VertKleen HCR and prefills the exact HVAC HCR document request. No form was submitted.
- Observed prices: **1 gal $28.99**, **2.5 gal $68.49**, **4 × 1 gal $104.36**, **2 × 2.5 gal $123.28**; drum/tote quote-only. Browser used the local production build with read-only live commerce APIs.
- HVAC label returned HTTP 200, `application/pdf`, and valid PDF bytes. No browser warning/error logs were observed during final checks.

Evidence: [focused checks](/tmp/hvac-hcr-tests.log), [JavaScript validation](/tmp/hvac-hcr-js.log), [static build](/tmp/hvac-hcr-build.log). Browser observations and screenshots are recorded in this task. Verification is local and focused, not full-repository CI or a live-release claim.

Implementation: [generated page](../../products/hcr-t16.html), [catalog source](../../js/main/catalog-data.js), [contact alias](../../js/main/engagement.js), [regression checks](../../tests/hvac-hcr-page.test.mjs). Earlier renovations and unrelated working-tree changes remain intact.
