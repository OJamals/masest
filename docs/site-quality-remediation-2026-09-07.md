# Site quality remediation — spec

Source: full-surface review of masest.co, 7 Sep 2026 (live DOM + Resource Timing +
computed styles, plus static analysis of 64 HTML files, 7 stylesheets, 35 blog posts).
Review artifact: https://claude.ai/code/artifact/2ef31dba-6106-49ce-8615-0aa0f9faf4c2

Owner-confirmed 7 Sep 2026: all findings accepted. One correction folded in — see SQ-12.

Branch for phase 1: `design-system-phase1` (isolated worktree, cut from `origin/main`
because the primary checkout carries ~112 uncommitted Codex files).

---

## Root cause

Three missing systems account for nearly every visual complaint. Individual pages are
not badly designed; they are designed without a shared vocabulary, so each one re-decides
type, spacing and breakpoints from scratch.

| Missing system | Consequence measured on the live site |
|---|---|
| Type scale | 30 distinct rendered font sizes on `/products`; 232 of 385 text elements below 13px; most common size 12.48px |
| Spacing scale | 1 spacing token in `:root`; 49 distinct px values in CSS; 20 distinct live `gap` values |
| Responsive system | 99 media queries across 25 breakpoints, including the pairs 680/681 and 720/721 |

Fixing these first is not sequencing preference — it is a cost decision. Every page-level
fix below inherits the scale. Doing page work first means doing it twice.

---

## Priority order

Phases run in order. Within a phase, items are listed in the order they should land.

| Phase | Theme | Items | Why here |
|---|---|---|---|
| 1 | Design foundations | SQ-01 … SQ-05 | Everything else inherits it |
| 2 | Revenue surfaces | SQ-11 … SQ-17, SQ-21 | Highest commercial cost; unblocked by phase 1 |
| 3 | Front door | SQ-06 … SQ-10 | Large but non-blocking; needs phase 1 tokens |
| 4 | Operations | SQ-18 … SQ-20 | Internal-only impact |
| 5 | Content | SQ-22 … SQ-24 | Slow-compounding; no code dependency |

SQ-08 (proof imagery) is a business decision, not an engineering task. It is scheduled in
phase 3 but needs an owner ruling before that phase starts.

---

## Phase 1 — Design foundations

### SQ-01 — Introduce a type scale · CRITICAL

**Problem.** No type scale exists. `css/style.css` carries 93 `font-size` declarations
using arbitrary decimals (`.68`, `.7`, `.72`, `.74`, `.75`, `.76`, `.78`, `.8`, `.82`,
`.84`, `.85`, `.86`, `.88`, `.9`, `.92`, `.94`, `.95`, `1rem`) — seventeen distinct values
inside a 5px range. Live, `/products` renders 30 distinct sizes and 60% of its text
elements sit below 13px. Small type carries no weight, so no element leads, so hierarchy
collapses, so the layout compensates with 108px section padding and 700px cards. This is
the root cause of "bloated but cramped".

**Live evidence (`/products`, leaf text nodes).**

```
12.48px  91 elements      16.00px  29
11.20px  46               14.08px  21
12.16px  45               14.40px  21
10.88px  21               11.68px  15
12.80px   9               11.52px   3
12.00px   1               10.24px   1
232 / 385 elements below 13px · 30 distinct sizes
```

**Fix.**
- Define an eight-step scale as tokens in `:root`.
- Body copy moves to 16–17px.
- Map every existing declaration to its nearest step.
- Nothing below 13px except genuine legal microcopy (disclaimers, image credits).
- Keep the existing `clamp()` display sizes; they are already fluid and correct.

**Acceptance.**
- Distinct rendered font sizes on `/products` ≤ 10.
- Text elements below 13px ≤ 15% of the page's text elements.
- No raw `font-size` value in the touched stylesheets outside `:root` and `clamp()` heads.
- Full suite green; cache token bumped everywhere it is pinned.

**Correction 2026-09-09 — the first pass missed the worst file.** `css/story.css` was not
in the migration's file list, and the metric reported after that pass ("text under 13px:
232/385 → 0") was measured on `/products`, which does not load it. The homepage does.
story.css held **42 of 44 font-size literals under 13px, the smallest at 7.68px** — the
whole original problem, still on the front door.

32 of those 42 are now on the scale. **The 12 `.story-object__*` declarations are
deliberately exempt**, and the exemption is recorded in `tools/type-scale-migrate.mjs`
alongside the icon rule. Measured reason: at 13px every item in the before/after card's
footer wraps to three lines at 390px wide, and the card grows until it covers the
"Better chemistry." headline behind it. Raising those needs the card footer redesigned for
larger type, not a mechanical snap — tracked as its own task, not silently dropped.

The stage reservation needed retuning again as a result (`calc(48.8vw + 240px)` →
`264px`). Note for whoever tunes it next: the constant does **not** track card growth
one-for-one — roughly half of each added pixel is absorbed before it reaches the copy, so
tune against the measurement rather than by arithmetic.

---

### SQ-02 — Introduce a spacing scale · CRITICAL

**Problem.** `:root` defines 55 custom properties; exactly one is spacing
(`--space-section`). Everything else is hand-typed: 49 distinct px values across
padding/margin, 20 distinct live `gap` values. Six of those gaps (2, 4, 6, 7, 8, 10px) do
the same job. Section padding pairs are all one-offs: 108/36, 58/108, 72/48, 32/4, 26/0.
No two sections share a rhythm because there is no rhythm to share.

**Fix.** Ship a 4px-based scale as `--s1 … --s9` (4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 /
112) and sweep. 13, 11, 9, 7, 5 and 2px all round to a neighbour nobody will perceive.
Keep `--space-section` as an alias of the largest step so existing call sites survive.

**Acceptance.** ≤ 10 distinct px spacing values remain in CSS. ≤ 6 distinct live `gap`
values on `/products`. Visual diff shows no layout regressions at 390 / 768 / 1280 / 1600.

### SQ-03 — Collapse 25 breakpoints to 4 · HIGH

