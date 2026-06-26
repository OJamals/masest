# CRM Slice 4 — Contact-Level Records (design)

**Goal:** Let a company hold multiple named contacts (procurement, plant manager, maintenance, AP…) with role/title/email/phone and one primary, instead of the single email-per-quote the app has today.

**Why now:** Slices 1–3 (timeline/notes/tasks, deal pipeline, reporting) shipped + live. A real CRM keys relationships to *people* at an account. This is the last structural gap (research gap #7). No customer email involved → safe to build standalone.

## Architecture
Mirrors Slice 1's `crm_notes`/`crm_tasks` exactly: idempotent additive table + service_role grants, a pure `_lib` row/validation module (no I/O, unit-tested), a staff-guarded subfolder endpoint, and a new tab inside the existing reusable `createCrmPanel`. Contacts are company-scoped, so the tab renders only for `subject_type==='company'` mounts (company drawer), not quote/deal drawers.

**Footprint (collision-safe vs the concurrent CMS agent):** new `supabase/schema-crm-contacts.sql`, `functions/_lib/crm-contacts.js`, `functions/api/admin/crm/contacts.js`, edits to `js/admin/crm.js` + `css/components.css`, tests. NO `admin.html` / `js/admin.js` / `service-catalog.js` / content files.

## Data model — `public.crm_contacts`
- `id` bigint identity PK
- `company_id` text not null  (matches `company.id` passed to `crm.mount(box,'company',company.id)`)
- `name` text not null
- `role` text not null default 'other' — CHECK in: procurement, plant_manager, maintenance, engineering, operations, accounts_payable, executive, other
- `title` text (free-form job title)
- `email` text, `phone` text
- `is_primary` boolean not null default false
- `notes` text
- `created_by` text, `created_at` timestamptz default now(), `updated_at` timestamptz, `deleted_at` timestamptz
- index `(company_id, is_primary desc, name)`; RLS on; `grant all … to service_role` + sequence grants.

At most one primary per company — enforced in the handler (setting a primary demotes siblings), not a partial unique index, to keep the migration simple and idempotent.

## Pure lib — `functions/_lib/crm-contacts.js`
- `CONTACT_ROLES` array + `ROLE_LABELS` map; `validRole(r)`.
- `contactRow({ company_id, name, role, title, email, phone, is_primary, notes, actor })` → `{ row }` or `{ error }`. Errors: `company_required`, `name_required`, `invalid_email`. Role coerced to enum (default 'other'); strings trimmed/capped; email validated when present; `is_primary` coerced boolean.
- `contactPatch({ name, role, title, email, phone, is_primary, notes }, now)` → `{ patch }` or `{ error }`; only provided keys included; sets `updated_at`; validates email when present.
- `EMAIL_RE` shared validation.

## Endpoint — `functions/api/admin/crm/contacts.js` (import depth `../../../_lib/`)
- `requireStaff` + `staffCanWrite(role)` guards (same as notes/tasks).
- **GET** `?company_id=` → non-deleted contacts, order `is_primary desc, name asc`, limit 200. `needs_migration:true` fallback when the table is absent (regex on error, like notes).
- **POST**: body with `id` → update via `contactPatch`; without `id` → create via `contactRow`. When the resulting record `is_primary` is true, first demote siblings (`update {is_primary:false} where company_id=cid and id<>thisId`). Audit `crm.contact_add` / `crm.contact_update`.
- **DELETE** `?id=` → soft delete (`deleted_at`). Any write-capable staff (shared company record, not a personal note → no author gate). Audit `crm.contact_delete`.

## UI — `js/admin/crm.js`
- `panelShell` adds a **Contacts** tab button only when `subjectType==='company'`.
- `renderContacts(contacts)`: composer (name, role `<select>`, title, email, phone, primary checkbox, Add) + list cards (name + ★ primary, role badge, title, email mailto, phone, Edit, Set-primary, Delete) + empty state.
- `load()` handles `tab==='contacts'` → GET `/api/admin/crm/contacts?company_id=<subjectId>`.
- click handler: delete (confirm), set-primary, edit (repopulate composer + switch to update mode via `form.dataset.editId`).
- submit handler: contact form → POST (create, or update when `editId` set), reload.

## CSS — `css/components.css`
`.crm-contact`, `.crm-contact-form`, `.crm-contact-role` badge, `.crm-contact-primary` star. Reuse existing tokens (`--accent`, `--surface-2`, `--border`, `--muted`); no raw status hex (regression test forbids it).

## Testing
- `admin-crm-contacts-schema.test.mjs` — table, role CHECK, index, service_role grant present.
- `admin-crm-contacts-lib.test.mjs` — roles, `contactRow` validation (company/name/email), default role, `contactPatch` partial + updated_at.
- `admin-crm-contacts-api.test.mjs` — import depth, staff guard, GET company_id, POST create+update branches, primary demotion, DELETE soft.
- `admin-crm-contacts-ui.test.mjs` — source-contract grep on `crm.js`: Contacts tab gated to company, contacts endpoint call, form fields, edit/primary/delete handlers.
- Existing Playwright (`admin-crm-pipeline.spec.mjs`) must stay green; no new spec (company-drawer stubbing out of scope for this slice).

## Out of scope (defer)
Contact ↔ quote linkage, dedupe/merge, import, per-contact activity timeline. Saved-filter named views + multiple pipelines remain the other deferred CRM slices.
