# Handoff — site quality remediation, 2026-09-09

Companion to `docs/site-quality-remediation-2026-09-07.md`, which is the spec and holds
all 25 findings with their evidence. Read that first; this file is only what a fresh
session needs in order to take over.

> **Phases 1–4 are complete. What is left is five decisions and Phase 5.**
> Both are written up in **`docs/decisions-pending-2026-09-10.md`** — start there. It
> carries the blocked items with the contracts that block them, and Phase 5 re-measured
> against the current tree.

---

## Where the work is

| | |
|---|---|
| Worktree | `/Users/omar/Claude/Projects/MASEST-design-system` |
| Branch | `design-system-phase1` |
| Position | **29 commits ahead of `origin/main`, 0 behind** — rebased onto `a2cd169a` on 2026-09-10 |
| Tree | clean |
| Tests | `2966/2966` pass on HEAD |
| Cache token | `20260910a`, unified across every versioned asset. Never deployed. |
| Recovery points | `backup/design-system-pre-phase4` (pre-2026-09-10 rebase), `backup/design-system-pre-rebase` (older) |
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

## Phase 3 — front door, done 2026-09-09

Two of the four findings did not survive measurement. Both were checked against
production, not just the source tree, because both failure modes are ones a local server
manufactures on its own.

| finding | result |
|---|---|
| SQ-06 story cost | **partly delivered, core ask blocked.** First product moved 8,428 → 7,210px (−1,218px, −14.5%). The prescribed fix is not implementable — see below |
| SQ-07 reveal-on-jump | **stale.** Does not reproduce in 11 scenarios |
| SQ-09 redundant sections | **done.** Two sections merged into one; −673px |
| SQ-10 empty case images | **stale.** Symptom is manufactured by the QA harness |

### SQ-09 — what shipped

"Different messes need different cleaners" (806px) and "Start with the cleaner you want
to replace" (706px) were two taxonomies of one decision — one sorted by soil, one by the
incumbent chemical — and the catalog subhead below restated the second. They are now a
single "Find the cleaner that replaces yours" block: 1,512px → 839px.

**The spec's prescribed merge was wrong and would have failed an existing test.** It says
to keep "the two replacement cards plus the product grid", but the two cards cover only
descale and degrease. The water-systems route (WaterSafe60/Purgo → `/programs`) and the
280× corrosion claim existed *only* in the section it discards — and
`homepage-marketing-proof.test.mjs` asserts that claim sits next to its evidence link. The
merged block carries three cards, so every route and the proof survive.

`.grid-2` and `.cat-card` became dead with the second section and were removed; their link
affordance was carried onto `.why-col .link`, which had been unstyled. `.why-col.reveal`
is kept because `site-audit-regressions.spec.mjs` pins it on mobile. A new test pins the
merge so the pair cannot grow back.

### SQ-06 — the core ask is blocked by two source contracts

Measured: the story is **4,030px / 4.5 screens, six scenes at `84vh`** — not the spec's
"five pinned scenes, 3,679px".

The spec asks to cut to three scenes and cap the story at ~2 screens. Both halves are
forbidden by tests that encode deliberate decisions:

- `tests/story-contract.test.mjs:126-129` pins each act to **80–88vh and the total to
  480–520vh**. The floor is 4.8 screens — the spec's target is ~2.2× below what the
  contract permits. Current 504vh sits mid-band; the whole in-contract headroom is 24vh
  (216px), 2.5% of the distance to the first product, and spending it means retuning an
  animation covered by a frame-budget test. Not worth it.
- Six scenes are pinned twice — `story-contract.test.mjs` (six named scenes, plus
  `doesNotMatch(/data-act="7"/)`) and `story-six-comparisons.test.mjs` (six R2-backed
  pairs, six rail buttons) — over owner-approved before/after imagery.

The 80–88vh bound was reaffirmed on **2026-09-03**, four days before the spec was written,
so it is current intent and not a stale leftover. **Scene count and story length are an
owner ruling**, the same class of call as the card-height chip.

Three of SQ-06's four sub-claims are also stale:
- *"the media card clips the product name in every scene"* — it does not. Identity bottom
  751px, product bottom 755px, card bottom 773px. Verified across all six scenes.
- *"the sticky sub-bar carries four competing actions in a 40px strip"* — it carries two
  links plus a context label in a 52px strip. `.story-skip` is not sticky; it sits at page
  top and scrolls away. The 01–06 rail is a separate left gutter.
