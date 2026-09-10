# Elevation semantics proposal — 2026-09-10

Design document only. No CSS in this repo is changed by this proposal; every
"move" recommended below is a suggestion for a follow-up PR, explicitly
flagged, never applied here.

## 0. What this is, and what it deliberately is not

`tools/surface-token-migrate.mjs`'s header comment (read in full before writing
this) already settled the hard question: shadows on this site are **four
unrelated jobs**, not one scale —

1. layered "material" elevation — `--shadow-xs/sm/md/lg` (two-layer, three
   with negative spread)
2. single-layer "cast" shadows — `--shadow-cast-sm/md/lg` (zero-spread,
   ink-tinted, added today per the comment block at `css/style.css:107-124`)
3. focus/selection rings — `--ring`, `--ring-soft`, `--ring-tight` (hard
   spread, no blur — not a shadow)
4. inset bevel highlights — `--highlight-top`

That split is not revisited here. A strict four-dimensional match (y ±2, blur
±4, spread ±4, alpha ±.03) fits **zero of 46** light-surface literals to any
`--shadow-*` token; 38 fail on layer count alone. 61 distinct raw `box-shadow`
literals remain frozen by `tests/surface-shadow-freeze.test.mjs`. This
document does not try to snap those onto a nearest token — that mechanical
approach is the one the migration tool's own history rejected at "2.5M changed
pixels." What nobody has decided yet is **what elevation means per
component** — which surfaces deserve which family, and why. That is the gap
this document fills.

### Method

Every claim below is a measurement, not an impression:

- **Inventory**: parsed every `box-shadow` declaration in `css/*.css` (158
  declarations across 7 files, excluding `none`) and paired each with its
  owning selector by brace-depth tracking, not eyeballing. Breakdown: 55 uses
  of `--shadow-xs/sm/md/lg`, 15 uses of `--shadow-cast-sm/md/lg`, 11 uses of
  `--ring*`, 3 uses of `--highlight-top`, 10 uses of a token-with-fallback
  form (`var(--shadow-md, <literal>)`), and 64 raw literals (61 distinct,
  matching the freeze test).
- **"Wrong level" claims are cascade or color facts, not visual guesses.**
  Where a component is flagged as mismatched, the finding is either (a) a
  verified CSS cascade outcome — same selector, same specificity, no
  `!important`, no `@layer`, so the later declaration in source order is the
  one that renders and the earlier one is dead — or (b) a verified background
  color (an `--ink`-background surface using a teal-tinted token, contradicting
  the rule the codebase already wrote for itself for `--shadow-dark-*`). No
  finding here is "this looks a bit off."
  - The formatting `.selector { … }` is stated as unguarded when a brace-depth
    walk confirmed the rule sits at file scope, not inside any `@media`.
- **No mechanical snapping.** Nothing below proposes moving a literal to
  "whichever token has the nearest blur." Every proposed token assignment is
  justified by the component's *behavior* (does it lift on hover? does it sit
  on a dark background? is it a topmost overlay?), and every proposed change
  in *family* (cast ↔ material) is called out as a visible change, not framed
  as free cleanup.
- **The ≥3-use convention holds.** Per the migration tool's own rule ("every
  proposed token is used at least three times... the genuine one-offs stay
  literal"), nothing here proposes a token for a value used once or twice.

---

## 1. Elevation roles

Nine roles cover every component in the inventory. They are named for what
the surface *does*, not for a pixel value.

| # | Role | Purpose | Default family |
|---|------|---------|-----------------|
| R1 | **Flat / Inline** | No elevation. Most of the site — text, chips inside a card, table cells, badges. Not enumerated below; it is the default every other role departs from. | none |
| R2 | **Field & Control Focus** | An input, select, or control gaining keyboard/pointer focus. The affordance is "you are here," not "this is lifted" — so it is a **ring**, never a shadow. Weight (`--ring` / `--ring-soft` / `--ring-tight`) scales with the control's density and the cost of getting it wrong, not with any elevation ladder. | ring |
| R3 | **Resting Surface** | A static, non-interactive block that just needs to read as its own surface rather than bare background. Never gains a hover shadow — if it did, it would be R4. Weight scales with structural prominence: a small fact chip earns `xs`/cast-`sm`, a structural panel (hero media, cart summary, a form wrapped in a card) earns `sm`/`md`, and a callout that must anchor attention regardless of scroll position (a stat claim, a safety/HMIS panel) earns `lg`. | material or cast, by weight |
| R4 | **Interactive Card** | A card in a grid or list that *is* the click target, or contains one that the whole card should visually invite. Rest state is a light lift; hover promotes it one step, signalling "pick me up." | material `xs → md` (see §3 for cast-family members proposed to move here) |
| R5 | **Pressable Control** | A button or pill. Same rest→hover step logic as R4, sized for a control rather than a content card; press depth is handled separately via the `scale` property (`css/style.css:8293-8296`), so the shadow ladder only has to carry the lift, not the push. | material `xs → sm` or `sm → md` |
| R6 | **Dark-Surface Card** | Any R3/R4/R5 member whose background is a solid `--ink` (or comparably dark) fill. A teal-tinted shadow disappears against near-black — this is the exact reasoning `--shadow-dark-sm/md/lg` were built for (`css/style.css:117-121`). Membership in this role overrides the family choice from whatever role the component would otherwise sit in. | `--shadow-dark-*` |
| R7 | **Sticky Chrome** | The nav bar and its flyouts. Weight escalates with commitment: a near-invisible resting hairline, a soft lift once scrolled, heavier still when it opens as a mobile flyout or sits over a dark hero. | material for the light case, neutral literal for the dark case (see R6 reasoning) |
| R8 | **Overlay / Modal** | The topmost floating layer — a true modal, a native `<dialog>`, a lightbox. Regardless of context (admin vs. storefront), this should read as one consistent maximum weight. | `--shadow-lg` |
| R9 | **Floating Popover / Widget** | A persistent floating utility — chat widget, support widget — and its panel/toggle/message parts. Neutral ink only, **never** brand-tinted (a chat bubble is not a marketing surface). | literal today (see §4) |

