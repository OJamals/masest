# Handoff — site quality remediation, 2026-09-09

Companion to `docs/site-quality-remediation-2026-09-07.md`, which is the spec and holds
all 25 findings with their evidence. Read that first; this file is only what a fresh
session needs in order to take over.

---

## Where the work is

| | |
|---|---|
| Worktree | `/Users/omar/Claude/Projects/MASEST-design-system` |
| Branch | `design-system-phase1` |
| Position | **21 commits ahead of `origin/main`, 0 behind — rebased 2026-09-09** |
| Tree | clean |
| Tests | `2947/2947` pass on HEAD `f68b3c04` |
| Cache token | `20260910a`, unified across every versioned asset. Never deployed. |
| Recovery point | `backup/design-system-pre-rebase` = the pre-rebase tip |
| Pushed? | **No.** Nothing has been pushed. |

**Do not touch `/Users/omar/Claude/Projects/MASEST`.** That is the primary checkout, Codex
edits it live, and it carries ~112 uncommitted files.

---

## The rebase is done — what it cost, so you don't undo it

Rebased onto `origin/main` (`c716b90a`) on 2026-09-09. 21 commits replayed, 20 kept,
six conflicts. Recorded here because several resolutions were judgement calls that a
future rebase or revert could quietly reverse.

