# Scene 4 "The Cost" Conversion Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pinned split-screen "The Cost" act between the HMIS score scene and the savior/0-0-0 scene that accumulates the sourced hidden cost of legacy chemistry on the left while VertKleen sits frozen at HMIS 0-0-0 on the right.

**Architecture:** New `<section class="act act-cost" data-act="4">` in `index.html` (savior renumbers 4→5). Reveals use the existing `[data-at]` beat engine; a climbing dollar count-up is driven by a new `updateCost(st)` hook in `js/story.js` (mirrors the existing `updateHmis` pattern, reading timeline progress `st.p`). Layout + no-JS/reduced-motion fallback live in `css/story.css`. Tests are Playwright visual checks in `tools/story-hmis-visual.spec.mjs`.

**Tech Stack:** Vanilla HTML/CSS/JS, GSAP + ScrollTrigger (CDN, already wired), Phosphor icons (`ph ph-*`), Playwright (`@playwright/test`), python3 static server (test harness, port 4194).

**Spec:** `docs/superpowers/specs/2026-06-20-scene4-cost-bridge-design.md`

---

## Engine facts the implementer must know (read before starting)

- `js/story.js` builds one GSAP timeline per `.act`. Any descendant with
  `data-at="n"` fades/slides in at beat `n` (`autoAlpha 0→1`, `y 30→0`,
  `scale .985→1`, `duration BEAT_IN`); `data-out="m"` fades it out at beat `m`.
- Elements **without** `data-at` are untouched by the timeline and render at their
  CSS opacity (visible) whenever their act is the one on the sticky stage. Use this
  for the frozen right column.
- Fallback is automatic: `css/story.css:199` `.story.story-ready [data-at]{opacity:0}`
  (JS animates them) and `css/story.css:708` `.story:not(.story-ready) [data-at]{opacity:1;transform:none}`
  (no-JS/reduced-motion shows everything). **Never** add a plain `opacity:0` to a
  `[data-at]` selector — it would break the no-JS fallback.
- Per-act custom logic runs in `onActScrub(st)` and reads `st.p`
  (timeline `totalProgress`, 0..1). `beatFrac(st, n)` returns beat `n`'s fraction
  of `st.p`. `smooth(t)` is a smoothstep; `clamp(0,1,x)` clamps; `setTxt(el, v)`
  sets text only when changed. Reuse these — they are already defined in the file.
- Per-act surfaces that must each gain an entry when adding an act: the `.rail-btn`
  list + the `landings` array (rail click target fractions) + the `__storyProbe`
  `out.aN` debug block, all in `index.html`/`js/story.js`.
- `cvPix(n)` in the probe reads `.act[data-act="n"] .fx-canvas`; the savior's
  number must move 4→5 there too.

## File structure

- Modify `index.html`: new `.act-cost` section; savior `data-act` 4→5; 5th rail
  button; `__storyProbe` `a4`/`a5`.
- Modify `js/story.js`: `costAct` lookup, `updateCost(st)`, dispatch in
  `onActScrub`, `landings` array → 5 entries.
- Modify `css/story.css`: `.act-cost` split-grid layout, card/number styling,
  responsive stack, emphasis state.
- Modify `tools/story-hmis-visual.spec.mjs`: update the act-count test; add
  cost-scene tests.

---

## Task 0: Precondition gate (NOT a code change)

The story files are under active Codex edit (uncommitted working-tree 4-act
refactor; memory `masest-concurrent-codex-edits`). Do **not** start coding until
Codex's refactor is committed and the tree is clean for these files.

- [ ] **Step 1: Confirm Codex's refactor landed and the base is the 4-act structure**

```bash
cd /Users/omar/Claude/Projects/MASEST
git fetch origin main
git --no-pager log --oneline -3
git --no-pager status --short index.html js/story.js css/story.css tools/story-hmis-visual.spec.mjs
```
Expected: the four files are committed (clean or only intended edits), and
`index.html` has four acts with the savior at `data-act="4"` and no `.act-chems`.

- [ ] **Step 2: Confirm the baseline suite is green before adding anything**

```bash
npx playwright test tools/story-hmis-visual.spec.mjs 2>&1 | tail -5
```
Expected: all tests PASS (the 4-act baseline). If red, stop and reconcile with the
owner before proceeding.

---

## Task 1: Structure — renumber savior to act 5, add empty cost act + 5th rail button