Two more groupings sit outside the elevation ladder entirely and are handled
in §4 rather than as roles: **brand glow** (a hue-carrying accent shadow that
must never enter the neutral ramp) and **narrative one-offs** (bespoke
scrollytelling elements in `story.css`).

---

## 2. Component → role → token mapping

Status column: **clean** = already on the role's target token/family, no
change proposed. **visible change** = proposed move, flagged for approval,
detailed in §3. **keep literal** = correctly a one-off per the ≥3-use rule.

### R2 — Field & Control Focus (11 ring uses + 2 related literals)

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.field input/select/textarea:focus-visible` | style.css:1226 | `var(--ring-soft)` | `--ring-soft` | clean |
| `.newsletter-form input[type=email]:focus-visible` | style.css:1250 | `var(--ring-soft)` | `--ring-soft` | clean |
| `.cart-line input:focus-visible, .cart-input:focus-visible` | style.css:4140 | `var(--ring-soft)` | `--ring-soft` | clean |
| `.foot-news-form input[type=email]:focus-visible` | style.css:1526 | `var(--ring)` | `--ring` | clean |
| `.shop-card-proof-link:focus-visible` | style.css:3468 | `var(--ring)` | `--ring` | clean |
| `.shop-card-add:focus-visible, .shop-card-quote:focus-visible` | style.css:5054 | `var(--ring)` | `--ring` | clean |
| `.commerce-vol:focus-visible` | style.css:5059 | `var(--ring)` | `--ring` | clean |
| `.cart-ship-estimate-row input:focus-visible` | style.css:4021 | `var(--ring-tight)` | `--ring-tight` | clean |
| `.checkout-flow-page .field input/select:focus-visible` | style.css:4410 | `var(--ring-tight)` | `--ring-tight` | clean |
| `.address-autocomplete:focus-within gmp-place-autocomplete` | style.css:4488 | `var(--ring-tight)` | `--ring-tight` | clean |
| `.checkout-rate:has(input:checked)` | style.css:4646 | `var(--ring-tight)` | `--ring-tight` | clean (selection state, not focus, but same "you are here / this is chosen" job) |
| `.search-field input:focus-visible` (components.css) | components.css:287 | `0 0 0 3px var(--accent-soft)` | — | keep literal (2 uses incl. blog, below threshold) |
| `.blog-search-field:focus-within` | blog.css:37 | `0 0 0 3px var(--accent-soft)` | — | keep literal (pairs with the components.css one above; 2 total) |
| `.checkout-flow-page .field input[aria-invalid="true"]:focus-visible` | style.css:4425 | `0 0 0 2px rgba(180,35,24,.14)` | — | keep literal — this is a **danger-colored** ring (validation error), a different job from the accent ring family; 1 use |

**Observation, not a proposed change**: R2's three weights already read as a
coherent hierarchy — `--ring` marks a primary commit action (subscribe,
add-to-cart, quote), `--ring-soft` marks a generic text field, `--ring-tight`
marks a dense control inside the checkout flow. That is a real, load-bearing
distinction; do not collapse it in a future pass.

### R3 — Resting Surface (informational tile weight: xs / cast-sm / cast-md)

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.decision-strip, .quote-assurance` | style.css:1161 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.segment-pricing-facts span` | style.css:5427 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.segment-volume-note` | style.css:5447 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.segment-pricing-note` | style.css:5470 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.service-stats` | style.css:6036 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.data-viz-card` | style.css:6072 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.recommendation-panel` | style.css:6178 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.newsletter-media` | style.css:8171 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.program-scope-visual` | style.css:2448 | `var(--shadow-xs)` | `--shadow-xs` | clean |
| `.catalog-price-note span, .catalog-price-note a` | style.css:5361 | `var(--shadow-cast-md)` | `--shadow-cast-md` | clean |
| `.catalog-quick-facts span, .service-hero-badges span` | style.css:7898 | `0 14px 34px rgba(4, 50, 54, .06)` | — | keep literal today, but see note below |
| `.blog-body .md-table-scroll` | blog.css:87 | `var(--shadow-xs, …)` | `--shadow-xs` | clean |

