# MASEST CMS Expansion and Maturation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mature the existing native MASEST CMS into a reliable editorial operations surface for non-commerce public content without replacing the current admin dashboard or splitting commerce truth out of Supabase.

**Architecture:** Keep the CMS inside the existing `admin.html` staff console, Cloudflare Pages Functions, Supabase tables, static snapshot export, and vanilla JS module system. Build outward from the current Content tab by adding a shared content-type registry, server-side structured validation, revision restore, preview, asset governance, workflow queues, page integration, and publish/export status. Keep product pricing, stock, checkout, Stripe, QBO, quotes, and customer/account data in their existing modules.

**Tech Stack:** Cloudflare Pages Functions, Supabase Postgres/Auth/Storage metadata, vanilla ES modules, static HTML/CSS/JS storefront, Node build tools, `node --test`, Playwright admin smoke tests, local `npm run verify`.

---

## Research Notes

The plan is inspired by open-source CMS systems, but it intentionally keeps MASEST native:

- Payload: fields are explicit schema objects that generate admin UI and can have validation, access control, conditional logic, hooks, and custom components. Use this as the model for a shared MASEST content-type registry instead of keeping UI-only field definitions in `js/admin/content.js`. Source: https://payloadcms.com/docs/fields/overview
- Payload Live Preview: the admin can render a front-end iframe and send edited document data through `postMessage`. Use this pattern for a preview pane that does not require publishing first. Source: https://payloadcms.com/docs/live-preview/overview
- Directus: content versioning supports alternate versions for drafts, collaboration, and safer publishing. MASEST already stores revisions; add usable revision list, diff, and restore. Source: https://directus.com/docs/guides/content/content-versioning
- Strapi: Media Library centralizes uploaded assets with search, filters, folders, and insertion into content. MASEST should add an asset picker and usage tracking before adding broad uploads. Source: https://docs.strapi.io/cms/features/media-library
- Strapi: Content History exposes prior versions with author/time/status and restore. MASEST should surface revision history inside the Content tab. Source: https://docs.strapi.io/cms/features/content-history
- Strapi/Wagtail: review workflow stages and moderation queues are editor-facing features, not just statuses. MASEST should add `in_review`, `changes_requested`, and `scheduled` with owner-gated publish and reviewer queues. Sources: https://docs.strapi.io/cms/features/review-workflows and https://docs.wagtail.org/en/v2.15.1/editor_manual/new_pages/previewing_and_submitting_for_moderation.html
- Wagtail: draft changes should stay in revisions until publish, and dashboard panels should show waiting reviews, locks, and recent edits. MASEST should avoid publishing side effects on draft save and add an operations dashboard for content. Sources: https://docs.wagtail.org/en/7.1/topics/snippets/features.html and https://docs.wagtail.org/en/v3.0.1/editor_manual/finding_your_way_around/the_dashboard.html
- Decap CMS: Git-backed editorial workflow creates a pull request per unpublished entry. MASEST should not move content into Git now, but should copy the auditability idea through export manifests and publish logs. Sources: https://decapcms.org/docs/intro/ and https://decapcms.org/docs/editorial-workflows/
- TinaCMS/Keystatic: file-backed systems prove the value of local JSON/YAML schemas and visual editing over raw JSON. MASEST should keep static snapshots and add visual editors/previews, not adopt a separate file CMS. Sources: https://github.com/tinacms/tinacms and https://keystatic.com/docs/configuration

## Current State

- Implemented CMS files:
  - `supabase/schema-content.sql`
  - `functions/_lib/content.js`
  - `functions/api/admin/content.js`
  - `js/admin/content.js`
  - `tools/build-content.mjs`
  - `tests/content-validation.test.mjs`
  - `tests/content-expansion.test.mjs`
  - `tools/admin-content-cms.spec.mjs`
- Current capabilities:
  - owner-gated Content tab in `admin.html`
  - content entries, revisions, assets table shell
  - draft, publish, archive
  - structured fields for CMS-owned content types
  - static snapshots under `data/content/*.json`
  - optional snapshot verification
  - admin smoke for structured edit desktop/mobile
- Current gaps:
  - structured field definitions live in admin UI code, not a shared registry
  - server accepts any object payload for a supported type
  - no revision list, diff, or restore UI
  - no preview pane or draft preview URL
  - no asset picker, usage tracking, alt-text enforcement, or focal point UI
  - no review/scheduled workflow
  - proof/resources/industries/FAQ snapshots are exported but not yet consumed by public pages
  - no export manifest or publish/build status in admin

## Maturity Boundary

CMS owns:

- services and service packages display metadata
- proof/case cards
- resource cards
- industry/use-case cards
- FAQ blocks
- page metadata
- content asset metadata and usage references
- draft/review/scheduled/publish lifecycle for the above

CMS does not own:

- product variants, stock, pricing, Stripe, tax, checkout, freight, QBO, orders, buyer accounts, quote conversion, or product mode
- the product buy-vs-quote contract
- generated product detail pages except approved display/SEO overlays already routed through product tooling

## File Structure

Create:

- `js/content-types.js` - shared browser-safe CMS type registry, field definitions, payload normalization, and payload validation.
- `functions/api/admin/content-revisions.js` - staff-only revision listing and restore endpoint.
- `functions/api/admin/content-assets.js` - staff-only asset metadata and usage endpoint.
- `functions/api/admin/content-preview.js` - staff-only preview payload endpoint for iframe/public preview URLs.
- `content-preview.html` - static preview shell for draft content.
- `js/content-preview.js` - iframe renderer that receives draft payload via `postMessage`.
- `js/main/content-snapshots.js` - optional snapshot loader and typed rendering helpers for proof/resources/industries/FAQ content.
- `tests/content-registry.test.mjs` - shared type registry and validation tests.
- `tests/content-revisions.test.mjs` - revision restore and diff source-contract tests.
- `tests/content-assets.test.mjs` - asset metadata and usage contract tests.
- `tests/content-preview.test.mjs` - preview shell and message contract tests.
- `tests/content-public-snapshots.test.mjs` - public snapshot integration tests.
- `tools/content-smoke.spec.mjs` - Playwright coverage for preview, revision restore, asset picker, and workflow state.

Modify:

