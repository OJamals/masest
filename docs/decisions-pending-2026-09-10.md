# Decisions pending, and Phase 5 — 2026-09-10

Companion to `handoff-design-system-2026-09-09.md` (branch state, phases 1–4) and
`site-quality-remediation-2026-09-07.md` (the spec, all 25 findings).

This file is the short list of things engineering cannot decide. Phases 1–4 are done; five
items are blocked on a ruling, and Phase 5 has not started. Every number here was measured
on the current tree on 2026-09-10, not carried over from the spec.

---

## Part 1 — Five decisions

### D1 · Story length and scene count (SQ-06) — the expensive one

> **RULED 2026-09-10 — Option A. Keep the six scenes; revise SQ-06's target; retire
> "distance to first product" as a homepage KPI.**
>
> *Reasoning.* The six-scene / 80–88vh contract was reaffirmed `23260bc8` on 2026-09-03,
> four days after the spec's review date, so it is current intent. Cutting to three costs
> more than the brief stated: 14 files reference the scene names, including **six** test
> files (`story-contract`, `story-six-comparisons`, `ui-structure`,
> `premium-product-story`, `image-delivery`, `blog-build`), `data/story-scenes.json`, and
> **two blog posts that reuse the scene imagery**
> (`commercial-kitchen-degreasing-guide`, `food-plant-cleaning-cip-sanitation-release`).
> 2.77MB across 36 files in `img/proof/story/`.
>
> *The KPI is retired because it is non-binding, not because the story is short.* The
> story **is** the hero — nothing precedes it but the nav — and the nav's first link is
> **Products**, which is also where the catalogue actually comes from (no `shop-card` in
> the shipped HTML; commerce hydrates via JS). A buyer who wants to buy clicks one link.
> Scroll depth to the catalogue therefore does not gate purchase, and the story should be
> judged on persuasion quality, not length. Next reviewer: do not re-raise SQ-06 on pixel
> grounds.
>
> *Two figures in this document do not reconcile and were NOT relied on.* Distance-to-
> product is given as **7,210px** while post-story content is given as **4,398px**;
> 4,030 + 4,398 = 8,428, the superseded total. Under 7,210 the story is 56% of the
> distance, not the minority contributor the original recommendation implied. The
> "24vh headroom = 2.5%" figure is likewise computed against 8,428. Re-measure both before
> either is cited again.
>
> *Not taken:* the free in-contract trim (504vh → 480vh floor, ~216px, no test change)
> remains available and unspent.


**What is true.** The homepage story is **4,030px / 4.5 screens**, six scenes at `84vh`
each. The spec asks for three scenes capped at ~2 screens.

**Why engineering stopped.** Both halves are blocked by tests that encode deliberate
choices, not by difficulty:

| what blocks it | where |
|---|---|
| each act pinned to **80–88vh**, total to **480–520vh** — a floor of 4.8 screens | `tests/story-contract.test.mjs:126-129` |
| **six** named scenes, plus `doesNotMatch(/data-act="7"/)` | `tests/story-contract.test.mjs` |
| six R2-backed before/after pairs, six rail buttons | `tests/story-six-comparisons.test.mjs` |

The 80–88vh bound was reaffirmed on **2026-09-03 — four days after the spec's own review
date and before it was written up**, so it is current intent rather than a stale leftover.
The whole in-contract headroom is 24vh (216px, 2.5% of the distance to the first product),
and spending it means retuning an animation covered by a frame-budget test.

**What each answer costs.**

- *Cut to three scenes:* delete three owner-approved before/after photo pairs and their
  R2 assets, rewrite two source-contract tests, and drop three rail chapters. Recovers
  roughly 2 screens. The scrollybook is the site's centrepiece and has a mirror ledger,
  marketing-email exports derived from the scenes, and a performance budget.
- *Keep six scenes:* the front door keeps 4.5 screens of story ahead of the catalogue.
  SQ-06's target should then be revised in the spec with the reason recorded, so the next
  reviewer does not re-raise it.