**Note on `.catalog-quick-facts span`**: its literal shares `.catalog-price-note`'s
purpose (a small pricing/spec fact chip) and is built on the same second ink
base, `rgba(4,50,54,*)`, that recurs across several other cast-family
literals below (`.job-plan-card:hover`, the page-scoped `.shop-card` literal
at 5703/5709, `.services-page .service-catalog-shell`,
`.services-page .service-card:hover`). Five-plus uses of one un-named color
base is exactly the accumulation pattern the migration tool's header warns
about for borders — but it is short of the ≥3-uses-of-one-*value* bar for a
new elevation token today (each blur/alpha combination differs), and
introducing a fifth shadow family is out of scope for this document. Flagging
it so a future token pass (not this one) can decide whether `rgba(4,50,54,*)`
deserves to become a named "cast-heavy" step alongside `rgba(9,46,52,*)`.

### R3 — Resting Surface (structural panel weight: sm / md)

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.nav-logo .logo-mark` | style.css:460 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.contact-hero-media` | style.css:617 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.page-hero-scene-media` | style.css:1286 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.cart-summary` | style.css:3958 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.service-quote-panel` | style.css:5197 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.segment-pricing-media` | style.css:5403 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.services-hero-media` | style.css:5989 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.service-catalog-page .services-hero-media` | style.css:6276 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.service-catalog-shell` | style.css:6306 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.services-final-panel` | style.css:6775 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.service-guide-summary, .service-guide-hero-media` | style.css:6941 | `var(--shadow-sm)` | `--shadow-sm` | clean |
| `.form-card` | style.css:1210 | `var(--shadow-md)` | `--shadow-md` | clean |
| `.checkout-business-options p` | style.css:4558 | `var(--shadow-md)` | `--shadow-md` | clean |
| `.crm-ws-head` | components.css:334 | `var(--shadow-cast-sm)` | `--shadow-cast-sm` | clean |
| `.job-plans-media` | style.css:7643 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.segment-pricing-scroll` | style.css:5482 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.shop-toolbar` | style.css:5663 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.service-guide-card` | style.css:7042 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.product-application-media` | style.css:8834 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.product-static-panel` | style.css:8868 | `var(--shadow-cast-lg)` | `--shadow-cast-lg` | clean |
| `.blog-author` | blog.css:117 | `var(--shadow-cast-sm)` | `--shadow-cast-sm` | clean |
| `.services-page .service-catalog-shell` | style.css:7961 | `0 34px 84px rgba(4, 50, 54, .09)` | — | keep literal (1 use, page-scoped override of the base `.service-catalog-shell` above) |