- *"the left column runs out of content around 60% height"* — it fills 76–94%. The
  emptiness that reads in a screenshot is the crossfade: consecutive scenes are vertically
  offset, so during a transition two scenes' copy sits on screen with a gap between them.

What was delivered instead, since it serves the same goal and no contract binds it: the
buyable grid now leads its section, ahead of the product-line photo. Nothing was removed.

### SQ-07 — does not reproduce

Tested with motion **enabled** (reduced motion short-circuits reveal entirely and would
hide the bug), on production and on this branch: nine in-page anchors, back-button scroll
restoration from 8,600px, and reload at 9,200px. **Zero ghosted elements in the viewport in
any of them.** Elements below the fold sit at opacity 0, which is reveal-on-scroll working.

The architecture the spec asks for is already there: `initReveal()` guards the hidden state
behind `body.reveal-ready`, which JS adds. With `js/main.js` blocked, 23 reveal elements
render at full opacity — visible *is* the resting state, and anything never observed is
already correct.

The one measurable residue is far smaller than described. The spec reports
`scrollTo(0, 8000)` landing at 2420 — swallowed by 5,580px. Measured drift after a settle
delay is **−12 to −44px** across targets of 2,000–10,000, and 0px at 2,000 and 4,000. A
single cold-load sample did read 7,376; that is lazy-image layout settling, not the pin
eating the scroll. `scroll-behavior: smooth` is confirmed inline on `<html>`.

### SQ-10 — the symptom is manufactured by the harness

`tools/test-media-isolation.mjs` replaces every managed R2 and Supabase image with a **1×1
transparent PNG** in test and QA browsers unless `MASEST_LIVE_MEDIA=1` (and not CI). Every
managed image therefore renders as an empty bordered box — exactly the reported symptom,
on every card, by design.

On production, with each image scrolled into view, **all 13 homepage images render**,
including both cards the spec names. Judging them at `networkidle` without scrolling also
reports 6 of 13 broken, because `loading="lazy"` images below the fold never fetch —
another way to manufacture this finding. Neither is a site defect.

**Do not conclude an image is broken from a source-tree server.** `cf-build` puts
`/^img\//` in `DENY` and rewrites every reference to `media.masest.co/site`, so the raw
source tree 404s 179 image paths that are all fine in production. Apply the same rewrite in
any local QA browser and it matches what ships — one Playwright route is enough:

