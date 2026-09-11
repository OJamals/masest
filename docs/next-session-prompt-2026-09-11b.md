# Next-session entry prompt — after 2026-09-11 session 2

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.** You may read `/Users/omar/Claude/Projects/MASEST/.dev.vars` for credentials; it
exists only there, not in the worktree.

State: `design-system-phase1` == `origin/main` == `b8b62b31`, clean, 0 ahead / 0 behind.
Suite 2946/2946 unit; Playwright 3 vitals + 45 interaction + 62 workspace + 36 commerce.
Cache token `20260911c`. Everything through `b8b62b31` is **deployed and verified on
production**. **Nothing is pending — but do not push or deploy without asking me first.**

Read `docs/handoff-2026-09-11b.md` first, especially its Traps section. The two older
handoffs (`-2026-09-11.md`, `-2026-09-10.md`) are superseded on branch state but their
Traps sections are still accurate.

**Do not re-raise SQ-06, SQ-08, SQ-13, SQ-16 or SQ-22.** Do not re-litigate removing the
homepage scrollybook, keeping the `/services` hero entrance animation, or declining to
reserve space for the checkout rate list — all three were measured and decided.

## Start here

**Finish the cart CLS work: reserve the order summary.** Production is iPad Mini 0.1271,
Pixel 7 0.0808, down from 0.4967 / 0.4796. The lines no longer move at all — measured
per-line delta on hydration is 0px. What still moves is
`.cart-path.cart-path-primary`, the block holding `#checkoutContinue`, by **+347px at
~1451ms**, when `#cartEstimate` and the ZIP-estimate form populate. Both are static markup
that is merely `hidden`. Neither is reservable from localStorage alone: one needs prices,
the other needs to know whether the cart consolidates into a single carton. Getting iPad
Mini under 0.1 puts the page in the "good" band.

Harnesses, all gitignored under `.qa-local/frontdoor/`:
`cart-cls-attribution.mjs` (production, per-element shift attribution — this is the one
that found the cause), `purchase-path-live.mjs` (cart → checkout → pay-enabled, stops at
the button), `services-heroanim-ab.mjs`, `lcp-baseline.mjs`.

**Note the correction in the handoff**: commit `a4eb9789` says "CLS 0.50 → 0.06" but 0.06
was the local number; production is 0.1271 / 0.0808. The local server has no pricing data
so the estimate block never populates there. Do not quote the commit subject as the
production figure.

## Then, in rough value order

1. **Tap targets on the revenue path** — deferred last session until the CLS work verified,
   which it now has. `Return to cart` 94×22 with zero padding, checkout checkbox labels at
   26px (they gate shipping cost and destination), nav cart badge 42×44, `Talk with our
   team` 117×16. **Do these after, never alongside, a reserve change** — padding moves the
   row heights a skeleton is calibrated against.
2. **`/products` and product detail** — the card work stopped at height. Nobody has asked
   whether the grid actually sells.
3. **The 23 consolidation MERGEs** — blocked by design, not effort: a redirect into a
   thinner page is content deletion, and 7 of 23 targets are smaller than their source.
   Multi-session content work. Ask before starting.

Do not start a new performance pass unless the numbers justify it. Homepage 1,780ms mobile
LCP / CLS 0.0003. `/services` and its 8 guides now land LCP at FCP, gap 0. `/blog`,
`/proof`, `/industries` are text-LCP at FCP. The cart summary above is the one measured gap
left.

## Standing decisions, do not reopen without telling me

- **Production is live-Stripe only.** `js/config.js` ships `pk_live_…` and
  `functions/_lib/stripe-runtime.js:28` forces live mode for host `masest.co` independent
  of the env var. Clicking `#checkoutPay` opens a **live** Checkout Session. Everything up
  to that button can be driven for free — neither `/api/shipping-rates` nor `/api/checkout`
  writes anything locally. **Do not click pay.**
- Checkout post-rates CLS of 0.07–0.20 is accepted, not a defect: reserving that space
  would park ~860px of void above the fold and leave the pay button just as unreachable.

## Still owed to me

- **Label PDFs.** `vertkleen-lam3-label-front.pdf` p.2 says "SAFE ON SKIN AND EYES" against
  an SDS that says "Causes eye irritation". 15 occurrences, 7 documents, 2 printed labels,
  and the claim appears **nowhere on the web**. `tools/publish-approved-labels.py`
  republishes owner-approved artwork, it does not author it — there is no code fix. Raise
  it, do not fix it. Third session running.

## How I want you to work

- Grill me on decisions rather than guessing. Give measured numbers and what each answer
  costs before asking, and a recommendation when I ask for one.
- Where you are about to contradict a test-encoded decision or delete owner-approved
  content, say so plainly and make me confirm. But read the guard test's stated intent
  first — `surface-shadow-freeze` was nearly escalated as a conflict when its own header
  says the change was encouraged.
- Report honestly. If a spec claim is stale, say so with the measurement. If you get
  something wrong, correct it in one line and move on — and if a result is only partly
  explained, say which part is not.
- **Verify your own harness before reporting a defect.** Two confident false findings last
  session were both my own bugs: `waitForFunction`'s options must be the THIRD argument
  (passing them second silently falls back to a 30s default), and the cart keys on the
  VARIANT sku `vsku` (`CRCIP-1G`), never the base product sku (`cr`). Identical numbers
  across different configurations means suspect the harness.
- Use subagents for independent analysis to save wall-clock time, but **verify their
  headline claims yourself**.
- Measure the thing that actually ships. Local numbers diverge from production — the cart
  measured 0.06 locally and 0.13 in the field, because the local server has no prices.
- Never `npm test` alongside Playwright — one suite at a time. Never `npm run build`
  without `build:content` first; note `npm run serve` shells into `npm run build`, so use
  `python3 -m http.server` to serve the tree for measurement. Read the summary counts in
  the log rather than trusting a task notification's exit code.
