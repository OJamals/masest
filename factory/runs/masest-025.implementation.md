# masest-025 implementation

- Native adapter: `codex`
- Spec hash: `297f577b01f7f728f0a3f65c1ba7f537726e25b23009c758e67c971d349763d7`
- Spec remains active at `factory/specs/active/masest-025.md`.

## Changed files

- `js/newsletter-render.js`: replaced trusted raw-HTML passthrough with an environment-neutral escaping renderer, strict renderer-owned formatting, URL allowlists, external-link `rel`, and strict card fields.
- `tests/newsletter-lib.test.mjs`: added supported-format, raw-HTML, attribute-boundary, URL-scheme, entity/control/quote, card, empty/malformed, Unicode/ampersand, and preview/email parity coverage.
- `advisor-plans/README.md`: marked row 025 `DONE` after every required verification command passed.

## Verification

- `node --test tests/newsletter-lib.test.mjs tests/newsletter-endpoints.test.mjs` — pass, 26/26.
- `npm run check` — pass, 214 JavaScript files checked.
- `npm run verify` — pass: 1527/1527 Node tests, build/site verification, and 12/12 commerce smoke cases.
- `git diff --check` — pass.

## Implementation notes and open risks

- Small reversible assumption: invalid link, image, or card syntax remains visible as escaped text instead of being silently removed.
- Absolute HTTP(S) links are treated as external and receive `rel="noopener noreferrer"`; `mailto:`, `tel:`, and root-relative links do not.
- Entity references inside URLs are rejected conservatively to prevent scheme activation after normalization. Literal query-string ampersands remain supported and are HTML-escaped.
- Existing saved newsletters that depend on unsupported raw HTML will now display that markup as text; the maintainer-approved spec explicitly accepts this risk and authorizes no migration.
- Existing unrelated worktree changes, including prior edits in `tests/newsletter-endpoints.test.mjs`, were preserved.