**Problem.** 99 `@media` blocks across 25 widths: 360, 420, 460, 520, 560, 600, 620, 640,
680, **681**, 700, 720, **721**, 760, 800, 820, **821**, 840, 860, 900, 920, 940, 960,
980, 1100. The `n`/`n+1` pairs are mutually-exclusive patches. Nobody can predict a
component's behaviour at an arbitrary width without testing it.

**Fix.** Four breakpoints — 640 / 900 / 1180 / 1440. Convert fixed-column grids to
`repeat(auto-fit, minmax(…, 1fr))` so most queries stop being necessary. Expect a large
share of the 242KB stylesheet to disappear here.

**Acceptance.** ≤ 6 distinct breakpoints. `@media` block count reduced by ≥ 40%.
Screenshot parity at 390 / 640 / 900 / 1180 / 1440.

### SQ-04 — Three surface levels, not one card treatment · MEDIUM

**Problem.** Border, fill, radius and shadow each announce "separate object", and all four
are applied at every level. On `/products/crhd` a single bullet list renders as five
stacked bordered pills, inside a bordered card, inside a bordered section — three
container levels for one line of text each. Applied everywhere, the treatment emphasises
nothing.

**Fix.** Exactly three surface levels: page ground, one raised surface for genuinely
separable objects, one sunken surface for inputs and code. Lists render as lists. The
shadow is reserved for the single element per screen that should lift.

**Acceptance.** No component nests a bordered container inside a bordered container inside
a bordered container. `--shadow-md` / `--shadow-lg` used ≤ 8 times each.

**Measured 2026-09-09 — the worked example in this finding is wrong; the underlying
problem is real and worse.** Rendered-DOM measurement across 10 pages at two viewports:

| claim as written | measured |
|---|---|
| crhd shows "five stacked bordered pills" | crhd has no 5-item list. Its three `product-fit-list`s hold 4, 2 and 2 items. The "five" is HCR's two separate lists (3+2), misattributed. |
| "three container levels" | **Four.** bordered card → `li.doc-file` (border only, transparent fill) → `a` (filled pill, no border) → `span.doc-pill` (filled badge). |
| the outer `<section>` is bordered | It is not a surface at all — its background is byte-identical to `<body>`. |
| "one line of text each" | Each row carries a label span plus a status badge: 51px box against 49px of text, i.e. two stacked lines. |

Max surface depth by page: `/` 4 · `/products` 3 · `/products/crhd` 3 · `/products/hcr` 3 ·
`/about`, `/services`, `/contact`, `/blog`, `/resources`, `/cart` all 2. Half the site is
already at or under the target, so this is three components, not a site-wide rewrite:

1. the scrollytelling replacement ledger inside `<details>` on `/` (depth 4),
2. the product card on `/products` — three depth-3 patterns × 15 identical cards,
3. the document-download row chain on the PDPs (`article > ul > li.doc-file > a > span.doc-pill`),
   4 instances on crhd, 5 on hcr.

The genuinely single-sentence list the finding meant to indict ("Made for jobs like these")
is depth 1 and is fine.

**The real shadow problem is not the token count.** `--shadow-md` is used 17 times in source
(target ≤ 8, fails) and `--shadow-lg` 6 times (passes) — but **30 distinct `box-shadow`
values actually paint** across those pages, because most shadows are bespoke `rgba()`
literals that never route through either token. Capping token uses would not have caught
that. Same shape in the other two axes: **17 distinct rendered `border-radius` values** and
**35 distinct `border-color` values** (one dominant `--line` gray at 906 uses, then ~10
white-alpha steps, ~5 teal-alpha steps and ~5 near-duplicate light grays).

**Revised acceptance.** ≤ 3 distinct rendered `box-shadow` values, ≤ 4 `border-radius`,
≤ 6 `border-color`. Max surface depth 3 on every page. Measured on rendered DOM, not
counted in source — source counts miss the literals, which are the actual problem.

**That acceptance was wrong too, and is replaced. 2026-09-09.** "≤ 3 distinct box-shadow
values" was set before looking at the declarations. Counting values treats four unrelated
jobs as one, and collapsing them would destroy real distinctions:

| job | declarations | distinct |
|---|---:|---:|
| elevation on a light surface | 68 tokenised + 43 literal | 40 |
| focus / selection rings | 26 | 21 |
| elevation on a **dark** surface | 14 | 12 |
| inset bevel highlights | 5 | 5 |
| translucent borders | 109 literal (of 473 total) | 65 |

A ring is not a shadow with different numbers — it is a hard spread with no blur, and it
has to stay legible exactly where a soft drop shadow disappears. A shadow cast on a dark
surface cannot use the teal-tinted `--shadow-*` ramp, because a teal tint is invisible
against near-black. Three values cannot serve all four jobs.

**The real disease is the one the type, spacing and radius scales already had: a
continuous ramp with no steps.** 27 accent borders are spelled with 17 different alpha
values, 23 ink hairlines with 7, 16 on-dark borders with 13. Nobody chose those numbers.

The steps are measured, not invented. Each family was split by whether the declaration
sits in a resting rule or in a `:hover` / `:focus-visible` / selected rule — and the split
is clean, which is what makes the scale semantic rather than arbitrary:

| family | resting | emphasis | selected |
|---|---|---|---|
| accent border | .14–.32 (10) → **.22** | .18–.42 (14) → **.36** | .46–.62 (3) → **.52** |
| ink hairline | .07–.09 (9) → **.08** · .10–.16 (14) → **.12** | none | none |
| on-dark border | .10–.22 (12) → **.18** | .30–.55 (4) → **.42** | none |

14 new tokens replace 143 literal declarations: seven `--line-*` steps, three `--ring-*`,
three `--shadow-dark-*`, and `--highlight-top`. **Every one is used at least three times** —
a token used once is a rename, not a token — so the genuine one-offs stay literal: the
hazard-diamond colours, the data-visualisation series, the amber and mint rings, and the
two dim inset highlights.