- `supabase/schema-content.sql` - add lifecycle fields, locks, scheduled publish time, asset metadata details, and export log table.
- `functions/_lib/content.js` - import registry validation, add revision diff/restore, asset usage helpers, workflow transitions, and export manifest helpers.
- `functions/api/admin/content.js` - route workflow actions and reject invalid type-specific payloads server-side.
- `functions/_lib/authz.js` - add `content.review`, `content.publish`, `content.assets`, and keep `content.write`.
- `admin.html` - add preview/revision/asset/workflow panels and responsive CSS.
- `js/admin/content.js` - consume `js/content-types.js`, split large editor concerns, add preview/revision/asset/workflow UI.
- `tools/build-content.mjs` - write `data/content/manifest.json` with counts, hashes, and generated timestamp.
- `tools/verify_site.mjs` - validate public snapshot references, image alt text, URL safety, and manifest shape.
- `package.json` - include `tools/content-smoke.spec.mjs` in `smoke:admin`.

## Validation Gates

Run these after each task that changes production code:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-registry.test.mjs
node --test --test-concurrency=1 --test-timeout=120000 tests/content-validation.test.mjs tests/content-expansion.test.mjs
npm run check
npm run smoke:admin
```

Run these before closing the whole plan:

```bash
npm run build:content
npm run verify
npm run smoke:admin
git diff --check
```

Use Playwright screenshots for:

- `admin.html#content` desktop structured editor
- `admin.html#content` mobile workflow/asset state
- preview pane desktop
- preview pane mobile
- public pages consuming CMS snapshots: `proof.html`, `resources.html`, `industries.html`, and `services.html`

## Task 1: Shared Content Type Registry and Server Validation

**Files:**

- Create: `js/content-types.js`
- Create: `tests/content-registry.test.mjs`
- Modify: `js/admin/content.js`
- Modify: `functions/_lib/content.js`
- Modify: `tests/content-expansion.test.mjs`
- Modify: `tests/content-validation.test.mjs`

- [ ] **Step 1: Write the failing registry test**

Create `tests/content-registry.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_TYPE_DEFINITIONS,
  contentPayloadFields,
  normalizeStructuredPayload,
  validateStructuredPayload,
  snapshotGroups,
} from "../js/content-types.js";

test("CMS type registry exposes every supported non-commerce type", () => {
  assert.deepEqual(Object.keys(CONTENT_TYPE_DEFINITIONS).sort(), [
    "faq_block",
    "industry_card",
    "page_meta",
    "proof_card",
    "resource_card",
    "service",
    "service_package",
  ]);
  assert.equal(CONTENT_TYPE_DEFINITIONS.product, undefined);
});

test("registry normalizes type-specific structured payloads", () => {
  assert.deepEqual(
    normalizeStructuredPayload("service", {
      sku: " MS-LAB-WATER ",
      category: "Lab",
      public_price: "130.25",
      active: "on",
      chips: "should not survive",
    }),
    {
      sku: "MS-LAB-WATER",
      category: "Lab",
      public_price: 130.25,
      active: true,
    },
  );
});

test("registry validates required fields and URL/image fields", () => {
  assert.deepEqual(validateStructuredPayload("resource_card", { href: "javascript:alert(1)" }), {
    ok: false,
    error: "href_invalid_url",
  });
  assert.deepEqual(validateStructuredPayload("faq_block", { question: "What is NET?", answer: "Invoice terms." }), {
    ok: true,
    payload: { question: "What is NET?", answer: "Invoice terms." },
  });
});

test("snapshotGroups returns every public export target", () => {
  assert.deepEqual(snapshotGroups().map((group) => group.file), [
    "services.json",
    "page-meta.json",
    "proof.json",
    "resources.json",
    "industries.json",
    "faqs.json",
  ]);
  assert.ok(contentPayloadFields("proof_card").some((field) => field.key === "result"));
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-registry.test.mjs
```

Expected: fail with `ERR_MODULE_NOT_FOUND` for `../js/content-types.js`.

- [ ] **Step 3: Create the shared registry**

Create `js/content-types.js`:

```js
const URL_FIELDS = new Set(["href", "image", "og_image"]);

export const CONTENT_TYPE_DEFINITIONS = {
  service: {
    label: "Services",
    snapshot: { file: "services.json", key: "services" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text", required: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
    ],
  },
  service_package: {
    label: "Service packages",
    snapshot: { file: "services.json", key: "service_packages" },
    fields: [
      { key: "sku", label: "SKU", kind: "text", required: true },
      { key: "category", label: "Category", kind: "text" },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "public_price", label: "Public price", kind: "number" },
      { key: "currency", label: "Currency", kind: "text" },
      { key: "active", label: "Active", kind: "checkbox" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full" },
    ],
  },
  proof_card: {
    label: "Proof cards",
    snapshot: { file: "proof.json", key: "proof_cards" },
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text" },
      { key: "kind", label: "Sector key", kind: "text" },
      { key: "chips", label: "Chips", kind: "list" },
      { key: "source", label: "Source", kind: "text" },
      { key: "image", label: "Image path", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "href", label: "Link", kind: "text" },
      { key: "result", label: "Result", kind: "textarea", className: "full", required: true },
    ],
  },
  resource_card: {
    label: "Resource cards",
    snapshot: { file: "resources.json", key: "resource_cards" },
    fields: [
      { key: "href", label: "Link", kind: "text", required: true },
      { key: "cta", label: "CTA", kind: "text" },
      { key: "icon", label: "Icon", kind: "text" },
      { key: "description", label: "Description", kind: "textarea", className: "full", required: true },
    ],
  },
  industry_card: {
    label: "Industry cards",
    snapshot: { file: "industries.json", key: "industry_cards" },
    fields: [
      { key: "href", label: "Link", kind: "text", required: true },
      { key: "image", label: "Image path", kind: "text" },
      { key: "image_alt", label: "Image alt", kind: "text" },
      { key: "summary", label: "Summary", kind: "textarea", className: "full", required: true },
    ],
  },
  faq_block: {
    label: "FAQ blocks",
    snapshot: { file: "faqs.json", key: "faq_blocks" },
    fields: [
      { key: "category", label: "Category", kind: "text" },
      { key: "question", label: "Question", kind: "text", className: "wide", required: true },
      { key: "answer", label: "Answer", kind: "textarea", className: "full", required: true },
    ],
  },
  page_meta: {
    label: "Page metadata",
    snapshot: { file: "page-meta.json", key: "page_meta" },
    fields: [
      { key: "page", label: "Page", kind: "text", required: true },
      { key: "description", label: "Description", kind: "textarea", className: "full", required: true },
      { key: "og_image", label: "OG image", kind: "text" },
      { key: "jsonld_type", label: "JSON-LD type", kind: "text" },
    ],
  },
};

export function contentPayloadFields(type) {
  return [...(CONTENT_TYPE_DEFINITIONS[type]?.fields || [])];
}

export function snapshotGroups() {
  const seen = new Map();
  for (const [type, definition] of Object.entries(CONTENT_TYPE_DEFINITIONS)) {
    const group = definition.snapshot;
    if (!seen.has(group.file)) seen.set(group.file, { file: group.file, types: [] });
    seen.get(group.file).types.push({ type, key: group.key });
  }
  return [...seen.values()];
}

function parseList(value) {
  return String(value || "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^(?:javascript|data|vbscript):/i.test(text.replace(/\s+/g, ""))) return "";
  return text;
}

export function normalizeStructuredPayload(type, values = {}) {
  const payload = {};
  for (const field of contentPayloadFields(type)) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    if (field.kind === "checkbox") {
      payload[field.key] = raw === true || raw === "true" || raw === "on" || raw === "1";
      continue;
    }
    if (field.kind === "number") {
      const value = Number(String(raw || "").trim());
      if (Number.isFinite(value)) payload[field.key] = value;
      continue;
    }
    if (field.kind === "list") {
      const list = parseList(raw);
      if (list.length) payload[field.key] = list;
      continue;
    }
    const value = URL_FIELDS.has(field.key) ? cleanUrl(raw) : String(raw || "").trim();
    if (value) payload[field.key] = value;
  }
  return payload;
}

export function validateStructuredPayload(type, values = {}) {
  if (!CONTENT_TYPE_DEFINITIONS[type]) return { ok: false, error: `unsupported_content_type:${type}` };
  const payload = normalizeStructuredPayload(type, values);
  for (const field of contentPayloadFields(type)) {
    if (field.required && (payload[field.key] === undefined || payload[field.key] === "")) {
      return { ok: false, error: `${field.key}_required` };
    }
    if (URL_FIELDS.has(field.key) && values[field.key] && !payload[field.key]) {
      return { ok: false, error: `${field.key}_invalid_url` };
    }
  }
  return { ok: true, payload };
}
```

