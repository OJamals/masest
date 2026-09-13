# Next-session entry prompt — after 2026-09-12 session 5

Continue the MASEST website renovation — the overarching goal is transforming masest.co
from an informational site into a high-trust, conversion-optimized platform that sells the
VertKleen line, merging an Apple-grade aesthetic with industrial credibility.

Work in the git worktree `/Users/omar/Claude/Projects/MASEST-design-system` on branch
`design-system-phase1`. **Never touch `/Users/omar/Claude/Projects/MASEST` — Codex edits it
live.** You may read `/Users/omar/Claude/Projects/MASEST/.dev.vars` for credentials; it
exists only there, not in the worktree.

State: `origin/main` == **`5ca20218`**, deployed and verified on production. The branch
carries one docs-only commit after it (the handoff and this prompt). Suite 2978 unit;
Playwright 4 vitals + 46 interaction + 62 workspace + 36 commerce. Cache token `20260912a`,
now spent. **There is no work in progress. Do not push or deploy without asking me first.**

Read `docs/handoff-2026-09-12.md` first — especially **Decisions recorded**, **Do not carry
forward**, and **Traps**. The five older handoffs are superseded on branch state, but their
Traps sections all remain accurate.

## Before anything else, verify the state instead of trusting this prompt

Run `git fetch`, then confirm the branch is clean and `origin/main` has not moved; Codex may
have pushed since. Then confirm production still behaves as shipped — `/products/crhd`
should carry exactly 2 offers at $14.49-$33.99, and `POST /api/shipping-rates` with
`123 Main St, Brooklyn NY 11201` should return 422 `shipping_address_unverified`, not 502.
If either has regressed, that is the first job.

## Start here, in value order

1. **Three small verified items, roughly one commit each.** Each was re-verified at its
   cited line on 2026-09-13. Ask before pushing any of them.
   - **Order edit takes a raw company UUID.** `js/admin/orders.js:393` is a text input for
     `company_id`, while order *creation* already has a business search at `admin.html:1009`
     (`#ordCreateCompanySearch`). Reuse the creation control rather than building a second one.
   - **Newsletter signups create no CRM record.** `functions/api/newsletter.js:44` calls only
     `setMarketingPreference`. Ask me what a signup should create, and whether it should
     score, before writing it — that is a CRM decision, not a bug fix.
   - **CMS revision restore.** `restoreRevision` is at `functions/_lib/content.js:363`.
     Session 4 reported that restoring creates a draft and forces a second manual publish.
     **Reproduce that before changing anything**, and read the guard tests first:
     restore-to-draft may be deliberate, since a restore that publishes immediately puts
     old content live with no review.
2. **One decision I still owe you.** Probe discipline is enforced in code only for HTML
   (`tools/html-query.mjs`). Ask me whether to add a lint rule banning regex-over-HTML in
   `tests/` and `tools/`, a `CLAUDE.md` entry, or neither — with what each costs.
3. **The larger tracks from my original brief.** Ask me which before starting any of them —
   each is multi-session. My recommendation is SEO content, because it continues the
   answer-engine work that just shipped.
   - **SEO content.** Verified: **0 of 26 industry pages carry any FAQ content.** Any FAQ must
     be built from sources that already exist and were reviewed — the industry registry, the
     SDS/TDS library, the printed label directions — never invented, and the
     registry-framing guards apply (see Standing decisions). Session 4 also claimed product
     pages lack dilution, dwell time and compatibility; that is **unverified**, and industry
     pages now publish dilution in both the label sections and the operating standard, so
     re-derive it before acting.
   - **Admin IA.** `admin.html` carries 12 tabs today. The proposal — 11 tabs, Analytics and
     Finance merged into Reports, the duplicate CRM People directory dropped — had three
     checkable claims hold in session 4; the rest is unread.
   - **CRM.** Session 4 reported that `lead_score` is set once at intake and never moves, and
     that inbound `quotes` and outbound `prospect_organizations` have no link. Both unverified.
   - **CMS.** No real draft preview. Session 4 also listed "authors and SEO titles are
     hardcoded in the generator" as a gap — **that placement is deliberate.**
     `data/content/*.json` is a snapshot that `verify.yml` overwrites from Supabase before every
     build, so structural fields live in the generator to survive it. Making them editable is
     a new feature that moves them into Supabase, not a fix.
4. **Blocked on my input, not on code.** Per-industry proof: `field_evidence.status` is 0
   qualified, 11 context_only, 15 absent — there is no field record to publish. The
   imageless-SKU cart over-reserve is blocked on artwork.

## Closed last session — do not re-raise

- Product JSON-LD offers: fixed and verified on all 15 pages.
- `aggregateRating`: production has 0 approved reviews, and the pipeline that will bake the
  first one now works without a credential.
- Industry product grids, the operating standard, and supplemental scope copy: shipped.
- Golf's "Gym label": correct. It is the real printed label, and every label-variant section
  repeats grid products because its purpose is the dilution directions.
