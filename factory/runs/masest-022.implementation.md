# masest-022 implementation

- Native adapter: `codex`
- Spec hash: `85f85b2059995f247ba7b20e293b3be603c79a4312c55c28458d90c2fddbb34a`
- Spec remains active at `factory/specs/active/masest-022.md`.

## Changed files

- `functions/api/checkout.js`: added the 20/IP/60s pre-parse rate gate, 64 KiB bounded JSON parsing, stable size/parse errors, and strict cart/SKU/quantity bounds.
- `tests/money-flow-handlers.test.mjs`: added boundary, malformed-input, legacy-cart, fail-open, exact-rate, early-denial, and unchanged pay/NET coverage.
- `tests/checkout-pricing.test.mjs`: aligned the source-integrity assertions with strict cart validation.
- `advisor-plans/README.md`: marked row 022 `DONE` after all required verification passed.

## Verification

- `node --test --test-timeout=120000 tests/money-flow-handlers.test.mjs tests/checkout-pricing.test.mjs tests/cart.test.mjs tests/request-body.test.mjs` — pass, 38/38.
- `npm run check` — pass, 214 JavaScript files checked.
- `npm run verify` — pass: 1517/1517 Node tests, build, site verification, and 12/12 commerce smoke tests.
- `git diff --check -- functions/api/checkout.js tests/money-flow-handlers.test.mjs tests/checkout-pricing.test.mjs advisor-plans/README.md` — pass.

## Implementation notes and open risks

- Small reversible assumption: the 80-character limit applies after existing SKU whitespace trimming; whitespace-only SKUs remain invalid.
- Duplicate SKUs remain supported, but their normalized total quantity must also remain within 1–999.
- `RATE_KV` keeps the existing fail-open, best-effort helper semantics. Concurrent KV read/write races remain an infrastructure-level limitation; no broader rate infrastructure was authorized.
- Legitimate carts above the selected bounds will now be rejected by design. Production cart distributions were not inspected; limits come from the maintainer-approved spec.