Elevation literals snap onto the **existing** `--shadow-xs/sm/md/lg` by nearest blur
radius (2 / 12 / 42 / 74), not by threshold buckets. Bucketing pushed a 24px blur onto the
42px step — a visible thickening — when the 12px step is nearer. Same reasoning as the
breakpoint canon. Two 1px rings keep their literals rather than being widened to
`--ring-tight`'s 2px.

Tooling: `tools/surface-token-migrate.mjs`. `rgba()` used for **backgrounds or text** is
deliberately untouched — a translucent fill is a fifth job and needs its own pass.

**Revised acceptance.** Zero literal `box-shadow` outside the token definitions, except
declared one-offs. Zero translucent `border-color` literals in the accent / ink / on-dark
families. Max surface depth 3 on every page. Rendered `border-radius` ≤ 6 including `50%`
and `0`.

### SQ-05 — Fold 65 hard-coded hex colours into tokens; remove 67 `!important` · MEDIUM

**Problem.** The token layer is good — the semantic status ramp and the `--rating-star`
fix show real care — but 143 raw hex uses bypass it, and 67 `!important` declarations mean
the cascade is being fought rather than composed. In a 9,462-line, 2,089-selector single
stylesheet that compounds: each new rule must out-specify the last.

**Fix.** Fold the 65 hexes into tokens area by area. Split `css/style.css` along the seams
that already exist — base, layout, commerce, marketing. Treat each `!important` removal as
the acceptance test for the split.

**Acceptance.** Zero raw hex outside `:root` (existing site-audit-regressions test already
bans raw status hex — extend it). `!important` count ≤ 10.

**Measured 2026-09-09 — the stylesheet split is dropped from this finding.** The split was
proposed to relieve a 253KB stylesheet. Over the wire that file is 38KB brotli, and the
whole CSS layer is 63KB, so it is not what causes the 4.76s first paint in SQ-21 — the
double fetch and the serialized render-blocking chain are. Splitting also does not relieve
the specificity compounding the finding describes: four files loaded in the original order
produce a byte-identical cascade. What it would buy is navigability, at the cost of 118
HTML files, 5 generator tools and 13 source-contract tests. Deferred as a poor trade
against Phase 2. The two real parts of SQ-05 — hexes and `!important` — stand unchanged.

CSS coverage, 118 pages x 2 viewports, union (`page.coverage.startCSSCoverage`):

| measure | value |
|---|---|
| style.css | 252,874 bytes raw · 38,444 brotli |
| used by at least one page | 60.3% |
| never rendered | 39.7% |
| mean single page needs | 9.2% |
| heaviest page (`/products`) needs | 17.2% |

The 39.7% is **not** dead code, and must not be reported as such: the static server runs
no backend, so JS-injected commerce markup and auth-gated admin surfaces never render.
Cross-referencing every never-rendered class against all HTML, JS and JSON source (vendor
bundles excluded — `stagger` matches inside `gsap.min.js`) puts genuinely dead CSS at
**41 families, 11.2KB, 4.4%**. That is worth deleting as hygiene, not as performance.

Two entries on the dead list are findings rather than cleanup:

- **`.breadcrumb` is unused, but `BreadcrumbList` JSON-LD is emitted** by `tools/seo-inject.mjs`
  and appears on product, pricing, services and comparison pages. Structured data claims a
  hierarchy the page never shows a visitor. Either render the component or stop claiming it.
- **`.nojs-logo` is unused** while `index.html` carries 8 `<noscript>` blocks, so the no-JS
  path is likely already broken. Worth a look before deletion.

---

### SQ-05 addendum — what the audits actually found · 2026-09-09

**Colour: 497 raw hex occurrences outside `:root`, not 65.** More important than the count
is the shape — **318 of them sit inside `var(--token, #fallback)` calls, not bare
literals**, which splits three ways:

| kind | count | status |
|---|---:|---|
| fallback matches the real token | 134 | dead code, harmless |
| fallback names a real token but a **wrong** value | 150 | dead today, a landmine the moment the token is ever unset |
| fallback names a token that **is never defined anywhere** | 34 | **always live** — functionally a raw literal |

The 34 reference `--paper`, `--white`, `--paper-soft`, `--brand-ink`, `--surface-muted`,
none of which exist in any stylesheet. Those are the ones to fix first: they are not
fallbacks, they are the actual painted value, wearing a token's name.

One new token is justified: **`--on-accent: #ffffff`** — the colour of text and icons
painted *onto* a solid `--accent`/`--ink` surface. 56 occurrences, currently invisible in
the audit because its value happens to equal `--surface`; the job is different, and the
two will diverge the first time anyone darkens a button. Contrast 4.95:1 on `--accent`,
17.93:1 on `--ink` — both pass.

The near-white tint tail turned out **not** to be one job spelled eleven ways: it resolves
to five existing tokens (`--bg`, `--surface-soft`, `--accent-tint`, `--surface-2`/`--panel`,
`--panel-cool`). No new token needed there. Two rules also contradict their own siblings —
`style.css:319`/`384` hard-code white where `:1678`/`1682` use `var(--ink-inverse)` for the
same selectors. One latent accessibility bug surfaced: a dead `#777777` fallback on blog
muted text sits at **4.48:1**, a fail, fixed by collapsing it to `--muted` (5.88:1).

**`!important`: 79, not 67** (one grep line held three declarations; one match was inside a
comment). The reassuring part is the classification:

| bucket | count |
|---|---:|
| no competitor at all — pure noise | 14 |
| competitor loses on specificity or order anyway | 60 |
| competitor would genuinely win — needs a paired fix | 5 |
| fighting something outside the cascade (UA, inline JS, third-party) | **0** |

**74 of 79 delete with zero rendering change.** Nothing is defending against Crisp, Stripe,
Turnstile or a UA default — verified, not assumed. The 5 real ones share one shape: the
loser already has equal-or-higher specificity but its sibling is *also* `!important`, so
importance decides. Each is fixed by stripping the flag from the named sibling in the same
change: `style.css:448`+`:1771`, `style.css:3353`+`:3347`, `story.css:1459`/`:1460`+
`style.css:477`/`:480`, `customer-chat.css:137`+`:123`.