- [ ] **Step 4: Modify admin and repository to use the registry**

In `js/admin/content.js`, remove local `PAYLOAD_FIELDSETS`, `parseList`, `structuredPayloadFromValues`, and `contentPayloadFields`, then import:

```js
import {
  CONTENT_TYPE_DEFINITIONS,
  contentPayloadFields,
  normalizeStructuredPayload,
} from "../content-types.js";
```

Replace the local `TYPES` definition with:

```js
const TYPES = Object.entries(CONTENT_TYPE_DEFINITIONS).map(([key, definition]) => [key, definition.label]);
```

Replace `structuredPayloadFromValues(type, values)` calls with:

```js
normalizeStructuredPayload(type, values)
```

In `functions/_lib/content.js`, import:

```js
import { CONTENT_TYPE_DEFINITIONS, validateStructuredPayload } from "../../js/content-types.js";
```

Replace `CONTENT_TYPES` with:

```js
export const CONTENT_TYPES = new Set(Object.keys(CONTENT_TYPE_DEFINITIONS));
```

Inside `validateContentEntry`, after the object payload check, add:

```js
const structured = validateStructuredPayload(entry.type, entry.payload);
if (!structured.ok) return { ok: false, error: structured.error };
entry.payload = { ...entry.payload, ...structured.payload };
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-registry.test.mjs tests/content-validation.test.mjs tests/content-expansion.test.mjs
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add js/content-types.js js/admin/content.js functions/_lib/content.js tests/content-registry.test.mjs tests/content-validation.test.mjs tests/content-expansion.test.mjs
git commit -m "feat: share cms content type registry"
```

## Task 2: Revision History, Diff, and Restore

**Files:**

- Create: `functions/api/admin/content-revisions.js`
- Create: `tests/content-revisions.test.mjs`
- Modify: `functions/_lib/content.js`
- Modify: `js/admin/content.js`
- Modify: `admin.html`

- [ ] **Step 1: Write the failing source-contract tests**

Create `tests/content-revisions.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content repository exposes revision list and restore contracts", () => {
  const source = readFileSync(new URL("../functions/_lib/content.js", import.meta.url), "utf8");
  assert.match(source, /async listRevisions\(/);
  assert.match(source, /async restoreRevision\(/);
  assert.match(source, /content_revisions/);
  assert.match(source, /Restored revision/);
});

test("admin revision endpoint is staff gated and write-gated for restore", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-revisions.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /createContentRepository/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
  assert.match(source, /staffCan\(role, "content\.write"\)/);
});

test("content editor renders revision history and restore controls", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentRevisionList/);
  assert.match(source, /data-content-revision/);
  assert.match(source, /restoreRevision/);
  assert.match(source, /\/api\/admin\/content-revisions/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-revisions.test.mjs
```

Expected: fail because `functions/api/admin/content-revisions.js` does not exist.

- [ ] **Step 3: Add repository revision methods**

In `functions/_lib/content.js`, add methods inside `createContentRepository(sb)`:

```js
async listRevisions({ type, slug, locale = "en" } = {}) {
  const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
  if (!entry?.id) return [];
  const { data, error } = await sb
    .from("content_revisions")
    .select("*")
    .eq("entry_id", entry.id)
    .order("version", { ascending: false });
  if (error) throw error;
  return data || [];
},

async restoreRevision({ type, slug, locale = "en", version } = {}, userId) {
  const entry = await existingEntry(sb, { type, slug: normalizeSlug(slug), locale });
  if (!entry?.id) return { ok: false, error: "entry_not_found" };
  const { data: revision, error } = await sb
    .from("content_revisions")
    .select("*")
    .eq("entry_id", entry.id)
    .eq("version", Number(version))
    .single();
  if (error) throw error;
  return this.saveEntry(
    {
      ...entry,
      payload: objectValue(revision.payload),
      seo: objectValue(revision.seo),
      status: "draft",
    },
    userId,
    `Restored revision ${revision.version}`,
  );
},
```