| conflict | resolution and why |
|---|---|
| `style.css` touch-target padding | took **main's** `min-height: 45px` / `padding-block: 11px`. Their touch-target QA postdates the spacing scale. |
| `js/main/chrome.js` module tokens | took main's; everything was re-tokened afterwards anyway. |
| `37372c14` (previous session's token unification) | **skipped.** It re-tokenised onto `20260909b`, the exact collision described below. Its type/spacing work on `admin-support.css` was preserved by resolving that file to this branch's side. |
| `.quote-form-footer` block | took **main's**. This branch would have added a duplicate of a block main already has. |
| `css/admin-support.css` ×2 | took **this branch's** — restores the tokenization the skipped commit carried. |
| `js/main/commerce-ui.js` | took **main's** renamed "Product details" link, then applied SQ-17's root-absolute fix to *their* line. Taking this branch's side would have added a second link instead of fixing theirs. |

**The cache token was the real hazard, and it was worse than forecast.** `origin/main` now
spends `20260909b` as a new `MAIN_VERSION` constant. Everything is therefore unified on
**`20260910a`**, which has never been deployed.

Unified, not bumped per module, deliberately: `auth.js` alone is imported under three
different release constants, and changing it rewrites an import URL inside `main.js`,
which changes `main.js`, which changes every page loading it. Two attempts at tracing that
cascade gave wrong answers. Unification costs one redundant download per unchanged module
and yields a state verifiable in one grep — the better trade when the failure mode is a
stale module in a user's browser.

**One migration exemption was added.** Main's touch-target pass set `11px` padding;
re-running the spacing migration would snap it to `--s3`'s `12px` and undo the tuning. It
is exempted with the reason recorded in `css/style.css`. If you re-run
`tools/spacing-scale-migrate.mjs`, it will report 1 mapping — that is the exemption, leave
it.

**SQ-12 was solved twice and the merge was verified in a browser,** not from source:
signed out against the live catalog, `/products` renders a visible "Add to cart" label,
15 size selects, 15 add buttons, one anchor per card, zero relative product hrefs, no page
errors.

## What was done

Phase 1 (foundations) and Phase 2 (revenue) are complete. SQ-21 (first paint) is done.

### Phase 1 — design foundations

| finding | result |
|---|---|
| SQ-01 type scale | distinct rendered font sizes on `/products` 30 → 12; text under 13px 60% → 0% |
| SQ-02 spacing scale | distinct px spacing values 63 → 5 (all preserved sub-4px hairlines) |
| SQ-03 breakpoints | 32 → 9 canonical widths; fixed a real overlap where `max-width:760` and `min-width:760` both applied at exactly 760px |
| SQ-04 surfaces | `.doc-file` border reset (the 4th surface level); radius 17 → 5 values |
| SQ-05 colour | 284 colour fallbacks stripped, 36 pseudo-tokens routed, 89 `#fff` split by job, `!important` 79 → 9 |

### Phase 2 — revenue surfaces

| finding | result |
|---|---|
| SQ-11 PDP | `/gal` chip suppressed when it restates the headline price; trust chips unified; marine cross-sell demoted. **The spec's "no image above the fold" was stale** — packshots measure 243–763px with add-to-cart at 455–630px |
| SQ-12 buy controls | persistent visible label (was hover-only, invisible on touch); size select added; staff "preview as buyer" toggle |
| SQ-13 card | 916px → **488px**; anchors 3 → 1; sub-32px targets 16 → 0 |
| SQ-14 sort | "Recommended" → "Featured" (no ranking data existed to back the former) |
| SQ-15 hero | grid top 1340 → 1062px |
| SQ-17 URLs | `/product.html?sku=` 301 redirect added; 5 relative href sites made root-absolute |
| SQ-21 first paint | Phosphor preload; `apply()` no longer rebuilds the grid; `me()` single-flight; two unversioned imports fixed |

### Five defects that were live in production and are not in the spec

Found by checking rather than assuming. Each was verified broken before and working after,
in a browser:

1. `var(--ease)` referenced with no fallback and defined nowhere → the whole `transition`
   declaration was invalid, so the **nav dropdown snapped instead of fading**
2. `var(--paper)` bare inside `color-mix()` ×2 → chat order-context chip had **no
   background**, chat close button had **no hover state**
3. Two identical `@media (max-width: 720px)` blocks setting opposite nav colours at equal
   specificity — one pair was dead, decided only by source order
4. `.btn { display: inline-flex !important }` forced a **"Show 9 more products" button onto
   a desktop grid that already showed all 15**
5. `.doc-file` reset padding and background but not border, leaving an empty bordered box
   around every download row

---

## Open items

### Carried forward, with reasons

**Card height is 488px against SQ-13's ≤440 target.** Verified at 1440×900, 1440×1200 and
1280×900 — identical at all three. Breakdown: media 187 + body 130 + buybar 147. The slack
is a 49px `.shop-card-savings` chip ("Case of 4 saves $10.40"), which is a real conversion
lever, so cutting it is a business decision rather than cleanup. The likely cause of the
overshoot is sequencing: SQ-13 measured before SQ-12 added the size select and visible
label.

**Elevation drift: 40 distinct light-surface shadow literals.** A mechanical migration was
built, tried, and **rejected by its own visual diff at 2.5M changed pixels**. A border alpha
varies in one dimension and collapses onto a scale cleanly; a shadow varies in four —
offset, blur, spread, colour — and matching on blur alone discards the other three.
`0 24px 70px -54px` became `--shadow-lg`'s `-28px` spread; a subtle teal
`0 8px 30px rgba(14,124,134,.10)` became the heavy two-layer `--shadow-md`. Fixing this
needs a per-component design decision. Do not retry it mechanically.

**Translucent `rgba()` used for backgrounds and text** is untouched. That is a fifth job —
fills and scrims — and folding it into the border scale would repeat the mistake of
grouping by value instead of purpose.

### Deferred deliberately

**The `css/style.css` split** (SQ-05's third part). Measured: the file is 253KB raw but
**38KB brotli**, and the whole CSS layer is 63KB, so it is not what causes a slow first
paint. Splitting also does not relieve specificity compounding — four files loaded in the
original order produce a byte-identical cascade. It would buy navigability at the cost of
118 HTML files, 5 generators and 13 source-contract tests.

**CSS coverage, for whoever revisits that:** across 118 pages × 2 viewports, the mean page
uses 9.2% of `style.css` and the heaviest (`/products`) 17.2%. 39.7% is never rendered —
but that is **not** dead code: the static server runs no backend, so JS-injected commerce
and auth-gated admin markup never mount. Cross-referencing every never-rendered class
against all HTML, JS and JSON source (excluding vendor bundles — `stagger` matches inside
`gsap.min.js`) puts genuinely dead CSS at **41 families, 11.2KB, 4.4%**.

Two entries on that dead list are findings rather than cleanup:
- **`.breadcrumb` is unused while `BreadcrumbList` JSON-LD is emitted** on product, pricing,
  services and comparison pages. Structured data claims a hierarchy visitors never see.
- **`.nojs-logo` is unused** while `index.html` carries 8 `<noscript>` blocks.

---

## Not started

**Phase 3 — front door:** SQ-06 (five pinned scenes, 3,679px before the first product),
SQ-07 (reveal-on-jump invisibility), SQ-09 (redundant sections), SQ-10 (empty case-study
images).

**Phase 4 — operations:** SQ-18, SQ-19, SQ-20 (admin console density).

**Phase 5 — content:** SQ-22, SQ-23, SQ-24, SQ-25 (prose, AI-sounding copy).

**Owner-held:** SQ-08 (proof imagery) and SQ-16 (image framing) are being done by the owner
in another session. A review was delivered — see "Imagery review" below.

---

## Imagery review, delivered 2026-09-09

Five before/after pairs in `img/before-after/`, all wired in (3–4 references each).

**Technically sound:** all 1200×750, aspect 1.600, dimensions matched — which is what a
wipe slider needs.

**Three of five do not register.** Per-quadrant block matching gives offsets varying by
72–84px full-res on `brewery-tank`, `education-stairs` and `restaurant-concrete-floor`;
`marine-intake` and `property-pillar` are clean at 0–6px. This matters because the site's
comparison UI is a **wipe slider** (`.story-object__range`), so non-registering frames make
the scene jump. Side-by-side presentation would be fine.

- `restaurant-concrete-floor` is weakest: the yellow mop bucket appears in **both** frames
  at different positions and sizes, and the floor is only modestly cleaner.
- `property-pillar` may be too subtle to read as proof (median per-cell shift +0.5, with 8
  cells brighter and 6 darker).
- `education-stairs` is strong content. An earlier note calling it "exposure-like" from a
  +46.9 luminance shift was **wrong** — the bushes and stone brightened too, so it is a
  different-day reshoot, not a brightness edit.

Weight: 2.1MB added; `marine-intake` alone is 375KB + 339KB.

---

## Conventions and traps

**Testing**
- `npm test`, never bare `node --test`. Takes ~8–12 min.
- **Never run `npm test` and Playwright concurrently** — they collide on ports and produce
  false failures.
- Do not stack polling waiters on background runs; one blocking wait per run. Accumulated
  idle waiters caused memory pressure in this session.

**Building**
- **Never run `npm run build` without `npm run build:content` first** — it silently deletes
  CMS-sourced copy from ~31 files.

**Verification loop that works**
1. `git stash push -- css/`, `node tools/visual-css-guard.mjs baseline`, `git stash pop`,
   `capture`, `diff`. Isolates your change. Self-serves on :4179.
2. Use `reducedMotion: 'reduce'` or `.reveal` sections screenshot blank.
3. **Measure delta magnitude, not changed-pixel count.** 663k changed pixels sounds alarming
   and was 0.3% of area at a median delta of 5/255 — imperceptible. Counting pixels alone
   would have sent someone chasing a non-problem.
4. For commerce UI, **proxy `/api/*` to `https://masest.co`** and answer `/api/account/me`
   locally as `{account:null}`. A stub catalog has invented fake defects here before.

**Known detector false positives** — do not chase these:
- visually-hidden `<thead>` (`clip: rect(0 0 0 0)` in a 1px box) legitimately holds wider
  content
- horizontal scroll-snap carousels legitimately have children past the viewport
- `.story-object__identity b` is a deliberate 2-line clamp
- `foot-news-gotcha` is a 4×4px spam honeypot, not a tap-target failure
- `td`/`shell` `border-bottom`/`border-top` are row rules, not nested surfaces

**Design tokens — use them, do not bypass them**
- type `--fs-*`, spacing `--s1..--s12`, radius `--r-xs/--r-input/--r-card/--r-lg/--r-pill`
- colour incl. `--on-accent` (white **on** a solid accent/ink surface, as distinct from
  `--surface`, a surface's own colour)
- lines `--line-ink-soft/--line-ink/--line-accent/-hover/-active/--line-on-dark/-strong`
- rings `--ring/--ring-soft/--ring-tight`, plus `--highlight-top`
- **There are currently zero raw colour fallbacks and zero undefined custom properties in
  `css/*.css`. Do not reintroduce either.** `!important` is at 9, all reduced-motion.
- Breakpoints are canonical: 360, 480, 560, 640, 720, 820, 960, 1180, 1400 —
  `min-width` sits at canon+1.

**The lesson that recurred three times**
A literal that encodes a deliberate decision must not be snapped to a scale. It cost the
elevation ramp, the four-breakpoint collapse, and the neutral media outlines
(`interface-feel-polish` pins pure black and pure white at 10% on photographic media
*because* they must stay neutral; routing them through the teal-tinted `--line-ink` tints
every image edge). When a test disagrees with a migration, check whether the test is
encoding intent before touching it.

**Source-contract tests**
31 test files assert on CSS source text. When you move a declaration, move its assertion
with it and preserve the original intent — do not weaken a test to make it pass.

---

## Suggested next steps, in order

1. **Phase 3 — front door.** SQ-06 (five pinned scenes, 3,679px before the first
   product), SQ-07 (reveal-on-jump invisibility), SQ-09 (redundant sections), SQ-10 (empty
   case-study images). This is the next unstarted phase and the branch is clean for it.
2. **Decide the card-height question** — trim the 49px savings chip to reach SQ-13's ≤440,
   or revise the target with the reason recorded. It is 488px today.
3. **Consider pushing before starting.** 21 commits of verified work sit unpushed, and
   `origin/main` moved three commits during the last session. The longer it waits, the
   more the next rebase costs. Push requires `git fetch && git rebase origin/main` first —
   Codex races this branch — and a fresh cache token if `20260910a` has shipped by then.
