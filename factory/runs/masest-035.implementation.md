# masest-035 implementation

## Result

- Added a same-origin, structured request-context contract capped at 1,800 absolute URL characters.
- Guest and authenticated customer chat retain their primary actions and expose a secondary quote handoff.
- Contact prefill validates `customer_chat`, visibly exposes editable product, volume, and notes, and submits the allowed source in the existing quote payload.
- Existing quote CRM attribution remains `contact`; no backend context state or personal/chat-history URL data was added.
- Review remediation makes local builds include unignored new site modules while excluding internal Factory artifacts, publishes a coherent `20260719c` cache chain, and keeps the authenticated quote action inside 320px-wide panels down to 320px viewport height.
- Row 035 is `DONE`. Spec remains active at `factory/specs/active/masest-035.md` pending independent acceptance.

## Implementation assumptions

- The smallest reversible safe URL cap is 1,800 absolute characters.
- Stable product identity comes from `body[data-product-sku]` when present, otherwise a validated `/products/<slug>` path.
- Valid but unknown product slugs remain visible as temporary editable select options; no catalog fetch is needed for handoff.
- Cart overflow uses omitted line-item and quantity counts after up to eight validated SKU/quantity pairs.

## Changed files

- `js/request-context.js`
- `js/customer-chat.js`
- `js/main/engagement.js`
- `contact.html`
- `css/customer-chat.css`
- `tests/cart.test.mjs`
- `tests/customer-chat.test.mjs`
- `tools/contact-prefill.spec.mjs`
- `tools/cf-build.mjs`
- `tests/build-architecture.test.mjs`
- `tests/auth-cache-release.test.mjs`
- `tests/main-split.test.mjs`
- `advisor-plans/README.md`

## Verification

- `node --test tests/customer-chat.test.mjs tests/cart.test.mjs tests/conversion-entry.test.mjs` — pass, 23/23.
- `npx playwright test tools/contact-prefill.spec.mjs --reporter=line` — pass, 3/3. `playwright` is not globally installed; `npx` invoked the repository-local binary.
- Focused remediation suite — pass, 42/42, including 320×568, 320×360, and 320×320 clipping regressions plus build-boundary and cache-release coverage.
- `npm run build` — pass, 408 static files; new 031/033/035 modules are present and `dist/factory` is absent.
- `npm run check` — pass, 221 JavaScript files.
- `npm run verify` — pass after review remediation: 1,570/1,570 Node tests, site verification, 20/20 commerce browser tests, and 42/42 critical UI browser tests.

## Open risks

- No known acceptance-criteria risk. Worktree contains a larger shared Loop Factory batch; no files were staged or committed.
