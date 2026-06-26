# CRM Deal Pipeline — Slice 2 Design

**Date:** 2026-06-25
**Status:** Approved (design), pre-implementation
**Surface:** Staff admin console only (`admin.html` / `js/admin/*` / `functions/api/admin/*`). No buyer-facing change.
**Builds on:** `feat/crm-contact-view` (Slice 1). Implemented on branch `feat/crm-deal-pipeline` in an isolated worktree.

## Problem

The admin Quotes tab is a flat, reverse-chronological list of `<details>` accordions. There is
no value-weighted sales funnel, no visual stage progression, no forecast, and no structured
loss capture. Per ARCHITECTURE.md priority #1 (a disciplined CRM) and the CRM feature research,
the single biggest missing muscle is a **visual deal pipeline**. Slice 1 built the activity
foundation (`crm_notes` / `crm_tasks` + `/api/admin/crm/*`, polymorphic over
`subject_type in ('company','quote')`) and explicitly deferred `quotes.pipeline_stage` + a
grouped/kanban board and the quote-drawer CRM UI to this slice.

## Scope

**In:**
- Extend `quotes` with pipeline fields (`pipeline_stage`, `deal_value`, `expected_close`,
  `stage_changed_at`, `lost_reason`) via a new additive migration `supabase/schema-crm-pipeline.sql`.
- Extend the existing `functions/api/admin/quotes.js` to read/write the new fields, validate the
  6-stage machine, enforce won/lost coherence with `status`, and serve a `?view=pipeline` forecast
  summary.
- A **List ⇄ Board toggle** and a **drag-and-drop kanban board** inside the Quotes tab, plus a
  **forecast strip**, all injected through `js/admin/quotes.js` (no `admin.html` change).
- A **quote detail drawer** (injected `<dialog>`, no `admin.html` change) with sub-tabs
  **Details | Timeline | Tasks | Notes**, reusing Slice 1's `createCrmPanel().mount(el,'quote',id)`.
- Tests: new endpoint/stage unit test, schema test, extended admin Playwright spec.

**Out (later slices):** contact-level records distinct from the company; email templates /
sequences / cadences; conversion + forecast *reporting dashboards* (this slice ships only the
inline forecast strip); saved-filter segments; multiple pipelines; round-robin assignment; SLA
timers. Any CMS work (owned by the concurrent CMS-foundation agent).

## Collision avoidance (concurrent CMS agent)

The CMS-foundation agent is editing the `main` working tree, touching `js/admin.js`,
`admin.html`, `js/main/service-catalog.js`, `tools/seo-inject.mjs`, `tools/verify_site.mjs`,
`package.json`, and `functions/_lib/content.js` / `functions/api/admin/content.js` /
`js/admin/content.js`. **This slice touches none of those.** Its entire footprint is:
`supabase/schema-crm-pipeline.sql` (new), `functions/api/admin/quotes.js` (CMS-untouched),
`js/admin/quotes.js` (CMS-untouched), `css/components.css` (CMS-untouched; Slice 1 already
appends here), plus new `tests/*` and `tools/*.spec.mjs`. Work happens on a separate worktree
+ branch, so there is no shared checkout. The board toggle and the drawer are injected by JS
rather than added to `admin.html`, specifically to keep `admin.html` and `js/admin.js` out of
the diff and avoid a merge race with the CMS tab registration.

## Key decisions

1. **Quotes ARE deals — extend `quotes`, no new `deals` table.** A quote already carries owner,
   priority, next_step, due_at, notes, and the convert-to-order path. A parallel deals table would
   duplicate that and split truth. Slice 1's design pre-committed to `quotes.pipeline_stage`.
2. **`pipeline_stage` is a new dimension beside `status`, not a replacement.** `status`
   (new/contacted/closed/spam) stays for triage and spam. `pipeline_stage` is the sales funnel.
   Coherence is enforced server-side, not by the editor:
   - moving to `won` or `lost` also sets `status='closed'`;
   - `spam` quotes are excluded from the board entirely;
   - the existing convert-to-order action additionally sets `pipeline_stage='won'`.