```js
await context.route("**/img/**", async (route) => {
  const { pathname, search } = new URL(route.request().url());
  const live = await fetch(`https://media.masest.co/site${pathname}${search}`);
  await route.fulfill({ status: live.status, contentType: live.headers.get("content-type"),
                        body: Buffer.from(await live.arrayBuffer()) });
});
```

---

## Phase 4 — operations, done 2026-09-10

Rebased onto `origin/main` first this time, because Phase 4 edits the same admin files
Codex had just touched. See the rebase note below — it cost a full redo.

| finding | result |
|---|---|
| SQ-18 Save density | **done.** Visible Save buttons armed at rest: 15 → 0 |
| SQ-18 blank thumbnails | **stale.** All 15 render |
| SQ-18 row density | **done.** 222px → 102px rows; panel 4,009px → 2,175px |
| SQ-19 duplicate status | **done.** Second pill suppressed only where it restates the lifecycle |
| SQ-19 money format | **done**, console-wide. New display-only `moneyDisplay()`; `money()` untouched |
| SQ-20 sidebar clipping | **stale.** Already `position: sticky` + `overflow-y: auto` |
| SQ-20 KPI alignment | **done.** Value right edges 443/463/750/728 → one x per column |
| SQ-20 dead column | **stale — and my earlier correction of it was also wrong.** There is no dead column |

### What shipped

**SQ-18 — Save no longer shouts on every row.** Each product and variant Save renders
`disabled` and arms only when its own scope is edited. Measured: 15 of 15 armed at rest
→ 0; editing one product's name arms only that product; toggling `Active` on another arms
only that one; a variant edit arms that variant and not its parent.

That last part is why this could not ride on `data-dirty`: `markDirty()` in `js/admin.js`
deliberately excludes checkboxes — and `Active` is a checkbox — while `captureDirty()`
stores `.value`, which is meaningless for one. Edit state is therefore tracked separately
as `data-edited`, and `data-dirty` keeps its restore-after-rebuild job untouched. Nothing
clears the flag explicitly after a save: the list rebuilds every Save disabled, and
`restoreDirty()` re-arms only rows whose values still differ from the server's, so a saved
row settles and a failed save stays saveable.

**SQ-19 — one fact, one pill.** The card showed Lifecycle and Status side by side. They are
*not* generally the same fact: `lifecycleFor()` derives its stage from status **and**
`tracking_status`, so a `processing` order is legitimately "Unfulfilled" and both belong on
screen. The stage collapses onto the status only in the terminal states. The second pill is
now suppressed exactly there, by comparing the **rendered labels** rather than the keys —
`payment_pending` and `pending_payment` are different keys that both read "payment pending".
Verified by driving the real module across seven states: `cancelled`, `refunded`, `cart`,
`fulfilled`, `payment_pending` suppress; `processing` and `paid` keep both.

### Stale, with measurements

**SQ-18's "thumbnails are blank for every product" — all 15 render.** This is the third
instance of the trap in SQ-10's note, and it caught me too: my own harness re-prefixed
`/site` onto image URLs that were *already* absolute R2 URLs, producing `/site/site/…` and
404ing every one. The DB stores absolute `media.masest.co` URLs — check `hostname` before
rewriting. The finding also cannot have come from the repo's own stub, which ships exactly
one product with `image_url: ""`, so it can neither show fifteen rows nor say anything
about thumbnails.

**SQ-20's sidebar already scrolls.** `.adm-sidebar` computes `position: sticky`,
`top: 75px`, `overflow-y: auto`, `max-height: 801px` — essentially the prescribed fix.
Content is 894px against an 799px box, so lower items are reached by scrolling the sidebar,
which is the intended behaviour rather than the reported clipping.

### Finished 2026-09-10, second pass

**SQ-18 row density — 222px → 102px, panel 4,009px → 2,175px.** The media controls
("Choose primary" / "Add gallery image" / the gallery grid) moved into the existing
"Edit product details" disclosure; that vertical stack was most of the row height, not the
thumbnail. The row is now a fixed-track grid — `54px` thumb / name (`1fr`, truncates) /
`136px` price / actions.

**The first attempt at this was wrong in an instructive way.** It left-packed the row with
nothing flex-growing, which did close the ~600px void — but gave every row a different
action x: Save's left edge spread 116px across 15 rows, Active 117px, price 116px, plus
407px of trailing dead space. That is precisely the defect SQ-13/SQ-18 exist to fix. It
measured well (row height, void closed) and looked wrong; only the screenshot caught it.
Fixed tracks get both: all three spreads are now 0 and trailing space is 0. The price track
must be **fixed, not `auto`** — its text varies per row ("Pricing workspace" vs a number),
and an auto track re-introduces the raggedness.

**SQ-20 KPI alignment — one right edge per column.** The cause was not the labels: it was
`.dash-row` being `flex` + `justify-content: space-between`, where route rows carry a third
child (the trailing arrow), so leftover width split into two gaps *around* the value rather
than pinning it right, and the leftover shifted with each label's wrap. Now a grid with a
fixed value column plus a reserved icon column, so route and non-route rows share an edge.
Setup-gaps and traffic rows needed a narrower value column of their own — the shared width
pushed that card past the 120px height `tests/admin-panel-spacing.test.mjs` pins.

**There is no dead column, and the correction I published earlier was also wrong.** This
handoff previously said "the dead column is the 4th, not the 3rd". Both readings came from
`#admStats`, which is `class="adm-grid"`, **hidden**, and empty — a decoy that a
`[class*='grid']` selector finds first. The real KPI grid is `.adm-report-grid`: 3 columns
holding 6 cards (5 groups + the always-rendered "Setup gaps" card), so both rows fill
completely, and `.adm-wrap`'s `max-width: 1400px` caps it at every viewport. Left alone.

**SQ-19 money format — finished console-wide.** `money()` is untouched and still the
export/ISO form. A display-only `moneyDisplay()` renders `$1,840.00` for USD and delegates
to `money()` for any other currency, so nothing is mislabeled. Every client-rendered money
value in the admin console now uses it: orders (cards, detail dialog, ledger, refund
prompts, carrier rates), products, companies, and the overview KPIs — 31 call sites.

Converting only the order cards, which is what the finding literally scopes, would have
left one console showing `$250.00` on a card and `USD 250.00` in that same order's detail
dialog. A mixed convention inside one workflow is the same defect SQ-19 itself is about.