### R3 — Resting Surface (emphasis/callout weight: lg)

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.zero-card` | style.css:645 | `var(--shadow-lg)` | `--shadow-lg` | clean |
| `.hmis-panel` | style.css:682 | `var(--shadow-lg)` | `--shadow-lg` | clean |
| `:where(.zero-card, .hmis-panel)` (redesign-polish layer) | style.css:8285 | `var(--surface-edge), var(--shadow-lg)` | `--shadow-lg` | clean, but **dead for both members** — see note |

**Note**: `.zero-card` and `.hmis-panel` each already carry their own
higher-specificity `box-shadow: var(--shadow-lg)` rule (lines 645, 682). The
`:where()` "redesign polish" rule at line 8285 has zero specificity, so for
these two selectors it never wins the cascade — it is inert. It is not wrong
(same target token, so no visual bug), just redundant source. Worth a
housekeeping note for whoever next touches that block, not a "visible change."

### R4 — Interactive Card (material family: rest `xs` → hover `md`, unless noted)

| Component | File:Line | Rest | Hover | Status |
|---|---|---|---|---|
| `.bento-cell` | style.css:714/718 | `var(--shadow-xs)` | `var(--shadow-md)` | clean |
| `.prod-card` | style.css:742/745 | `var(--shadow-xs)` | `var(--shadow-md)` | clean |
| `.snap-card` | style.css:1145/1148 | `var(--shadow-xs)` | `var(--shadow-md)` | clean |
| `.row-card` | style.css:1316/1319 | `var(--shadow-xs)` | `var(--shadow-md)` | clean |
| `.contact-card` | style.css:1425/1428 | `var(--shadow-xs)` | `var(--shadow-md)` | clean |
| `.why-col` | style.css:1541/1546 | `var(--shadow-xs)` | `var(--shadow-sm)` (one step lighter than its siblings) | clean — smaller step is fine here; a "why us" row is a lighter-weight card than a product/contact card |
| `.cta-choice.active` | style.css:2617 | `var(--shadow-xs)` | — (no hover escalation; this is a *selected* state, not a hover lift) | clean — a "this option is chosen" cue, correctly the lightest step |
| `:where(.bento-cell, .cat-card, .prod-card, .snap-card, .contact-card, .proof-card, .case-card, .route-card, .resource-card, .service-card, .tier-card, .program-card)` | style.css:8278/8288 | `var(--surface-edge), var(--shadow-xs)` | `var(--surface-edge), var(--shadow-md)` | clean, and **live** for `.cat-card`, `.proof-card`, `.case-card`, `.route-card`, `.resource-card`, `.service-card`, `.program-card`, `.tier-card` — these seven/eight have no other box-shadow rule, so this is their sole elevation source |
| `.blog-body .md-card, .md-card` | blog.css:97/99 | `var(--shadow-cast-sm)` | `var(--shadow-cast-md)` | clean, cast-flavored — see §3 for why this one is *not* proposed to move |
| `.job-plan-card` | style.css:7667/7679 | `var(--shadow-cast-lg)` | `0 24px 58px rgba(4, 50, 54, .1)` | **visible change proposed**, see §3 |
| `.product-comparison-link` | style.css:8904/8935 | `var(--shadow-cast-md)` | `0 14px 32px rgba(9, 46, 52, .1)` | **visible change proposed**, see §3 |
| `.shop-card` (base, catalog grid) | style.css:3589/3600 | `var(--shadow-xs)` | `var(--shadow-md)` | **dead** — see §3, this rule never paints |
| `.shop-card` (second definition) | style.css:5694/5707 | `0 14px 38px rgba(4, 50, 54, .08)` | `0 24px 58px rgba(4, 50, 54, .13)` | **dead** — see §3 |
| `.shop-card` (third definition, live outside products-page) | style.css:7405/7414 | `0 26px 74px rgba(9, 46, 52, .1)` | `0 34px 92px rgba(9, 46, 52, .16)` | **visible change proposed**, see §3 — this is the one actually rendering today |
| `body.products-page .shop-card` | style.css:8536 | `var(--shadow-cast-lg)` | (none scoped — falls back to the plain `.shop-card:hover` above by specificity, see §3) | **visible change proposed**, see §3 |
| `.service-guide-directory-card:hover, :focus-visible` | style.css:6836 | (none at rest — border/background only) | `var(--shadow-sm)` | clean |
| `.services-page .service-card:hover, :focus-within` | style.css:8000 | (none at rest) | `0 22px 52px rgba(4, 50, 54, .09)` | keep literal (page-scoped override, 1 use) |
| `.shop-card-quick-commerce .commerce-vol` | style.css:3647 | `0 8px 24px rgba(9, 46, 52, .12)` | — | keep literal (1 use; cast-family hue, below threshold as its own value) |
| `.shop-card-quick-add` | style.css:3666 | `0 8px 24px rgba(9, 46, 52, .16)` | — | keep literal (1 use) |
| `.blog-card` | blog.css:8/9 | `var(--shadow-xs, …)` | `var(--shadow-md, …)` | clean |

### R5 — Pressable Control

| Component | File:Line | Rest | Hover | Status |
|---|---|---|---|---|
| `.btn-secondary` | style.css:501/502 | `var(--shadow-xs)` | `var(--shadow-sm)` | clean |
| `.btn-ink` | style.css:509/514 | `var(--shadow-xs)` | `var(--shadow-sm)` | clean |
| `.btn-ghost` | style.css:517/518 | `var(--shadow-xs)` | `var(--shadow-sm)` | clean |
| `.btn-light` | style.css:519/520 | `var(--shadow-sm)` | `var(--shadow-md)` | clean |
| `.nav-cta` | style.css:480/483 | `var(--shadow-sm)` | `var(--shadow-md)` | clean |
| `:where(.btn, .btn-sm, .nav-cta, .nav-cart, .lead-action-bar a):focus-visible` | style.css:8301 | `0 0 0 4px rgba(14,124,134,.16), var(--shadow-sm)` | — | keep literal — this is a **compound** ring+shadow (focus ring layered over the resting lift) with no separable token form; 1 use |
| `.btn-primary` | style.css:499/2716 (rest, duplicated), 500/2719 (hover, duplicated) | see §3 | see §3 | **visible change / decision required**, see §3 |
| `.block-dark .btn-primary:hover, .on-dark .btn-primary:hover` | style.css:2752 | — | `0 10px 26px -10px rgba(14,124,134,.6), 0 0 0 1px rgba(255,255,255,.14)` | keep literal — this is the dark-surface variant of the primary button (R6 territory) and it already does the right thing: a hairline instead of a soft wash, because a diffuse shadow doesn't read on a dark block; 1 use |

### R6 — Dark-Surface Card

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.bento-cell.ink` | style.css:721/724 | `var(--shadow-md)` (rest) | `var(--shadow-lg)` (hover) | **visible change proposed — the headline finding**, see §3 |
| `.nav.over-dark, .nav.over-dark.scrolled` | style.css:7275 | `0 24px 72px rgba(0, 0, 0, .34)` | — | already doing the *right family* (neutral black, not teal) — see the near-miss note under R7 below |
| `.block-dark .btn-primary:hover, .on-dark .btn-primary:hover` | style.css:2752 | (listed under R5 above) | — | already correct: hairline, not a soft wash |