3. **Six stages:** `new → qualified → sample_audit → proposal → won → lost`. Maps to MASEST's
   quote types (sample / audit / technical fold into `sample_audit`) and the convert path (`won`).
   `lost` is terminal with a captured reason.
4. **Fixed stage probabilities (v1), as code constants** in `functions/_lib/crm-pipeline.js`:
   `new 0.10, qualified 0.30, sample_audit 0.50, proposal 0.70, won 1.0, lost 0`. Editable per-deal
   probability is deferred. Forecast = Σ(`deal_value` × stage probability) over non-terminal +
   won deals with a value; deals with null `deal_value` are excluded from $ math but still shown.
5. **`deal_value` is staff-entered**, nullable. No auto-derivation from `payload` volume×price in
   v1 (payload shapes are inconsistent). Editable on the card and in the drawer.
6. **Drag is an enhancement; the keyboard/AA path is a per-card stage `<select>`.** Native HTML5
   drag-and-drop is not keyboard-operable, so every card keeps a stage select that issues the same
   PATCH. The board is fully usable with no pointer.
7. **Reuse Slice 1's CRM panel verbatim.** `createCrmPanel({ $, api, admSkeleton, admEmpty })`
   already returns `mount(container, subjectType, subjectId)` and the timeline merge already has a
   `quote` source. The quote drawer calls `mount(drawerBody, 'quote', quote.id)` — no new CRM
   endpoint, no fork of `crm.js`.

## Schema — `supabase/schema-crm-pipeline.sql`

Additive and idempotent. `quotes` already has full grants (`grant all ... to ... service_role`
in `schema-quotes.sql`), so no new grants are required — only column adds and an index.

```sql
alter table public.quotes add column if not exists pipeline_stage  text not null default 'new';
alter table public.quotes add column if not exists deal_value      numeric(12,2);
alter table public.quotes add column if not exists expected_close  date;
alter table public.quotes add column if not exists stage_changed_at timestamptz;
alter table public.quotes add column if not exists lost_reason     text;

-- Stage allow-list as a CHECK (DO block = re-runnable without duplicate-object errors).
do $$ begin
  alter table public.quotes add constraint quotes_pipeline_stage_chk
    check (pipeline_stage in ('new','qualified','sample_audit','proposal','won','lost'));
exception when duplicate_object then null; end $$;

create index if not exists quotes_pipeline_stage_idx
  on public.quotes (pipeline_stage, stage_changed_at desc);
```

Backfill: existing rows default to `new`; a one-line optional update can map `status='closed'`
rows to `won`/`lost` at the owner's discretion (documented, not run automatically).

## Backend — `functions/api/admin/quotes.js` (extend, do not rewrite)

Add a pure helper module `functions/_lib/crm-pipeline.js` (no I/O, unit-testable, mirrors
`quote-convert.js`):

- `PIPELINE_STAGES` (ordered array) and `STAGE_PROBABILITY` map.
- `LOST_REASONS` suggested set: `['price','competitor','spec','timing','no_decision','other']`.
- `validStage(s)`, `isTerminal(s)` (`won`/`lost`).
- `stagePatch({ stage, lost_reason }, now)` → `{ patch }` or `{ error }`. Sets
  `pipeline_stage`, `stage_changed_at`, and — for terminal stages — `status='closed'`,
  `handled_at`, plus `lost_reason` when `lost` (free text, capped; suggested set is UI-only).
- `pipelineSummary(rows)` → `{ stages: [{ stage, count, value }], weighted, open_value }` for the
  forecast strip (also computable server-side over head-counted rows).

Wire into the existing handler:

- **GET list:** add `pipeline_stage, deal_value, expected_close, stage_changed_at, lost_reason`
  to the `.select(...)` column list (and to the CSV export columns/header).