---

## Phase 2 — Revenue surfaces

### SQ-11 — PDP has no product image above the fold · CRITICAL

**Problem.** On `/products/crhd` the first screen is eyebrow, H1, four chips, a link, a
price card and a paragraph. No photograph of the product appears anywhere in the buy zone.
The first image on the page is 750px down and is a generic "Built for real work" scene,
not the bottle. The buy zone has no visible size selector and no quantity control. The
price card stacks four elements saying three things: `$14.49`, `1 GAL`, `Case of 4 saves
$5.80 (10%)`, `$14.49/gal` — the last repeats the first verbatim for every 1-gallon SKU.

Also on this page: the trust chips (`MARINE LINE`, `HMIS 0-0-0`, `REPLACES …`,
`AVAILABLE …`, `See 2 real job results`) are five different pill shapes with mismatched
internal padding and ragged right edges. And CR HD — a warehouse and kitchen degreaser —
is labelled `MARINE LINE / Marine Degreaser` while the same page lists "Grease traps,
drains, and commercial kitchen hoods". Merch data mismatch, worth checking across SKUs.

**Fix.** Conventional two-column PDP: gallery left (packshot, label crop, in-use photo),
buy box right (name, price, size select, quantity, add-to-cart, then trust chips).
Suppress the `/gal` chip when it equals the headline price. Normalise the chips to one
component. Verify the line/category assignment per SKU.

**Acceptance.** Product image visible above 700px on a 1440×900 viewport. Add-to-cart
visible without scrolling. One price statement, plus case savings.

### SQ-12 — Buy controls are hard to find, even for buyers · CRITICAL

**Correction from the review.** The missing add-to-cart observed during the audit was
correct behaviour: `commerceActionHTML()` in `js/main/commerce-ui.js` swaps the buy control
for "Manage catalog" when `document.documentElement.dataset.accountKind === "staff"`, and
the audit ran on an admin account. That gate is right and stays.

**What remains a real problem.** Even for a signed-out buyer, the purchase affordance is
weak. On `/products`, each card's visible action is the text link "See how it works" or
"See details" — buying requires a detail-page round trip. On the PDP the buy control sits
below a chip stack rather than in a buy box. For a 15-SKU catalogue of re-ordered
consumables, quick-add on the card is the highest-leverage commerce change available.

Secondary: because the storefront cannot be evaluated from a staff session, nobody on the
team can QA the buyer experience without a second browser profile.

**Fix.**
- Size-select plus add-to-cart on every grid card; "See details" demoted to a text link.
- Buy box on the PDP per SQ-11.
- Staff-only "preview as buyer" toggle so the buyer surface is reviewable in-session.

**Acceptance.** A signed-out visitor can add a product to cart from `/products` without
leaving the page. A staff member can view the buyer storefront via the toggle.

**Measured 2026-09-09, signed out, against the LIVE catalog API** (proxied from masest.co —
a stub catalog has previously invented fake defects here). `accountKind` reported `guest`,
so this is the real buyer surface:

- **Quick-add already exists and already mounts on all 15 cards.** `commerceActionHTML`'s
  `variant === "quick"` branch renders a `.shop-card-quick-add` button wired to
  `data-cart-add`. This part of the fix is built. The audit never saw it because the staff
  branch swaps it for "Manage catalog".
- **But it is a 44×44 icon with no visible label.** The `.shop-card-quick-add-copy` span
  reading "Quick add 1 gal" computes `opacity: 0; visibility: hidden` — it is revealed on
  hover. **There is no hover on touch, so a phone buyer never sees the label at all.**
  Rendered, it is a white circle on a pale teal image, reading as a decorative badge.
  This is precisely the "difficulty to find where to add to cart" the owner reported, and
  it survives the admin-account explanation.
- **No size selector on the grid.** `.commerce-vol` count on `/products` is **0**. A buyer
  can only quick-add the default 1 gal; any other size still costs a detail-page round
  trip. This half of the finding is genuinely not built.

**Revised fix.** Do not build quick-add — label it. Give the existing control a persistent
visible label and buy-control affordance, and add the size select next to it. The staff
"preview as buyer" toggle is unchanged and still needed.

### SQ-13 — Grid cards ~700px tall, nothing aligns across a row · HIGH

> **REVISED 2026-09-10 — height target moved from ≤440 to ~490. The `.shop-card-savings`
> chip stays.**
>
> Cards measure **488px** (media 187 + body 130 + buybar 147), identical at 1440×900,
> 1440×1200 and 1280×900. The chip's true vertical cost is **41.6px**, not the 49px
> assumed — so removing it lands at **446.4px and still misses ≤440 by 6.4px**. The target
> also predates the card: it was set before SQ-12 added the size select and the persistent
> add-to-cart label.
>
> No card-height assertion exists anywhere in `tests/`. The chip is pinned three times in
> `tests/product-case-savings.test.mjs` under *"case savings use linked account-effective
> prices, never a hard-coded claim"* — a deliberate revenue feature wired to real pricing.
> If height is revisited, the 49px lives in the 187px media block and 147px buybar. See `decisions-pending-2026-09-10.md` for the full measurement and reasoning.


**Problem.** Each card stacks eleven blocks: badge overlay, image, eyebrow, title,
description, price, savings chip, per-unit chip, FITS list, RESULTS paragraph, link.
Eyebrows wrap to two lines on some SKUs and one on others; FITS wraps to one, two or three.
Everything below therefore sits at a different height per column.

```
same grid row, /products
"See how it works" baseline:  333 · 313 · 313 · 308 px
price block top:              425 · 404 · 404 · 398 px
card height ≈ 700–760px → 15 products ≈ 3,000px of grid
```

Three card-level defects ride along:
- The overlay badge duplicates the title beneath it ("VertKleen mineral cleaner" above
  "VertKleen CIP HCR").