### R7 — Sticky Chrome

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.nav` (resting) | style.css:7267 | `0 1px 0 rgba(20, 24, 32, .02)` | — | keep literal — this is a near-invisible separator hairline, not really "elevation" in the lift sense; 1 use |
| `.nav.scrolled` | style.css:364 | `0 1px 0 rgba(20,24,32,.02), 0 8px 24px -18px rgba(20,24,32,.3)` | — | keep literal (1 use, two-layer: keeps the hairline and adds the lift) |
| `.nav.over-dark, .nav.over-dark.scrolled` | style.css:7275 | `0 24px 72px rgba(0, 0, 0, .34)` | — | keep literal today — **near-miss** on `--shadow-dark-lg` (`0 24px 60px rgba(0,0,0,.45)`): same y-offset (24px), same neutral-black hue, but blur is 12px off and alpha .11 off, so it fails the stated match tolerance. Correct family, not a strict match. Leave as literal; revisit only if a third dark-nav-like surface shows up. |
| `.nav-links` (desktop dropdown) | style.css:1638, navigation.css:119 | `var(--shadow-md)` | `--shadow-md` | clean |
| `.nav-menu` (mobile flyout) | style.css:3239 | `0 18px 42px -28px rgba(20, 24, 32, .48)` | — | keep literal (1 use) |
| `.nav-links.open` | style.css:3165 | `0 18px 38px -28px rgba(21,23,28,.45)` | — | keep literal (1 use, close neighbor of `.nav-menu` above but distinct) |
| `.lead-action-bar` (mobile floating action bar) | navigation.css:150 | `0 18px 44px rgba(16, 74, 80, .20)` | — | keep literal (1 use) — teal-tinted on purpose; this is a persistent branded CTA bar, not neutral chrome |

### R8 — Overlay / Modal

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.modal` | components.css:231 | `var(--shadow-lg, 0 28px 64px -16px rgba(20, 24, 32, .16))` | `--shadow-lg` | clean (fallback literal exists for defensive reasons, not a semantic disagreement) |
| `.detail-dialog` | components.css:202 | `var(--shadow-lg, 0 28px 64px -16px rgba(20, 24, 32, .16))` | `--shadow-lg` | clean |
| `.confirm-dialog` | components.css:633 | `0 24px 80px rgba(20, 24, 32, .28)` | — | keep literal today, optional consolidation — see §3 |
| `#lightbox .lb-img` | style.css:2654 | `0 12px 48px rgba(0, 0, 0, .55)` | — | keep literal (1 use, heaviest neutral-black weight on the site — appropriate, it sits over a full-screen scrim) |
| `.toast` | components.css:529 | `var(--shadow-md, 0 18px 42px -20px rgba(16, 74, 80, .28))` | `--shadow-md` | clean — a toast is a *transient* overlay, correctly one step lighter than a modal, not R8's full weight |

### R9 — Floating Popover / Widget

| Component | File:Line | Current | Target | Status |
|---|---|---|---|---|
| `.customer-chat__toggle` | customer-chat.css:32/116 | `0 8px 24px color-mix(…24%…), 0 2px 5px color-mix(…18%…)` (rest) → `0 12px 28px …28%…, 0 3px 8px …16%…` (hover) | — | keep literal (1 pair) |
| `.customer-chat__panel` | customer-chat.css:58 | `0 18px 44px color-mix(…22%…), 0 3px 10px color-mix(…14%…)` | — | keep literal (1 use) |
| `.customer-chat__message` | customer-chat.css:79 | `0 1px 2px color-mix(…10%…)` | — | keep literal (1 use) |
| `.site-support__launcher` | admin-support.css:25 | `0 12px 30px rgb(0 0 0 / 24%)` | — | keep literal (1 use) |
| `.site-support__drawer` | admin-support.css:75 | `0 20px 52px rgb(0 0 0 / 28%)` | — | keep literal (1 use) |
| `.site-support__popover` | admin-support.css:98 | `0 16px 32px rgb(0 0 0 / 18%)` | — | keep literal (1 use) |

**Observation, not a proposed change**: these six values are all neutral,
un-tinted, and structurally play the same three-tier role (launcher/toggle →
popover/message → drawer/panel) across two different widgets built at
different times — one uses `color-mix(in srgb, var(--ink) N%, transparent)`,
the other plain `rgb(0 0 0 / N%)`. Each individual value is correctly a
one-off by the ≥3-use rule. If a third floating widget is ever added with a
matching three-tier shape, that is the point at which this becomes a genuine
fifth family (call it `--shadow-float-*`) rather than an accumulation of
one-offs — not before.

---

## 3. Proposed visible changes (flagged for approval — none applied)

These are the components whose *current live rendering* should change, or
whose current source disagrees with itself about what should render. Every
one of these is a judgment call about intent, not a free technical cleanup —
approve or reject each independently.

### 3.1 `.bento-cell.ink` — wrong shadow family for a dark surface (most significant finding)