**Recommendation: keep the six scenes and revise the target.** The commercially meaningful
number was never the story's length but the distance to something buyable, and that has
already moved **8,428px → 7,210px (−14.5%)** without touching the story. If more is wanted,
the cheaper lever is the 4,398px of post-story content, not the contract-bound 4,030px.

**Also worth knowing — three of SQ-06's four sub-claims are stale.** No product-name
clipping (identity bottom 751 / product 755 against a card bottom of 773). The sticky bar
carries two links plus a context label in a 52px strip, not "four competing actions in
40px". The left column fills 76–94%, not 60% — the emptiness in a screenshot is the
crossfade showing two vertically-offset scenes at once.

---

### D2 · Card height (SQ-13) — the cheap one

> **RULED 2026-09-10 — Option (b). Keep the `.shop-card-savings` chip. Revise the SQ-13
> target from ≤440 to ~490 and record the reason.**
>
> *Option (a) never reached its own target.* Computed from the tokens the chip uses —
> `--s2: 8px`, `--fs-caption: 0.8125rem` (13px), `line-height: 1.2`, 1px border — the chip's
> full vertical cost is **41.6px** (16 padding + 2 border + 15.6 line + 8 margin-top), not
> the 49px this document assumed. **488 − 41.6 = 446.4, missing ≤440 by 6.4px.** Even at
> the assumed 49px it cleared by a single pixel. Deleting a revenue element to land 6px
> short is not a trade worth making.
>
> *The target is not test-encoded; the chip is.* No card-height assertion exists anywhere
> in `tests/*.test.mjs`, so revising ≤440 costs a doc edit. The chip is pinned three times
> in `tests/product-case-savings.test.mjs` (:141, :157, :161) under a test whose title
> states the intent: *"case savings use linked account-effective prices, never a hard-coded
> claim."* It is deliberate, and the figure is wired to real pricing.
>
> *And the target predates the card.* SQ-13 measured before SQ-12 added the size select and
> the persistent add-to-cart label. The card grew because it gained controls the review had
> never seen.
>
> *If height is ever revisited:* the 49px lives in the 187px media block and the 147px
> buybar, neither of which is test-pinned. That is option (c) and a real task, not a chip
> deletion.


**What is true.** Product cards are **488px against a ≤440 target**, identical at
1440×900, 1440×1200 and 1280×900. Breakdown: media 187 + body 130 + buybar 147.

The 49px of slack is one element: the `.shop-card-savings` chip, *"Case of 4 saves
$10.40"*. That is a conversion lever, so removing it is a revenue call.

**The target may simply be out of date.** SQ-13 measured the card *before* SQ-12 added the
size select and the persistent add-to-cart label. The card grew because it gained controls
the review had not seen.

**Options:** (a) drop the savings chip and hit ≤440; (b) keep the chip and revise the
target to ~490 with the reason recorded; (c) keep the chip and find 49px elsewhere in the
187px media / 147px buybar.

**Recommendation: (b).** A per-card savings figure at the point of choice is worth more
than 49px of height, and the target predates the card's current controls.

---

### D3 · Proof imagery (SQ-08) — owner-held, and there is new evidence