- **"See details" is set inside the RESULTS sentence**, so the link reads "…backed by
  brewery and HVAC results *See details*". It is also under 32px tall — one of 16
  sub-32px tap targets on the page.
- **All 15 cards contain duplicate links to the same href** (image, title and CTA), which
  dilutes the link signal and triples keyboard traversal.

**Fix.** Fix the card to a strict grid — image / eyebrow (1 line, clamped) / title (2
lines, clamped) / price / one action. Move FITS and RESULTS to the detail page. Target
380–420px. Drop the badge. Make the whole card one link, with the CTA a non-anchor
affordance inside it.

**Acceptance.** All cards in a row share identical element baselines. Card height ≤ 440px.
One `<a>` per card. No interactive target under 32px.

**Measured 2026-09-09, signed out, live catalog:**

| claim | measured |
|---|---|
| card height 700–760px | **916–918px** — worse than the audit estimated, against a 440px target |
| duplicate links per card | **3**, not 2: `.shop-card-media`, `.shop-card-link`, and the `.shop-card-cta` inside it — all to the same href |
| sub-32px tap targets | **16**, confirmed |
| "See details" inside the RESULTS sentence | confirmed — renders "…in place of conventional caustic **See details**" |
| the `/gal` chip repeats the headline price | confirmed — `$25.99` headline, `$25.99/gal` chip, on the same card |

Visually the dominant action on the card is the teal "See how it works →" at 165×34px,
while the actual buy control is the unlabelled icon described in SQ-12. The card advertises
reading, not buying.

### SQ-14 — "Recommended" sort has no discernible order · MEDIUM

Default order runs $25.99, $25.99, $28.99, $28.99, $20.49, $14.49, $14.49, $21.99, $19.99,
$16.99, $18.99 — not price, not alphabetical, not category. Make "Recommended" mean
something explicit (best sellers, then breadth of use) or rename it to what it is.

### SQ-15 — `/products` spends 1,200px before the first product · MEDIUM

Three-line 96px headline, paragraph, four stat chips, a collapsed "Buying details"
accordion, the filter bar, then the grid. Page total 6,422px for 15 SKUs. Compress the
hero to headline plus one line; get the first product row into the opening screen.

### SQ-16 — Product imagery inconsistently framed · MEDIUM

> **REVISED 2026-09-10 — scope reduced to one image. Sub-claim 1 is misattributed.**
>
> **The homepage renders no product cards** (`shop-card` × 0, `shop-grid` × 0,
> `data-commerce` × 0 in production HTML). The images described are the six *story*
> product shots, and they already follow one framing rule: all 900×1200, subject height
> **90.4–97.8%** (spread 7.3 points), subject width **78.0–80.3%** (spread 2.3 points).
> There is no "small centred bottle" — the smallest subject fills 90.4% of frame.
>
> **One real defect:** `alumibrite-studio` has a **0.0% bottom gap** where its four
> siblings sit on 3.1–4.7%. Re-export to a 3–5% bottom margin. Note the file is **R2-only**
> — not in the repository — so this is a media operation, not a commit.
>
> **The shelf photo is left as-is by decision.** `product-line-2026-enhanced.webp` is
> **1200×900**, not "1,300px wide", and has already had an enhancement pass. The
> substantive complaint is device-pixel ratio, not source quality. See `decisions-pending-2026-09-10.md` for the full measurement and reasoning.


Grid packshots are consistent and good. Homepage product cards are not: one is a label
crop enlarged past its frame and cropped top and bottom, the next is a small centred
bottle in the same box. The homepage also runs a low-resolution shelf snapshot at 1,300px
wide with unreadable label text, captioned as bottling provenance. Adopt one framing rule
— same bottle height as a share of frame, same baseline, same margin — and re-shoot or
drop the shelf photo.

### SQ-17 — Legacy product URLs 404; grid links are relative · MEDIUM

`/product.html?sku=cr-hd` returns the not-found page, so any old link, bookmark or indexed
URL in that shape is dead. Separately the grid emits 87 relative hrefs of the form
`products/cr` — correct from `/products`, but resolving to `/products/products/cr` from
any path with a trailing slash. Add a redirect and make hydrated commerce links
root-absolute.

### SQ-21 — 4.76s to first paint · CRITICAL

DOM content loaded at 497ms. First contentful paint at 4,760ms. Over four seconds of blank
screen after the document was ready, on a repeat visit, on a fast connection.

```
duplicate requests on /products
2×  /api/account/me           1,169ms + 1,722ms
2×  css/style.css             once bare, once ?v=20260829b  → 242KB twice
2×  js/main/engagement.js
2×  js/image-url.js
2×  crhd-studio.webp, cip-cr-studio.webp, hvac-cr-studio.webp, hvac-hcr-studio.webp
5×  cloudflareinsights RUM beacon
5 render-blocking stylesheets · 79 requests · img/ = 7.5MB
```

Three stacked faults:
- **`style.css` fetched twice** — once unversioned, once with `?v=`. Two URLs, two cache
  entries, 242KB duplicated on a cold visit. Same bug for two JS modules.
- **`/api/account/me` requested twice**, 2.9s of combined latency. Six modules call it
  independently (`auth`, `dashboard`, `checkout`, `business`, `customer-chat`,
  `staff-surface`) with no shared promise.
- **Product images fetched twice each**, presumably a re-render replacing `src` after
  hydration.

Fix: single-flight the account fetch behind one cached promise; remove the unversioned
`style.css` link and align module URLs; inline the critical shell CSS and defer the rest;
compress the two 400KB+ proof webps.

**Acceptance.** FCP under 1.5s on a warm cache. Zero duplicate resource URLs. One
`/api/account/me` per page load.

**Diagnosed 2026-09-09 — one headline cause is refuted and another is worse than reported.**

- **`style.css` fetched twice: REFUTED.** Every HTML entry point, all five generators
  (`seo-inject`, `build-blog`, `gen_industries`, `gen_comparisons`, `build-industry-pages`)
  and the built `dist/products.html` emit the versioned URL consistently. No bare
  reference, no `@import`, no JS-injected `<link>`, no `Link:` header exists. This was a
  stale CDN edge entry or a mid-deploy version skew — the same rollout-window artifact
  already recorded as a trap in this project's notes. **0% of the 4,760ms.**