- [ ] **Step 4: Add the admin revisions endpoint**

Create `functions/api/admin/content-revisions.js`:

```js
import { createContentRepository } from "../../_lib/content.js";
import { staffCan } from "../../_lib/authz.js";
import { adminClient, json, readBody, requireStaff } from "../../_lib/supabase.js";

export async function onRequest({ request, env }) {
  const staff = await requireStaff(request, env);
  if (staff.response) return staff.response;
  const role = staff.role || "owner";
  const repo = createContentRepository(adminClient(env));

  if (request.method === "GET") {
    const url = new URL(request.url);
    const revisions = await repo.listRevisions({
      type: url.searchParams.get("type"),
      slug: url.searchParams.get("slug"),
      locale: url.searchParams.get("locale") || "en",
    });
    return json({ revisions });
  }

  if (request.method === "POST") {
    if (!staffCan(role, "content.write")) return json({ error: "forbidden" }, 403);
    const body = await readBody(request);
    const result = await repo.restoreRevision(body || {}, staff.user?.id);
    return json(result, result.ok === false ? 400 : 200);
  }

  return json({ error: "method_not_allowed" }, 405);
}
```

- [ ] **Step 5: Add revision UI**

In `js/admin/content.js`, add a revision panel inside `shellTemplate` below the editor form:

```html
<div class="adm-card adm-content-revisions">
  <div class="adm-panel-header">
    <h2>Revision history</h2>
  </div>
  <div id="contentRevisionList" class="adm-list"></div>
</div>
```

Add functions:

```js
async function loadRevisions(entry) {
  const list = $("contentRevisionList");
  if (!list || !entry?.type || !entry?.slug) return;
  list.innerHTML = admSkeleton(3);
  try {
    const query = new URLSearchParams({ type: entry.type, slug: entry.slug, locale: entry.locale || "en" });
    const data = await api(`/api/admin/content-revisions?${query.toString()}`);
    list.innerHTML = (data.revisions || []).map((revision) => `
      <button class="adm-list-row" type="button" data-content-revision="${esc(revision.version)}">
        <b>Version ${esc(revision.version)}</b>
        <span>${esc(revision.status || "")} · ${esc(revision.created_at ? new Date(revision.created_at).toLocaleString() : "")}</span>
      </button>
    `).join("") || admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.");
  } catch (error) {
    list.innerHTML = admEmpty("ph-warning", "Revision history unavailable", error.data?.message || error.message || "Try again.");
  }
}

async function restoreRevision(version) {
  const entry = selectedFormEntry();
  const result = await api("/api/admin/content-revisions", {
    method: "POST",
    body: { type: entry.type, slug: entry.slug, locale: entry.locale, version },
  });
  populateForm(result.entry || {});
  setStatus(`Restored version ${version} as a draft.`, "ok");
  await renderContent({ refetch: true });
}
```

Call `loadRevisions(result.entry || {})` after save/publish/archive and after `populateForm(entry)` in `editEntry`.

Wire:

```js
delegate(root, "click", "[data-content-revision]", (_event, button) => restoreRevision(button.dataset.contentRevision));
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-revisions.test.mjs
npm run smoke:admin
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/content.js functions/api/admin/content-revisions.js js/admin/content.js admin.html tests/content-revisions.test.mjs
git commit -m "feat: add cms revision restore"
```

## Task 3: Draft Preview Pane

**Files:**

- Create: `content-preview.html`
- Create: `js/content-preview.js`
- Create: `functions/api/admin/content-preview.js`
- Create: `tests/content-preview.test.mjs`
- Modify: `js/admin/content.js`
- Modify: `admin.html`
- Modify: `tools/admin-content-cms.spec.mjs`

- [ ] **Step 1: Write the failing preview tests**

Create `tests/content-preview.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content preview shell listens for admin postMessage payloads", () => {
  const html = readFileSync(new URL("../content-preview.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../js/content-preview.js", import.meta.url), "utf8");
  assert.match(html, /id="contentPreviewRoot"/);
  assert.match(html, /js\/content-preview\.js/);
  assert.match(js, /addEventListener\("message"/);
  assert.match(js, /masest:content-preview/);
  assert.match(js, /renderPreview/);
});

test("admin content editor owns a preview iframe and sends draft payloads", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentPreviewFrame/);
  assert.match(source, /postMessage/);
  assert.match(source, /masest:content-preview/);
  assert.match(source, /refreshPreview/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-preview.test.mjs
```

Expected: fail because `content-preview.html` does not exist.

- [ ] **Step 3: Add the preview shell**

Create `content-preview.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Content preview</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body class="site-soft-bg">
  <main id="contentPreviewRoot" class="section" aria-live="polite">
    <div class="wrap">
      <p class="muted">Waiting for preview content.</p>
    </div>
  </main>
  <script type="module" src="js/content-preview.js"></script>
</body>
</html>
```

Create `js/content-preview.js`:

```js
const root = document.getElementById("contentPreviewRoot");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

function renderPreview(entry = {}) {
  const payload = entry.payload && typeof entry.payload === "object" ? entry.payload : {};
  root.innerHTML = `
    <div class="wrap">
      <span class="eyebrow">${esc(entry.type || "content")}</span>
      <h1 class="headline">${esc(entry.title || "Untitled draft")}</h1>
      <p class="subhead">${esc(payload.summary || payload.description || payload.result || payload.answer || "")}</p>
      <pre class="adm-code">${esc(JSON.stringify(payload, null, 2))}</pre>
    </div>
  `;
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== "masest:content-preview") return;
  renderPreview(event.data.entry || {});
});
```

- [ ] **Step 4: Add the admin iframe**

In `js/admin/content.js`, add the preview card inside `shellTemplate`:

```html
<div class="adm-card adm-content-preview">
  <div class="adm-panel-header">
    <h2>Preview</h2>
    <button class="btn btn-ghost btn-sm" type="button" data-content-action="preview">Refresh</button>
  </div>
  <iframe id="contentPreviewFrame" title="Content preview" src="content-preview.html"></iframe>
</div>
```

Add:

```js
function refreshPreview() {
  const frame = $("contentPreviewFrame");
  if (!frame?.contentWindow) return;
  try {
    frame.contentWindow.postMessage({
      type: "masest:content-preview",
      entry: selectedFormEntry(),
    }, window.location.origin);
  } catch (error) {
    setStatus(error.message, "err");
  }
}
```