> **RULED 2026-09-10 — owner states the after-frames are RETOUCHED ORIGINALS, i.e. real
> photographs of the real result, retouched and cropped for presentation. Not synthetic.
> No relabelling. `b842b5ee` stays. "Photo proof" stays.**
>
> *This document's premise was already stale when written, and the direction of the error
> is the opposite of what it implied.* The disclosure it describes — `<span
> class="story-object__method">After frame digitally reconstructed from source photo.</span>`
> — was deleted by `e933983b` (2026-09-09 18:12) together with a new assertion in
> `story-contract.test.mjs:37-38` forbidding its return. `e933983b` is on `origin/main`
> and live. It did **not** touch `img/proof/story/` (those files last changed `23260bc8`,
> 2026-09-03), which read as a disclosure removed while the imagery stayed.
>
> *Pixel evidence says otherwise, and supports the owner.* In all six scenes the BEFORE
> and AFTER originals have **different dimensions** — separate photographs, independently
> cropped; `cip-vessel` (1200×1600 vs 1600×1200) and `pool-cartridge` (686×1229 vs
> 1220×648) are even shot in opposite orientations. Per-pair change is spread across
> 25–30 of 64 tiles with quiet-tile deltas of 1.7–23.0 — global, not painted-in locally.
> That is the signature of two real photographs graded to match, not of a synthesised
> after-frame. **The removed wording "digitally reconstructed from source photo" overstated
> what was done; removing it was a correction, not a cover-up.**
>
> *Also checked and clear:* the enhancement filter
> `saturate(1.03) contrast(1.07) brightness(1.02)` applies to `.photo img, .proof-card
> figure img` only. The story uses `.story-object__*` and receives **none** of it. The
> filter does reach `/proof` case-study photos.
>
> *Method note.* A first pass compared each original after-frame to its aligned version by
> resizing to 1200×1017 and reported 25–69 mean delta. That measured aspect-ratio
> distortion, not editing — the six originals span six aspect ratios. Discarded. The
> dimension comparison above is the confound-free test.
>
> **Still open, engineering only, no ruling needed:** the three non-registering pairs in
> the *industry* `.ba` wipes (`brewery-tank`, `education-stairs`,
> `restaurant-concrete-floor`; 72–84px offsets) are a different component from the story
> and are already declared `data-evidence-kind="generated"`. Non-registering frames jump
> under a wipe handle; they belong side-by-side. Same applies to `cip-vessel` and
> `pool-cartridge`, whose sources are 90° apart.


**What is true.** Each before/after card is labelled **"Photo proof"** and carries, in 9px
grey type at the bottom edge, **"After frame digitally reconstructed from source photo."**
A photographic-proof claim and a digital-reconstruction disclosure inside one component is
a contradiction a competitor or a procurement officer could raise — on the homepage's
load-bearing trust element.

**New measurement, delivered 2026-09-09.** Of the five before/after pairs, **three do not
register**: per-quadrant block matching gives offsets of 72–84px at full resolution on
`brewery-tank`, `education-stairs` and `restaurant-concrete-floor`. `marine-intake` and
`property-pillar` are clean at 0–6px.

This matters because the comparison UI is a **wipe slider** (`.story-object__range`), so
non-registering frames make the scene jump under the handle. The same images presented
side-by-side would be fine.

- `restaurant-concrete-floor` is weakest: the same yellow mop bucket appears in **both**
  frames at different positions and sizes, and the floor is only modestly cleaner.
- `property-pillar` may be too subtle to read as proof (median per-cell shift +0.5).
- `education-stairs` is strong content. An earlier note calling it "exposure-like" was
  **wrong** — the bushes and stone brightened too, so it is a different-day reshoot.

Weight: 2.1MB added; `marine-intake` alone is 375KB + 339KB.

**Options:** (a) replace reconstructed frames with unretouched originals and keep the
"photo proof" claim; (b) keep the reconstructions, relabel the component "Illustrated
result", and move the disclosure to legible size beside the label. Either way the `/proof`
case-study photos need the same audit.

**Engineering note:** whichever way this goes, the three non-registering pairs should
either be re-shot on a tripod or moved out of the wipe slider into a side-by-side
presentation. That part is independent of the labelling decision.

---

### D4 · Image framing (SQ-16) — owner-held

