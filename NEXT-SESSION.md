# MASEST — next-session prompt

Paste the block below to start the next session. Context first, then prioritized work.

---

You're continuing work on the MASEST / VertKleen site (masest.co, Cloudflare Pages, push `main` → auto-deploy). Read `~/.claude/projects/-Users-omar-Claude-Projects-MASEST/memory/MEMORY.md` at start — it indexes everything. The last session (2026-07-08) did a full end-to-end review: scrollybook scenes 2-5, a 4-dimension UX sweep, nav/IA restructure, blog/quote fixes, three perf wins (home CLS 0.16→0.001, logo 355→73kb, Phosphor font 147→31kb), a gated-app spot-check, and an all-pages visual review. Site is in strong shape; everything shipped is verified + test-guarded (~1276 tests green).

## Do these first (verify still true, they're the highest-leverage)

1. **Owner DB/env ops — check if the owner has applied them; several features are inert until then.** Grep memory for "OWNER OP":
   - Newsletter platform: `supabase/schema-newsletters.sql` not yet applied.
   - Blog→newsletter auto-send: `supabase/schema-blog-newsletter.sql`.
   - Reviews & ratings: `schema-reviews.sql` + `REVIEW_CRM_SECRET` env + cron sql.
   - QBO: env vars + `schema-qbo.sql` + Stripe `async_payment_*` events.
   If applied, smoke-test each feature end-to-end. If not, note they're still inert.

## Deferred code work (safe to do)

2. **P3 layout polish** (all-pages review leftovers): newsletter desktop has a large dead-whitespace band under the subscribe form (`newsletter.html` — reduce hero min-height / center columns); review fallback state has a gap between the hint card and the 3 CTA cards (`review.html` `.page-hero.compact` + section top padding). Both cosmetic.
3. **Thin blog content**: `blog/hmis-000-explained.html` is a 1-min stub (one sentence per section) — reads unfinished next to product/industry pages. Owner-content call; flag or expand.
4. **Noscript fallback navs still say "Field Results"** on ~142 pages (the JS nav + footer were unified to "Proof" last session; the `<noscript>` fallback wasn't, to avoid mass churn). Optional: `sed` "Field Results"→"Proof" across the noscript blocks.
5. **CMS icon field could be constrained to the subset.** Last session subset the Phosphor font and added a curated buffer (`vendor/phosphor/icon-buffer.txt`, ~114 extra icons) so CMS free-text icon fields have headroom. The *full* fix is to change the `industry_sector`/`proof_card` icon fields (`js/content-types.js`, currently `kind:"text"`) to a picker of subset icons. Only worth it if icon-blanks become a real problem.
6. **Schema logo**: `masest-logo.png` (now 192×240) is the schema.org Organization logo on ~20 pages — passes Google's 112px min but is small; a dedicated larger schema logo is optional polish.

## Untested (needs your input / credentials)

7. **Real form + auth + checkout flows were NOT exercised** (would send real data / need captcha login). If you want these tested: provide test creds or use the magic-link prod-QA trick (see memory `dashboards-cms-crm-qa`), and I'll drive quote submit, sign-in, add-to-cart→checkout, admin login.
8. **Gated app logged-in UI** only spot-checked unauthenticated (login gates verified secure, no data leak). Deep review of admin/dashboard/business logged-in needs auth.

## TRAPS — read before editing (from memory `ux-sweep-and-cachebust-pin` + `perf-pass`)

- **style.css cache-bust is pinned in 5 places** — bump ALL or the suite fails / CI re-breaks it: (a) every `*.html` incl `products/ comparisons/ industries/ blog/` subdirs (~72), (b) `tools/seo-inject.mjs`, (c) `tools/build-blog.mjs`, (d) `tests/build-architecture.test.mjs` literal, (e) `tests/seo-inject-asset-version.test.mjs`. Current version: **20260708c**.
- **Phosphor font is subset (31kb).** A NEW `ph-<icon>` anywhere renders BLANK until you run `node tools/subset-phosphor.mjs` (needs `pip install fonttools brotli`) and commit. `tests/phosphor-subset.test.mjs` fails CI if you forget. Full font kept at `vendor/phosphor/Phosphor.full.woff2`.
- **story.js / story.css / blog.css** have their own `?v=` (or none = etag). `js/main/*` modules use etag, no `?v=`.
- Concurrent Codex/CI edits the repo mid-session — `git fetch && rebase origin/main` before every push; commit only your own files path-specific if others are mid-edit.
- Local static `:4195` suppresses commerce (blank buybars = NOT a bug) and doesn't fire `.reveal` sections unless you inject `.reveal{opacity:1!important}`. Verify commerce/CMS on live or `wrangler pages dev`.

## How to work
Verify visually (Playwright screenshots on live masest.co or local serve, reveal-forced), run `npm test` (or targeted `node --test tests/<x>.test.mjs`), push to `main` only when green, update memory with durable decisions.