- **GET `?view=pipeline`:** return `pipelineSummary` over all non-spam quotes (selecting only
  `id, pipeline_stage, deal_value` for the aggregate, like the existing `new_count` head-counts),
  so the forecast reflects every deal, not just the loaded page.
- **POST generic patch:** accept `pipeline_stage` (→ `stagePatch`, validated; 400
  `invalid_stage`), `deal_value` (number ≥ 0 or null), `expected_close` (date or null),
  `lost_reason`. A drag issues `POST { id, pipeline_stage }` and nothing else. Keep the existing
  `convert` action, and additionally set `pipeline_stage='won'` inside it.
- Best-effort `auditLog` entry on stage change, per the existing convention used elsewhere.

Auth/guards unchanged: `requireStaff` for all; `staffCanWrite(role)` for writes (read-only staff
denied), exactly as the current quotes handler already enforces.

## Frontend — `js/admin/quotes.js` (extend `createQuotesTab`)

- **Toggle:** inject a `List | Board` segmented control once into `#admQuotes`'s **parent panel,
  immediately above the list container**, so it survives the `#admQuotes` `innerHTML` swaps that
  `renderQuotePipeline` performs. Persist the choice in `state.quotesView` and route renders to
  `renderQuoteBoard` vs the existing list renderer.
- **Board (`renderQuoteBoard`):** six `.pipe-col` columns in stage order, each with a header
  (stage label, deal count, column $). Cards (`.pipe-card`) render company/name, `deal_value`
  (formatted), a priority badge, owner, and overdue/stale flags (`stale` = non-terminal and
  `stage_changed_at` older than N days, N=7 constant). Cards are `draggable`; `dragstart` stashes
  the quote id, column `dragover`/`drop` issue `POST { id, pipeline_stage }` then re-render.
  - Drop on **Lost** opens a tiny inline reason `<select>` (`LOST_REASONS`) before committing.
  - Drop on **Won** confirms and points to the existing convert-to-order flow (does not silently
    fabricate an order).
  - Each card also carries a hidden-until-focus stage `<select>` (keyboard path) issuing the same
    PATCH.
- **Forecast strip (`renderForecast`):** above the board — open pipeline $, weighted forecast $,
  and per-stage chips — fed by `GET ?view=pipeline`.
- **Quote drawer (`openQuoteDrawer`):** a `<dialog class="adm-drawer">` injected into `<body>`
  (mirrors the company drawer pattern; no `admin.html` edit). Header = quote identity + stage
  select + deal_value/expected_close inputs + Save. A sub-tab strip **Details | Timeline | Tasks |
  Notes**: Details renders the existing per-quote edit controls (status/priority/owner/next_step/
  due/notes/convert) reused from the current accordion body; Timeline/Tasks/Notes call
  `crmPanel.mount(tabBody, 'quote', quote.id)` using the Slice 1 module (imported and constructed
  once in `createQuotesTab`). Opening a card opens the drawer at the Details tab.
- **List view** keeps the current accordion behavior unchanged (regression-safe default until the
  user toggles to Board).
- Delegation stays on the stable `#admQuotes` container per the `delegate()` / once-bound
  `wireQuotes()` pattern; the drawer binds its own listeners on mount and tears them down on close.

## CSS — `css/components.css` (append only)

Add a small, token-based block: `.pipe-toggle`, `.pipe-board` (horizontal scroll on narrow
viewports), `.pipe-col`, `.pipe-col-head`, `.pipe-card` (+ `.is-dragging`, `.is-stale`),
`.pipe-forecast`, and the `.adm-drawer` reuse for the quote drawer if not already present. Reuse
existing `.badge`, `.muted`, `.btn`, `.skeleton`, `.empty-state`, `.adm-select`, `.adm-input`
primitives. AA contrast on any new stage/forecast colors; visible focus ring on cards and
controls; drag affordances also expressed non-visually (the stage select).

## Error / empty / loading states