> **RULED 2026-09-10 — do (i) only: re-export `alumibrite-studio` with a 3–5% bottom
> margin to match its four siblings. The shelf photo stays as it is; no re-shoot, no
> re-export.**
>
> *Sub-claim 1 is misattributed.* SQ-16 blames "homepage product cards". **The homepage
> renders no product cards** — production HTML has `shop-card` × 0, `shop-grid` × 0,
> `data-commerce` × 0. The images it describes are the six *story* product shots, and
> measured against the live R2 assets they are consistent, not inconsistent:
>
> | image | px | subject h% | subject w% | bottom gap% | baseline% |
> |---|---|---|---|---|---|
> | `crhd-food-beverage-studio` | 900×1200 | 91.0 | 78.0 | 4.6 | 95.3 |
> | `cip-cr-studio` | 900×1200 | 93.2 | 79.8 | 3.1 | 96.8 |
> | `cip-hcr-studio` | 900×1200 | 92.8 | 79.7 | 3.3 | 96.6 |
> | `descaler-studio` | 900×1200 | 90.4 | 78.0 | 4.7 | 95.2 |
> | **`alumibrite-studio`** | 900×1200 | **97.8** | 80.3 | **0.0** | **99.9** |
>
> Subject-height spread is **7.3 points**, width spread **2.3 points**, dimensions
> identical. A framing rule already exists and is already applied. There is no "small
> centred bottle" — the smallest subject fills 90.4% of frame. The single real defect is
> `alumibrite-studio`'s **0.0% bottom gap**, where its four siblings sit on 3.1–4.7%.
>
> *Sub-claim 2 — the shelf photo — is real but not as described, and is being left alone
> by decision.* `product-line-2026-enhanced.webp` carries the bottling-provenance caption
> SQ-16 names ("VertKleen CR and HCR, bottled and labeled at MASEST on Florida's Space
> Coast."), but it is **1200×900**, not "1,300px wide", and has already had an enhancement
> pass. The substantive version of the complaint is device-pixel ratio — 1200 intrinsic in
> a full-width slot renders at roughly half resolution on a 2× display, which is what makes
> small label text mush. Recorded, not actioned.


Product imagery inconsistently framed. Being handled by the owner in another session; no
engineering input is blocked on it and no measurement was taken this session.

---

### D5 · Elevation ramp — a designer's call, not a business one

> **RE-RULED 2026-09-10 — A′ then B. A′ (tokenise the single-layer language that is
> actually there) is DONE; B (per-component promotion to the layered material) is a design
> pass and will be brought to the owner as a proposed mapping, not decided unilaterally.**
>
> **The first ruling's premise was wrong and is superseded.** It assumed the ramp merely
> lacked rungs. Measured with a strict four-dimensional matcher (y ±2, blur ±4, spread ±4,
> alpha ±.03): **0 of 46 light-surface literals fit any existing token — 38 fail on layer
> count alone.** Adding rungs would have absorbed nothing.
>
> *Root cause: two shadow languages, one tokenised.* `--shadow-xs/sm/md/lg` are **4/4
> two-layer**, 3/4 negative spread. The literals are **83% single-layer**, zero or small
> positive spread. A single-layer zero-spread cast cannot be spelled as a two-layer
> negative-spread token without changing how it looks — which is why the blur-nearest snap
> in `tools/surface-token-migrate.mjs` produced garbage.
>
> *A′ as shipped:* three new tokens `--shadow-cast-sm/md/lg`, derived as the centres of
> measured groups, each used ≥3 times (the prior author's own rule). **14 declarations
> migrated** across `style.css` (10), `blog.css` (2), `components.css` (2). Worst
> substitution cost **6.0/255** at the darkest pixel of a shadow whose peak opacity is
> 6–8%; tint unification is free (0.0–0.9/255) and every per-substitution delta is recorded
> in the token comment so the four above 3/255 can be reverted individually.
>
> *Two exemptions annotated in place so no future pass absorbs them:* the teal brand glow
> `0 8px 30px rgba(14,124,134,.10)` on `.tier-card.featured` (hue, max channel 134 — this
> is the exact value the prior migration ruined), and the `.nav` hairline
> `0 1px 0 rgba(20,24,32,.02)` (blur 0, not a cast shadow). My own first grouping pass
> would have swallowed both; the hue and blur checks were added after catching it.
>
> *Guard:* `tests/surface-shadow-freeze.test.mjs` freezes the remaining **61 distinct raw
> literals** and fails on any new one, naming the file and value. Verified by injecting a
> probe literal — it failed correctly, and went green on restore. A second assertion fails
> if an allowlist entry goes stale, so the list cannot rot.
>
> *`css/components.css` carries no `?v=` cache token (4h TTL), so its 2 migrated
> declarations propagate on that delay rather than with the release.*
>
> *Measurement that changed the shape of the job.* The 40 light-surface literals are not
> 40 elevations. They are four families: **5 rings** (`0 0 0 Npx` — two are near-dupes of
> the existing `--ring-soft`, one is a **red error ring with no `--ring-danger` to land
> on**), **4 inset highlights/hairlines** (belong with `--highlight-top`), **3 neutral
> `rgb(0 0 0 / N%)`** values (dark-surface, different colour space from the teal-tinted
> rest), and **28 true elevations**.
>
> *The 28 already agree on a ramp.* By y-offset: 1px ×5, 8px ×4, 10–16px ×7, 18–26px ×8,
> 34px+ ×2. Existing tokens are xs 1px / sm 4px / md 18px / lg 34px. **Nothing sits at
> ~8–10px and there is no `xl`.** Both of this document's cited migration failures follow
> from that gap: the teal `0 8px 30px rgba(14,124,134,.10)` had no 8px rung and fell to
> the heavy two-layer `--shadow-md` — and it is also a *brand glow*, a family that should
> never be absorbed into a neutral ramp.
>
> *Work items:* add the ~8–10px rung and an `xl`; add `--ring-danger`; move the insets and
> the black values out of the elevation job; name brand glows (`--glow-teal`); migrate only
> literals within tolerance of a rung; document the remainder as intentional exceptions;
> add a guard test forbidding new raw `box-shadow` literals in `css/`.
>
> *Correction to this document's account of the rejection.* The mechanical migration was
> "rejected by its own visual diff at **2.5M changed pixels**" — the metric the handoff
> explicitly bans ("measure by delta magnitude, not changed-pixel count"). The stated
> *reason* for rejecting it (matching on blur discards offset, spread and colour) stands
> and is not disputed. The *number* is not evidence. The rejected migration will be
> re-scored by delta magnitude as the first step of A, to see what is salvageable.


**What is true.** 40 distinct light-surface shadow literals remain. A mechanical migration
was built, run, and **rejected by its own visual diff at 2.5M changed pixels**.

The reason it failed is worth keeping: a border alpha varies in one dimension and collapses
onto a scale cleanly, but a shadow varies in four — offset, blur, spread, colour — and
matching on blur alone discards the other three. `0 24px 70px -54px` became `--shadow-lg`'s
`-28px` spread; a subtle teal `0 8px 30px rgba(14,124,134,.10)` became the heavy two-layer
`--shadow-md`.

**This needs someone to decide what each component's elevation means** (which surfaces
lift, and by how much), after which the migration is mechanical. **Do not retry it
mechanically first.**

Related and also untouched: translucent `rgba()` used for backgrounds and text. That is a
fifth job — fills and scrims — and folding it into the border scale would repeat the
mistake of grouping by value instead of purpose.

---

## Part 2 — Phase 5, measured 2026-09-10

Not started. All four findings re-measured against the current tree; `prototypes/`,
`tools/` and `supabase/` are excluded throughout because `cf-build` never publishes them.

### SQ-24 and SQ-25 are the two that matter, and both are confirmed

**SQ-25 — prose rhythm · HIGH · confirmed almost exactly.**

| metric | spec | measured 2026-09-10 |
|---|---|---|
| sentence-length CV, median | 0.40 | **0.363** |
| CV range | 0.33–0.48 | **0.287–0.443** |
| mean sentence length | 12.3–15.3 per post | **13.4** (per-post 11.8–15.1) |
| contractions across the corpus | 16 | **16** |
| posts with zero contractions | 20 of 35 | **22 of 35** |
| H2 headings / questions among them | 260 / 0 | **260 / 0** |

Human editorial prose sits at 0.55–0.85. **All 35 posts are below the 0.55 floor**;
the flattest are `how-to-remove-moss-algae-without-pressure-washing` (0.287),
`low-foam-degreaser-parts-washers-floor-scrubbers` (0.291) and
`watersafe60-water-treatment-guide` (0.299).

The obvious AI vocabulary really is already gone — across ~35k words there is not one
*leverage*, *seamless*, *robust*, *delve*, *comprehensive*, *unlock* or *elevate*. What
gives the writing away is only the rhythm, plus prose that describes without committing.

> **Measurement trap, learned the hard way today.** Measuring CV over the whole HTML file
> gives a median of **0.765** — inside the human band and apparently disproving the
> finding. That number is nav, footer and CTA chrome inflating the variance. Measure
> `.blog-body` paragraph text only. The tell that the first pass was wrong: contractions
> and H2-question counts matched the spec *exactly* while CV was wildly off — when two
> metrics agree and one does not, suspect the method, not the corpus.
> Script: `.qa-local/frontdoor/phase5-prose.mjs`.

**SQ-24 — thin, uniform, unattributed posts · HIGH · confirmed.**
35 posts, **375 body words each** (spec said 405; the difference is chrome). Bylines: 34
"MASEST Team", 1 "MASEST" — no author entity anywhere. Publish dates cluster hard:
**16 posts on 2026-08-03, 8 on 2026-09-07, 5 on 2026-07-09** — batch publication legible to
a visitor and a crawler alike.

The spec's fix stands: stop publishing stubs; expand the eight highest-intent posts (CR HD
comparisons, Walmart case studies, HMIS 0-0-0) past 1,200 words with dilution tables and
cost-per-job maths; byline a real person with `Person` schema; consolidate the rest into
pillar pages rather than deleting them.

