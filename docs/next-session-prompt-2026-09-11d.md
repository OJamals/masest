# Next-session entry prompt — after 2026-09-11 session 4

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.** You may read `/Users/omar/Claude/Projects/MASEST/.dev.vars` for credentials; it
exists only there, not in the worktree.

State: `design-system-phase1` == `origin/main` == `da843b12`, clean, 0 ahead / 0 behind.
Suite 2960 unit; Playwright 4 vitals + 46 interaction + 62 workspace + 36 commerce.
Cache token `20260911g`. Everything through `da843b12` is **deployed and verified on
production**. **Nothing is pending — but do not push or deploy without asking me first.**

Read `docs/handoff-2026-09-11d.md` first, especially its Traps section and its audit
backlog, which is deliberately split into **verified / disproven / unread**. Several audit
headline claims were wrong last session; do not treat that list as fact beyond what it
marks as verified. The four older handoffs are superseded on branch state, but their Traps
sections all remain accurate.

## Start here, in value order

1. **Three small verified fixes, all on the money path.** Each is confirmed against the
   live site, each is roughly one commit.
   - `/products/*` Product JSON-LD puts unrelated SKUs in one `Product`'s `offers[]`:
     `/products/crhd` offers Marine Degreaser at $25.99 and $64.99 under "VertKleen CR HD".
     Invalid structured data, and Google would render a $14.49–$64.99 range for CR HD.
     Systemic across all ~15 product pages; find the JSON-LD builder.
   - No `aggregateRating` on any product, despite a live reviews feature. That is star
     ratings in search results you are not collecting.
   - `/industries/golf-courses` renders gym-labelled product copy ("Gym label",
     "Gym · fitness · studio & clinic cleaner") — a templating fault in the label module,
     and it is also the block a text extractor picks as the page's main content.
2. **The checkout wait.** The rate fetch blocks 5.0–6.9s on every checkout, 15.3s on one
   cold run, with no progress indication beyond static text. 100% of buyers hit it once.
   Reserving space for the rate list was measured and declined; this is about telling the
   buyer something is happening, not about layout. `js/checkout.js:822-834`.
3. **Apartment addresses.** Rejected with "check the street, unit, city, state, and ZIP"
   while an unused "Add apartment or suite" toggle sits on the same form. Google requires
   `PREMISE`/`SUB_PREMISE` granularity. Reproduced 3/3 with a real multi-tenant address.
   `js/checkout.js:58`, `functions/_lib/address-validation.js:103`.
4. **The larger tracks from my original brief, all specced and untouched.** Ask me which
   before starting any of them — each is multi-session:
   - **Admin panel**: 12 tabs → 11, merge Analytics+Finance into Reports, drop the
     duplicate CRM People directory, replace the raw-UUID company field on order edit with
     the search+select that order *creation* already has.
   - **CMS**: revision restore creates a draft and forces a second manual publish
     (`functions/_lib/content.js:363`); no real preview; authors and SEO titles are
     hardcoded in the generator rather than editable.
   - **CRM**: newsletter signups create no lead record; `lead_score` is set once at intake
     and never moves; inbound `quotes` and outbound `prospect_organizations` have no link.
   - **Industry pages**: six under 490 words against marine's 1,033; one identical
     boilerplate proof paragraph across 16 canonical pages; only one page has real case
     data.
   - **SEO content**: product pages carry no dilution ratio, dwell time or compatibility,
     though the data exists in the SDS/TDS library and on `/resources`. Worth building:
     a dilution guide, a compatibility matrix, a disposal/discharge FAQ.

Harnesses, all gitignored under `.qa-local/frontdoor/`: `products-fold.mjs` and
`products-blocks.mjs` (grid top, above-fold counts, block height map — serves a priced
catalog captured from production), `card-internals.mjs`, `h1-lines.mjs` and
`h1-census.mjs` (heading size and line count per page per width), `why-nav-cart.mjs` (which
CSS rule actually wins, via CDP), `services-lcp-element.mjs`, `tap-targets*.mjs`,
`overlay-hit-test.mjs`, `cart-cls-attribution.mjs`, `cart-estimate-delta.mjs`,
`cart-estimate-prod-parity.mjs`, `purchase-path-live.mjs`, `lcp-baseline.mjs`.

