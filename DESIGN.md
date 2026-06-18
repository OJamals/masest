# MASEST Design System

The MASEST/VertKleen storefront is CSS-first: a single token layer in
`css/style.css` (`:root`) drives every surface, with a reusable component layer in
`css/components.css`. No build step, no framework — raw HTML/CSS/JS on Cloudflare
Pages. This doc is the contract: build new UI from these tokens and components,
not ad-hoc values.

## Files

| File | Role |
|---|---|
| `css/style.css` | Tokens (`:root`) + global type, layout, page styles. Light theme primary. |
| `css/components.css` | Reusable component primitives (this doc, "Components"). Load **after** style.css. |
| `css/story.css` | Dark scrollytelling theme (homepage story acts only). |
| `css/commerce.css` | Cart / order-confirmed layout shims. |

## Tokens (defined in `css/style.css` `:root`)

**Color** — `--ink` (#15171c primary text), `--ink-soft`, `--muted` (AA on white),
`--line` / `--line-soft` (borders), `--bg` (page), `--surface` (#fff cards),
`--panel` (soft fill), `--accent` (#0e7c86 teal action), `--accent-ink` (hover),
`--accent-soft` / `--accent-tint` (teal washes), `--danger` (#a63a2e, AA on white).
`--brand-grad` (purple→teal) is **logo-only** — never a UI fill.

**Elevation** — `--shadow-xs`, `--shadow-sm`, `--shadow-md`, `--shadow-lg`.

**Radii** — `--r-card` (16px), `--r-lg` (22px), `--r-input` (10px), `--r-pill` (999px).

**Spacing / layout** — `--space-section` (fluid clamp), `--maxw` (1180px container).

**Motion** — `--ease-out` (snap), `--ease-out-soft` (gentle). All motion must be
disabled under `prefers-reduced-motion: reduce` (Playwright screenshots require
`reducedMotion:'reduce'` or `.reveal` sections render blank).

**Type** — `--font` (Satoshi stack). Icons: Phosphor (`<i class="ph ph-*">`).

## Components (`css/components.css`)

Additive, token-built, accessible. Adopt incrementally — existing bespoke styles
(dashboard/admin tabs, `.prod-card`, `.btn*`, `.field`) stay until refactored.

| Class | Use |
|---|---|
| `.skeleton` (+ `.skeleton-text .w-40/60/80`, `.skeleton-block`) | Loading placeholder; shimmer auto-off under reduced-motion. |
| `.badge` (+ `-accent/-success/-warning/-danger`, `.badge-dot`) | Status / metadata pill. |
| `.tabs` + `.tab` (`aria-selected="true"`) | Canonical tab strip. |
| `.empty-state` (`.empty-icon/.empty-title/.empty-body`) | Zero-data / no-results. |
| `.pagination` | Page navigation (`aria-current="page"`). |
| `.data-table` (`td.num`) | Consistent responsive table. |
| `.modal-backdrop` + `.modal` (`.open` to show) | Dialog; pair with focus-trap + Esc/backdrop close. |
| `.search-field` | Labelled input with leading Phosphor icon. |

### Existing reusable classes (keep using)
Buttons `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-ink` / `.btn-sm`;
cards `.prod-card` / `.shop-card`; forms `.field` / `.field-grid`; badges `.hmis-badge`.

## Rules
1. New UI references tokens, never raw hex/px for color, radius, shadow, or motion.
2. Prefer a component class over a one-off; if none fits, add it to `components.css` + this doc.
3. Every interactive element needs a visible `:focus-visible` ring and AA contrast.
4. Respect `prefers-reduced-motion` for any transition/animation.
5. `components.css` is loaded per page after `style.css` — add the `<link>` when a page adopts a component.