- Product detail copy: complete on all 15 pages.
- The checkout rate wait: copy is staged; the speed work was declined.
- The audit's "unannotated wait" and "unused apartment toggle": both were wrong at the source.
- **"80 of 110 industry images are imagegen output": do not use this number.**
  `docs/INDUSTRY_IMAGE_AUDIT.md` documents 16 replacements.

Harnesses, all gitignored. Session 5, at `.qa-local/`: `registry-coverage.mjs` (which
registry string fields reach the page), `copy-coverage.mjs` (product copy per detail page,
by importing the catalog module), `label-overlap.mjs` (label-variant sections against the
recommended grid, section-scoped), `checkout-addr.mjs` and `rate-timing.mjs` (live address
shapes and quote latency), `rate-502.mjs`, `suite-reveal.mjs` and `stage-copy.mjs` (A/B the
branch's `checkout.js` against the live page), `grid-verify.mjs`, `grid-shot.mjs` and
`operating-shot.mjs` (industry page rendering, with R2 images substituted). Session 4, at
`.qa-local/frontdoor/`: `products-fold.mjs`, `products-blocks.mjs`, `card-internals.mjs`,
`h1-lines.mjs`, `h1-census.mjs`, `why-nav-cart.mjs`, `services-lcp-element.mjs`,
`tap-targets*.mjs`, `overlay-hit-test.mjs`, `cart-cls-attribution.mjs`,
`cart-estimate-delta.mjs`, `cart-estimate-prod-parity.mjs`, `purchase-path-live.mjs`,
`lcp-baseline.mjs`. Several session-5 probes predate the parser; check any you reuse against
a known-bad input first.

## Standing decisions, do not reopen without telling me

- **Production is live-Stripe only.** Everything up to the pay button can be driven for
  free — neither `/api/shipping-rates` nor `/api/checkout` writes anything. **Do not click pay.**
- **`SUPABASE_SERVICE_ROLE_KEY` never goes into CI.** `tests/github-pages-deploy.test.mjs:34`
  and `:64` forbid it; the key lives in the Worker runtime. `build-reviews.mjs` reads
  `GET /api/reviews` instead.
- **Registry framing stays out of customer copy.** Three guards say so, one of them
  `tests/industry-pages.test.mjs:701`. My override for the six operating-standard fields is
  scoped to that section only.
- **Every image byte lives in R2.** Supabase went over its storage limit hosting pictures
  and the account got a final warning. `data/content/site-images.json` is metadata only, and
  an `<img src>` reaches R2 only if its path is registered there.
- Checkout post-rates CLS of 0.07-0.20 is accepted.
- `.checkout-brand`, `.skip-link` and the footer's legal links stay under 44px, with reasons
  in `docs/handoff-2026-09-11c.md`.
- `blog` and `products` keep their own heading steps.
- The industry before/after sliders are **real jobs, edited so the two frames align**. Settled.
- The **"SAFE ON SKIN AND EYES" label claim is closed**: an EPA designation consistent with
  the SDS (Skin Cat 3, Eye Cat 2B, both reversible).
- **Google-Extended is allowed on purpose**; `GPTBot` is not. `tests/robots-crawl-preferences.test.mjs`
  pins it.

## How I want you to work

- Grill me on decisions rather than guessing. Give me what each answer costs before asking,
  and a recommendation when you have one.
- Where you are about to contradict a test-encoded decision, owner-approved content, or an
  approval I gave you, stop and say so — but read the guard test's stated intent first. Last
  session I approved adding a secret, and the suite showed the architecture forbids it; the
  right move was to stop, not to edit the guard.
- Report honestly. If a spec claim is stale, say so. If you get something wrong, correct it
  in one line and move on — and if a result is only partly explained, say which part is not.
- **Probe discipline — this is where every false finding has come from.** Never regex a
  structured format: use `tools/html-query.mjs` for HTML and `import` JS modules instead of
  scraping their source. Run any probe whose number you will report against a known-bad input
  first. After a browser `fill`, read the value back. Check an external URL shape once at the
  source rather than assuming it.
- **Ask the browser, not the source, which CSS rule applies.** A runtime-injected `<style>` in
  `js/account-nav.js` beats every linked sheet, and a shadowed declaration is not a dead rule.
- Use subagents for independent analysis to save context, but verify their headline claims
  yourself.
- Measure the thing that actually ships, and prefer a screenshot as well as numbers. The local
  tree has no prices and only 8 product image binaries, so measure against production data.
- **Never `git checkout -- .` with uncommitted work you mean to keep.** Commit first, or revert
  named files.
- Never `npm test` alongside Playwright, and never run the Playwright suites while a
  Playwright subagent is live. Never `npm run build` without `build:content` first; use
  `python3 -m http.server` to serve the tree. `npm run seo-inject` fires `preseo-inject` and
  rewrites `sitemap.xml` — call `node tools/seo-inject.mjs` directly, on a clean tree. Read the
  summary counts in the log rather than trusting a task notification's exit code.
- This worktree has no `graft/` index; do not assume graft tools answer for it.
