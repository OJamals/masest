# Purgo final polish

Completed September 25, 2026. Local page updated; not deployed.

## Changes

- Shortened the hero to 38 words, including the existing buying guidance. Surface cleaning and odor control lead; water-system maintenance stays visible.
- Added a complete, concise search/social description so the snippet no longer ends mid-thought.
- Changed the sample action to “Request a free Purgo sample.”
- Replaced the generic application-photo caption with “Facility cleaning & drain care” and a specific description of the setting.
- Kept the generator as the owner of the product page. Optional product-specific metadata and captions preserve existing defaults for other products and use the existing HTML escaping.

## Verification

- Visually inspected the rendered page at 390px and 1440px, including the real product image and application image. No horizontal overflow; caption, CTAs, and purchase controls remain readable.
- Used live read-only catalog responses to verify the purchase area: $42.99 for one gallon; selecting 2.5 gallons updates it to $102.49; selecting a 55-gallon drum replaces Add to cart with Request quote. No order or form was submitted.
- Checked all seven distinct product-content link destinations: marine page, bulk quote, shipping/returns, cleaning-program quote, sample request, product catalog, and persistence PDF. Each returned HTTP 200.
- Passed 63 existing tests covering catalog, layout, search, escaping, marine mapping, SEO metadata, and generated asset versions. Updated the existing caption expectation for the new wording.
- Generator syntax and `git diff --check` passed. Regeneration changed the Purgo page; unrelated sitemap date churn was discarded. Existing unrelated work was preserved.

The first static preview omitted live commerce and offloaded images. Final visual checks used the real read-only API and media responses, including a scroll to load the application photograph.

## Scope

This finishes the copy and presentation pass. Existing package artwork, technical documents, dilution calculations, and previously identified source-reconciliation work were not changed. No commit, push, or deployment performed.

Files: [catalog copy](../../js/main/catalog-data.js), [generator](../../tools/seo-inject.mjs), [generated Purgo page](../../products/purgo.html), [layout checks](../../tests/product-layout.test.mjs).