Call `refreshPreview()` after `populateForm`, after structured field `input`, and when action is `preview`.

- [ ] **Step 5: Add CSS**

In `admin.html`, add:

```css
.adm-content-preview iframe {
  width: 100%;
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
}
```

- [ ] **Step 6: Extend Playwright smoke**

In `tools/admin-content-cms.spec.mjs`, after editing a field, assert:

```js
await page.locator('[data-content-action="preview"]').click();
const frame = page.frameLocator("#contentPreviewFrame");
await expect(frame.locator("h1")).toContainText("Water analysis");
await expect(frame.locator("pre")).toContainText("130.25");
```

- [ ] **Step 7: Run tests and smoke**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-preview.test.mjs
npm run smoke:admin
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add content-preview.html js/content-preview.js js/admin/content.js admin.html tests/content-preview.test.mjs tools/admin-content-cms.spec.mjs
git commit -m "feat: add cms draft preview"
```

## Task 4: Asset Metadata, Picker, and Usage Tracking

**Files:**

- Create: `functions/api/admin/content-assets.js`
- Create: `tests/content-assets.test.mjs`
- Modify: `supabase/schema-content.sql`
- Modify: `functions/_lib/content.js`
- Modify: `js/admin/content.js`
- Modify: `admin.html`
- Modify: `tools/verify_site.mjs`

- [ ] **Step 1: Write the failing asset contract tests**

Create `tests/content-assets.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content schema stores asset metadata, usage, and focal points", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /content_assets/);
  assert.match(sql, /alt\s+text\s+not null/);
  assert.match(sql, /focal_point\s+jsonb/);
  assert.match(sql, /usage\s+jsonb/);
  assert.match(sql, /asset_status/);
});

test("asset endpoint is staff gated and content asset permission gated", () => {
  const source = readFileSync(new URL("../functions/api/admin/content-assets.js", import.meta.url), "utf8");
  assert.match(source, /requireStaff/);
  assert.match(source, /staffCan\(role, "content\.assets"\)/);
  assert.match(source, /request\.method === "GET"/);
  assert.match(source, /request\.method === "POST"/);
});

test("content editor has an asset picker contract", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentAssetPicker/);
  assert.match(source, /data-content-asset-field/);
  assert.match(source, /\/api\/admin\/content-assets/);
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-assets.test.mjs
```

Expected: fail because `functions/api/admin/content-assets.js` does not exist and `asset_status` is not in schema.

- [ ] **Step 3: Extend schema**

In `supabase/schema-content.sql`, add before `content_assets`:

```sql
do $$ begin
  create type asset_status as enum ('available','archived');
exception when duplicate_object then null; end $$;
```

Add columns to `content_assets`:

```sql
status asset_status not null default 'available',
credit text,
source_url text,
updated_by uuid references auth.users(id) on delete set null,
updated_at timestamptz not null default now()
```

- [ ] **Step 4: Add repository methods**

In `functions/_lib/content.js`, add:

```js
async listAssets({ q = "", status = "available" } = {}) {
  let query = sb.from("content_assets").select("*");
  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("storage_path", `%${q}%`);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
},

async saveAsset(input = {}, userId) {
  const storagePath = String(input.storage_path || "").trim();
  const alt = String(input.alt || "").trim();
  if (!storagePath) return { ok: false, error: "storage_path_required" };
  if (!alt) return { ok: false, error: "alt_required" };
  const { data, error } = await sb
    .from("content_assets")
    .upsert({
      storage_path: storagePath,
      alt,
      mime_type: input.mime_type || null,
      width: Number.isFinite(Number(input.width)) ? Number(input.width) : null,
      height: Number.isFinite(Number(input.height)) ? Number(input.height) : null,
      focal_point: objectValue(input.focal_point),
      usage: Array.isArray(input.usage) ? input.usage : [],
      credit: input.credit || null,
      source_url: input.source_url || null,
      updated_by: userId || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "storage_path" })
    .select("*")
    .single();
  if (error) throw error;
  return { ok: true, asset: data };
},
```

- [ ] **Step 5: Add endpoint**

Create `functions/api/admin/content-assets.js`:

```js
import { createContentRepository } from "../../_lib/content.js";
import { staffCan } from "../../_lib/authz.js";
import { adminClient, json, readBody, requireStaff } from "../../_lib/supabase.js";

export async function onRequest({ request, env }) {
  const staff = await requireStaff(request, env);
  if (staff.response) return staff.response;
  const role = staff.role || "owner";
  const repo = createContentRepository(adminClient(env));

  if (request.method === "GET") {
    const url = new URL(request.url);
    const assets = await repo.listAssets({
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "available",
    });
    return json({ assets });
  }

  if (request.method === "POST") {
    if (!staffCan(role, "content.assets")) return json({ error: "forbidden" }, 403);
    const result = await repo.saveAsset(await readBody(request), staff.user?.id);
    return json(result, result.ok === false ? 400 : 200);
  }

  return json({ error: "method_not_allowed" }, 405);
}
```

Add to `functions/_lib/authz.js`:

```js
"content.assets": ["owner"],
```

- [ ] **Step 6: Add a metadata-first asset picker**

In `js/admin/content.js`, add a compact picker that opens when a structured field key is `image` or `og_image`:

```js
async function openAssetPicker(fieldKey) {
  const list = $("contentAssetPicker");
  if (!list) return;
  list.hidden = false;
  list.innerHTML = admSkeleton(5);
  const data = await api("/api/admin/content-assets");
  list.innerHTML = (data.assets || []).map((asset) => `
    <button class="adm-list-row" type="button" data-content-asset-field="${esc(fieldKey)}" data-content-asset-path="${esc(asset.storage_path)}">
      <b>${esc(asset.storage_path)}</b>
      <span>${esc(asset.alt)}</span>
    </button>
  `).join("") || admEmpty("ph-image", "No assets", "Add asset metadata before selecting media.");
}
```

For image fields, render a `Choose` button beside the text input:

```html
<button class="btn btn-ghost btn-sm" type="button" data-content-action="asset" data-content-asset-target="${esc(field.key)}">Choose</button>
```

Wire:

```js
if (action === "asset") return openAssetPicker(button.dataset.contentAssetTarget);
```

and:

```js
delegate(root, "click", "[data-content-asset-path]", (_event, button) => {
  const control = root.querySelector(`[data-content-payload-field="${CSS.escape(button.dataset.contentAssetField)}"]`);
  if (control) control.value = button.dataset.contentAssetPath;
  syncStructuredPayload();
});
```

- [ ] **Step 7: Add verifier guardrails**

In `tools/verify_site.mjs`, when optional CMS snapshots exist, reject image-backed entries missing alt text:

```js
for (const entry of [...(parsed.proof_cards || []), ...(parsed.industry_cards || [])]) {
  if (entry.image && !entry.image_alt) failures.push(`${relative} entry ${entry.slug || entry.title} has image without image_alt`);
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-assets.test.mjs
npm run smoke:admin
npm run verify:site
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add supabase/schema-content.sql functions/_lib/content.js functions/_lib/authz.js functions/api/admin/content-assets.js js/admin/content.js admin.html tools/verify_site.mjs tests/content-assets.test.mjs
git commit -m "feat: add cms asset metadata picker"
```

## Task 5: Workflow States, Locks, and Content Operations Dashboard

**Files:**

- Create: `tests/content-workflow.test.mjs`
- Modify: `supabase/schema-content.sql`
- Modify: `functions/_lib/authz.js`
- Modify: `functions/_lib/content.js`
- Modify: `functions/api/admin/content.js`
- Modify: `js/admin/content.js`
- Modify: `admin.html`

- [ ] **Step 1: Write failing workflow tests**

Create `tests/content-workflow.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content schema supports review, changes, scheduled, and locks", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /in_review/);
  assert.match(sql, /changes_requested/);
  assert.match(sql, /scheduled/);
  assert.match(sql, /scheduled_at/);
  assert.match(sql, /locked_by/);
  assert.match(sql, /locked_at/);
});