- **Duplicate JS modules: CONFIRMED.** `js/content-types.js:1` imports `"./image-url.js"`
  unversioned while three other files import it versioned; `js/main/commerce-ui.js:4`
  imports `"./engagement.js"` unversioned while `js/main.js:17` imports it versioned. Two
  URLs means two fetches **and two module instances** in one page's graph.
- **`/api/account/me` twice: CONFIRMED, but not render-blocking.** `js/auth.js:137` `me()`
  has no caching; `js/account-nav.js:135` and `js/customer-chat.js:60` each import it and
  call independently. Both are async and off the paint path — `js/checkout.js:303-307`
  already documents avoiding this. Fix: memoise a single-flight promise, mirroring
  `loadCommerceCatalog()` at `commerce-ui.js:273-276`. Worth ~5-10%, not the headline.
- **Product images: 3-5×, not 2×.** `initShop()` calls `apply()` **three times
  unconditionally** — immediately, after the catalog resolves or fails, and after the
  marine catalog resolves — and `apply()` does `grid.innerHTML = …`, a full rebuild that
  creates brand-new `<img>` nodes each time rather than patching `src`. ~25-30%.
- **The actual paint blocker: the render-blocking chain.** `/products` serialises four
  synchronous stylesheets, `/` five. `vendor/phosphor/style.css` uses `font-display: block`
  and is **never preloaded** — only Satoshi gets a build-injected preload in
  `tools/cf-build.mjs`. Because `main.js` is `type=module` and therefore deferred,
  DOMContentLoaded fires without waiting on CSS, which is exactly how DCL lands at 497ms
  while paint stays blocked past 4s. ~40-50%.

**Order to land:** Phosphor preload first (smallest change, targets the chain that gates
all paint), then the `apply()` triple-render, then the two import specifiers, then the
`me()` memo.

---

## Phase 3 — Front door

### SQ-06 — Five pinned scenes, 3,679px, before the first product · CRITICAL

> **REVISED 2026-09-10 — target withdrawn. Six scenes stay; the story is not capped at
> ~2 screens.** The six-scene / 80–88vh contract was reaffirmed `23260bc8` on 2026-09-03,
> four days after this review. Cutting to three would touch 14 files including six test
> files and two blog posts that reuse the scene imagery.
>
> **"Distance to first product" is retired as a homepage KPI.** The story *is* the hero,
> and the nav's first link is **Products**, which is where the catalogue comes from anyway
> (no `shop-card` in the shipped homepage HTML — commerce hydrates via JS). Scroll depth
> does not gate purchase. Judge the story on persuasion quality, not length.
>
> **Three of the four sub-claims below are measured stale:** no product-name clipping
> (identity bottom 751 / product 755 against a card bottom of 773); the sticky bar carries
> two links plus a context label in a **52px** strip, not "four competing actions in 40px";
> the left column fills **76–94%**, not 60% — the apparent emptiness is the crossfade
> showing two vertically-offset scenes at once. Do not re-raise on these grounds. See `decisions-pending-2026-09-10.md` for the full measurement and reasoning.


The homepage is 11,427px — 15.7 screens. The scroll-scrubbed story occupies the first
3,679px as six pinned scenes numbered 01–06; reaching the product line-up took 24 wheel
notches. Scenes reuse one layout (eyebrow, two-line headline, paragraph, caption,
before/after slider), so scenes 2–6 deliver diminishing information at constant cost.

Inside the sequence:
- The media card's bottom edge **clips the product name** in every scene — "VertKleen
  CRHD", "VertKleen Descaler", "VertKleen AlumiBrite" all cut through the descenders.
- The left column runs out of content around 60% height in scenes 1–4, leaving a large
  empty block beside a 690px image.
- The sticky sub-bar carries four competing actions — "Skip comparisons", "View all six
  results", "Shop CRHD", "Try it" — in a 40px strip.

Fix: cut to three scenes, cap the story at ~2 screens, and put a real product row (image,
name, price, add-to-cart) above it or immediately after.

### SQ-07 — Content reached by jump or back-navigation renders invisible · CRITICAL

Reveal-on-scroll only fires for sections crossed during a live scroll. Jump to an anchor,
restore a scroll position with the back button, or deep-link mid-page, and the sections
below sit at roughly 15% opacity — legible in a screenshot, unreadable on screen.
Everything below "Different messes need different cleaners" was ghosted in this state
during the review.

Compounding it, `scroll-behavior: smooth` is set inline on `<html>`, and while the story
is pinned, programmatic scrolls past it are swallowed: `scrollTo(0, 8000)` left `scrollY`
at 2420 after 900ms. Any in-page link targeting content below the story is unreliable.

Fix: make the visible state the resting state and animate as enhancement — elements start
opaque, the observer adds a class that plays the entrance. Anything never observed is then
already correct. Drop the global smooth scroll or scope it to the story's own controls.

### SQ-08 — Proof panels disclose that the imagery is reconstructed · OWNER DECISION