**Files:**
- Modify: `index.html` (rail list ~line 53; savior `<section>` ~line 263; before savior insert)
- Test: `tools/story-hmis-visual.spec.mjs` (existing "conventional cleaner scene" test ~line 227)

- [ ] **Step 1: Update the structural test to expect 5 acts with savior at act 5**

Replace the existing `test("conventional cleaner scene is no longer rendered", ...)` body with:

```js
test("story renders five acts with the cost bridge and savior last", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator(".act-chems")).toHaveCount(0);          // old scene stays gone
  await expect(page.locator(".story .act")).toHaveCount(5);
  await expect(page.locator(".story .rail-btn")).toHaveCount(5);
  await expect(page.locator('.story .act[data-act="4"].act-cost')).toHaveCount(1);
  await expect(page.locator('.story .act[data-act="5"].act-savior')).toHaveCount(1);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "five acts" 2>&1 | tail -15`
Expected: FAIL — currently 4 acts, savior is `data-act="4"`, no `.act-cost`.

- [ ] **Step 3: Renumber the savior section to act 5**

In `index.html`, change the savior opening tag:
```html
<!-- ACT 5: THE SAVIOR -->
<section class="act act-savior" data-act="5" data-fx="motes">
```
(was `<!-- ACT 4: THE SAVIOR -->` / `data-act="4"`).

- [ ] **Step 4: Add the 5th rail button**

In the rail `<div class="rail-...">` button list, the current last entry is
`<button class="rail-btn" ...><b>4</b><span>The zero</span></button>`. Replace it
with two buttons:
```html
<button class="rail-btn" type="button" tabindex="-1"><b>4</b><span>The cost</span></button>
<button class="rail-btn" type="button" tabindex="-1"><b>5</b><span>The zero</span></button>
```

- [ ] **Step 5: Insert the empty cost act shell immediately before the savior section**

```html
<!-- ACT 4: THE COST (the price the label hides) -->
<section class="act act-cost" data-act="4">
  <div class="stage">
    <div class="act-copy top">
      <span class="kicker danger" data-at="0">Read the invoice, not the label</span>
      <h2 class="act-h" data-at="0">The drum is the cheapest part.</h2>
    </div>
  </div>
</section>
```