**SQ-24 and SQ-25 are one job, not two.** Expanding a post and fixing its rhythm are the
same edit. Doing them separately means writing every post twice.

### SQ-22 and SQ-23 are small and mechanical

**SQ-22 — images without `loading` · MEDIUM.** **379 shipped `<img>`, 84 without a
`loading` attribute** (spec said 199/60 — the corpus grew, the finding did not go away).
**`index.html` alone accounts for 15.** Alt text and explicit `width`/`height` are complete
across all 379, so CLS is already handled and 70 images already carry `fetchpriority`.
Add `loading="lazy"` below the fold; keep the LCP image eager.

**SQ-23 — head hygiene · MEDIUM.** Baseline is strong: zero duplicate titles, zero
duplicate descriptions, JSON-LD everywhere. Remaining, all confirmed:

- **42 titles exceed 60 characters** (spec said 36) and will truncate. Worst:
  `blog/drone-building-cleaning-guide` (99), `blog/commercial-kitchen-degreasing-guide`
  (94), `blog/how-to-clean-oxidized-aluminum-boat` (90).
- **`checkout.html` has two `h1` elements** — the only page in the shipped corpus whose
  `h1` count is not exactly 1.
- **`content-preview.html` has no meta description.**
- **`404.html` and `review.html` lack canonical + OG.** The other pages missing them
  (`/cart`, `/checkout`, `/dashboard`, `/account`, `/admin`, `/business`,
  `/order-confirmed`) are correctly noindex — do not "fix" those.