> **RESOLVED 2026-09-10 — no change. The premise was wrong, and in the opposite direction
> to what this finding assumed.**
>
> The after-frames are **retouched originals** — real photographs of the real result,
> cropped and graded for presentation. Pixel evidence: in all six story scenes the BEFORE
> and AFTER originals have **different dimensions** (separate photographs, independently
> cropped; `cip-vessel` 1200×1600 vs 1600×1200 and `pool-cartridge` 686×1229 vs 1220×648
> are shot 90° apart), and per-pair change is spread across 25–30 of 64 tiles — global
> grading, not locally painted-in cleanliness.
>
> The disclosure this finding quotes ("After frame digitally reconstructed from source
> photo") **overstated what was done** and was removed by `e933983b` on 2026-09-09. That
> removal was a correction. "Photo proof" stays; the component is not relabelled.
>
> The enhancement filter `saturate(1.03) contrast(1.07) brightness(1.02)` applies to
> `.photo img, .proof-card figure img` only — the story receives none of it. See `decisions-pending-2026-09-10.md` for the full measurement and reasoning.


Each before/after card is labelled **"Photo proof"** and carries, in 9px grey type at the
bottom edge, **"After frame digitally reconstructed from source photo."** A claim of
photographic proof and a disclosure of digital reconstruction in the same component is a
contradiction a competitor or a procurement officer could reasonably raise — and it is the
load-bearing trust element of the homepage.

Options: (a) replace reconstructed frames with unretouched originals and keep the "photo
proof" claim; (b) keep the reconstructions, relabel the component "Illustrated result",
and move the disclosure to legible size next to the label. Either way, audit the
`/proof` case-study photos the same way.

**Blocked pending owner ruling.**

### SQ-09 — Four consecutive sections make the same argument · HIGH

In order: "Different messes need different cleaners" → "Start with the cleaner you want to
replace" → "Move away from hydrochloric acid / Move away from caustic cleaners" → "The
VertKleen line, by the job it replaces". Four sections, ~4 screens, one idea: pick the
product that matches your soil. Merge into one "Find your cleaner" block — the two
replacement cards plus the product grid. Recovers ~3 screens.

### SQ-10 — Case-study cards render with empty image wells · HIGH

In "Results from real dirty jobs", the large left card and the thumbnail on
"Drone-applied building wash" both render as blank bordered boxes. The layout reserves the
space correctly so nothing shifts, but the section whose entire job is showing evidence
shows none. Trace the case-record image path; collapse the card to text when a case has no
image rather than rendering an empty frame.

### Phase 3 addendum — what measurement found · 2026-09-09

Corrections to the four findings above, each verified against **production** as well as the
branch. Full evidence in `docs/handoff-design-system-2026-09-09.md`.

| claim as written | measured |
|---|---|
| SQ-06 "five pinned scenes, 3,679px" | **six scenes, 4,030px** (6 × `84vh`) |
| SQ-06 "media card clips the product name in every scene" | **no clipping.** identity 751 / product 755 / card bottom 773 |
| SQ-06 "sticky sub-bar carries four competing actions in a 40px strip" | **two links + a context label in 52px.** `.story-skip` is not sticky; the 01–06 rail is a separate gutter |
| SQ-06 "left column runs out of content around 60% height" | **fills 76–94%.** The gap is the crossfade showing two vertically-offset scenes at once |
| SQ-07 "sections below sit at roughly 15% opacity" | **not reproducible.** 11 scenarios — 9 anchors, back-nav restore, reload at depth — zero ghosted elements on screen |
| SQ-07 "`scrollTo(0, 8000)` left `scrollY` at 2420" | **drift is −12 to −44px**, and 0 at 2,000 and 4,000 |
| SQ-09 "four consecutive sections" | **three.** The fourth is the two cards *inside* the second |
| SQ-09 "recovers ~3 screens" | **673px (0.75 screens)** for the merge |
| SQ-10 "cards render with empty image wells" | **all 13 homepage images render in production** once scrolled into view |

Two of the prescriptions are also unsafe as written:

- **SQ-06's fix is blocked by two source contracts.** `tests/story-contract.test.mjs`
  pins each act to 80–88vh and the total to 480–520vh — a floor of 4.8 screens against a
  target of ~2 — and six scenes are pinned by that file plus
  `tests/story-six-comparisons.test.mjs`, over owner-approved imagery. The bound was
  reaffirmed 2026-09-03, four days before this review. **Owner ruling required.**
- **SQ-09's fix would delete evidence and fail a test.** Keeping only "the two replacement
  cards plus the product grid" drops the water-systems route and the 280× corrosion claim,
  which exist only in the discarded section — and `homepage-marketing-proof.test.mjs`
  asserts that claim sits beside its evidence link. The merge shipped with three cards.

SQ-10's symptom has a specific cause worth recording: `tools/test-media-isolation.mjs`
substitutes a 1×1 transparent PNG for every managed R2/Supabase image unless
`MASEST_LIVE_MEDIA=1`, and `cf-build` never publishes `img/` at all — it rewrites those
references to `media.masest.co/site`. A source-tree server therefore shows 179 broken
images that are all fine in production.

---

## Phase 4 — Operations

### SQ-18 — Catalog rows 275px tall with empty thumbnails · HIGH

Each product in the Products tab renders as a card containing a blank grey image well,
"Choose primary" and "Add gallery image" stacked beneath it, an SKU chip and name to the
right, an Active checkbox, and filled **Save** and **Remove** buttons far right — with
~700px of empty space between. Fifteen products is ~4,000px of scrolling.

Two specific defects: thumbnails are **blank for every product** even though the public
grid renders the same packshots correctly; and **Save is a filled primary button on all 15
rows at once**, so the eye has fifteen equal calls to action and no way to tell which row
is dirty.

Fix: make it a table — 48px thumbnail, SKU, name, price, active toggle, row menu. Expand a
row inline to edit. Disable Save until the row changes.

### SQ-19 — Orders show the same status twice, in two styles · MEDIUM

Every order card carries **LIFECYCLE: CANCELLED / Closed** and, 200px right, **STATUS:
CANCELLED** — one fact, two pill treatments. The four label/value columns sit at
inconsistent widths with labels on mismatched baselines (ITEMS at y-461, LIFECYCLE at
y-431), so the row does not read as a row. Money is formatted `USD 10.40`; in a
single-currency store `$10.40` is shorter and scans faster (keep the ISO code for exports).

Fix: one status column, table layout with fixed column widths, `tabular-nums` on money,
and Saved-view controls behind a disclosure instead of holding 100px permanently.

### SQ-20 — Sidebar clips instead of scrolling; overview grid leaves a dead column · MEDIUM

The nav panel scrolls with the page and cuts off mid-item — "Reviews" is sliced by the
panel's bottom edge — so lower tabs are unreachable without scrolling the content area. On
Overview the third column holds one tall card then nothing for two rows, while KPI values
right-align at a different x in every card because the label wraps and pushes them.

Fix: `position:sticky; top:0; height:100dvh; overflow-y:auto` on the sidebar. KPI cards
become a two-column grid with a fixed value column and `tabular-nums`, so every number in
every card shares one edge.

---

## Phase 5 — Content

### SQ-22 — 60 images without a loading attribute · MEDIUM

> **DO NOT IMPLEMENT — measured 2026-09-10. The correct number of images that should gain
> `loading="lazy"` is ZERO.** This finding counts a deliberate and correct loading strategy
> as a defect.
>
> 378 shipped `<img>`, 83 without a `loading` attribute. All 83 decompose:
>
> | group | n | why it has no `loading` |
> |---|---|---|
> | inside `<noscript>` | 12 | never fetched when JS runs; the attribute is inert |
> | `fetchpriority="high"` | 68 | each page's designated LCP image — lazy-loading it is a **performance regression** |
> | `checkout.html` logo | 1 | first image, above the fold |
> | `index.html` #1, #2 | 2 | the story object's after-frame and product shot, in the same above-the-fold card |
>
> `index.html`'s "15", which this spec says to do first, is **12 noscript fallbacks plus
> the 3 above-the-fold images of the opening comparison card**. None of them should be
> lazy. Alt text and explicit `width`/`height` are already complete across all 378, so CLS
> is handled, and 70 images already carry `fetchpriority`.
>
> The durable version of this finding is an invariant, not an edit: *every image without
> `loading="lazy"` must be an LCP image, a `<noscript>` fallback, or the first image on its
> page.* That holds today on all 83.


Alt text and explicit dimensions are complete across all 199 images — genuinely rare, and
it means CLS is already handled. But 60 images carry no `loading` attribute, so below-fold
media competes with the hero for bandwidth. Add `loading="lazy"` below the fold and
`fetchpriority="high"` on the LCP image.

### SQ-23 — Head hygiene: four remaining gaps · MEDIUM

Across 64 pages: zero duplicate titles, zero duplicate descriptions, one `h1` on 63 of 64,
JSON-LD on every public page, canonical and OG on every indexable page. Strong baseline.
Remaining:

- **36 titles exceed 60 characters** and will truncate in results; 12 are under 30 and
  leave room unused.
- **`checkout.html` has two `h1` elements.**
- **`content-preview.html` has no meta description.**
- Ten pages lack canonical and OG — correct for `/cart`, `/checkout`, `/dashboard`,
  `/account`, `/admin`; worth adding for `404.html` and `review.html`.

Rewrite the 36 long titles to 50–58 characters front-loaded with the query term, and add a
source-contract test enforcing title length at build time.

### SQ-24 — 35 posts averaging 405 words, all bylined "MASEST Team" · HIGH

Every post is a 350–500 word stub. In a technical B2B niche where competing results are
1,500-word engineering guides, that length does not compete regardless of quality. The
uniformity is visible: 11 posts share the publish date 3 Aug 2026, another 8 share 7 Sep
2026 — batch publication readable by a visitor and a crawler alike. Every post is bylined
"MASEST Team" with no author entity, forfeiting the experience and expertise signals
Google's helpful-content guidance rewards, in a category where there are real field results
to attach a name to.

Fix: stop publishing new stubs. Expand the eight highest commercial-intent posts (CR HD
comparisons, Walmart case studies, HMIS 0-0-0) to 1,200+ words with dilution tables,
cost-per-job maths and named results. Byline to a real person with a bio and `Person`
schema. Consolidate the remaining thin posts into pillar pages rather than deleting them.

### SQ-25 — Prose reads as generated because the rhythm never varies · HIGH

The obvious AI vocabulary is already gone. Across 34,868 words there is not one instance
of *leverage*, *seamless*, *robust*, *delve*, *comprehensive*, *cutting-edge*, *unlock*,
*elevate*, *navigate the landscape*, *it's worth noting* or *whether you're*. That work was
done and it shows.

What gives the writing away is that every sentence is the same length as every other.

```
sentence-length coefficient of variation, 35 posts
range 0.33 – 0.48 · median 0.40      (human editorial prose: 0.55 – 0.85)
mean sentence length 12.3 – 15.3 words in every single post
contractions across ~14,000 words: 16   (20 of 35 posts contain zero)
H2 headings 260 · questions among them 0 · mean length 5.9 words
paragraph openers: the×80 · MASEST×52 · a×49 · Choose×41
paragraphs repeated verbatim in all 35 posts: 2
```

The second tell: the prose describes without committing. "That range reduces product
changes during the shift" and "become operating advantages rather than label facts" are
grammatical and carry no specific claim — no customer, no number, no date, no job that went
wrong. The dilution tables are the only concrete artefact in the sample post, and they are
the best thing in it.

Fix: vary length deliberately (after any sentence over 20 words, write one under 8; target
CV above 0.55). Use contractions — this is trade writing for maintenance crews, not a
datasheet. Make one heading in three a question. Ground every section in something
specific: the plant, the surface, the failed prior product, the measured result. Delete the
two boilerplate CTA paragraphs repeated across all 35 posts. Rewrite two posts by hand as
the voice reference, then edit the rest against it.

---

## Verified-good baseline — do not regress

| Check | Status |
|---|---|
| Images with alt text | 199 / 199 |
| Images with explicit width and height | 199 / 199 (CLS already handled) |
| Duplicate `<title>` across 64 pages | 0 |
| Duplicate meta descriptions | 0 |
| Pages with exactly one `h1` | 63 / 64 |
| JSON-LD on public pages | complete |
| AI-vocabulary tells in 34,868 words | 0 |
| Server response (TTFB) | 439ms |
| Staff/buyer surface separation | correct, gated on `can_admin` |

## Not covered by this review

Buyer-side cart and checkout were not exercised live: staff accounts are correctly refused
those surfaces, so a non-staff session is required. SQ-12 adds the toggle that makes this
reviewable in future passes.
