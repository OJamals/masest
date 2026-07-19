# masest-034 Codex implementation

## Changed files

- `js/main/commerce-ui.js`: renders at most three source fit labels plus one source proof cue after existing buy/quote controls; omits unsupported or empty decision cues.
- `js/main/catalog-data.js`: corrected six proof cues to evidence present on their product detail routes.
- `css/style.css`: adds restrained, wrapping decision rows and an explicit proof-link focus ring without nested-card or gradient treatment, keeping the production build on a tracked stylesheet.
- `js/main.js`, `js/main/media.js`, and `js/main/commerce-ui.js`: publish one `20260719b` product-module cache graph so repeat visitors receive the new decision renderer.
- Public HTML entrypoints, their generators, and `tests/auth-cache-release.test.mjs`: advance the shared `main.js` release to `20260719b`.
- `tests/product-layout.test.mjs`: covers source traceability, three-fit cap, missing data, detail routes, and unchanged buyable/quote-first states.
- `tools/product-buy.spec.mjs`: covers 390px overflow, visible actions, source proof, detail routing, and action priority.
- `tools/focus-visible-a11y.spec.mjs`: covers the proof-link focus ring.
- `advisor-plans/README.md`: marks row 034 `DONE` after all required gates passed.

## Implementation notes

- Smallest reversible assumption: decision cues render only for confirmed `CATALOG_ORDER` cards. The sole quote-first id, noncanonical `crs`, keeps its quote action but receives no cue because its detail route is a current-catalog fallback without promised proof.
- Existing detail evidence replaced unsupported cue wording for HCR, HCR T16, CR, MultiWash, LAM3, and AlumiBrite. No new claims, assets, metrics, testimonials, certifications, price, stock, variant, or commerce behavior were added.
- Price and purchase/quote controls remain first in DOM and visually dominant. Decision rows are flat, smaller, and secondary.
- Review remediation removed the untracked standalone stylesheet, added listener cleanup and cache-coherency coverage, and preserved the repository-wide public-entrypoint release contract.

## Verification

- `node --test tests/catalog-seed.test.mjs tests/product-layout.test.mjs tests/website-language.test.mjs`: 32 passed.
- `playwright test tools/product-buy.spec.mjs tools/focus-visible-a11y.spec.mjs --reporter=line`: 10 passed.
- `npm run check`: 220 JavaScript files checked.
- `npm run verify`: passed; full check, Node tests, build, site verification, 18 commerce smoke tests, and 42 critical-UI tests exited 0.
- `node --test tests/auth-cache-release.test.mjs tests/main-split.test.mjs`: 14 passed.
- `npm run build`: copied 405 files; dist contains the decision CSS and a coherent `20260719b` product-module graph.
- Runtime inspection at 390px: 390px document width, 334px card, 288px action/cue width, three fit labels, one proof link, no overflow, and visible 46px buy action.

## Open risks

- No known acceptance-criteria risk.
- Worktree contains unrelated pre-existing factory changes; this implementation preserved them.
