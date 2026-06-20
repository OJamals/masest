# Scene 4 — "The Cost" conversion bridge (scrollytelling)

**Date:** 2026-06-20
**Status:** Approved design, pending implementation
**Owner sign-off:** approved 2026-06-20; standing auto-approve in effect

## 1. Problem & goal

The homepage scrollytelling story (`index.html` `.story`, engine `js/story.js`,
styles `css/story.css`) currently runs four acts in the live-bound working tree:

1. The enemy (field-photo reel) — `data-act="1"`
2. The buildup (debris-in-pipe canvas) — `data-act="2"`
3. The score (HMIS hazard diamond, four legacy chemicals scored) — `data-act="3"`
4. The zero (VertKleen savior, HMIS 0-0-0 + CTAs) — `data-act="4"`

The story jumps from "legacy chemicals are scored dangerous" straight to "buy the
0-0-0 product." There is no scene that gives the buyer a **reason to switch** —
the financial and health cost of staying on legacy chemistry. The old image-heavy
"The Chemicals" act was removed by the in-flight Codex refactor (correct call — it
was redundant with scene 3). This spec defines its replacement: a tighter,
higher-conversion **cost-bridge** scene inserted as the new act 4, pushing the
savior to act 5.

**Goal:** a single scroll-pinned scene that makes the *hidden cost of the status
quo pile up visibly* on the left while a *non-hazardous alternative sits frozen at
zero* on the right — converting on both axes (financial TCO + health/safety),
then handing off to the savior's CTA.

## 2. Final story structure (target)

1. The enemy — `data-act="1"`
2. The buildup — `data-act="2"`
3. The score — `data-act="3"`
4. **The cost** — `data-act="4"` (NEW, this spec)
5. The zero — `data-act="5"` (savior, renumbered from 4)

This is **not** a revert of the Codex refactor. Codex deleted the old `.act-chems`
"The Chemicals" act (loadout + burden + relief grids). This spec adds a new
`.act-cost` act with different content and a different mechanic.

## 3. Concept & mechanic