- [ ] **Step 6: Run the structural test to confirm it passes**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "five acts" 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add index.html tools/story-hmis-visual.spec.mjs
git commit -m "feat(story): add empty cost act 4, renumber savior to act 5"
```

---

## Task 2: Cost act content — legacy cost lines, incident count-up, VertKleen column, sources

**Files:**
- Modify: `index.html` (the `.act-cost .stage` from Task 1)
- Test: `tools/story-hmis-visual.spec.mjs`

- [ ] **Step 1: Write the failing content test**

Add to `tools/story-hmis-visual.spec.mjs`:
```js
test("cost act has four legacy lines, a sourced incident total, and a VertKleen column", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });

  await expect(page.locator('.act-cost .cost-line')).toHaveCount(4);
  await expect(page.locator('.act-cost .cost-incident')).toHaveCount(1);
  await expect(page.locator('.act-cost .cost-vert')).toHaveCount(1);
  await expect(page.locator('.act-cost .cost-sources')).toHaveCount(1);

  const num = page.locator('.act-cost .cost-num');
  await expect(num).toHaveAttribute("data-target", "115000");
  // Resting DOM value is the real figure so the no-JS fallback reads correctly.
  expect((await num.getAttribute("data-target"))).toBe("115000");
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "four legacy lines" 2>&1 | tail -15`
Expected: FAIL — selectors not present yet.

- [ ] **Step 3: Fill in the cost act `.stage`**

Replace the `.act-cost .stage` inner markup from Task 1 with:
```html
<div class="stage">
  <div class="act-copy top">
    <span class="kicker danger" data-at="0">Read the invoice, not the label</span>
    <h2 class="act-h" data-at="0">The drum is the cheapest part.</h2>
    <p class="act-p" data-at="0">HMIS scored the hazard. The hazard scores you back — in gear, downtime, disposal, and one bad day.</p>
  </div>
  <div class="cost-rig">
    <div class="cost-legacy" aria-label="The hidden cost of legacy chemistry">
      <h3 class="cost-col-h" data-at="0">Legacy chemistry</h3>
      <ul class="cost-lines">
        <li class="cost-line" data-at="1"><i class="ph ph-hard-hat" aria-hidden="true"></i><span class="cost-label">PPE &amp; training</span><span class="cost-fig">$1,000s / yr<sup class="cost-foot">1</sup></span></li>
        <li class="cost-line" data-at="2"><i class="ph ph-wind" aria-hidden="true"></i><span class="cost-label">Vacate &amp; ventilate</span><span class="cost-fig">downtime / job<sup class="cost-foot">2</sup></span></li>
        <li class="cost-line" data-at="3"><i class="ph ph-barrel" aria-hidden="true"></i><span class="cost-label">Hazmat ship, store, dispose</span><span class="cost-fig">$135–$395 / drum<sup class="cost-foot">3</sup></span></li>
        <li class="cost-line" data-at="4"><i class="ph ph-warning-octagon" aria-hidden="true"></i><span class="cost-label">OSHA exposure</span><span class="cost-fig">up to $16,550 / violation<sup class="cost-foot">4</sup></span></li>
      </ul>
      <div class="cost-incident" data-at="5">
        <span class="cost-incident-label">+ one workplace injury</span>
        <b class="cost-total"><span class="cost-cur">$</span><span class="cost-num" data-target="115000">115,000</span></b>
        <small>average total cost, direct + indirect<sup class="cost-foot">5</sup></small>
      </div>
    </div>
    <div class="cost-vert" aria-label="VertKleen removes the cost">
      <h3 class="cost-col-h">VertKleen</h3>
      <div class="cost-zero"><span>HMIS</span><b>0-0-0</b></div>
      <ul class="cost-drops">
        <li><i class="ph ph-check" aria-hidden="true"></i>PPE burden</li>
        <li><i class="ph ph-check" aria-hidden="true"></i>Vapor &amp; vacate step</li>
        <li><i class="ph ph-check" aria-hidden="true"></i>DOT handling profile</li>
        <li><i class="ph ph-check" aria-hidden="true"></i>Hazmat disposal drag</li>
      </ul>
      <p class="cost-proof">Documented switch: operating cost <b>$19,600 → $2,100</b> in year one.<sup class="cost-foot">6</sup></p>
      <p class="cost-payoff">The drum is the cheapest line on the legacy invoice — and the only line on ours.</p>
    </div>
  </div>
  <p class="cost-sources" data-at="5">1 OSHA / NoCry · 2 MCF Environmental · 3 MCF Environmental, hazardouswastedisposal.com · 4 OSHA 2026 schedule · 5 OSHA $afety Pays; Liberty Mutual 2025 Index · 6 CG Chemicals case</p>
</div>
```

- [ ] **Step 4: Run the content test to confirm it passes**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "four legacy lines" 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html tools/story-hmis-visual.spec.mjs
git commit -m "feat(story): cost act content — legacy lines, incident total, VertKleen column"
```

---

## Task 3: CSS — split-screen layout, responsive stack, fallback, emphasis state

**Files:**
- Modify: `css/story.css` (append a new `ACT 4 — THE COST` block; bump the `?v=` query in `index.html` if one is present on the `story.css` link)
- Test: `tools/story-hmis-visual.spec.mjs`

- [ ] **Step 1: Write the failing layout tests**

Add to `tools/story-hmis-visual.spec.mjs`:
```js
test("cost columns sit side by side on desktop and stack on mobile", async ({ page }) => {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktop = await page.evaluate(() => {
    const l = document.querySelector('.act-cost .cost-legacy').getBoundingClientRect();
    const v = document.querySelector('.act-cost .cost-vert').getBoundingClientRect();
    return { sameRow: Math.abs(l.top - v.top) < 24, legacyLeftOfVert: l.right <= v.left + 1 };
  });
  expect(desktop.sameRow).toBe(true);
  expect(desktop.legacyLeftOfVert).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => {
    const l = document.querySelector('.act-cost .cost-legacy').getBoundingClientRect();
    const v = document.querySelector('.act-cost .cost-vert').getBoundingClientRect();
    return { stacked: v.top >= l.bottom - 1, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(mobile.stacked).toBe(true);
  expect(mobile.overflowX).toBe(0);
});

test("cost scene fits a short laptop with all content in frame", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 768 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const frame = await page.evaluate(async () => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * 0.9);
    await new Promise((r) => setTimeout(r, 700));
    const stage = act.querySelector('.stage').getBoundingClientRect();
    const rig = act.querySelector('.cost-rig').getBoundingClientRect();
    return { rigTop: rig.top, rigBottom: rig.bottom, stageBottom: stage.bottom, vh: window.innerHeight };
  });
  expect(frame.rigTop).toBeGreaterThanOrEqual(0);
  expect(frame.rigBottom).toBeLessThanOrEqual(frame.vh);     // no clip past viewport
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "cost columns|short laptop" 2>&1 | tail -20`
Expected: FAIL — no `.act-cost` layout yet (columns stack/overlap by default; rig may overflow).

