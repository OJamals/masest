# Industry product image correction

Owner request: review every industry page and fix every product card that does not show the actual product.

Audited all 26 industry routes, including recommended products, specialty-label cards, and eight marine products: 115 cards total. Twenty recommended cards on 16 routes omitted MultiWash or Neutral images because their prior artwork was withdrawn. One Low Foam recommendation used the standard CR HD jug. Six specialty MultiWash cards still selected older gym, pressure-washing, or food/beverage artwork. Three CRS cards linked to Descaler despite showing CRS.

## Corrections

- MultiWash: new general-label package rendering, `img/products/multiwash-general-studio-v2.webp`. Supplied reference: `docs/labels/general/vertkleen-multiwash-label-6x8.pdf`. General directions remain 10:1, 5:1, 2:1; removed gym-only claims, NSF badge, and conflicting yield/coverage text. Specialty cards explicitly identify the general rendering while retaining their separately sourced specialty directions.
- Neutral: `img/products/neutral-identity-studio-v2.webp` identifies Neutral without printing disputed pH, recipes, yield, or certifications. The supplied Neutral package artwork and PDF have unresolved revisions; this rendering does not establish a current instructional label. Buyers still follow their supplied package directions.
- Low Foam: `img/products/cr-hd-low-foam-identity-studio-v1.webp` identifies the LF formulation instead of showing standard CR HD directions. This identity rendering does not establish an approved instructional label.
- CRS: product-specific inquiry replaces the incorrect Descaler link. CRS remains quote-first.

New artwork is explicitly described as product/package rendering, not authentic package photography or field evidence. Original assets, PDFs, source photographs, and marine selections remain preserved. Canonical catalog, industry generator, generated product pages, live image selections, and R2 registry use versioned replacements. Hydration rejects known old artwork for the corrected products.

## Image generation record

Built-in imagegen edits, one asset per request; transparent backgrounds preserved. Inputs: existing MultiWash gym cutout, Neutral cutout, standard CR HD cutout; supplied general MultiWash PDF rendered as the label reference.

MultiWash prompt: preserve white rectangular 2.5-gallon jug, cap, handle, studio angle and lighting. Replace front label with the supplied general MultiWash label, faithfully matching its name, design, caution, branding, 10:1/5:1/2:1 directions, and checked 2.5 GAL. Remove gym-specific text, NSF badge, yield and square-foot coverage.

Neutral prompt: preserve pale-yellow contents, jug, cap, handle, angle. Replace front label with white identity artwork reading VertKleen / Neutral / Cleaner / Degreaser / MASEST · masest.co, blue type and green divider. Omit recipes, pH numbers, safety claims, certifications, yield, and net-content claims.

Low Foam prompt: preserve white CR HD family jug, cap, handle, angle. Replace front label with white identity artwork reading VertKleen / CR HD / Low Foam / Cleaner / Degreaser / MASEST · masest.co, blue type and green divider. Omit standard HD directions, ratios, pH, safety/certification/aviation/GRAS claims, yield, and net-content claims.

Final cleanup prompt for each: preserve every label word and jug feature; center complete jug at 70% canvas width/height, remove floating fragments outside jug and speckles in handle opening, keep clean transparent padding and full uncropped silhouette. Selected outputs compressed to WebP with alpha preserved.

## Verification

Local release gate passed: 3,174 Node tests; syntax check; production build; all 52 industry page/viewport combinations with 230 decoded and visibly painted product images, zero failures. Visually reviewed all 24 distinct assets plus desktop/mobile product grids. R2 objects returned HTTP 200 and matched the registered SHA-256 bytes. The industry index contains no product cards; its sector imagery remains unchanged.

Regression checks require every industry card to identify a known product, contain exactly one product asset, reject replaced artwork, preserve marine identity, use matching dimensions, and retain CRS inquiry identity. `tools/audit-industry-product-images.mjs` verifies all 115 images on all 26 pages at desktop and mobile sizes, after hydration: exact source, decoding, painted visibility, containment, and no horizontal overflow. Browser reports and screenshots live in the local untracked `reports/industry-product-images/` folder.