**Pinned split-screen cost meter** (research's top pick for a "cost piling up vs.
zero" narrative; loss-aversion made literal and watchable).

- **Left column — LEGACY CHEMISTRY:** hidden-cost line items reveal one per scroll
  beat and a running total climbs as you scroll. The accumulation *is* the
  argument.
- **Right column — VERTKLEEN:** a frozen, calm anchor — `HMIS 0-0-0` and the list
  of cost lines that drop to zero. It never moves. The asymmetry is the message.
- **Payoff line:** "The drum is the cheapest line on the legacy invoice — and the
  only line on ours." Hands off to scene 5's 0-0-0 + CTA.

### Scroll choreography (beats)

The engine drives `[data-at="n"]` elements: each fades/slides in at beat `n`
(`autoAlpha 0→1`, `y 30→0`, `scale .985→1`, `duration BEAT_IN=0.58`). `data-out`
fades out. Custom per-act logic runs in `onActScrub(st)` reading `st.p`
(timeline `totalProgress`, 0..1) — the same pattern as `updateHmis`.

| Beat | Reveal (left, `data-at`) | Running total behavior |
|------|--------------------------|------------------------|
| 0    | Headline + both column frames | total at $0 |
| 1    | PPE + training line       | climbs |
| 2    | Vacate + ventilate (downtime) line | climbs |
| 3    | Hazmat ship/store/dispose line | climbs |
| 4    | OSHA exposure line        | climbs to annual-TCO figure |
| 5    | "+ one incident" amplifier card | tail-risk figure flips in |
| 5→hold | Right column "lights up"; payoff line | total settles on final value |

- Running total: a new `updateCost(st)` hook count-ups the displayed number from
  `st.p` (same technique as `updateHmis`'s `Math.round(value * ramp)`), so it
  climbs smoothly with scroll rather than stepping.
- Right column is present from beat 0 (the calm constant) and gets an emphasis
  state (`is-on`/class toggle) at the final beat so the contrast peaks on exit.

### Mobile / short-viewport

- Columns **stack** (legacy over VertKleen) below a breakpoint.
- The scene must stay within the sticky stage floor on short laptops — apply the
  scene-3 clip lesson (`docs`/memory `scene3-hmis-overflow`): no element may rely
  on reserved-but-hidden column height that pushes content past `overflow:hidden`.
  Verify at 1280×768 and 390px.

## 4. Data — real, sourced, footnoted

Decision: real sourced figures with tiny footnotes (highest persuasion; must stay
accurate). Rules:

- Per-line **ranges**, not a single fabricated precise sum.
- **Do not** add recurring annual costs and one-time incident cost into one
  misleading number. The meter climbs through **annual TCO**; the incident is a
  separate "+ one bad day" tail-risk amplifier card.
- Right-column VertKleen claims **reuse copy already live** on the site
  ("non-DOT handling profile", "biodegrades in under 10 days", HMIS 0-0-0) — no
  new product claims are introduced by this scene.
- Every dollar figure carries a superscript `¹²³…` → a `.cost-sources` footnote
  line (also exposed to assistive tech).
- **Running-total semantics (count-up target):** the meter counts to the
  **conservative sum of the displayed line-item LOW bounds for the recurring
  annual costs only** (PPE + transport/disposal + a single OSHA serious
  violation) — explicitly labeled `/yr · conservative`. Because it sums only the
  shown sourced lows, the number is defensible and reproducible from the visible
  figures. The ~$115k incident is **excluded** from this total and shown
  separately as the tail-risk amplifier. The implementer computes the target from
  the chosen low bounds at build time and authors it as the resting DOM value.

| Line item | Figure shown | Source |
|-----------|--------------|--------|
| PPE + training | "thousands / yr" (gloves, face shield, respirator fit, eyewash) | OSHA-cited; NoCry "real cost of cheap PPE" |
| Hazmat ship/store/dispose | ~$135–$395 per 55-gal drum disposal + $45–$200/drum transport (+$200–$500 min trip) | MCF Environmental; hazardouswastedisposal.com |
| OSHA exposure | serious up to **$16,550**/violation; HazCom items $3,000–$8,000 each (willful/repeat up to $165,514) | OSHA 2026 schedule; BayArea Compliance; SafetyRegulatory |
| + one incident (amplifier) | **~$115,000** total per injury (~$54,856 direct + ~$60,341 indirect) | OSHA $afety Pays; Liberty Mutual 2025 Index |
| Switch ROI proof point | operating cost $19,600 → $2,100 in year 1; payback < 18 mo | CG Chemicals case |
| Macro anchor (optional kicker) | U.S. employers $58.78B/yr, top-10 serious-injury causes | Liberty Mutual 2025 Workplace Safety Index |

Source URLs (for the footnote line / spec record):
- MCF Environmental — https://mcfenvironmental.com/hazardous-waste-disposal-costs-what-to-know-about-transportation-fees/
- hazardouswastedisposal.com — https://www.hazardouswastedisposal.com/hazardous-waste-blog/hazardous-waste-disposal-cost
- OSHA fines 2026 — https://bayareacompliance.com/resources/osha-fines-2026 ; https://safetyregulatory.com/guides/osha-fines-penalties/
- OSHA Safety Pays background — https://www.osha.gov/safetypays/background
- Liberty Mutual 2025 Index — https://riskandinsurance.com/two-injury-types-drive-40-of-americas-58-78b-workplace-safety-bill/
- PPE true cost — https://nocry.com/blogs/news/the-real-cost-of-cheap-ppe ; https://cgchemicalsllc.com/blogs/articles/the-true-cost-of-toxic-cleaning-supplies-health-ppe-disposal

## 5. Engine integration (against the post-Codex 4-act base)

### HTML (`index.html`)
- Insert `<section class="act act-cost" data-act="4">` before the savior section.
- Renumber savior: `data-act="4"` → `data-act="5"`.
- Rail: add a 5th `.rail-btn` (`<b>5</b><span>The zero</span>`); the new cost btn
  becomes `<b>4</b><span>The cost</span>`. Final rail: enemy / buildup / the score
  / the cost / the zero.
- `__storyProbe` (debug block near the bottom of `index.html`): restore an `a4`
  entry for the cost act and make savior `a5`. Probe shape mirrors the existing
  per-act probes (headline opacity + a representative element + the running-total
  value for the cost act).

### CSS (`css/story.css`)
- `.act-cost .stage` → split grid (`.cost-rig` → `.cost-legacy` + `.cost-vert`).
- Line items `.cost-line`; running total `.cost-total` with `.cost-num`; incident
  amplifier `.cost-incident`; footnotes `.cost-foot` + `.cost-sources`.
- **Fallback (no-JS / reduced-motion):** the engine bails and CSS shows
  everything. All line items, the **final** total, both columns, and the source
  line must render fully visible and stacked. The final total value is authored as
  DOM text content (JS animates from 0 → that on scrub), so the static read is
  correct and accurate.
- Reuse story design tokens / existing card and number styling for visual
  consistency with scenes 3 and 5.

### JS (`js/story.js`)
- `var costAct = story.querySelector(".act-cost");`
- `function updateCost(st) { ... }` — drives the count-up from `st.p` and toggles
  the right-column emphasis at the final beat. Mirror `updateHmis` structure
  (clamp, smooth, `setTxt` guard, idempotent class toggles).
- Dispatch in `onActScrub(st)`: `if (st.act === costAct) updateCost(st);`
- `landings[]` (rail click target fractions) → 5 entries, tuned so each act lands
  on its key beat (cost act lands mid-accumulation).
- `data-fx`: none for v1 (the left column carries the motion; keeps the frame
  budget for the count-up). Savior keeps its `motes` fx.

## 6. Accessibility

- Respect `prefers-reduced-motion: reduce` (engine already bails → static scene).
- Count-up has a real resting value in the DOM; screen readers get the final
  number, not "0".
- Footnote sources reachable by assistive tech (visible `.cost-sources` line).
- Focusable elements inside the act participate in the existing `syncStoryFocus`
  tabindex management automatically (any `a/button/[tabindex]` is picked up).
- Color is not the only signal for "cost rising vs. zero" (labels + numbers).

## 7. Testing (`tools/story-hmis-visual.spec.mjs`)

Update existing:
- "conventional cleaner scene is no longer rendered": `.story .act` count 4 → **5**;
  `.rail-btn` 4 → **5**; assert `.story .act[data-act="5"].act-savior` exists and
  `.act-chems` count stays 0.

Add cost-scene tests:
- Cost line items are in-frame (top ≥ 0, bottom ≤ viewport − margin) at each beat,
  at **1280×768** (short-laptop, the scene-3 regression class) and **390×844**
  (mobile, no horizontal overflow).
- Running total reaches its authored final value after the final beat.
- Static/no-JS-style read: the final total text and all line items exist in the
  DOM (fallback correctness).

## 8. Build sequencing & risk

- These files (`index.html`, `js/story.js`, `css/story.css`,
  `tools/story-hmis-visual.spec.mjs`) are under active Codex edit (uncommitted
  working-tree refactor; memory `masest-concurrent-codex-edits`). **Implement only
  after Codex's 4-act refactor is committed/pushed**, then build scene 4 on that
  clean base. Spec is authored against the post-refactor 4-act structure.
- Scene-3 fix is currently working-tree-only and **not live** (origin/main still
  has the old 5-act layout without the overlay fix). Surfacing for the owner —
  separate from this scene's implementation, but both ship when Codex's work lands.
- Re-apply the scene-3 clip discipline so the new act doesn't reintroduce
  short-viewport truncation.

## 9. Out of scope (YAGNI)

- No `data-fx` canvas for the cost act in v1.
- No interactive cost calculator / input fields (it's a narrative scene, not a
  tool).
- No new VertKleen product claims beyond copy already live on the site.
- No horizontal-scroll mechanic (disorienting for a financial argument).