- [ ] **Step 3: Append the cost-act CSS**

Add to the end of `css/story.css`:
```css
/* ============================================================
   ACT 4 — THE COST (split-screen: legacy climbs, VertKleen at zero)
   No plain opacity:0 on [data-at] here — the global fallback at the
   top of this file owns reveal/visibility. Keep the stage within its
   floor on short viewports (see scene-3 overflow fix).
   ============================================================ */
.story .act-cost .stage {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(16px, 3vh, 30px);
  padding: clamp(76px, 11vh, 116px) clamp(20px, 5vw, 60px) clamp(36px, 6vh, 64px);
}
.story .act-cost .cost-rig {
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: clamp(14px, 2.2vw, 30px);
  width: min(1080px, 100%);
  margin-inline: auto;
  align-items: start;
}
.story .act-cost .cost-legacy,
.story .act-cost .cost-vert {
  border-radius: 18px;
  padding: clamp(16px, 1.8vw, 26px);
  border: 1px solid rgba(255, 255, 255, .08);
}
.story .act-cost .cost-legacy {
  background:
    radial-gradient(130% 120% at 50% 0%, rgba(255, 77, 45, .14), transparent 70%),
    rgba(255, 255, 255, .03);
}
.story .act-cost .cost-vert {
  background:
    radial-gradient(130% 120% at 50% 0%, rgba(52, 224, 200, .14), transparent 70%),
    rgba(255, 255, 255, .03);
  transition: box-shadow .4s ease;
}
.story .act-cost .cost-col-h {
  margin: 0 0 12px;
  font-size: .8rem;
  font-weight: 900;
  letter-spacing: .14em;
  text-transform: uppercase;
  opacity: .82;
}
.story .act-cost .cost-lines { list-style: none; margin: 0; padding: 0; display: grid; gap: 9px; }
.story .act-cost .cost-line {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, .04);
}
.story .act-cost .cost-line i { font-size: 1.2rem; opacity: .85; }
.story .act-cost .cost-fig { font-weight: 800; white-space: nowrap; }
.story .act-cost .cost-foot { font-size: .58em; opacity: .7; margin-left: 2px; }
.story .act-cost .cost-incident { margin-top: 14px; text-align: center; }
.story .act-cost .cost-incident-label { display: block; font-weight: 700; opacity: .85; letter-spacing: .02em; }
.story .act-cost .cost-total {
  display: block;
  font-size: clamp(2.3rem, 6vw, 3.8rem);
  font-weight: 900;
  line-height: 1;
  letter-spacing: -.02em;
  color: #ff7144;
}
.story .act-cost .cost-incident small { display: block; opacity: .7; font-size: .72rem; }
.story .act-cost .cost-zero { display: flex; align-items: baseline; gap: 10px; margin-bottom: 12px; }
.story .act-cost .cost-zero b { font-size: clamp(2rem, 5vw, 3rem); font-weight: 900; color: #34e0c8; letter-spacing: .02em; }
.story .act-cost .cost-zero span { font-size: .76rem; font-weight: 900; letter-spacing: .14em; opacity: .7; }
.story .act-cost .cost-drops { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 7px; }
.story .act-cost .cost-drops li { display: flex; align-items: center; gap: 9px; opacity: .9; }
.story .act-cost .cost-drops i { color: #34e0c8; }
.story .act-cost .cost-proof { margin: 0 0 10px; opacity: .9; }
.story .act-cost .cost-payoff { margin: 0; font-weight: 700; }
.story .act-cost .cost-vert.is-on {
  box-shadow: 0 0 0 1px rgba(52, 224, 200, .5), 0 30px 80px -50px rgba(52, 224, 200, .6);
}
.story .act-cost .cost-sources {
  font-size: .72rem;
  opacity: .6;
  text-align: center;
  margin: 4px auto 0;
  max-width: 78ch;
}
@media (max-width: 760px) {
  .story .act-cost .cost-rig { grid-template-columns: minmax(0, 1fr); }
}
```

