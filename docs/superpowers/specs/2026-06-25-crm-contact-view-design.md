# CRM Contact View — Slice 1 Design

**Date:** 2026-06-25
**Status:** Approved (design), pre-implementation
**Surface:** Staff admin console only (`admin.html` / `js/admin/*` / `functions/api/admin/*`). No buyer-facing change.

## Problem

The admin CRM is order/quote-centric with no unified contact view. Notes live only on
quotes; there is no generic task/follow-up system; there is no per-company activity
timeline. `audit_log` exists but is not surfaced in the company drawer. ARCHITECTURE.md
priority #1 is a disciplined CRM (score, priority, owner, due date, follow-up). This slice
builds the foundation: a **polymorphic activity timeline + notes + tasks**, surfaced on the
company detail drawer. The multi-stage quote pipeline (slice 2) will read the same data.

## Scope

**In:** `crm_notes` + `crm_tasks` tables (polymorphic subject), three `/api/admin/crm/*`
endpoints, a `js/admin/crm.js` module, three new sub-tabs in the company detail drawer
(Timeline | Tasks | Notes), and an open/overdue follow-ups badge + mini-list on the admin
Overview. Tests for each endpoint. Playwright coverage of the drawer tabs.

**Out (later slices):** `quotes.pipeline_stage` + grouped/kanban board; saved views /
segments; bulk actions; note editing; quote-drawer CRM UI (schema is ready, UI deferred);
any CMS work.

## Key decisions

1. **Virtual timeline (read-time merge), not a materialized `crm_activity` table.** The
   timeline endpoint queries existing per-company signals and merges them with the two new
   tables at read time, sorted descending. No write-path instrumentation, no backfill, no
   migration risk; full history appears immediately. Trade-off: heavier read query, but
   bounded per company.
2. **"Manual activity" collapses into `crm_notes.kind`.** A logged call/email/meeting is a
   note with `kind in ('note','call','email','meeting')`. No separate activity table.
3. **Polymorphic subject** `(subject_type, subject_id)`. `subject_type in ('company','quote')`.
   Slice 1 wires UI for `company` only; `quote` is schema-ready for slice 2.
4. **Quote↔company linkage is best-effort.** Quotes store `company` as free text and an
   `email`, with no `company_id` FK. The company timeline matches quotes where the quote
   `email` is one of the company's member emails OR `quotes.company ILIKE company.name`.
   Documented as best-effort; exact linkage is a later concern.

## Schema — `supabase/schema-crm.sql`

Additive and idempotent (`create table if not exists`, `create index if not exists`).
Ends with explicit grants (pooler-created tables fail `42501` on insert without them):
`grant all privileges on crm_notes, crm_tasks to service_role;` plus
`grant usage, select on all sequences in schema public to service_role;`.

```
crm_notes
  id            bigint generated always as identity primary key
  subject_type  text  not null  check in ('company','quote')
  subject_id    text  not null                 -- companies.id / quotes.id as text
  kind          text  not null default 'note'  check in ('note','call','email','meeting')
  body          text  not null
  created_by    text  not null                 -- staff email
  created_at    timestamptz not null default now()
  deleted_at    timestamptz                     -- soft delete
  index (subject_type, subject_id, created_at desc)

crm_tasks
  id            bigint generated always as identity primary key
  subject_type  text  not null  check in ('company','quote')
  subject_id    text  not null
  title         text  not null
  due_at        timestamptz
  assigned_to   text                            -- staff email; null = unassigned
  status        text  not null default 'open'  check in ('open','done')
  created_by    text  not null
  created_at    timestamptz not null default now()
  completed_at  timestamptz
  completed_by  text
  index (subject_type, subject_id)
  index (status, due_at)                         -- global overdue/open scans
```

RLS: enable, no anon/authenticated policies (service-role bypass via grant), matching
`audit_log`. All access is server-side through `requireStaff`.

## Endpoints — `functions/api/admin/crm/`

Subfolder routing like `functions/api/admin/qbo/*`. Import depth is `../../../_lib/...`
(verified against `qbo/*.js`). Every handler starts with `requireStaff`; write methods
additionally require `staffCanWrite(role)` (read-only staff denied, consistent with other
admin writes). Validate `subject_type` against the allow-list; reject unknown values 400.
Use `paginate` helpers (`parsePage`, `pageEnvelope`) for list responses.