Add a source-contract test enforcing title length at build time, or the 42 will come back.

### Suggested order

1. **SQ-23** — an afternoon, and the title test stops regression.
2. **SQ-22** — mechanical; do `index.html`'s 15 first.
3. **SQ-24 + SQ-25 together** — the real work. Rewrite two posts by hand as the voice
   reference (target CV > 0.55, contractions, one heading in three a question, every
   section grounded in a named plant/surface/failed prior product/measured result), then
   edit the rest against it. Delete the two boilerplate CTA paragraphs repeated across all
   35 posts.

---

## Part 3 — Also still open

Non-blocking, recorded so they are not rediscovered:

- **`css/style.css` split** (SQ-05's third part) — deliberately deferred. 253KB raw but
  **38KB brotli**, and four files in the original order produce a byte-identical cascade,
  so it buys navigability at the cost of 118 HTML files, 5 generators and 13 tests.
- **Genuinely dead CSS: 41 families, 11.2KB, 4.4%** — measured by cross-referencing every
  never-rendered class against all HTML/JS/JSON source. Two entries are findings, not
  cleanup: `.breadcrumb` is unused while `BreadcrumbList` JSON-LD is emitted on product,
  pricing, services and comparison pages (structured data claiming a hierarchy visitors
  never see), and `.nojs-logo` is unused while `index.html` carries 8 `<noscript>` blocks.
- **`u-mb-22` is now unused**, joining three utilities (`u-measure-820`, `u-minh-0`,
  `u-ml-8`) that were already unused before this work. Belongs to the dead-CSS pass.
- **The admin console's floating chat button overlaps the last visible row's Remove
  control.** Pre-existing, not a Phase 4 regression, but the obstruction-registration
  mechanism used on the buyer cart is not wired up in the admin console.

---

## The record so far, and what it implies for Phase 5

Across phases 3 and 4, **nine findings or corrections turned out stale or misattributed** —
including two of this session's own corrections:

| claim | reality |
|---|---|
| SQ-07 reveal-on-jump invisibility | not reproducible in 11 scenarios |
| SQ-10 empty case-study images | all 13 render; symptom manufactured by the QA harness |
| SQ-18 blank product thumbnails | all 15 render |
| SQ-20 sidebar clips instead of scrolling | already `position: sticky` + `overflow-y: auto` |
| SQ-06 clipped product name | no clipping |
| SQ-06 four actions in a 40px strip | two links + a label in 52px |
| SQ-06 left column empty at 60% | fills 76–94% |
| SQ-20 "dead column is the 4th" (this handoff's own correction) | there is no dead column; both readings came from a hidden, empty `#admStats` |
| SQ-25 "CV is fine, finding is stale" (measured earlier today) | wrong method; on body prose the finding holds exactly |

Two lessons, both earned:

1. **Measure before implementing, and measure the thing that ships.** A local server, a
   stub fixture, and a media-isolating test harness each manufacture defects that do not
   exist in production.
2. **A metric that agrees with a finding on two axes and disagrees wildly on a third is
   usually a broken method, not a stale finding.** That check caught D-list errors twice
   today.

---

## Part 4 — Session rulings, 2026-09-10 (execution scope)

All five decisions above are ruled. Two further items settled in the same session:

- **The non-registering before/after pairs were ruled IN SCOPE — then measured, and the
  defect does not exist. NOT IMPLEMENTED, deliberately.**

  All **11** shipped pairs (6 story `-aligned-202609`, 5 industry `img/before-after/`) are
  correctly registered in **both translation and scale**:
  - Edge-map brute-force search over +/-12px: best shift is within **0-2px** on every pair,
    improving the residual by at most 8.4%. Nothing moves.
  - Scale sweep 0.96-1.04: every pair bottoms out at **1.00**. No zoom mismatch.

  The spec's "72-84px offsets on `brewery-tank`, `education-stairs`,
  `restaurant-concrete-floor`" is **not reproducible** - those three are the *cleanest* in
  the set at 0-1px.

  *Two wrong measurements were made getting here, both recorded so the method is not
  repeated.* (1) An earlier note that `cip-vessel` and `pool-cartridge` are "90 degrees
  apart" measured the **source originals**, not the aligned files that ship; `23260bc8`
  aligned them, and the shipped versions register at 3px and 7px. (2) A phase-correlation
  pass reported 35-228px offsets on three story pairs. That was spurious: removing dirt
  changes image content, which produces false correlation peaks. The sound method is an
  edge-map search **plus a residual-improvement check** - if the "best" shift does not
  reduce error, there is no shift.

  Consequence: the wipe slider is correct for every pair, and no story or industry markup
  changes. This also avoids contradicting the wipe contract pinned in
  `story-contract.test.mjs` and `story-six-comparisons.test.mjs`.
- **Cache token stays `20260910a`.** It is already unified across all six versioned
  references in `index.html` and has never been deployed, so it is unspent. Minting a
  second unspent token would be churn. Do NOT reuse it once it has shipped.
- **D4(i) is a media operation, not a commit.** All five story product shots are R2-only;
  `alumibrite-studio.webp` is not in the repository. The corrected 900×1200 file is
  produced locally and handed to the owner. No R2 writes are made from the engineering
  session, and the live object is not overwritten.

### Execution order and status

1. **Spec revisions for D1/D2/D3/D4 — DONE.** Recorded under each finding in
   `site-quality-remediation-2026-09-07.md`.
2. **D5 (A′) — DONE.** `--shadow-cast-sm/md/lg`, 14 declarations migrated, two exemptions
   annotated, `tests/surface-shadow-freeze.test.mjs` freezing the remaining 61 literals.
   **B (per-component promotion to the layered material) is still open** and will be
   brought to the owner as a proposed mapping.
3. **SQ-23 — DONE.** 39 over-length titles (not 42; three were `&amp;` counted as five
   characters), now **0 of 118**. `seo_title` resolution added to `tools/build-blog.mjs`:
   `post.seo_title` → `SEO_TITLES[slug]` → `post.title`.
   **The map lives in the generator, not `data/content/blog.json`, on purpose**: the
   "Refresh production CMS snapshots" step (`verify.yml:62-66`) overwrites
   `data/content/*.json` from Supabase before `verify:core` builds, so a repo-side
   `seo_title` would pass every local test and silently vanish at deploy. Guard:
   `tests/head-title-length.test.mjs`, which counts **rendered** characters.
   `tests/priority2-pages.test.mjs` had its expected titles moved with the code (8 values,
   both fixture tables) and a comment recording that the column is a SERP title, not an H1.
4. **SQ-22 — DO NOT IMPLEMENT.** The correct number of images to lazy-load is **zero**;
   of 83 without `loading`, 68 are `fetchpriority="high"` LCP images, 12 are `<noscript>`
   fallbacks, 3 are above the fold. `index.html`'s "15 to do first" is 12 noscript plus the
   3 images of the opening comparison card. Replaced with an invariant —
   `tests/image-loading-strategy.test.mjs`: *an eager image must be an LCP image, a
   noscript fallback, or first on its page*, plus alt/dimension completeness (378/378).
   Two above-the-fold images in `index.html` now declare `loading="eager"` explicitly
   rather than by omission; `eager` is the default, so nothing renders differently.
5. **SQ-24 + SQ-25 as one job — NOT STARTED.** The real remaining work.
6. **Side-by-side conversion for the five non-registering pairs — NOT STARTED.**

- **D5 part B, first three items — 2 of 3 shipped, 1 reverted after measurement.**
  - **NOT DONE: the `--shadow-dark-*` ramp.** A proposal identified `.bento-cell.ink` as
    the site's worst elevation mismatch — a dark card wearing light-surface teal tokens —
    and recommended the neutral dark ramp designed in `tools/surface-token-migrate.mjs`.
    Both the proposal and this session's first implementation were **wrong**. A box-shadow
    falls *outside* the element, onto the page behind it, and `.bento-cell.ink` is a dark
    card on a **white** page. Composited over `#ffffff`, the swap made the shadow *lighter*
    — darkest point 172.6 -> 188.7 luminance. `--shadow-dark-*` is for shadows cast ONTO a
    dark surface, which is a different situation entirely.
    The ramp was then removed rather than left unused: the stylesheet contains only **three**
    true neutral-black elevation shadows (`.ba-handle::after`, `.nav.over-dark.scrolled`,
    `#lightbox .lb-img`), they form no consistent scale, and only one matches a proposed
    token exactly. Under this codebase's own rule — a token used fewer than three times is a
    rename, not a token — the ramp does not earn its place.
    **Also correct the record:** the comment in `tools/surface-token-migrate.mjs` claiming
    "the `--shadow-dark-*` tokens stay defined and are used by hand" is **false**. They were
    never in `css/`. That sentence is what misled the proposal.
  - **DONE: the `/products` hover bug.** `body.products-page .shop-card` (0,2,1) outranked
    `.shop-card:hover` (0,2,0) on `box-shadow` while setting no `transform`, so hovering
    lifted a card 6px while its shadow stayed put. Fixed with a matching-specificity hover
    rule using the same value as the general hover.
  - **DONE: dead-rule cleanup, but only one of the two was actually dead.** Of three
    `.shop-card:hover` rules at identical specificity, the middle one was fully overridden
    and was deleted. The first was **not** dead — its `border-color: var(--accent)` still
    applies and is the hover accent border; only its `transform` and `box-shadow` were
    dead, so those two declarations were stripped and the rule kept. Deleting it wholesale,
    as "two dead blocks" implied, would have silently removed the hover border.
    Removing the dead rule orphaned an allowlisted literal and
    `tests/surface-shadow-freeze.test.mjs` caught it on the next run — the anti-rot
    assertion working as designed. Allowlist shrunk by one.
