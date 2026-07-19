You are implementing Loop Factory spec `masest-022`.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-022.md`
        Spec hash: `85f85b2059995f247ba7b20e293b3be603c79a4312c55c28458d90c2fddbb34a`

        Operating rules:
        - Treat spec as source of truth.
        - Automate code generation and verification, not product decisions.
        - If spec is ambiguous, make smallest reversible assumption and record it in implementation notes.
        - Keep changes scoped to acceptance criteria.
        - Update living spec only for facts learned from implementation or tests.
        - Do not archive spec. Review step does that.
        - Use Codex subagents when work splits cleanly. Ask explicitly before spawning. Keep final answer terse with files changed and checks run.

        Required verification:
        - `node --test --test-timeout=120000 tests/money-flow-handlers.test.mjs tests/checkout-pricing.test.mjs tests/cart.test.mjs tests/request-body.test.mjs`
- `npm run check`
- `npm run verify`

        Deliverables:
        1. Implement acceptance criteria.
        2. Run verification commands or explain why unavailable.
        3. Add notes under `factory/runs/` or in final response: changed files, checks, open risks.
        4. Leave spec in `factory/specs/active/` for review.

        Spec:
        ---
        # Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected concrete body/cart/rate limits; no broader bot policy is authorized.
- Problem: anonymous checkout parses arbitrary JSON and unbounded carts before database and Stripe work.
- Out of scope: other request-body callers, webhook bodies, pricing/tax/NET/stock/cart policy, CAPTCHA, and new infrastructure.
- Review failure: limits/status shapes drift, denied requests reach body/DB/Stripe work, valid checkout behavior changes, or gates fail.
- Riskiest assumption: legitimate carts fit 50 lines, 80-character SKUs, and quantity 999.
- Smallest acceptable: rate-limit before parsing, parse at most 64 KiB, validate cart bounds, preserve valid pay/NET flows.

# Context

`/api/checkout` is public and cost-amplifying. It needs the existing bounded-reader convention plus an early per-IP rate gate before parsing or provider work.

# Acceptance Criteria

- JSON body limit is 64 KiB before parsing; one byte over returns 413 `request_too_large`.
- At most 50 distinct cart lines are accepted.
- SKU is a non-empty string of at most 80 characters.
- Quantity is an integer from 1 through 999.
- Rate is 20 checkout attempts per IP per 60 seconds.
- Rate denial returns 429 before body consumption, database queries, or Stripe calls.
- Malformed JSON/shape returns 400 `bad_request` or existing `cart_empty`.
- Missing `RATE_KV` preserves fail-open local behavior.
- Tests cover exact boundaries, false/missing `content-length`, invalid JSON, empty/legacy carts, invalid quantities, early denial, and unchanged pay/NET responses.
- All frontmatter verification commands pass; mark row 022 `DONE` afterward.

# Constraints

- Dependencies: `masest-019` accepted; retain completed bounded-reader behavior from earlier quote/newsletter work.
- Completed prerequisite: advisor plan 011’s bounded-body reader convention remains authoritative.
- Scope changes to `functions/api/checkout.js`, focused checkout/input tests, and row-022 status only.
- Do not alter `readBody()` for other routes, webhook raw-body handling, commerce policy, CAPTCHA, or infrastructure.
- Change `functions/_lib/request-body.js` only if a verified reuse blocker exists.
- STOP if legitimate data exceeds selected bounds, production accepts non-JSON checkout, rate policy must distinguish accounts, or bounded parsing requires consuming the body twice.

# Review Notes

- Assert call ordering with spies: rate gate before parser; all denials before DB/Stripe.
- Inspect every boundary value and preserve existing response contracts for valid carts.
