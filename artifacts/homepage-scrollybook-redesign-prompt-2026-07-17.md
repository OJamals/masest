<!-- Hallmark · pre-emit critique: P5 H5 E5 S5 R5 V5 -->

# Homepage scrollybook review + redesign prompt

Reviewed current local homepage at `1440×900` and `390×844`, then confirmed the
live homepage uses the same story headline and `css/story.css?v=20260712a`.
Review covered the five-act sequence, chapter transitions, mobile composition,
dark-to-light handoff, navigation state, chat launcher, and reduced-motion/no-JS
architecture. No production files were changed.

## Current verdict

Strong foundation. Real field photography, the animated pipe, mirrored hazard
ledgers, documented proof, and restrained industrial palette make the story feel
specific to VertKleen. It does not need replacement from scratch.

Main problem is pacing. The story consumes about `10,674px` at `1440×900` and
`9,453px` at `390×844`: roughly 12 and 11 viewport heights before the factual
homepage resumes. Repeated centered chapters, long reveal roads, duplicate CTA
pairs, and a weak dark-to-light handoff make a good idea feel longer and more
templated than it should.

## What works

- Act 1 establishes industrial credibility immediately with real field evidence.
- Act 2 turns scale, rust, grease, and biofilm into one readable process diagram.
- Acts 3–4 reuse one ledger skeleton, making conventional burden versus
  VertKleen `0-0-0` easy to compare.
- The `$10,000 / yr saved` proof is attributed; the page does not invent metrics.
- Native scrolling, one GSAP timeline per act, deferred story images, no Lenis,
  no wheel interception, no per-frame SVG blur, and static reduced-motion/no-JS
  fallbacks are sound implementation choices.
- Mobile ledger cards remain readable without horizontal scrolling.

## Ranked findings

### Critical

1. **Tell — The 3-column feature grid**
   - **Where —** `index.html:282` and `css/story.css:1363`
   - **Why —** Act 5 ends with three equal benefit tiles: “Cleans / HMIS /
     Approval.” This is the most recognizable generated-landing-page pattern,
     and it reduces the force of the preceding custom ledger.
   - **Fix —** Replace the equal tiles with an asymmetric proof-and-action close:
     one dominant documented result, one compact approval/document cue, and one
     primary CTA.

### Major

1. **Tell — Animate-on-scroll on everything**
   - **Where —** `css/story.css:37-40`, `css/story.css:837-840`,
     `js/story.js:62`, `js/story.js:110`, `js/story.js:140`
   - **Why —** Every act receives a long scroll road, most elements wait for
     `data-at`, scrub smoothing is `0.42`, and every timeline adds a `1.35` hold.
     The result is an 11–12-screen prelude with visible blank/low-information
     states around chapter boundaries.
   - **Fix —** Merge the two ledgers into one morphing chapter, cut the story to
     four acts and at most 6–7 viewport heights on desktop, remove end holds that
     do not communicate new information, and guarantee a meaningful composition
     at every scroll position.

2. **Tell — Centred everything**
   - **Where —** `index.html:173`, `index.html:190`, `index.html:234`,
     `index.html:280`, plus the centered `.act-copy.top` treatment
   - **Why —** Acts 2–5 repeat centered eyebrow, centered heading, centered body,
     centered object, then reveal. The visual material changes; the composition
     rhythm does not.
   - **Fix —** Keep Act 1 asymmetric, let the pipe travel edge-to-edge with copy
     anchored to one side, make the ledger a left-aligned operational document,
     and close with a proof-led split rather than another centered hero.

3. **Tell — Boundary state leak**
   - **Where —** `.story-rail` at `css/story.css:70`,
     `syncStoryPageState()` at `js/story.js:393`, and visibility ownership at
     `js/story.js:446`
   - **Why —** At the dark-to-light boundary, chapter rail circles remain visible
     over the light page while the nav briefly keeps its dark-scene treatment.
     The handoff looks accidental and reduces nav contrast.
   - **Fix —** End rail ownership before the story bottom, fade/clip it inside
     the final dark stage, and switch nav contrast from a single shared boundary
     signal before light content enters the viewport.

