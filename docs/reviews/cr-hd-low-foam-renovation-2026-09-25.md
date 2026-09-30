# CR HD Low Foam renovation — September 25, 2026

Status: implemented and verified locally. No commit, push, or deployment.

## Page changes

The page now leads with grease and hydraulic-oil removal in parts washers, wash cabinets, and floor-cleaning equipment. It distinguishes Low Foam from standard high-foam CR HD, explains non-emulsifying grease lift, and presents warm/cold-water use, zero VOCs, solvent-/butyl-free chemistry, biodegradability, and the manufacturer's transport classification.

Added LF-specific application guidance, a two-row dilution table, a practical machine-cleaning sequence, manufacturer technical data, and a product-specific request for LF package directions and the latest SDS. Trial guidance measures concentrate use, cycle time, foam interruptions, repeat passes, and finished results. Price/SKU/pack configuration is unchanged.

The dilution table uses the exact LF examples: 10:1 for caked hydraulic fluid/grease; 30:1 for floors, vehicles, and carpets. Its caption identifies technical-sheet examples. Ratio orientation is not defined in the source, so the page does not invent a water-to-concentrate recipe or RTU economics.

## Source review

- [EMS product catalog](https://www.enviromfg.com/products1) explicitly positions SynClean LF for wash cabinets and parts cleaners.
- [EMS SynClean LF technical data](https://www.enviromfg.com/s/syncleanlf-tds.pdf) is byte-identical to the supplied local LF PDF. It is the currently linked document, not a newly issued 2026 revision.
- Distributor exploration informed the machine-use emphasis and clear distinction between HD and LF. Unsupported extra dilutions, shelf life, and operating conditions were not transferred.
- Current certification searches and the exact LF sheet's conflicting category lists are recorded in the [research dossier](../research/cr-hd-low-foam-external-research-2026-09-25.md). No unverified LF badge, patent number, or borrowed HD customer result was added.
- No LF-specific label or SDS was located. The page links the exact LF TDS and provides a correctly prefilled request for those documents.

## Images and responsive fix

Removed the synthetic-looking machine-wash application scene. Flagged it and the standard CR HD jug in the [replacement queue](image-replacement-queue-2026-09-25.md). Family packaging remains visibly captioned; the caption survives live commerce image hydration. A genuine LF packshot remains needed.

Browser inspection found the hero's grid minimum sizing clipping text at 320px despite no document-level horizontal overflow. Added `min-width: 0` to product-hero grid children. Rechecked actual copy and caption bounds after the fix.

## Verification

- 136 focused tests passed: LF/previous product pages, catalog seed, industry grid, generated layout, metadata, offers, controlled documents, and inquiry contracts.
- JavaScript check passed: 387 files.
- Static build passed: 295 files copied; CMS media linked in 127.
- Generated product and industry pages refreshed through their owners. Graph refreshed. Incidental sitemap timestamp changes reverted.
- Local browser QA at 320, 390, 768, 1024, and 1440px: document fits viewport; hero copy stays inside its container; no broken images.
- Desktop and mobile visual checks completed. Final table caption and family-packaging caption confirmed in rendered DOM.
- Read-only live commerce data hydrated in local preview: 1 gal $14.49; 2.5 gal $33.99; four 1-gal case $52.16; two 2.5-gal case $61.18; drums/totes quoted. Selected two-pack case updated price correctly.
- Technical inquiry prefilled `VertKleen CR HD Low Foam` and the complete LF document request. Sample inquiry selected the correct LF product. No forms submitted or orders created.
- No browser errors observed in final inquiry check. `git diff --check` passed.

The preview server permitted GET/HEAD only and proxied live public API reads. This verifies local changes with current public catalog data; it is not production deployment QA.

Next product in the review sequence: **VertKleen Neutral**.