## Standing decisions, do not reopen without telling me

- **Production is live-Stripe only.** `js/config.js` ships `pk_live_…`;
  `functions/_lib/stripe-runtime.js:28` forces live mode for host `masest.co` independent
  of the env var. Everything up to the pay button can be driven for free — neither
  `/api/shipping-rates` nor `/api/checkout` writes anything. **Do not click pay.**
- Checkout post-rates CLS of 0.07–0.20 is accepted: reserving it would park ~860px of void
  above the fold and leave the button just as unreachable.
- `.checkout-brand` (38×48), `.skip-link` (144×41) and the footer's legal links stay under
  44px, with reasons in `docs/handoff-2026-09-11c.md`.
- `blog` and `products` keep their own heading steps; both regress to three lines at 390px
  under either shared step.
- The industry before/after sliders are **real jobs, edited so the two frames align**. The
  `data-evidence-kind="generated"` attribute mislabels them. Settled — do not re-raise.
- The **"SAFE ON SKIN AND EYES" label claim is closed**: an EPA designation meaning no
  permanent damage, consistent with the SDS (Skin Cat 3, Eye Cat 2B, both reversible).
- **Google-Extended is allowed on purpose.** Cloudflare's managed robots.txt is off and the
  file is ours. Google may train on the content; `GPTBot` may not. The asymmetry is
  accepted. `tests/robots-crawl-preferences.test.mjs` pins it.
- The imageless-SKU −19px cart over-reserve is **blocked on artwork**, not on code. Product
  images are being generated separately; re-measure with `cart-estimate-delta.mjs`'s
  `pending` case once they land, and only then decide if anything is still worth fixing.

## How I want you to work

- Grill me on decisions rather than guessing. Give me what each answer costs before asking,
  and a recommendation when I ask for one.
- Where you are about to contradict a test-encoded decision or owner-approved content, say
  so plainly and make me confirm — but read the guard test's stated intent first. Two tests
  were correctly moved last session because their subject had ceased to exist; one guard
  was wrong in the same commit that added it.
- Report honestly. If a spec claim is stale, say so. If you get something wrong, correct it
  in one line and move on — and if a result is only partly explained, say which part is not.
- **Ask the browser, not the source, which CSS rule applies.** `css/style.css` carried
  `.nav-cart { min-width: 44px }` twice while the button rendered 42px: one copy cancelled
  by `css/navigation.css`, and the winning rule injected at runtime by `js/account-nav.js`.
  A shadowed declaration is also not a dead rule — an audit called a `.display` block dead
  and deleting it would have changed every heading on the site.
- **Verify your own harness before reporting a defect.** Every confident false finding so
  far has been a harness bug: `waitForFunction` takes options as its THIRD argument; the
  cart keys on the VARIANT sku (`CRCIP-1G`); `route.fulfill` bypasses CDP throttling;
  `top < innerHeight` counts collapsed zero-rect cards as visible; and the local tree has
  no prices, so a `/products` card renders ~90px shorter than the real one.
- Use subagents for independent analysis to save context, but **verify their headline
  claims yourself** — last session produced "no AI answer engine can read the site" (the
  blocked agents were training crawlers) and "zero Product JSON-LD anywhere" (it is present
  and contaminated, the opposite problem).
- Measure the thing that actually ships, and prefer a screenshot as well as numbers: the
  `/products` hero looked half-empty at a width where every measured number was fine.
- Never `npm test` alongside Playwright, and **never run the Playwright suites while a
  Playwright subagent is live** — a race-condition test failed twice under that load and
  passed 62/62 once the agents finished. Never `npm run build` without `build:content`
  first; `npm run serve` shells into `npm run build`, so use `python3 -m http.server` to
  serve the tree for measurement. Read the summary counts in the log rather than trusting a
  task notification's exit code.