| Route | Methods | Behavior |
|-------|---------|----------|
| `/api/admin/crm/timeline` | GET | `?subject_type=company&subject_id=<id>` → merged desc feed: orders, messages, shipment_events, audit_log, best-effort quotes, crm_notes, crm_tasks (created + completed). Each item normalized to `{at, type, title, detail, ref}`. Bounded (e.g. latest 200). |
| `/api/admin/crm/notes` | GET / POST / DELETE | GET `?subject_type&subject_id` lists non-deleted notes desc. POST `{subject_type, subject_id, kind?, body}` creates (`created_by` = staff email). DELETE `?id=` soft-deletes; allowed for the author or an `owner` role. |
| `/api/admin/crm/tasks` | GET / POST / PATCH | GET `?subject_type&subject_id` (per-subject) or `?scope=mine\|overdue\|open` (global). POST `{subject_type, subject_id, title, due_at?, assigned_to?}`. PATCH `{id, action:'complete'\|'reopen'\|'reassign', assigned_to?}` (complete sets `completed_at`/`completed_by`). |

Write actions emit an `auditLog` entry (best-effort) per existing convention.

## UI

- **New module `js/admin/crm.js`**, factory shape matching `companies.js`
  (`createCrmPanel({ $, api, admSkeleton, admEmpty, ... })`). Keeps `companies.js` from
  growing past its current 278 LOC (ARCHITECTURE.md: split before growing).
- **Company detail drawer** already supports `data-company-detail-tab` buttons (messages,
  orders). Add **Timeline**, **Tasks**, **Notes** tabs that delegate to `crm.js` renderers.
  - Timeline: read-only feed, icon + relative time + title/detail. `.skeleton` while
    loading, `.empty-state` when empty, error row on failure.
  - Notes: list + composer (`kind` select + textarea + submit); soft-delete control on own
    notes. Optimistic-free (re-fetch after write).
  - Tasks: list (open first, overdue flagged) + composer (title, due date, assignee select
    from staff list); complete / reopen / reassign controls.
- **Overview action rail:** an **open / overdue follow-ups** badge (reuses the existing
  stats card pattern) linking to a small global task list (`?scope=overdue` then `open`).
- Reuse `.tabs`, `.data-table`, `.empty-state`, `.skeleton` from DESIGN.md /
  `css/components.css`. No new one-off CSS unless a token gap is found. Keyboard-operable
  tabs/controls; AA contrast on any new status/badge colors.

## Error / empty / loading states

Every new view renders three states explicitly: `.skeleton` during fetch, `.empty-state`
with a one-line prompt when no rows, and an inline error row (retry affordance) on failure.
Endpoints return structured JSON errors (`{error}`) with correct status; no stack leakage
(matches `api-error-masking` test expectations).

## Testing

- `tests/admin-crm-notes.test.mjs` — route shape, auth gate (401/403), `subject_type`
  validation, soft-delete authorization (author/owner only).
- `tests/admin-crm-tasks.test.mjs` — create/list/scope filters, PATCH transitions
  (complete sets completed fields), auth + write-guard.
- `tests/admin-crm-timeline.test.mjs` — merge ordering (desc), source normalization shape,
  auth gate, bounded result.
- `tests/functions-import-resolve.test.mjs` auto-covers the new subfolder import paths.
- Extend an existing admin Playwright spec (e.g. `tools/admin-quote-message-flows.spec.mjs`
  pattern) to open a company drawer and assert the three tabs + a note round-trip render
  (screenshots with `reducedMotion:'reduce'`).
- Full `npm run check` + `npm test` (keep ~649 green, plus the new tests) + `npm run build`.

## Migration / grants note

`schema-crm.sql` is owner-applied to prod (additive, idempotent, re-runnable). It MUST
include the `service_role` table + sequence grants or CF inserts fail `42501`. New static
assets: none (admin JS is git-tracked and shipped by `cf-build`). Verify the build does not
drop anything: new `functions/api/admin/crm/*.js` files are bundled by esbuild — run
`functions-import-resolve` + `npm run build` before pushing.

## Definition of done

Green `check` / `test` / `build`; Playwright-verified drawer tabs; AA + keyboard; loading /
empty / error states present; new endpoint tests added; PR opened off `main` (owner merges
to deploy). `schema-crm.sql` handed to owner for prod apply. Durable decisions recorded in
file memory.