`.bento-cell.ink` sets `background: var(--ink)` — a solid dark fill, with
white/translucent body text (`rgba(255,255,255,.72)`) and a cyan icon
(`#7adfe7`) chosen specifically to read against dark (style.css:721-729).
Its box-shadow, though, is `var(--shadow-md)` at rest and `var(--shadow-lg)`
on hover — the **teal-tinted, light-surface** ramp. This directly contradicts
the rule this same codebase already wrote for itself: "a shadow cast on a
dark surface cannot use the teal-tinted ramp that works on white, because a
teal tint is invisible against near-black; it needs neutral black" (migration
tool header), which is exactly why `--shadow-dark-sm/md/lg` exist
(`0 12px 30px rgba(0,0,0,.26)` / `0 24px 60px rgba(0,0,0,.45)`). Every other
dark-surface case found in this inventory — `.nav.over-dark` (neutral black
literal), `.block-dark .btn-primary:hover` (hairline instead of a wash) —
already gets this right by hand. `.bento-cell.ink` is the one place a dark
card slipped through using the light-surface token instead.

**Visible consequence**: on the near-black `.bento-cell.ink` fill, a
teal-tinted shadow at low alpha reads close to invisible against the dark
background it's supposed to lift off of, and whatever does show through
carries a color cast the surface was styled to avoid everywhere else on it.

**Proposal**: move `.bento-cell.ink` rest → `--shadow-dark-md`, hover →
`--shadow-dark-lg`. This is a visible change (the shadow becomes neutral
black instead of teal-black) and needs sign-off before it ships, but it is
the cleanest, most rule-consistent fix in this document — it is not inventing
a new convention, it is applying the one the codebase already committed to.

### 3.2 `.btn-primary` — two live-looking definitions, only one actually renders

`.btn-primary` and `.btn-primary:hover` are each declared **twice** at
identical specificity (`0,1,0`), unguarded by any media query (confirmed by
brace-depth walk), with no `!important` anywhere in the file:

- style.css:499 (rest) / 500 (hover) — teal-tinted:
  `0 1px 2px rgba(10,91,98,.25), 0 8px 20px -8px rgba(14,124,134,.55)` →
  `0 2px 4px rgba(10,91,98,.28), 0 14px 28px -10px rgba(14,124,134,.62)`
- style.css:2716 (rest) / 2719 (hover) — neutral ink, appearing ~2200 lines
  later in the same file:
  `0 1px 2px rgba(20,24,32,.18), 0 10px 22px -14px rgba(20,24,32,.42)` →
  `0 2px 6px rgba(20,24,32,.20), 0 14px 28px -16px rgba(20,24,32,.46)`

Per plain CSS cascade rules (equal specificity, equal origin, no
`!important`), **the later declaration wins for that property**. The version
that actually renders on every `.btn-primary` on the site today is the
**neutral-ink one at line 2716/2719**; the teal-tinted version at 499/500 is
dead code that has never painted a pixel, on any page, since whichever pass
added the second block.

This matters because `.btn-primary`'s background is `var(--accent)` (teal) —
a teal-tinted shadow would reinforce the brand color the same way
`.tier-card.featured`'s protected glow does; the neutral version that is
actually live reads as a generic dark-UI button shadow with no relationship
to the brand color at all, on the single most clicked element on the site.

**This is a decision, not a cleanup**: pick one and delete the other.
- Keep the *neutral* version (what currently renders) and delete the dead
  teal block → **zero visible change**, pure dead-code removal.
- Restore the *teal* version (delete the later block instead) → **visible
  change**: every primary button's shadow gains a teal cast it currently does
  not have.

Both are legitimate outcomes; this document does not pick one. What it
asserts is the measured fact — which block is currently live — so whoever
decides is deciding with the right information.

### 3.3 `.shop-card` — three competing definitions, only the last (unscoped) one renders

`.shop-card` is redefined three separate times at file scope, all at the same
specificity, none guarded by a body class or media query:

1. style.css:3589-3600 (in the main catalog grid section) — `--shadow-xs` →
   `--shadow-md` (the token pair a reader skimming the grid section would
   reasonably assume is canonical)
2. style.css:5694-5707 — literal `0 14px 38px rgba(4,50,54,.08)` →
   `0 24px 58px rgba(4,50,54,.13)`
3. style.css:7405-7414 — literal `0 26px 74px rgba(9,46,52,.1)` →
   `0 34px 92px rgba(9,46,52,.16)`

By source order, **definition 3 is what actually renders** everywhere except
the products page; definitions 1 and 2 are dead. On the products page,
`body.products-page .shop-card` (style.css:8534-8537, specificity `0,2,1`)
overrides the *resting* shadow to `--shadow-cast-lg`, but there is no
matching `body.products-page .shop-card:hover` rule — so on hover, the plain
`.shop-card:hover` at definition 3 (specificity `0,2,0`) still loses to the
resting `body.products-page .shop-card` rule's higher specificity for the
`box-shadow` property. Net effect: **on the products page, hovering a shop
card moves it (`translateY`) but its shadow does not deepen** — the lift
motion and the elevation feedback have come uncoupled, because the two rules
that would need to agree on hover behavior were never written to interact.