4. **Tell — Competing conversion paths**
   - **Where —** Act 1 CTA pair and three fast-path cards near
     `index.html:105-117`, then the same CTA pair near `index.html:289-292`
   - **Why —** Five actions appear in the opener, then the two primary actions
     repeat in the close. “Find your replacement” should be unmistakably first.
   - **Fix —** Keep one dominant CTA in the first viewport, demote proof/account
     to quiet links, and use the final chapter for one primary action plus one
     low-emphasis trial link.

5. **Tell — Fixed overlay/content collision**
   - **Where —** `css/customer-chat.css:2-24` and collision avoidance inside
     `js/customer-chat.js:68-90`
   - **Why —** At `390×844`, the Chat pill overlaps Act 2 chips and occupies the
     same lower-right zone used by ledger and close content. Existing avoidance
     checks interactive controls, not important story labels or proof.
   - **Fix —** Use `body.story-in-view` to switch the launcher to an icon-only
     compact state and reserve a story safe area; restore the full pill below
     the story.

6. **Tell — Broken proof phrase**
   - **Where —** `index.html:102`
   - **Why —** At `1440×900`, the hero wraps `HMIS 0-0-0` after `0-`, visually
     breaking the product’s defining phrase.
   - **Fix —** Rewrite the hero for a shorter line or wrap `HMIS 0-0-0` in a
     non-breaking inline span with a responsive size step-down.

### Minor

1. **Tell — Eyebrow on every section**
   - **Where —** Acts 2–5 in `index.html:172-280`
   - **Fix —** Keep at most two chapter labels. Let composition, copy, and
     progress state communicate the other transitions.

2. **Tell — Mobile microcopy compression**
   - **Where —** final three-card close at `390×844`
   - **Fix —** Remove the three-up mobile grid. Keep source/proof text readable
     without shrinking it below the surrounding narrative.

**Count:** 1 critical · 6 major · 2 minor

## Copy-paste redesign prompt

