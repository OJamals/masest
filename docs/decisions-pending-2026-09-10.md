# Decisions pending, and Phase 5 — 2026-09-10

Companion to `handoff-design-system-2026-09-09.md` (branch state, phases 1–4) and
`site-quality-remediation-2026-09-07.md` (the spec, all 25 findings).

This file is the short list of things engineering cannot decide. Phases 1–4 are done; five
items are blocked on a ruling, and Phase 5 has not started. Every number here was measured
on the current tree on 2026-09-10, not carried over from the spec.

---

## Part 1 — Five decisions

### D1 · Story length and scene count (SQ-06) — the expensive one

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

Product imagery inconsistently framed. Being handled by the owner in another session; no
engineering input is blocked on it and no measurement was taken this session.

---

### D5 · Elevation ramp — a designer's call, not a business one

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