**Proposal**: this needs an explicit decision on which of the three
".shop-card" identities is canonical (most likely definition 3, since it's
what's actually live off the products page today), followed by either giving
the products page its own `body.products-page .shop-card:hover` rule or
letting it inherit definition 3's hover behavior by removing the resting
override's inflated specificity. Any of these is a **visible change** on the
products page (the hover lift will start showing an elevation change it
currently doesn't) and should be approved with a screenshot in hand, not
assumed safe.

### 3.4 `.job-plan-card` and `.product-comparison-link` — cast-family interactive cards, proposed to join the material family

Both of these behave exactly like the R4 Interactive Card role used by
`.bento-cell`, `.prod-card`, `.snap-card`, `.row-card`, `.contact-card`: a
resting shadow, a `translateY` lift on hover/focus-within, and a heavier
shadow on that same hover. The only difference is that they currently express
that behavior through the **cast** family (rest) plus a bespoke literal
(hover), rather than the **material** family used by every other member of
that role:

- `.job-plan-card`: `--shadow-cast-lg` → `0 24px 58px rgba(4, 50, 54, .1)`
- `.product-comparison-link`: `--shadow-cast-md` → `0 14px 32px rgba(9, 46, 52, .1)`

**Why this is worth asking about**: cast shadows are single-layer and read
flatter/tighter; material shadows are two-layer and read softer/deeper. A
component that visibly lifts on hover is the exact case the two-layer
material ramp was built to sell — the ambient+key-light combination is what
makes a lift look convincing. Right now these two get a cast shadow at rest
and an unnamed one-off literal on hover, which is neither family
consistently.

**Proposal**: move both to the material family — `--shadow-cast-lg` /
`--shadow-cast-md` (rest) → `--shadow-md` / `--shadow-sm` (rest), `--shadow-lg`
/ `--shadow-md` (hover) — bringing them in line with the rest of R4. This is a
**visible change**: the resting shadow gets a second layer and a softer edge,
and the hover shadow's exact numbers change (not just its name). Flag for
approval; do not treat "same role" as license to apply silently.

**Explicit non-proposal for comparison**: `.blog-body .md-card` also uses the
cast family with a resting→hover pair (`--shadow-cast-sm` → `--shadow-cast-md`)
and is *not* included in this proposal. A blog post's reference-card list
sits in a reading context, not a marketing grid, and a flatter, quieter lift
is arguably the more correct choice there, not a gap to close. Mentioned so
the distinction reads as a judgment call, not an oversight.

### 3.5 Overlay consolidation (optional, low priority)

`.modal` / `.detail-dialog` (both `--shadow-lg` with an identical inline
fallback), `.confirm-dialog` (`0 24px 80px rgba(20,24,32,.28)`, literal), and
`#lightbox .lb-img` (`0 12px 48px rgba(0,0,0,.55)`, literal) all serve R8 —
the topmost floating layer — but currently render at three different
weights. The first two already agree with each other. `.confirm-dialog` is
close in spirit but meaningfully lighter than `--shadow-lg`
(`0 34px 74px -28px rgba(16,74,80,.34), 0 16px 30px -20px rgba(20,24,32,.18)`);
promoting it to `--shadow-lg` would be a **visible change** (deeper, teal-
tinted instead of neutral-ink) and is not clearly correct — a confirm dialog
inside the admin console arguably wants to read as slightly less dramatic
than a customer-facing modal. Recorded here as something worth a design call
someday, not something this document recommends doing.

---

## 4. Intentional one-offs

Per the established convention ("a token used fewer than three times is a
rename, not a token"), these stay literal. Listed so the mapping table above
is complete against "every component/selector," and so nobody mistakes an
absence from the token system for an oversight.

**Brand glow — must never enter the neutral ramp, regardless of use count.**
- `.tier-card.featured` (style.css:2415) — `0 8px 30px rgba(14, 124, 134, .10)`,
  already annotated in place: "brand glow, not elevation: teal hue (max
  channel 134) must never be folded into an ink cast/shadow token."
- `.shop-card-buybar .shop-card-add` (style.css:5853) —
  `0 10px 24px rgba(0, 115, 119, .18)`, a second teal (the migration tool's
  own `ACCENT_RGB` set already treats `rgb(0,115,119)` as "a second teal that
  drifted in; it is not a separate brand" for border purposes — the same
  reasoning applies here for shadows: this is a brand glow on an add-to-cart
  button, not a neutral shadow, and stays out of the ramp for the same reason
  as `.tier-card.featured`).

Both are two uses total of the "teal glow" idea, spread across two different
alpha/blur combinations — below the ≥3-use bar even if the rule allowed
brand-tinted tokens, which it explicitly does not.

**Selection / match halos — "this one is chosen," correctly one-off or ring-based.**
- `.buyer-router .route-card.active` (style.css:812) — `0 0 0 1px rgba(14,124,134,.14)`.
  Spread is exactly 1px: per the ring logic already encoded in
  `tools/surface-token-migrate.mjs` (`ringTokenFor`), a 1px ring is a
  hairline outline, not a compact focus ring — widening it to `--ring-tight`'s
  2px would be a visible change to a hairline that isn't broken. Correctly
  kept literal.
- `.buyer-router .route-card i` (style.css:967) — `inset 0 0 0 1px rgba(14,124,134,.12)`,
  same 1px-hairline reasoning, inset variant.
- `[data-marine-product-selector]… .is-marine-match` (style.css:8665) —
  `0 0 0 3px rgba(14, 124, 134, .12), 0 18px 42px rgba(4, 50, 54, .12)` — a
  compound ring-plus-shadow in one declaration for a "this product matches
  your selected job" halo. Not separable into either token family cleanly;
  correctly one-off.
- `.shared-image-library-card.is-selected` (components.css:698) —
  `0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)` — a
  selection ring using `color-mix` instead of `rgba`, 1 use.

**Dim inset bevels — the two the migration tool already named.**
The migration tool's comment on `--highlight-top` states "the two dim
variants on dark surfaces stay literal, because two uses is a rename rather
than a token." Those two are, by exact-value match against the freeze list:
- `.island-arrow` (style.css:7304) — `inset 0 1px 0 rgba(255, 255, 255, .18)`
- `.shop-card .hmis-badge` (style.css:7454) — `inset 0 1px 0 rgba(255, 255, 255, .2)`

**Validation state.**
- `.checkout-flow-page .field input[aria-invalid="true"]:focus-visible`
  (style.css:4425) — `0 0 0 2px rgba(180,35,24,.14)`, a danger-colored ring
  for a failed-validation field. A different job from the accent ring family
  (color communicates severity, not focus), 1 use, correctly literal.

**Narrative one-offs (`story.css`) — bespoke scrollytelling elements, exempt by design.**
Eleven declarations across `.story-object__card` (×3, including one inset
bevel), `.story-object__divider`, `.story-object__scan`, `.story-object__target`
(×2, including a ring), `.story-object__range` (×4, slider track/thumb,
×2 vendor-prefixed pairs), `.story-object__status`, `.story-object__product img`,
`.story-actions`, `.replacement-ledger tr`. Each is tied to one specific
scene's illustration or interaction state, several use narrative-specific
color (a cyan glow at `rgba(121,199,197,.85)`, an amber ring at
`rgba(226,165,99,.16)`, a mint status ring at `rgba(156,225,220,.12)`) that
the migration tool's own header already calls out by name as one-offs
("the amber and mint rings are one-offs"). None of these are reusable UI
chrome; none are proposed for tokenization.

**Page-scoped overrides below the use-count bar.**
`.services-page .service-catalog-shell` (style.css:7961),
`.services-page .service-card:hover` (style.css:8000),
`.shop-card-quick-commerce .commerce-vol` (style.css:3647),
`.shop-card-quick-add` (style.css:3666) — each a single-use literal
overriding a base rule for one specific page context. Individually below
the ≥3-use bar; several share the `rgba(4,50,54,*)` or `rgba(9,46,52,*)` ink
bases discussed in §2's note under `.catalog-quick-facts span` — a pattern
worth a future token pass, not a one-off fix today.

**Floating widget literals** — covered in §2 under R9; six one-offs across
two widgets, structurally coherent but individually below threshold.

---

## 5. Suggested implementation order

Ordered by (a) how independently reviewable the change is, and (b) risk —
lowest-risk, most self-contained first.

1. **`.btn-primary` dead-code decision (§3.2).** Purely a source-hygiene
   question first (which block do we keep) with an optional visual-intent
   question layered on top (do we want the teal glow back). Resolve the
   hygiene question alone if the visual-intent question needs more time —
   deleting the dead block changes nothing on screen.
2. **`.bento-cell.ink` → `--shadow-dark-md/lg` (§3.1).** Single component,
   single clear rule violation, the tokens it needs already exist and are
   already used elsewhere for exactly this reason. Screenshot before/after
   on both the resting and dark-hover states before merging.
3. **`.shop-card` canonicalization (§3.3).** Highest blast radius (it's the
   primary commerce grid card, appears on multiple pages/contexts) and the
   only one with a genuine interaction-state bug (hover lift without hover
   shadow on the products page) rather than just a "which value is right"
   question. Needs a decision on the canonical value plus a fix for the
   products-page hover gap. Do this after 1-2 so the team has practice
   reviewing this document's kind of change on lower-stakes components first.
4. **`.job-plan-card` / `.product-comparison-link` → material family (§3.4).**
   Purely aesthetic judgment call, no bug underneath it, lowest urgency.
   Do this whenever there's appetite for the visual change, independent of
   the others.
5. **Overlay consolidation (§3.5).** Optional, explicitly not recommended
   as urgent; revisit only if a design pass touches the admin confirm-dialog
   or the lightbox anyway.

Each step should ship as its own PR with its own before/after screenshots —
per the method discipline in §0, evaluate every diff by what a human sees
changing, not by a changed-pixel count.
