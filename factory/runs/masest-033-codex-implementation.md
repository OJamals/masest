# masest-033 Codex implementation

## Changed files

- `products.html`: mounted guided router before the unchanged expert replacement matrix.
- `js/main/replacement-router.js`: added deterministic evidence validation, matching, four-step UI, URL/history state, accessible announcements, quote/trial fallbacks, focused popstate rendering, and complete listener cleanup.
- `js/main/commerce-ui.js`: mounted the router and reused existing buy/quote rendering.
- `css/style.css`: added router desktop/mobile styles and 44px controls.
- `tests/product-layout.test.mjs`: covered every current-chemical row, evidence traceability, partial/conflicting/unknown input, URL encoding, and untrusted query rejection.
- `tools/product-buy.spec.mjs`: covered share/refresh/history focus, keyboard/live region, 390px/desktop layout, fallback prefill, unchanged commerce policy, and leak-free destroy/remount behavior.
- `advisor-plans/README.md`: marked row 033 `DONE` after all gates passed.

## Implementation notes

- Smallest reversible assumption: volume is optional handoff context only. It does not rank candidates, define freight thresholds, or alter commerce policy.
- All 11 current replacement rows resolve to one or two products with existing `PRODUCT_CATALOG_COPY` fit and proof evidence. Model creation fails closed if that evidence is missing.
- Router owns only its `route-*` URL parameters. Existing matrix filtering, search, chips, sorting, and catalog state remain owned by `commerce-ui.js`.
- The dedicated router module intentionally colocates its pure evidence model, URL codec, view markup, and controller. Runtime ownership remains cohesive: one mount owns its root and history listeners, while `destroy()` removes every listener before remount.
- Independent review found that browser Back/Forward initially left focus on `BODY` and that anonymous root listeners survived `destroy()`. Both defects now have browser regression coverage.

## Verification

- `node --test tests/catalog-seed.test.mjs tests/product-layout.test.mjs tests/website-language.test.mjs`: 29 passed.
- `npx playwright test tools/product-buy.spec.mjs tools/contact-prefill.spec.mjs --reporter=line`: 9 passed. Bare `playwright` is not installed on `PATH`; `npx` used the repository-local binary.
- `npm run check`: 220 JavaScript files checked.
- `npm run verify`: passed after review remediation — check, Node tests, 405-file build, site verification, commerce smoke, and critical-UI gates all exited 0.
- Runtime inspection: desktop and 390px layouts had no horizontal overflow, clean console, named controls, correct live region, 11 expert matrix rows, and 15 catalog cards.

## Open risks

- No known acceptance-criteria risk. Future replacement rows must include existing product, fit, and proof metadata or the router intentionally refuses to mount.
- Worktree contains unrelated pre-existing factory changes; this implementation preserved them.
