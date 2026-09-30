# VertKleen Neutral renovation — September 25, 2026

Status: renovated and verified locally. No commit, push, or deployment.

## Result

Neutral now presents a clear reason to buy: industrial oil and grease removal with near-neutral, solvent-free chemistry. Equipment, parts, floors, vehicles, and finished surfaces replace the previous broad sensitive-seal/aviation positioning. The page explains non-emulsifying grease lift, hot/cold-water applications, fresh-water rinsing, and a practical trial that measures product, time, repeat passes, and finished results.

The hero includes a product-facts panel: EMS's pH 7.5 reference, solvent-/butyl-free chemistry, and zero VOCs/non-flammability. Additional sections distinguish Neutral from Low Foam, explain application steps, link the exact EMS technical sheet, and provide a product-specific request for dilution guidance, package directions, and the latest SDS. Pack prices and SKU configuration were preserved.

## Research and judgment

The [current EMS SynClean N technical sheet](https://www.enviromfg.com/s/syncleannwso-tds.pdf), linked from [EMS Industrial Cleaning](https://www.enviromfg.com/industrial-cleaning), matches the supplied N PDF byte-for-byte. Manufacturer and distributor research informed job-based positioning and the distinction between HD, LF, and Neutral. Details and sources are in the [research dossier](../research/neutral-external-research-2026-09-25.md).

Three source sets give different directions: the supplied VertKleen PDF label, newer-looking studio artwork, and EMS application examples. File names and metadata do not establish which label is current. The artwork also prints pH 7 while EMS reports 7.5, and its yield statement does not reconcile with its dilution range. The page therefore uses near-neutral positioning and package-specific dilution guidance instead of an invented universal table or RTU calculation.

The old copy said Neutral holds oil in the wash. Corrected to the manufacturer's non-emulsifying grease-lift description. No unsupported aviation approval, universal seal compatibility, low-foam specification, current certification badge, patent number, or borrowed CR HD customer result was added. Handling copy follows the Neutral SDS's mild skin/eye irritation and washwater guidance.

The local SDS remains evidence for the review, but the current public-document policy does not make it a product-page download. A focused request replaces the unavailable direct link. Document bytes, hashes, and release records were preserved.

## Images

Removed the synthetic-looking material-test scene and withdrew the conflicting label packshot. A small media-review flag prevents live catalog hydration from silently restoring the same artwork. Other products keep their current images. Industry cards regenerate without the withdrawn Neutral image; the product page uses the facts panel instead of a blank placeholder.

The [replacement queue](image-replacement-queue-2026-09-25.md) records the exact assets, observed problems, and replacement brief. Current label reconciliation and a genuine Neutral packshot remain pending; no replacement label was fabricated.

## Verification

- 140 focused tests passed, covering Neutral plus previous product renovations, generated layouts, catalog/industry cards, metadata, offers, document policy, and inquiry contracts.
- Added regression coverage proving catalog image URLs cannot restore withdrawn Neutral artwork while ordinary product image selection remains intact.
- JavaScript check passed for 387 files.
- Static build passed: 295 files copied; CMS media linked in 127.
- Product and industry outputs regenerated from source owners. Fixed empty-media whitespace in the shared card renderer. Graph refreshed; incidental sitemap timestamp changes reverted.
- `git diff --check` passed.
- Browser QA at 320, 390, 768, 1024, and 1440px: no horizontal overflow, hero content within bounds, no broken images, withdrawn packshot absent after commerce hydration. Desktop facts panel and mobile hero inspected visually.
- Current public prices hydrated locally: 1 gal $21.99; 2.5 gal $51.49; four 1-gal case $79.16; two 2.5-gal case $92.68; drums and totes quoted. Selecting the two-pack case updated the displayed price and savings.
- Document request correctly prefilled `VertKleen Neutral` and the complete dilution/package/SDS message. Sample request selected Neutral. No forms submitted or orders created.
- Local catalog confirmed Neutral uses its fallback while CR HD and Low Foam retain their product images. No browser errors observed in the final inquiry check.

The local preview allowed GET/HEAD only and used read-only public API data. These checks verify local changes, not a production deployment.

Next product in sequence: **VertKleen MultiWash**.