test("content API exposes workflow actions with publish/review permissions", () => {
  const source = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /action:\s*"submit_review"/);
  assert.match(source, /action:\s*"request_changes"/);
  assert.match(source, /action:\s*"schedule"/);
  assert.match(source, /staffCan\(role, "content\.review"\)/);
  assert.match(source, /staffCan\(role, "content\.publish"\)/);
});

test("content editor surfaces workflow queues and actions", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentWorkflowQueue/);
  assert.match(source, /data-content-workflow/);
  assert.match(source, /Submit for review/);
  assert.match(source, /Schedule publish/);
});
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-workflow.test.mjs
```

Expected: fail because workflow status strings and UI actions are missing.

- [ ] **Step 3: Extend permissions**

In `functions/_lib/authz.js`, add:

```js
"content.review": ["owner"],
"content.publish": ["owner"],
```

Keep `content.write` for draft editing.

- [ ] **Step 4: Extend schema**

In `supabase/schema-content.sql`, add a new additive migration block for existing enum values:

```sql
alter type content_status add value if not exists 'in_review';
alter type content_status add value if not exists 'changes_requested';
alter type content_status add value if not exists 'scheduled';

alter table public.content_entries
  add column if not exists scheduled_at timestamptz,
  add column if not exists locked_by uuid references auth.users(id) on delete set null,
  add column if not exists locked_at timestamptz,
  add column if not exists review_note text;
```

- [ ] **Step 5: Add repository transition methods**

In `functions/_lib/content.js`, add:

```js
async transition(input = {}, userId, nextStatus, note) {
  const normalized = normalizeContentEntry({ ...input, title: input.title || input.slug, status: nextStatus });
  const prior = await existingEntry(sb, normalized);
  if (!prior?.id) return { ok: false, error: "entry_not_found" };
  const patch = compactRow({
    status: nextStatus,
    scheduled_at: input.scheduled_at || null,
    review_note: note || null,
    updated_by: userId || null,
    updated_at: new Date().toISOString(),
  });
  const { data, error } = await sb
    .from("content_entries")
    .update(patch)
    .eq("id", prior.id)
    .select("*")
    .single();
  if (error) throw error;
  await writeRevision(sb, data, userId, note || `Status changed to ${nextStatus}`);
  return { ok: true, entry: data };
},
```

- [ ] **Step 6: Route workflow actions in API**

In `functions/api/admin/content.js`, inside POST handling:

```js
const action = body.action || (body.publish ? "publish" : "save_draft");
if (action === "submit_review") {
  return json(await repo.transition(body.entry, staff.user?.id, "in_review", "Submitted for review"));
}
if (action === "request_changes") {
  if (!staffCan(role, "content.review")) return json({ error: "forbidden" }, 403);
  return json(await repo.transition(body.entry, staff.user?.id, "changes_requested", body.note || "Changes requested"));
}
if (action === "schedule") {
  if (!staffCan(role, "content.publish")) return json({ error: "forbidden" }, 403);
  return json(await repo.transition(body.entry, staff.user?.id, "scheduled", "Scheduled publish"));
}
if (action === "publish" && !staffCan(role, "content.publish")) {
  return json({ error: "forbidden" }, 403);
}
```

- [ ] **Step 7: Add workflow UI**

In `js/admin/content.js`, add buttons:

```html
<button class="btn btn-secondary btn-sm" type="button" data-content-workflow="submit_review">Submit for review</button>
<button class="btn btn-ghost btn-sm" type="button" data-content-workflow="request_changes">Request changes</button>
<button class="btn btn-ghost btn-sm" type="button" data-content-workflow="schedule">Schedule publish</button>
```

Add a queue card:

```html
<div class="adm-card" id="contentWorkflowQueue">
  <h2>Content operations</h2>
  <div id="contentWorkflowRows" class="adm-list"></div>
</div>
```

Add:

```js
async function runWorkflow(action) {
  const result = await api("/api/admin/content", {
    method: "POST",
    body: { action, entry: selectedFormEntry() },
  });
  populateForm(result.entry || {});
  setStatus(`Workflow updated: ${action.replace(/_/g, " ")}.`, "ok");
  await renderContent({ refetch: true });
}
```

Wire:

```js
delegate(root, "click", "[data-content-workflow]", (_event, button) => runWorkflow(button.dataset.contentWorkflow));
```

- [ ] **Step 8: Run tests and smoke**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-workflow.test.mjs tests/staff-roles.test.mjs
npm run smoke:admin
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add supabase/schema-content.sql functions/_lib/authz.js functions/_lib/content.js functions/api/admin/content.js js/admin/content.js admin.html tests/content-workflow.test.mjs
git commit -m "feat: add cms workflow states"
```

