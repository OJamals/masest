# Spec — `pricing_tier` CMS type (editable program pricing)

**Date:** 2026-06-28
**Goal:** Make the four `programs.html` pricing tiers editable through the existing CMS
instead of hardcoded HTML, so price/feature changes ship without a code deploy.

## Context / correction
A QA pass flagged two CMS gaps: hardcoded pricing tiers, and "orphan" `service` /
`service_package` types. On verification the service types are **already wired** —
`js/main/service-catalog.js` (`fetchServicesCatalog`) loads `/data/content/services.json`
(CMS) first and falls back to the legacy `/data/services.json` catalog, mounted on
`services.html` via `[data-service-catalog]` + `js/main.js:initServiceCatalog()`. So the
only real gap is **pricing**. No service-type changes are made.

## Design
Registry-driven, mirroring the 7 existing structured types. No DB/schema change — the
`content_entries` table is generic; `type` is a string. `CONTENT_TYPES` and the admin
editor/API validation are all derived from `CONTENT_TYPE_DEFINITIONS`.

### Fields (mirror the existing `.tier-card` markup in `programs.html`)
`badge` · `name` (required) · `audience` · `price` · `price_unit` · `annual` ·
`features` (list) · `replaces` · `cta` · `href` (url) · `featured` (checkbox) ·
`sort_order` (number) · `active` (checkbox)

### Touch points
1. `js/content-types.js` — add `pricing_tier` definition + a `SNAPSHOT_GROUP`
   (`pricing.json` → key `pricing_tiers`). This auto-wires the admin type selector,
   `validateStructuredPayload`/`normalizeStructuredPayload`, `CONTENT_TYPES`, and
   `snapshotGroups()`.
2. `tools/build-content.mjs` — add `"pricing.json": typedPayload(snapshot,
   "pricing_tier", "pricing_tiers")` to the writes map.
3. `js/main/content-snapshots.js` — `SNAPSHOT_FILES.pricing_tiers`, a `pricingTier()`
   renderer emitting `.tier-card` markup, and a `loadContentSnapshot` + `renderMount`
   call in `initContentSnapshots`.
4. `programs.html` — put `data-cms-content="pricing_tiers" data-cms-render="replace"`
   on the `.tier-grid`. The four hardcoded cards stay inside as fallback; an empty or
   missing snapshot leaves the page identical to today (`mergeCmsMountHtml`).
5. `data/content/pricing.json` stub (`{ "pricing_tiers": [] }`) + `manifest.json` entry —
   regenerated offline via `CONTENT_EXPORT_SOURCE='[]' node tools/build-content.mjs`.
6. `tools/verify_site.mjs` — add the `data/content/pricing.json` → `["pricing_tiers"]`
   structural check (required by the registry-derived stub guard).

### Tests (TDD)
- `tests/content-registry.test.mjs` — `pricing_tier` in the type-keys set; `pricing.json`
  in `snapshotGroups()`; normalize/validate of a tier payload (features list, featured
  checkbox, required `name`, url-safe `href`).
- `tests/content-snapshot-stubs.test.mjs` — auto-covers `pricing.json` (stub + manifest +
  verify_site) once the registry entry lands.
- `tests/content-public-snapshots.test.mjs` — `pricing.json` in the snapshot-fetch list;
  `programs.html` exposes the mount.
- New `tests/pricing-tier-render.test.mjs` — `pricingTier()` output contains the tier
  fields and respects the `featured` flag; mount preserves fallback when snapshot empty.

### Out of scope
Service/industry/product catalog (already catalog-driven), nav/footer, `page_meta`
(build-time SEO, correct for SSG). No new CMS types beyond `pricing_tier`.
