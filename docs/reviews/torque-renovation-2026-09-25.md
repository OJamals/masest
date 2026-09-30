# Torque review and renovation

Status: researched, renovated, and locally verified. No commit, push, or deployment. Torque follows AlumiBrite in the product catalog.

## Buyer outcome

The page now presents Torque as a concentrated, one-step vehicle and marine wash and wax. Buyers can see the soils it removes, understand how rinsing distributes wax and anti-stick protection, choose a label dilution, inspect a real Torque result, and buy a small pack or request a fleet-size quote.

## Review judgment

The previous page described a clean, polished finish without explaining the wax or anti-stick mechanism. It omitted practical label directions and named fleet-testing evidence. Its result link pointed to a combined AlumiBrite restoration even though the published proof catalog already contained a Torque-specific vessel wash.

The strongest story combines road-film, diesel-soot, winter-salt, and bug removal with polymerized natural bean wax and easier repeat cleaning. The current [EMS vehicle-washing page](https://www.enviromfg.com/vehicle-washing) identifies Torque as the chemistry behind Blue Bird's Bird Bath and reports testing by PPG. The currently linked [EMS Torque technical sheet](https://www.enviromfg.com/s/torquewso-tds.pdf) supports the cleaning, finish, compatibility, biodegradability, and shipping details used on the page.

## Changes

- Reworked hero, catalog positioning, search metadata, applications, and image caption around wash-and-wax performance.
- Explained SynTech and SynClean cleaning plus the wax and anti-stick finish deposited during rinsing.
- Added a readable dilution table from the published VertKleen general label: 20:1 new/reconditioned, 15:1 moderate, 10:1 heavy, and 5:1 severe soil.
- Added a three-step application guide covering hand, bucket-and-brush, and foam application; agitation; and thorough rinsing.
- Added named Blue Bird/PPG evidence with a direct manufacturer source link.
- Added an EMS technical profile: HMIS 0-0-0, non-corrosive/non-DOT classification, no VOCs or phosphates, 100% biodegradability, winter-salt removal, and listed vehicle materials.
- Replaced the combined airboat link with the existing `yellowfin-torque-wash` record and its published vessel photograph. No CMS records or media uploads changed.
- Added a related AlumiBrite link for oxidized-aluminum restoration, keeping the two products' jobs distinct.
- Generalized featured-result copy in the product generator so each product has its own heading, introduction, and related-product link. AlumiBrite retains its matched before/after panel images.
- Regenerated the Torque page and its fleet/car-wash and golf-course industry references. Existing AlumiBrite and unrelated directory work were preserved.

## Source decisions

The owner confirmed MASEST's direct-reseller relationship and permission to use EMS materials. Manufacturer attribution is now used openly. The full [research dossier](../research/torque-external-research-2026-09-25.md) records official documents, distributor research, patent context, and EPA/NSF searches.

The current general-label PDF and older supplied label agree on the four displayed ratios. Foreign distributor directions differ. The local label does not explicitly define ratio order, so the page reproduces its ratios and points to package directions; it does not invent a ready-to-use yield, cost per vehicle, or dosing protocol.

The page uses current manufacturer technical classifications and specifically attributed fleet evidence. The research did not establish a current Torque-specific EPA Safer Choice or NSF directory entry, so no new certification badge was added. No unrestricted discharge, guaranteed freight-price savings, universal OEM warranty, or time-based wax-protection promise was introduced. These source distinctions remain in this internal review rather than becoming disclaimers in the marketing copy.

The supplied four-page Yellowfin case PDF was reviewed, including its final hull photograph. The page uses the existing public proof record and image; the original customer-branded PDF was not republished.

## Verification

- **88/88 scoped tests passed** in a detached local snapshot at `6896ede5` plus AlumiBrite/Torque changes and the owner-authorized EMS-attribution policy adjustment. Coverage: both product pages, product layout, seed data, industry cards, SEO metadata, commerce schema, and document review.
- The shared checkout passed 87/88 of the same checks. Its sole failure expects the old product-directory introduction in `tests/catalog-seed.test.mjs`; the directory is under separate active renovation. The scoped snapshot passes that assertion unchanged. This is not a full-repository CI claim.
- The shared document-review test already permits EMS attribution. The isolated snapshot uses an equivalent product-identity check without importing the separate directory renovation. This shared policy change is a dependency for any eventual release.
- JavaScript validation passed across 383 files. Static production build passed: 282 files copied, CMS media linked in 127. Whitespace check passed.
- Browser QA passed at **320, 390, 768, 1024, and 1440 px** using the local production build, real published media, and read-only production commerce APIs. No JavaScript page errors, duplicate IDs, or horizontal overflow.
- Verified 1-gallon and 2.5-gallon price selection, 55-gallon quote switching and size preservation, hero result anchor, real image loading, keyboard sample navigation and Torque form prefill, canonical URL, metadata, and live manufacturer source links.
- Observed prices: 1 gal $19.99; 2.5 gal $46.49; 4 × 1 gal case $71.96; 2 × 2.5 gal case $83.68. Drum and tote remain quote-only. No order or form submission occurred.

QA artifacts: [browser script](/tmp/torque-page-qa.mjs), [browser results](/tmp/torque-browser-qa.json), [scoped test log](/tmp/torque-isolated-tests.log), [desktop hero](/tmp/torque-hero-1440.png), [mobile dilution table](/tmp/torque-dilution-390.png), [vessel result](/tmp/torque-result-1440.png).

AlumiBrite was also reverified: its initial isolated run passed 85/85 checks, and the final combined run includes its regression coverage. [AlumiBrite review](alumibrite-renovation-2026-09-25.md).

Reviewable implementation: [Torque page](../../products/torque.html), [catalog copy](../../js/main/catalog-data.js), [generator](../../tools/seo-inject.mjs), and [Torque regression checks](../../tests/torque-page.test.mjs).