Board and drawer each render three states explicitly: `.skeleton` during fetch, an
`.empty-state` per empty column / empty tab, and an inline error row with a retry affordance on
failure. Endpoints continue to return structured `{ error }` JSON with correct status and no
stack leakage (matches `api-error-masking` expectations).

## Testing

- `tests/admin-crm-pipeline-lib.test.mjs` — `validStage`, `isTerminal`, `stagePatch`
  (terminal → `status='closed'`; `lost` requires/sets `lost_reason`; invalid stage → error),
  `pipelineSummary` math (weighted = Σ value×probability; null values excluded).
- `tests/admin-quotes-pipeline.test.mjs` — quotes API source contract: GET selects the new
  columns, `?view=pipeline` summary path, POST accepts `pipeline_stage`/`deal_value`/
  `expected_close`/`lost_reason`, `invalid_stage` → 400, auth gate (401/403) + write-guard,
  convert sets `pipeline_stage='won'`.
- `tests/admin-crm-pipeline-schema.test.mjs` — migration adds the five columns, the stage CHECK,
  and the index.
- Extend an existing admin Playwright spec (the Slice 1 `tools/admin-crm-drawer.spec.mjs` pattern):
  toggle to Board → assert six columns render; move a card and assert the stage PATCH; open a card
  → assert the drawer's four sub-tabs; a quote-note round-trip via `subject_type=quote`
  (screenshots with `reducedMotion:'reduce'`).
- `tests/functions-import-resolve.test.mjs` already covers `functions/api/admin/*` and the
  reused `crm/*` subfolder; no new route folder is introduced.
- Full `npm run check` + `npm test` (keep the Slice 1 count green plus the new tests) +
  `npm run build`.

## Migration / grants note

`schema-crm-pipeline.sql` is owner-applied to prod (additive, idempotent, re-runnable). No new
grants: `quotes` already grants `service_role`. No new static assets (admin JS is git-tracked and
shipped by `cf-build`). New `functions/_lib/crm-pipeline.js` is bundled by esbuild via its import
from `functions/api/admin/quotes.js` — run `functions-import-resolve` + `npm run build` before
pushing.

## Definition of done

Green `check` / `test` / `build`; Playwright-verified board + drawer; AA + keyboard (stage select
path proven without a pointer); loading / empty / error states present; new endpoint, lib, and
schema tests added; PR opened off `feat/crm-contact-view` (owner merges Slice 1 + 2, or this slice
rebases onto `main` if Slice 1 merges first). `schema-crm-pipeline.sql` handed to owner for prod
apply. Durable decisions recorded in file memory.

---

## Addendum — Slice 3 (Pipeline Reporting) folded into this PR

Reporting was originally listed as a later slice. Because it is the direct payoff of the
pipeline data and adds no shared-file surface, it was built into this branch as a third
**Reports** view on the Quotes toggle (List | Board | Reports):

- **Pure aggregators** in `functions/_lib/crm-pipeline.js`: `conversionFunnel` (reached-count
  funnel + step rates, lost excluded), `forecastByMonth` (open valued deals by `expected_close`
  YYYY-MM, weighted, `unscheduled` bucket last), `lossReasonBreakdown`, `pipelineKpis`
  (open/won/lost counts + values, win rate, avg deal), and `pipelineReport` bundling all four.
- **API** `GET /api/admin/quotes?view=report` returns `pipelineReport` over all non-spam rows.
- **UI** `renderReport()` in `js/admin/quotes.js`: KPI cards, conversion-funnel bars,
  weighted-forecast-by-month bars, loss-reason chips. CSS `.pipe-report*` / `.pipe-kpi*` /
  `.pipe-bar*` in `css/components.css`.
- **Tests**: `tests/admin-crm-report-lib.test.mjs` (5) + report assertions in
  `tests/admin-quotes-pipeline.test.mjs` + a second Playwright test (Reports KPIs/funnel/forecast).
  Full suite 700/700.

Still deferred: contact-level records, email templates/sequences, saved segments, multiple
pipelines, round-robin/SLA.