## Task 6: Public Snapshot Consumption for Proof, Resources, Industries, and FAQs

**Files:**

- Create: `js/main/content-snapshots.js`
- Create: `tests/content-public-snapshots.test.mjs`
- Modify: `proof.html`
- Modify: `resources.html`
- Modify: `industries.html`
- Modify: `js/main.js`
- Modify: `tools/verify_site.mjs`

- [ ] **Step 1: Write failing public snapshot tests**

Create `tests/content-public-snapshots.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public content snapshot helper loads optional CMS snapshots", () => {
  const source = readFileSync(new URL("../js/main/content-snapshots.js", import.meta.url), "utf8");
  assert.match(source, /loadContentSnapshot/);
  assert.match(source, /proof\.json/);
  assert.match(source, /resources\.json/);
  assert.match(source, /industries\.json/);
  assert.match(source, /faqs\.json/);
});

test("public pages expose CMS mount points without replacing hardcoded fallback content", () => {
  for (const file of ["proof.html", "resources.html", "industries.html"]) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, /data-cms-content/);
  }
});

test("main entrypoint imports optional CMS public snapshots", () => {
  const source = readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
  assert.match(source, /content-snapshots\.js/);
  assert.match(source, /initContentSnapshots/);
});
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-public-snapshots.test.mjs
```

Expected: fail because `js/main/content-snapshots.js` does not exist.

- [ ] **Step 3: Add snapshot loader**

Create `js/main/content-snapshots.js`:

```js
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

async function loadContentSnapshot(file) {
  try {
    const response = await fetch(`data/content/${file}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function proofCard(card) {
  return `<article class="case-card reveal" data-proof-card data-proof-kind="${esc(card.kind || "all")}">
    ${card.image ? `<figure class="case-media"><img src="${esc(card.image)}" alt="${esc(card.image_alt || card.title)}" loading="lazy"></figure>` : ""}
    <div class="case-body">
      <span class="case-eyebrow">${esc(card.eyebrow || "Proof")}</span>
      <h3>${esc(card.title)}</h3>
      <p class="case-result">${esc(card.result || "")}</p>
    </div>
  </article>`;
}

function resourceCard(card) {
  return `<a class="route-card" href="${esc(card.href || "resources.html")}">
    <b>${esc(card.title)}</b>
    <span>${esc(card.description || "")}</span>
  </a>`;
}

function industryCard(card) {
  return `<a class="route-card" href="${esc(card.href || "industries.html")}">
    <b>${esc(card.title)}</b>
    <span>${esc(card.summary || "")}</span>
  </a>`;
}

function faqBlock(row) {
  return `<details class="resource-disclosure"><summary>${esc(row.question)}</summary><p>${esc(row.answer)}</p></details>`;
}

export async function initContentSnapshots() {
  const proof = await loadContentSnapshot("proof.json");
  const resources = await loadContentSnapshot("resources.json");
  const industries = await loadContentSnapshot("industries.json");
  const faqs = await loadContentSnapshot("faqs.json");

  const proofMount = document.querySelector('[data-cms-content="proof_cards"]');
  if (proofMount && proof?.proof_cards?.length) proofMount.innerHTML = proof.proof_cards.map(proofCard).join("");

  const resourceMount = document.querySelector('[data-cms-content="resource_cards"]');
  if (resourceMount && resources?.resource_cards?.length) resourceMount.innerHTML = resources.resource_cards.map(resourceCard).join("");

  const industryMount = document.querySelector('[data-cms-content="industry_cards"]');
  if (industryMount && industries?.industry_cards?.length) industryMount.innerHTML = industries.industry_cards.map(industryCard).join("");

  const faqMount = document.querySelector('[data-cms-content="faq_blocks"]');
  if (faqMount && faqs?.faq_blocks?.length) faqMount.innerHTML = faqs.faq_blocks.map(faqBlock).join("");
}
```

- [ ] **Step 4: Add page mount points**

Add mount attributes to existing fallback containers, preserving existing hardcoded content as fallback:

```html
<div class="case-grid" data-cms-content="proof_cards">
```

```html
<div class="resource-router" data-cms-content="resource_cards">
```

```html
<div class="industry-router" data-cms-content="industry_cards">
```

Add an FAQ mount to `resources.html` near the resource disclosure area:

```html
<div data-cms-content="faq_blocks"></div>
```

- [ ] **Step 5: Import and initialize**

In `js/main.js`, import:

```js
import { initContentSnapshots } from "./main/content-snapshots.js";
```

Call it inside the existing DOM-ready boot path:

```js
initContentSnapshots();
```

- [ ] **Step 6: Add verifier checks**

In `tools/verify_site.mjs`, add checks that any CMS snapshot entry with `href` points to a local URL or safe external URL:

```js
if (entry.href && /^(?:javascript|data|vbscript):/i.test(String(entry.href).trim())) {
  failures.push(`${relative} entry ${entry.slug || entry.title} has unsafe href`);
}
```

- [ ] **Step 7: Run tests and visual smoke**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-public-snapshots.test.mjs
npm run verify:site
npm run smoke:admin
```

Then capture browser screenshots for `proof.html`, `resources.html`, `industries.html`, and `services.html` with and without generated CMS snapshots.

- [ ] **Step 8: Commit**

```bash
git add js/main/content-snapshots.js js/main.js proof.html resources.html industries.html tools/verify_site.mjs tests/content-public-snapshots.test.mjs
git commit -m "feat: render cms public snapshots"
```

## Task 7: Export Manifest and Publish Status

**Files:**

- Create: `tests/content-export-manifest.test.mjs`
- Modify: `tools/build-content.mjs`
- Modify: `tools/verify_site.mjs`
- Modify: `js/admin/content.js`
- Modify: `admin.html`

- [ ] **Step 1: Write failing export manifest tests**