The currency contract test (`web-interface-guidelines-remediation.test.mjs`) tracks the
rename rather than being weakened: it still forbids hand-rolled `${x.toFixed(2)}`, still
requires a shared formatter, and now also pins that `moneyDisplay` delegates to `money()`
rather than reimplementing the ISO form.

---

## The second rebase — and the mistake that cost it

Rebasing 24 commits onto `origin/main` conflicted in **31 files**, all of them the same
`?v=` cache token (main moved `js/admin.js` to `20260909b`; this branch is unified on
`20260910a`).

**The mistake: `git status --short | head -20` showed only `admin.html` as conflicted,
because the `js/admin/*` entries sorted below the cut.** Resolving that one file and then
running `git add -A` staged 31 files that still contained `<<<<<<<` markers, and the rebase
committed them. The suite caught it — 32 admin failures, all
`SyntaxError: Unexpected token '<<'` — but the branch had to be reset to
`backup/design-system-pre-phase4` and the rebase redone.

**Use `git diff --name-only --diff-filter=U` — never a truncated `git status`.** And clear
`.git/rr-cache` after a bad resolution, or rerere replays it.

Redone properly, 45 of the 47 conflict hunks were token-only. The two that were not:
- `js/admin/crm-prospects.js` — main *added* `confirmDialog` to an import. Resolved to
  main's side plus the token, so Codex's outreach work survives.
- `tests/auth-cache-release.test.mjs` — resolved to this branch's side, which unifies
  `RELEASE` and `CHAT_RELEASE` onto the branch token as well.

`js/main/marine-catalog.js` auto-merged to main's `20260909b` without conflicting; it and
its test were moved to `20260910a` by hand to keep the one-grep invariant. **680 asset
references, all on `20260910a`.**

---

## Not started

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
2. Use `reducedMotion: 'reduce'` or `.reveal` sections screenshot blank. **But never judge
   reveal behaviour under it** — `initReveal()` returns early on reduced motion and marks
   everything visible, so any reveal bug is invisible in exactly that mode.
3. **Measure delta magnitude, not changed-pixel count.** 663k changed pixels sounds alarming
   and was 0.3% of area at a median delta of 5/255 — imperceptible. Counting pixels alone
   would have sent someone chasing a non-problem.
4. For commerce UI, **proxy `/api/*` to `https://masest.co`** and answer `/api/account/me`
   locally as `{account:null}`. A stub catalog has invented fake defects here before.
5. **Images need the same treatment, and two separate things fake a broken one.**
   (a) `cf-build` never publishes `img/` — it rewrites every reference to
   `media.masest.co/site`, so a source-tree server 404s 179 paths that ship fine.
   (b) `tools/test-media-isolation.mjs` swaps every managed image for a 1×1 transparent
   PNG unless `MASEST_LIVE_MEDIA=1`. Either one renders an empty bordered box. Route
   `**/img/**` to `media.masest.co/site` in the QA browser (snippet under SQ-10 below) so
   local matches production. **And scroll lazy images into view before judging them** — at `networkidle`
   alone, 6 of 13 homepage images report `naturalWidth === 0` and every one of them is
   fine.

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

1. **Get two owner rulings.** Both are business calls, not engineering ones, and both now
   block finished work:
   - **Story length and scene count (SQ-06).** Three scenes at ~2 screens needs
     `story-contract.test.mjs` and `story-six-comparisons.test.mjs` rewritten and
     owner-approved before/after imagery deleted. If the answer is "leave the story
     alone", revise SQ-06's target and record why.
   - **Card height (SQ-13).** Trim the 49px savings chip to reach ≤440, or revise the
     target. It is 488px today.
2. **Push — this is now the most valuable thing on the list.** 26 commits of verified work
   sit unpushed, `origin/main` moved twice more during the last session, and the 2026-09-10
   rebase already cost a full redo. Every day of delay makes the next one worse. Push
   requires `git fetch && git rebase origin/main` first — Codex races this branch — and a
   fresh cache token if `20260910a` has shipped by then. Expect the conflicts to be almost
   entirely `?v=` tokens; resolve every one to the branch's unified token, and read the
   rebase note above before starting.
3. **Phase 5 — content.** SQ-22 … SQ-25. The only phase still untouched. Given the record
   so far — 7 of the findings checked in phases 3 and 4 turned out stale or misattributed —
   measure each claim before implementing it.
