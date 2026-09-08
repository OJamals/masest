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

### SQ-13 — Grid cards ~700px tall, nothing aligns across a row · HIGH

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

### SQ-14 — "Recommended" sort has no discernible order · MEDIUM

Default order runs $25.99, $25.99, $28.99, $28.99, $20.49, $14.49, $14.49, $21.99, $19.99,
$16.99, $18.99 — not price, not alphabetical, not category. Make "Recommended" mean
something explicit (best sellers, then breadth of use) or rename it to what it is.

### SQ-15 — `/products` spends 1,200px before the first product · MEDIUM

Three-line 96px headline, paragraph, four stat chips, a collapsed "Buying details"
accordion, the filter bar, then the grid. Page total 6,422px for 15 SKUs. Compress the
hero to headline plus one line; get the first product row into the opening screen.

### SQ-16 — Product imagery inconsistently framed · MEDIUM

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

---

## Phase 3 — Front door

### SQ-06 — Five pinned scenes, 3,679px, before the first product · CRITICAL

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