Create `tests/content-export-manifest.test.mjs`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("build-content writes a manifest with counts and generated timestamp", () => {
  const outDir = mkdtempSync(join(tmpdir(), "masest-content-manifest-"));
  try {
    execFileSync(process.execPath, ["tools/build-content.mjs"], {
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        ...process.env,
        CONTENT_EXPORT_OUT_DIR: outDir,
        CONTENT_EXPORT_SOURCE: JSON.stringify([{
          type: "faq_block",
          slug: "shipping",
          title: "Shipping",
          status: "published",
          locale: "en",
          payload: { question: "How does freight work?", answer: "Reviewed during quote." },
          seo: {},
        }]),
      },
    });
    const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
    assert.equal(typeof manifest.generated_at, "string");
    assert.equal(manifest.files["faqs.json"].count, 1);
    assert.match(manifest.files["faqs.json"].sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-export-manifest.test.mjs
```

Expected: fail because `manifest.json` is not written.

- [ ] **Step 3: Add manifest generation**

In `tools/build-content.mjs`, import:

```js
import { createHash } from "node:crypto";
```

Change `writeJson` to return the serialized value:

```js
function writeJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, text);
  return text;
}
```

Add:

```js
function manifestEntry(text, value) {
  const firstArray = Object.values(value).find(Array.isArray) || [];
  return {
    count: firstArray.length,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}
```

In `main`, collect file writes:

```js
const writes = {
  "services.json": servicesPayload(snapshot),
  "page-meta.json": pageMetaPayload(snapshot),
  "proof.json": typedPayload(snapshot, "proof_card", "proof_cards"),
  "resources.json": typedPayload(snapshot, "resource_card", "resource_cards"),
  "industries.json": typedPayload(snapshot, "industry_card", "industry_cards"),
  "faqs.json": typedPayload(snapshot, "faq_block", "faq_blocks"),
};
const files = {};
for (const [file, value] of Object.entries(writes)) {
  files[file] = manifestEntry(writeJson(join(OUT_DIR, file), value), value);
}
writeJson(join(OUT_DIR, "manifest.json"), { generated_at: new Date().toISOString(), files });
```

- [ ] **Step 4: Add admin status display**

In `js/admin/content.js`, add a `contentExportStatus` panel that tries to fetch `data/content/manifest.json`:

```js
async function renderExportStatus() {
  const box = $("contentExportStatus");
  if (!box) return;
  try {
    const response = await fetch("data/content/manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error("No manifest");
    const manifest = await response.json();
    box.textContent = `Last static export: ${new Date(manifest.generated_at).toLocaleString()}`;
    box.dataset.state = "ok";
  } catch {
    box.textContent = "Static export manifest not generated in this environment.";
    box.dataset.state = "";
  }
}
```

Call `renderExportStatus()` in `mount()`.

- [ ] **Step 5: Verify manifest shape**

In `tools/verify_site.mjs`, add:

```js
const manifestFile = path.join(projectRoot, "data/content/manifest.json");
if (fs.existsSync(manifestFile)) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (!manifest.generated_at || !manifest.files) failures.push("data/content/manifest.json missing generated_at/files");
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/content-export-manifest.test.mjs
npm run build:content
npm run verify:site
```

Expected: all pass; `npm run build:content` still no-ops when source credentials are absent.

- [ ] **Step 7: Commit**

```bash
git add tools/build-content.mjs js/admin/content.js admin.html tools/verify_site.mjs tests/content-export-manifest.test.mjs
git commit -m "feat: add cms export manifest"
```

## Task 8: Full CMS Functional and Visual QA

**Files:**

- Modify: `tools/admin-content-cms.spec.mjs`
- Create: `tools/content-smoke.spec.mjs`
- Modify: `package.json`

- [ ] **Step 1: Expand smoke tests**

Create `tools/content-smoke.spec.mjs` with tests that:

```js
import { test, expect } from "@playwright/test";

test("cms editor supports preview, revision restore, workflow, and asset picker", async ({ page }) => {
  await page.goto("http://127.0.0.1:4195/admin.html#content", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#admApp")).toBeVisible();
  await expect(page.locator("#contentStructuredFields")).toBeVisible();
  await expect(page.locator("#contentPreviewFrame")).toBeVisible();
  await expect(page.locator("#contentRevisionList")).toBeVisible();
  await expect(page.locator("#contentWorkflowQueue")).toBeVisible();
  await page.screenshot({ path: "output/playwright/cms-mature/admin-content-desktop.png" });
});
```

Use the existing `tools/admin-content-cms.spec.mjs` API stubbing pattern instead of relying on real Supabase.

- [ ] **Step 2: Add public page visual checks**

In the same spec, add checks for:

```js
for (const path of ["/services.html", "/proof.html", "/resources.html", "/industries.html"]) {
  await page.goto(`http://127.0.0.1:4195${path}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("main")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
}
```

- [ ] **Step 3: Wire smoke command**

In `package.json`, append `tools/content-smoke.spec.mjs` to `smoke:admin` or create a new script:

```json
"smoke:cms": "playwright test tools/content-smoke.spec.mjs --reporter=line"
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run check
npm test
npm run build
npm run verify:site
npm run smoke:admin
npm run smoke:cms
git diff --check
```

Expected:

- JS check passes
- all Node tests pass
- static build passes
- site verification passes
- admin smoke passes
- CMS smoke passes
- no whitespace errors

- [ ] **Step 5: Commit**

```bash
git add tools/admin-content-cms.spec.mjs tools/content-smoke.spec.mjs package.json
git commit -m "test: add cms maturity smoke coverage"
```

## Final Acceptance Criteria

- Content field definitions live in one shared registry consumed by admin UI and server validation.
- Invalid content payloads are rejected server-side before publish.
- Editors can preview drafts without publishing.
- Editors can view and restore prior revisions.
- Asset metadata includes alt text, focal point, usage, source/credit, and picker integration.
- Workflow supports draft, review, changes requested, scheduled, published, and archived states.
- Owner-only publish/review/asset permissions are explicit in `staffCan`.
- Public proof/resources/industries/FAQ surfaces can consume CMS snapshots while retaining static fallback content.
- `tools/build-content.mjs` emits a manifest with generated time, counts, and hashes.
- Admin Content tab shows export status and content operations.
- `npm run verify`, `npm run smoke:admin`, `npm run smoke:cms`, and `git diff --check` pass.

## Non-Goals

- Do not adopt Directus, Strapi, Payload, Wagtail, Tina, Keystatic, or Decap as a runtime dependency in this plan.
- Do not move product catalog commerce data into CMS.
- Do not add a hosted deploy dependency to local verification.
- Do not require GitHub Actions for publish verification.
- Do not rebuild the admin dashboard as React or Next.js.