```text
You are a senior interaction designer and frontend motion engineer working in:

  /Users/omar/Claude/Projects/MASEST

Read the repository AGENTS.md and DESIGN.md first. Inspect current git status and
preserve every existing user-owned change. Do not reset, delete, reformat, stage,
commit, push, or deploy unrelated work.

Task
----
Design and implement a tighter, more conversion-focused homepage
animation/scrollybook for MASEST / VertKleen. Improve the existing system in
place; do not replace the homepage, route tree, product data, or below-story
information architecture.

Primary audience:
- Plant managers, facilities teams, safety leaders, water-treatment operators,
  maintenance buyers, and distributors who already know the chemical/job they
  need to replace.

Primary action:
- Find the matching VertKleen replacement.

Secondary action:
- Request a trial with supporting documentation.

Tone:
- Premium industrial, precise, evidence-led, cinematic.
- Apple-level restraint plus plant-floor credibility.
- Never futuristic SaaS, generic “clean tech,” neon sci-fi, or glossy ad-tech.

Current implementation truth
----------------------------
- Homepage story markup: index.html, currently five acts.
- Story styling: css/story.css.
- Motion engine: js/story.js.
- Existing architecture: native browser scroll, GSAP ScrollTrigger, one timeline
  per act, no Lenis, no wheel multiplier, no custom damping.
- Existing fallbacks: reduced motion, missing GSAP/ScrollTrigger, and no-JS show
  a static, fully visible story.
- Existing accessible summary:
  <section class="story-summary sr-only"> in index.html. Preserve it and update
  its wording/order if the visible narrative changes.
- Existing design system: Satoshi, Phosphor icons, light site tokens, dark story
  palette, teal action/safe color, warm danger color. The purple→teal brand
  gradient is logo-only.
- Existing real proof and product truth must remain real. Do not invent a
  metric, testimonial, customer, certification, product, hazard score, or
  savings claim.
- Preserve the documented $10,000/year Walmart distribution-center result and
  its source if it remains in the story.
- Preserve “typical HMIS 0-0-0” qualification where applicable. Do not silently
  turn a qualified claim into an absolute claim.

Problems to solve
-----------------
1. Current story is about 10,674px at 1440×900 and 9,453px at 390×844:
   roughly 12 and 11 viewport heights before the factual homepage resumes.
2. Acts 2–5 repeat centered eyebrow → centered heading → centered body →
   centered object.
3. Act 5 falls into a generic three-equal-card layout.
4. Act 1 has five competing paths; the CTA pair repeats at the end.
5. “HMIS 0-0-0” breaks after “0-” in the desktop hero.
6. Some chapter transitions briefly show mostly empty stage.
7. At the dark-to-light boundary, the chapter rail leaks over light content and
   nav contrast changes late.
8. At 390px, the fixed Chat pill overlaps important story content.
9. Mobile keeps nearly the full desktop scroll burden and sometimes compresses
   key copy to fit a pinned stage.

Required design direction: “The Replacement Ledger”
----------------------------------------------------
Use four acts maximum. Target 6–7 viewport heights total on desktop and no more
than 6.5 viewport heights on mobile. Mobile may use a shorter in-flow narrative
instead of pinning every act.

Act 1 — Field problem + immediate route
- Keep the real field-photo evidence.
- Use an asymmetric split, not a centered hero.
- Shorten the headline. Recommended direction:
  “Keep the job. Replace the harsh chemistry.”
- Supporting line may explain that VertKleen provides typical HMIS 0-0-0
  replacement chemistry for the same industrial cleaning and water-treatment
  jobs.
- Keep one dominant “Find your replacement” CTA in the first viewport.
- Keep “Request a trial” as a quieter text/outline action.
- Reduce the three shortcut cards to a compact secondary utility row or remove
  them from the hero.
- Treat “HMIS 0-0-0” as one non-breaking semantic unit.

Act 2 — What buildup costs
- Keep and refine the existing pipe cross-section.
- Anchor copy to one side while the pipe travels across the stage.
- Let scale, rust, grease, and biofilm accumulate in one continuous visual.
- Use only information already present in the repository.
- No extra decorative particles, orbiting blobs, fake dashboards, or invented
  gauges.

Act 3 — One ledger, transformed
- Merge current conventional-hazard and VertKleen-zero ledgers into one
  continuous operational document.
- Each conventional row enters once, then transforms in place:
  chemical → VertKleen replacement;
  HMIS score → 0-0-0;
  added burden → struck/removes burden.
- Preserve real product links for HCR, CR, Purgo, and Neutral.
- Keep the three HMIS axes color-coded and understandable.
- Use row morph/strike animation rather than fading a complete second ledger in.
- Finish the transformation on the documented $10,000/year proof.
- Avoid a blank pre-ledger or post-ledger hold.

Act 4 — Proof-led action + paper handoff
- Do not use three equal benefit cards.
- Build an asymmetric close:
  left/dominant = documented result and source;
  right/supporting = approval/document cue and primary CTA.
- Use one primary “Find your replacement” CTA.
- Keep “Request a trial” as secondary.
- Transition from dark story to light factual homepage as one deliberate
  “ink-to-paper” handoff. The next light section should feel revealed, not
  abruptly substituted.
- Fade and clip the chapter rail before the light page appears.
- Switch nav contrast early enough that all nav text remains readable throughout
  the boundary.

Structural and visual rules
---------------------------
- Preserve current dark cinematic palette, real photography, real product names,
  and real proof. Use existing tokens; do not create an unrelated theme.
- Vary composition by act:
  asymmetric split → edge-to-edge process → document/ledger → proof/action split.
- At most two eyebrow/kicker labels across the whole story.
- No equal three-card feature row.
- No glass cards unless they communicate an actual layer or document.
- No gradient headline.
- No fake browser/device chrome.
- No italic heading emphasis.
- No invented photography or stock imagery.
- No decorative motion that does not communicate buildup, replacement, proof,
  or progress.

Motion rules
------------
- Retain native scrolling and GSAP ScrollTrigger.
- No Lenis, scroll hijacking, wheel interception, snapping trap, WebGL, Three.js,
  Lottie, or sound.
- Use a maximum of three motion primitives per act:
  crop/reveal, transform/morph, opacity.
- SVG stroke-dash motion is allowed for the pipe. Do not add SVG blur filters to
  per-frame animated paths.
- Prefer transform and opacity. Avoid layout-property animation.
- Reduce scrub smoothing from the current sluggish feel; start around 0.25–0.35
  and tune by rendered review.
- Remove long end holds. A hold is allowed only when it makes a new claim
  readable; no act may spend a viewport with only a heading and empty stage.
- At every 10% of story progress, a meaningful composition must be visible.
- Keep image aspect ratios reserved and prevent CLS.
- Apply will-change only to active animated elements; remove it when inactive if
  practical.
- Keep the current mobile-resize and DPR safeguards unless the new structure
  makes them unnecessary and tests prove removal safe.

Mobile rules
------------
- Design separately for 320, 375, 390, 414, and 768px.
- Do not pin a scene whose full content cannot fit within the usable viewport.
- Prefer an in-flow mobile story with one short sticky/morphing ledger moment.
- No horizontal scrolling.
- No story copy hidden under the sticky nav.
- Minimum 44px interactive targets.
- Keep important body/proof text readable; do not solve fit by shrinking it.
- Use body.story-in-view to switch the customer chat launcher to a compact
  icon-only mode or otherwise reserve a safe lower-right story zone. Restore the
  full launcher below the story.
- Respect safe-area insets.

Accessibility and fallback rules
--------------------------------
- Preserve keyboard focus order.
- Inactive pinned acts must not leave hidden focusable controls reachable.
- Keep visible :focus-visible rings with AA contrast.
- Preserve semantic headings and useful aria-labels.
- Update the existing sr-only story summary to match the new four-act order.
- Under prefers-reduced-motion: reduce, show a concise static story with all
  claims and CTAs visible; use no spatial scrub.
- If GSAP or ScrollTrigger fails, the page must remain fully readable and
  actionable.
- Do not rely on animation alone to explain a score, savings claim, removed
  burden, or selected product.

Allowed implementation scope
----------------------------
Expected files:
- index.html
- css/story.css
- js/story.js
- focused story tests in tests/ or tools/

Optional only if needed for the verified overlap fix:
- css/customer-chat.css
- js/customer-chat.js

Do not modify unrelated homepage sections, commerce behavior, account/admin
surfaces, product catalog data, global navigation IA, or CMS content.

Workflow
--------
1. Start from current filesystem truth and current rendered homepage.
2. Before editing, report:
   - exact dirty files relevant to this task;
   - exact files you will change;
   - a four-act storyboard;
   - desktop and mobile scroll-length targets;
   - the beat map for each act.
3. Implement in place. Reuse existing assets and engine seams.
4. Update focused tests for the new structure and removed five-act assumptions.
5. Render and inspect actual animation states, not only DOM/CSS.

Required verification
---------------------
- Desktop: 1440×900 and 1280×720.
- Tablet: 768×1024.
- Mobile: 390×844 and 320×568.
- Capture opening, midpoint, ledger transformation, final CTA, and
  dark-to-light boundary.
- Verify:
  - no horizontal overflow;
  - no clipped text or imagery;
  - “HMIS 0-0-0” never splits internally;
  - no blank chapter state;
  - rail never appears on light content;
  - nav contrast remains correct at the boundary;
  - chat launcher does not cover labels, proof, or CTAs;
  - first primary CTA is visible without scrolling on normal desktop;
  - reduced-motion and missing-GSAP fallbacks remain complete;
  - no console errors.

Run at minimum:

  node --test --test-concurrency=1 --test-timeout=120000 \
    tests/ui-structure.test.mjs

  npx playwright test \
    tools/story-hmis-visual.spec.mjs \
    tools/site-audit-regressions.spec.mjs \
    --reporter=line

Then run the full local gate:

  npm run verify

Use normal motion for animated-state screenshots. Run a separate reduced-motion
pass for fallback verification.

Handoff
-------
Return:
- concise description of the new four-act experience;
- changed files;
- measured desktop/mobile story heights in pixels and viewport multiples;
- verification commands and results;
- screenshot paths for the five required states;
- any remaining risk.

Do not commit, push, or deploy unless explicitly requested.
```
