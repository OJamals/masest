# Next-session entry prompt — after 2026-09-11 session 3

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.** You may read `/Users/omar/Claude/Projects/MASEST/.dev.vars` for credentials; it
exists only there, not in the worktree.

State: `design-system-phase1` == `origin/main` == `64f04cac`, clean, 0 ahead / 0 behind.
Suite 2951/2951 unit; Playwright 4 vitals + 46 interaction + 62 workspace + 36 commerce.
Cache token `20260911e`. Everything through `64f04cac` is **deployed and verified on
production**. **Nothing is pending — but do not push or deploy without asking me first.**

Read `docs/handoff-2026-09-11c.md` first, especially its Traps section. The three older
handoffs (`-2026-09-11b.md`, `-2026-09-11.md`, `-2026-09-10.md`) are superseded on branch
state but their Traps sections are still accurate.

**Do not re-raise SQ-06, SQ-08, SQ-13, SQ-16 or SQ-22.** Do not re-litigate removing the
homepage scrollybook, keeping the `/services` hero entrance animation, declining to reserve
space for the checkout rate list, or leaving `.checkout-brand`, the skip link and the
footer's legal links under 44px — all were measured and decided.

## The cart is done; do not reopen it without a number

Production `/cart` CLS is **0.0273 iPad Mini, 0.0004 Pixel 7**, from 0.4967 / 0.4796 before
any reserve. The residual is the ZIP-estimate form on a first-ever cart view in a browser;
a repeat view pays nothing. Homepage is 1,780ms mobile LCP / CLS 0.0003. `/services` and
its 8 guides have a zero FCP-to-LCP gap. `/blog`, `/proof`, `/industries` are text-LCP at
FCP. **There is no remaining measured performance gap on the buyer path.** Do not start a
new performance pass unless a number justifies it.

## Start here, in rough value order

1. **`/products` and product detail.** The card work stopped at height. Nobody has asked
   whether the grid actually sells — what a buyer scanning it can tell about fit, size,
   price and proof before clicking, and whether the detail page answers the question the
   card raised. This is the largest untouched surface on the revenue path.
2. **Rates block for 5.1–9.4s** mid-checkout, iPad worst: a third-party round trip plus
   address validation, and the wait is unannotated. Reserving space for the rate list was
   measured and declined — this is about telling the buyer something is happening, not
   about layout.
3. **Imageless-sku over-reserve, −19px on `/cart`.** Pre-existing since `a4eb9789`: the
   line skeleton always renders `.cart-line-media` while the real line omits the figure
   when a product has no image. Only reachable for a sku the catalog does not know. The fix
   is the existing `masest_cart_estimable_v1` record also carrying "this sku had an image",
   about ten lines. Small, and honestly optional.
4. **The 23 consolidation MERGEs** — blocked by design, not effort. Multi-session content
   work. Ask before starting.

Harnesses, all gitignored under `.qa-local/frontdoor/`: `cart-cls-attribution.mjs`
(production, per-element shift attribution), `cart-estimate-delta.mjs` (per-element reserve
delta across viewports and cart shapes), `cart-estimate-prod-parity.mjs` (reserve markup
measured against production's own CSS), `cart-cls-local-priced.mjs` (local CLS with a
priced catalog, cold and warm), `tap-targets.mjs` / `tap-targets-focused.mjs` /
`tap-targets-local.mjs`, `overlay-hit-test.mjs` (elementFromPoint at the edges of an
`::after` target), `why-nav-cart.mjs` (which CSS rule actually wins, via CDP),
`purchase-path-live.mjs`, `services-heroanim-ab.mjs`, `lcp-baseline.mjs`.

## Standing decisions, do not reopen without telling me

- **Production is live-Stripe only.** `js/config.js` ships `pk_live_…`;
  `functions/_lib/stripe-runtime.js:28` forces live mode for host `masest.co` independent
  of the env var. Clicking `#checkoutPay` opens a live Checkout Session. Everything up to
  that button can be driven for free — neither `/api/shipping-rates` nor `/api/checkout`
  writes anything locally. **Do not click pay.**
- Checkout post-rates CLS of 0.07–0.20 is accepted, not a defect: reserving that space
  would park ~860px of void above the fold and leave the button just as unreachable.
- `.checkout-brand` (38×48), `.skip-link` (144×41) and the footer's legal links (34–44
  wide) stay under 44px. Reasons are in `docs/handoff-2026-09-11c.md`.

## Closed — do not raise again

- **The "SAFE ON SKIN AND EYES" label claim.** Resolved by the owner on 2026-09-11: it
  reflects an EPA designation meaning no permanent damage or injury, mild irritation only,
  and that checks out against the SDS (Skin Category 3, Eye Category 2B — mild, reversible).
  Noted and closed, no artwork or code change. The count I had been repeating was also
  wrong: 10 human-contact claims across 6 documents and 1 printed label front, not 15
  across 7 with 2 labels. Details in `docs/handoff-2026-09-11c.md`.

## How I want you to work

- Grill me on decisions rather than guessing. Give me what each answer costs before asking,
  and a recommendation when I ask for one.
- Where you are about to contradict a test-encoded decision or owner-approved content, say
  so plainly and make me confirm. But read the guard test's stated intent first —
  `surface-shadow-freeze` was nearly escalated as a conflict when its own header says the
  change was encouraged.
- Report honestly. If a spec claim is stale, say so. If you get something wrong, correct it
  in one line and move on — and if a result is only partly explained, say which part is not.
- **Verify your own harness before reporting a defect.** Three confident false findings
  across previous sessions were all harness bugs: `waitForFunction` takes options as its
  THIRD argument; the cart keys on the VARIANT sku `vsku` (`CRCIP-1G`), never the base
  product sku; and `route.fulfill` bypasses CDP throttling. Identical numbers across
  different configurations means suspect the harness.
- **Ask the browser, not the source, which rule applies.** `css/style.css` carried
  `.nav-cart { min-width: 44px }` twice while the button rendered 42px — one copy cancelled
  by `css/navigation.css`, and the winning rule injected at runtime by `js/account-nav.js`.
  Any sizing or tap-target gate must measure rendered boxes.
- Use subagents for independent analysis to save context, but **verify their headline
  claims yourself**.
- Measure the thing that actually ships. Local numbers are not field numbers — the cart
  measured 0.0609 locally and 0.1271 in the field for weeks, because the local server has
  no prices and a whole block never rendered there.
- Never `npm test` alongside Playwright — one suite at a time. Never `npm run build`
  without `build:content` first; note `npm run serve` shells into `npm run build`, so use
  `python3 -m http.server` to serve the tree for measurement. Read the summary counts in
  the log rather than trusting a task notification's exit code.