- [ ] **Step 4: If `css/story.css` is cache-busted in `index.html`, bump it**

If the `index.html` `<link ... href="css/story.css?v=...">` has a version query,
increment it (e.g. `?v=20260620a` → `?v=20260620b`) so the new styles ship.

- [ ] **Step 5: Run the layout tests to confirm they pass**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "cost columns|short laptop" 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add css/story.css index.html tools/story-hmis-visual.spec.mjs
git commit -m "feat(story): cost act split-screen layout, responsive stack, fallback"
```

---

## Task 4: JS — `updateCost` count-up hook, dispatch, rail landings

**Files:**
- Modify: `js/story.js` (add `costAct`/`updateCost` near the other act extras; add a dispatch line in `onActScrub`; extend the `landings` array)
- Test: `tools/story-hmis-visual.spec.mjs`

- [ ] **Step 1: Write the failing count-up test**

Add to `tools/story-hmis-visual.spec.mjs`:
```js
test("legacy cost meter counts up to the incident figure by the final beat", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html{scroll-behavior:auto!important}" });
  await page.waitForTimeout(300);

  const read = async (frac) => page.evaluate(async (f) => {
    const act = document.querySelector('.story .act[data-act="4"]');
    window.scrollTo(0, act.offsetTop + act.offsetHeight * f);
    await new Promise((r) => setTimeout(r, 800));
    return Number(document.querySelector('.cost-num').textContent.replace(/[,\s]/g, ""));
  }, frac);

  const early = await read(0.5);   // before the incident beat
  const end = await read(0.92);    // hold at the end of the act
  expect(early).toBeLessThan(115000);
  expect(end).toBe(115000);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "counts up to the incident" 2>&1 | tail -15`
Expected: FAIL — the number is static `115,000` at every scroll position (no count-up driver yet), so `early` will not be `< 115000`.

- [ ] **Step 3: Add the `costAct` + `updateCost` block**

In `js/story.js`, alongside the other act-extra blocks (near the `updateHmis`
section), add:
```js
/* ---- ACT 4: legacy cost meter counts up; VertKleen stays at zero ---- */
var costAct = story.querySelector(".act-cost");
var costNum = costAct ? costAct.querySelector(".cost-num") : null;
var costVert = costAct ? costAct.querySelector(".cost-vert") : null;
var COST_TARGET = costNum ? (parseInt(costNum.getAttribute("data-target"), 10) || 0) : 0;
function fmtCost(n) { return Math.round(n).toLocaleString("en-US"); }
function updateCost(st) {
  if (!costNum) return;
  /* ramp the count-up across the incident reveal (beat 4.4 -> 5.0) */
  var a = beatFrac(st, 4.4), b = beatFrac(st, 5.0);
  var ramp = smooth(clamp(0, 1, (st.p - a) / (b - a)));
  setTxt(costNum, fmtCost(COST_TARGET * ramp));
  if (costVert) costVert.classList.toggle("is-on", ramp > 0.6);
}
```

- [ ] **Step 4: Dispatch it from `onActScrub`**

In the `onActScrub(st)` function, add a line next to the other per-act dispatches
(`if (st.act === hmisAct) updateHmis(st);`):
```js
if (st.act === costAct) updateCost(st);
```

- [ ] **Step 5: Extend the `landings` array to 5 acts**

Find `var landings = [0.24, 0.42, 0.42, 0.54, 0.32];` (in the rail-button click
handler). Replace with:
```js
var landings = [0.24, 0.42, 0.42, 0.50, 0.32]; /* enemy, buildup, score, cost, zero */
```
(Index 3 = cost act lands mid-accumulation; index 4 = savior.)

- [ ] **Step 6: Run the count-up test to confirm it passes**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs -g "counts up to the incident" 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add js/story.js tools/story-hmis-visual.spec.mjs
git commit -m "feat(story): cost meter count-up hook + rail landing for act 4"
```

---

## Task 5: Probe — restore `a4` (cost) and make savior `a5`

**Files:**
- Modify: `js/story.js` (the `__storyProbe` block; in this codebase it lives inside the inline script in `index.html` — check both; the array of probe thunks `out.aN = {...}`)

- [ ] **Step 1: Update the probe thunks**

Locate the probe array. The current last two thunks read (savior as `a4`):
```js
function(){out.a4={h:op('.act-savior h2'),z:op('.savior-zero-scale'),fx:cvPix(4),rail:document.querySelectorAll('.rail-btn.is-on').length};}
```
Replace with two thunks — cost as `a4`, savior as `a5`:
```js
function(){out.a4={h:op('.act[data-act="4"] .act-h'),total:(document.querySelector('.cost-num')||{}).textContent||'',lines:document.querySelectorAll('.act-cost .cost-line').length};},
function(){out.a5={h:op('.act-savior h2'),z:op('.savior-zero-scale'),fx:cvPix(5),rail:document.querySelectorAll('.rail-btn.is-on').length};}
```
(Note `cvPix(5)` — the savior's fx-canvas is now `data-act="5"`.)

- [ ] **Step 2: Verify the page still loads with no console errors**

```bash
npx playwright test tools/story-hmis-visual.spec.mjs 2>&1 | tail -5
```
Expected: all tests still PASS (the probe is debug-only; this step guards against a
syntax slip in the inline script).

- [ ] **Step 3: Commit**

```bash
git add index.html js/story.js
git commit -m "chore(story): restore story probe for cost act 4 + savior act 5"
```

---

## Task 6: Full regression + visual confirmation

**Files:** none (verification only)

- [ ] **Step 1: Run the entire story visual suite**

Run: `npx playwright test tools/story-hmis-visual.spec.mjs 2>&1 | tail -10`
Expected: ALL pass — five-act structure, cost content, layout (desktop + mobile +
short laptop), count-up, and the **pre-existing scene-3 short-laptop regression
test still passes** (the new act must not reintroduce a clip).

- [ ] **Step 2: Run the broader UI structure test (catches act-count assumptions elsewhere)**

Run: `npx playwright test tests/ui-structure.test.mjs 2>&1 | tail -10`
Expected: PASS. If it hard-codes a story act count, update it to 5 and re-run.

- [ ] **Step 3: Visual screenshot check (trust the screenshot, per project practice)**

Serve and screenshot the cost act at a short laptop with motion ON (the story
engine is OFF under reduced-motion, so do NOT use reduced-motion here):
```bash
(python3 -m http.server 8765 >/tmp/h.log 2>&1 &) ; sleep 1
```
Then drive the browser: navigate to `http://localhost:8765/index.html`, resize to
1280×768, inject `html{scroll-behavior:auto!important}`, scroll to
`act[data-act="4"].offsetTop + offsetHeight*0.9`, settle ~1s, screenshot. Confirm
visually: both columns framed, the `$115,000` total and the VertKleen 0-0-0 panel
fully visible, no truncation, no horizontal scrollbar.

- [ ] **Step 4: Final commit (if any cleanup from steps 2–3)**

```bash
git add -A
git commit -m "test(story): five-act regression coverage for the cost bridge"
```

---

## Self-review notes (author)

- **Spec coverage:** placement/renumber → Task 1; split-screen + beats → Tasks 2–4;
  sourced/footnoted data → Task 2 (figures + `.cost-sources`); count-up semantics
  (single sourced $115k, no synthetic sum) → Task 4 + spec §4; engine integration
  (rail/probe/landings/`updateCost`) → Tasks 1,4,5; fallback → Task 3 (relies on
  the global `[data-at]` rules; resting DOM total = real value); accessibility →
  `[data-at]` fallback + real resting number + `aria-label`s in Task 2; tests →
  every task is TDD + Task 6 regression incl. the scene-3 short-laptop guard.
- **Placeholder scan:** none — every code/test step has complete content.
- **Type/selector consistency:** `.act-cost`, `.cost-rig`, `.cost-legacy`,
  `.cost-vert`, `.cost-line` (×4), `.cost-incident`, `.cost-num[data-target]`,
  `.cost-sources`, `updateCost`/`costAct`/`COST_TARGET`, `cvPix(5)` are used
  identically across HTML, CSS, JS, and tests.
- **Open implementer check:** confirm whether `__storyProbe` lives in `index.html`
  inline script vs `js/story.js` (Task 5 Step 1 covers both); confirm the
  `css/story.css` cache-bust query exists before bumping (Task 3 Step 4).
