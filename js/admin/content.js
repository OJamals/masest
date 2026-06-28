import { esc, delegate } from "../util.js";
import {
  contentPayloadFields,
  contentTypeOptions,
  normalizeStructuredPayload,
  structuredPayloadKeys,
} from "../content-types.js";

const TYPES = contentTypeOptions();
const ASSET_FIELD_KEYS = new Set(["image", "og_image"]);

const STATUSES = [
  ["published", "Published"],
  ["draft", "Drafts"],
  ["in_review", "In review"],
  ["changes_requested", "Changes requested"],
  ["scheduled", "Scheduled"],
  ["archived", "Archived"],
  ["all", "All statuses"],
];

const STRUCTURED_KEYS = structuredPayloadKeys();
const SEO_FIELDS = [
  { key: "title", label: "Meta title", kind: "text", max: 70 },
  { key: "description", label: "Meta description", kind: "textarea", max: 180 },
  { key: "og_image", label: "Social image", kind: "text" },
];
const SEO_FIELD_KEYS = new Set(SEO_FIELDS.map((field) => field.key));
const CONTENT_LOCK_TTL_MS = 30 * 60 * 1000;

function labelFor(options, value) {
  return options.find(([key]) => key === value)?.[1] || value || "";
}

function selectOptions(options, selected = "") {
  return options.map(([value, label]) => (
    `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`
  )).join("");
}

function jsonText(value) {
  return JSON.stringify(value && typeof value === "object" ? value : {}, null, 2);
}

function slugifyContentTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function dateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduledDisplay(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function entryKeyValue(entry = {}) {
  if (!entry.type || !entry.slug) return "";
  return `${entry.type}:${entry.slug}:${entry.locale || "en"}`;
}

function activeContentLock(entry = {}) {
  if (!entry.locked_by || !entry.locked_at) return false;
  const lockedAt = new Date(entry.locked_at).getTime();
  return Number.isFinite(lockedAt) && Date.now() - lockedAt <= CONTENT_LOCK_TTL_MS;
}

function fieldValue(payload, key) {
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload[key] : "";
  if (Array.isArray(value)) return value.join(", ");
  return value ?? "";
}

function mergeStructuredPayload(type, existing, values) {
  const payload = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  for (const key of STRUCTURED_KEYS) delete payload[key];
  return { ...payload, ...normalizeStructuredPayload(type, values) };
}

function cleanSeoUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const schemeProbe = trimmed.replace(/[\u0000-\u001F\u007F\s]+/g, "");
  if (/^(?:javascript|data|vbscript):/i.test(schemeProbe)) return "";
  return trimmed;
}

function seoFieldValue(seo, key) {
  const value = seo && typeof seo === "object" && !Array.isArray(seo) ? seo[key] : "";
  return value ?? "";
}

function normalizeSeoValues(values = {}) {
  const seo = {};
  const title = String(values.title || "").trim();
  const description = String(values.description || "").trim();
  const ogImage = cleanSeoUrl(values.og_image);
  if (title) seo.title = title;
  if (description) seo.description = description;
  if (ogImage) seo.og_image = ogImage;
  return seo;
}

function mergeSeoPayload(existing, values) {
  const seo = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...existing } : {};
  for (const key of SEO_FIELD_KEYS) delete seo[key];
  return { ...seo, ...normalizeSeoValues(values) };
}

function fieldTemplate(field, payload) {
  const value = fieldValue(payload, field.key);
  const cls = field.className || "";
  const required = field.required ? " required aria-required=\"true\"" : "";
  if (field.kind === "textarea" || field.kind === "list") {
    return `
      <label class="${esc(cls)}">${esc(field.label)}
        <textarea class="adm-textarea adm-content-field-text" data-content-payload-field="${esc(field.key)}" data-content-field-kind="${esc(field.kind)}" spellcheck="true"${required}>${esc(value)}</textarea>
      </label>
    `;
  }
  if (field.kind === "checkbox") {
    return `
      <label class="adm-content-check ${esc(cls)}">
        <input type="checkbox" data-content-payload-field="${esc(field.key)}" data-content-field-kind="checkbox"${value === true ? " checked" : ""}>
        <span>${esc(field.label)}</span>
      </label>
    `;
  }
  const input = `<input class="adm-input" type="${field.kind === "number" ? "number" : "text"}"${field.kind === "number" ? ' step="0.01"' : ""} data-content-payload-field="${esc(field.key)}" data-content-field-kind="${esc(field.kind)}" value="${esc(value)}"${required}>`;
  if (ASSET_FIELD_KEYS.has(field.key)) {
    return `
      <div class="adm-content-asset-control ${esc(cls)}">
        <label>${esc(field.label)}
          ${input}
        </label>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="asset" data-content-asset-target="${esc(field.key)}">
          <i class="ph ph-image" aria-hidden="true"></i> Choose
        </button>
      </div>
    `;
  }
  return `
    <label class="${esc(cls)}">${esc(field.label)}
      ${input}
    </label>
  `;
}

function structuredFieldsTemplate(type, payload) {
  const fields = contentPayloadFields(type);
  if (!fields.length) return "";
  return fields.map((field) => fieldTemplate(field, payload)).join("");
}

function seoFieldTemplate(field, seo) {
  const value = seoFieldValue(seo, field.key);
  const count = String(value || "").length;
  const maxlength = field.max ? ` maxlength="${esc(field.max)}"` : "";
  const meter = field.max ? `<small id="contentSeo${field.key}Count" class="adm-content-seo-meter">${esc(count)} / ${esc(field.max)}</small>` : "";
  if (field.kind === "textarea") {
    return `
      <label class="full">${esc(field.label)}
        <textarea class="adm-textarea adm-content-field-text" data-content-seo-field="${esc(field.key)}" rows="3"${maxlength}>${esc(value)}</textarea>
        ${meter}
      </label>
    `;
  }
  const input = `<input class="adm-input" type="text" data-content-seo-field="${esc(field.key)}" value="${esc(value)}"${maxlength}>`;
  if (field.key === "og_image") {
    return `
      <div class="adm-content-asset-control wide">
        <label>${esc(field.label)}
          ${input}
        </label>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="seo_asset" data-content-seo-asset-target="${esc(field.key)}">
          <i class="ph ph-image" aria-hidden="true"></i> Choose
        </button>
      </div>
    `;
  }
  return `
    <label class="wide">${esc(field.label)}
      ${input}
      ${meter}
    </label>
  `;
}

function seoFieldsTemplate(seo = {}) {
  return SEO_FIELDS.map((field) => seoFieldTemplate(field, seo)).join("");
}

function formTemplate() {
  return `
    <div class="adm-card adm-content-editor">
      <div class="adm-panel-header">
        <div>
          <h2>Content editor</h2>
          <p class="muted">Manage non-commerce public content. Product prices, variants, stock, checkout, and quote routing stay in Catalog.</p>
        </div>
        <span id="contentEditorBadge" class="badge" data-s="draft">draft</span>
      </div>
      <form id="contentForm" class="adm-form-grid" onsubmit="return false">
        <label>Type <select id="contentType" class="adm-select">${selectOptions(TYPES, "service")}</select></label>
        <label>Locale <input id="contentLocale" class="adm-input" value="en" maxlength="12"></label>
        <label class="wide">Title <input id="contentTitle" class="adm-input" required></label>
        <label class="wide">Slug <input id="contentSlug" class="adm-input" required></label>
        <label class="wide">Publish at <input id="contentScheduledAt" class="adm-input" type="datetime-local"></label>
        <label class="full">Workflow note
          <textarea id="contentWorkflowNote" class="adm-textarea" rows="3" placeholder="Reviewer instructions, change requests, or scheduling context"></textarea>
        </label>
        <div class="adm-content-lockbar full">
          <span id="contentLockStatus" class="adm-content-lock-status" data-state="">Unlocked</span>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="lock"><i class="ph ph-lock-key" aria-hidden="true"></i> Claim lock</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="unlock"><i class="ph ph-lock-key-open" aria-hidden="true"></i> Release</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="force_unlock"><i class="ph ph-warning-circle" aria-hidden="true"></i> Force unlock</button>
        </div>
        <div id="contentStructuredFields" class="adm-content-fields full"></div>
        <label class="full">Payload JSON <textarea id="contentPayload" class="adm-textarea" spellcheck="false">{}</textarea></label>
        <fieldset id="contentSeoFields" class="adm-content-seo full"></fieldset>
        <details class="adm-content-json full">
          <summary>SEO JSON</summary>
          <textarea id="contentSeo" class="adm-textarea" spellcheck="false">{}</textarea>
        </details>
        <div class="adm-inline-actions full">
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="new"><i class="ph ph-plus" aria-hidden="true"></i> New</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="duplicate"><i class="ph ph-copy" aria-hidden="true"></i> Duplicate</button>
          <button class="btn btn-secondary btn-sm" type="button" data-content-action="draft"><i class="ph ph-floppy-disk" aria-hidden="true"></i> Save draft</button>
          <button class="btn btn-primary btn-sm" type="button" data-content-action="publish"><i class="ph ph-upload-simple" aria-hidden="true"></i> Publish</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="archive"><i class="ph ph-archive" aria-hidden="true"></i> Archive</button>
          <button class="btn btn-secondary btn-sm" type="button" data-content-action="unarchive" hidden><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Restore draft</button>
          <button class="btn btn-secondary btn-sm" type="button" data-content-workflow="submit_review"><i class="ph ph-check-square-offset" aria-hidden="true"></i> Submit for review</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-workflow="request_changes"><i class="ph ph-warning-circle" aria-hidden="true"></i> Request changes</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-workflow="schedule"><i class="ph ph-calendar-check" aria-hidden="true"></i> Schedule publish</button>
        </div>
      </form>
      <p id="contentStatus" class="adm-status" role="status" aria-live="polite"></p>
    </div>
  `;
}

function revisionsTemplate(admEmpty) {
  return `
    <div class="adm-card adm-content-revisions">
      <div class="adm-panel-header">
        <div>
          <h2>Revision history</h2>
          <p class="muted">Restore prior versions as drafts before publishing.</p>
        </div>
      </div>
      <div id="contentRevisionList" class="adm-list">
        ${admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.")}
      </div>
    </div>
  `;
}

function assetPickerTemplate(admEmpty) {
  return `
    <div id="contentAssetPicker" class="adm-card adm-content-assets" hidden>
      <div class="adm-panel-header">
        <div>
          <h2>Asset manager</h2>
          <p class="muted">Upload CMS images or select existing asset metadata for structured fields.</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="close_assets">
          <i class="ph ph-x" aria-hidden="true"></i> Close
        </button>
      </div>
      <div class="adm-content-asset-tools">
        <input id="contentAssetSearch" class="adm-search" type="search" placeholder="Search asset paths" aria-label="Search CMS assets">
        <select id="contentAssetStatusFilter" class="adm-select" aria-label="Filter CMS asset status">
          <option value="available">Available assets</option>
          <option value="archived">Archived assets</option>
          <option value="all">All assets</option>
        </select>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="refresh_assets">
          <i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Refresh
        </button>
      </div>
      <form id="contentAssetUpload" class="adm-content-upload" onsubmit="return false">
        <label>Folder
          <input id="contentAssetFolder" class="adm-input" type="text" value="cms" maxlength="64">
        </label>
        <label>Image file
          <input id="contentAssetFile" class="adm-input" type="file" accept=".avif,.jpg,.jpeg,.png,.webp,image/avif,image/jpeg,image/png,image/webp">
        </label>
        <label>Alt text
          <input id="contentAssetAlt" class="adm-input" type="text" placeholder="Describe the image">
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="upload_asset">
          <i class="ph ph-upload-simple" aria-hidden="true"></i> Upload
        </button>
      </form>
      <form id="contentAssetRegister" class="adm-content-register" onsubmit="return false">
        <label>Existing path or URL
          <input id="contentAssetPath" class="adm-input" type="text" placeholder="img/proof/cases/example.webp">
        </label>
        <label>Alt text
          <input id="contentAssetPathAlt" class="adm-input" type="text" placeholder="Describe the image">
        </label>
        <label>Credit
          <input id="contentAssetCredit" class="adm-input" type="text" placeholder="Optional">
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="register_asset">
          <i class="ph ph-link-simple" aria-hidden="true"></i> Register
        </button>
      </form>
      <div id="contentAssetRows" class="adm-list" aria-live="polite">${admEmpty("ph-image", "No assets", "Add asset metadata before selecting media.")}</div>
    </div>
  `;
}

function previewTemplate() {
  return `
    <div class="adm-card adm-content-preview">
      <div class="adm-panel-header">
        <h2>Preview</h2>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="preview">
          <i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Refresh
        </button>
      </div>
      <iframe id="contentPreviewFrame" title="Content preview" src="content-preview.html"></iframe>
    </div>
  `;
}

function listTemplate(entries, admEmpty) {
  if (!entries.length) {
    return admEmpty("ph-note-pencil", "No content entries", "Create a draft or switch the filters.");
  }
  return `
    <table class="adm">
      <thead><tr><th>Entry</th><th>Type</th><th>Status</th><th>Updated</th><th></th></tr></thead>
      <tbody>${entries.map((entry) => `
        <tr class="adm-content-row">
          <td>
            <span class="adm-content-title">${esc(entry.title)}</span>
            <span class="adm-content-meta">${esc(entry.slug)} · ${esc(entry.locale || "en")}</span>
          </td>
          <td>${esc(labelFor(TYPES, entry.type))}</td>
          <td><span class="badge" data-s="${esc(entry.status)}">${esc(entry.status)}</span></td>
          <td>${esc(entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : "")}</td>
          <td><button class="btn btn-ghost btn-sm" type="button" data-content-edit="${esc(entry.type)}:${esc(entry.slug)}:${esc(entry.locale || "en")}">Edit</button></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function workflowTemplate(admEmpty) {
  return `
    <div class="adm-card adm-content-workflow" id="contentWorkflowQueue">
      <div class="adm-panel-header">
        <div>
          <h2>Content operations</h2>
          <p class="muted">Review, scheduled, and change-request queues stay visible outside the status filter.</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="publish_scheduled">
          <i class="ph ph-clock-countdown" aria-hidden="true"></i> Publish due scheduled
        </button>
      </div>
      <div id="contentWorkflowRows" class="adm-list">
        ${admEmpty("ph-kanban", "No workflow items", "Submit drafts for review or schedule content to populate this queue.")}
      </div>
    </div>
  `;
}

function exportStatusTemplate() {
  return `
    <div class="adm-card adm-content-export">
      <div class="adm-panel-header">
        <h2>Static export</h2>
      </div>
      <p id="contentExportStatus" class="adm-status" role="status">Checking static export manifest...</p>
      <div id="contentManifestRows" class="adm-content-manifest" aria-label="Static export snapshot counts"></div>
    </div>
  `;
}

function manifestCountText(meta = {}) {
  const counts = meta.counts && typeof meta.counts === "object" ? meta.counts : {};
  const parts = Object.entries(counts)
    .filter(([, count]) => Number.isFinite(Number(count)))
    .map(([key, count]) => `${key.replace(/_/g, " ")}: ${Number(count).toLocaleString()}`);
  if (parts.length) return parts.join(" · ");
  return `${Number(meta.count || 0).toLocaleString()} rows`;
}

function manifestFileRows(files = {}) {
  return Object.entries(files || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, meta]) => `
      <div class="adm-content-manifest-row">
        <b>${esc(file)}</b>
        <span>${esc(manifestCountText(meta))}</span>
      </div>
    `).join("");
}

function shellTemplate(admEmpty) {
  return `
    <div class="adm-content-layout">
      <div class="adm-content-stack">
        ${formTemplate()}
        ${revisionsTemplate(admEmpty)}
        ${assetPickerTemplate(admEmpty)}
      </div>
      <div class="adm-content-side">
        <div class="adm-card adm-content-list">
          <div class="adm-panel-header">
            <div>
              <h2>Published snapshots</h2>
              <p class="muted">Rows published here are exported into static public snapshots.</p>
            </div>
          </div>
          <div class="adm-tools adm-tools-flush">
            <select id="contentTypeFilter" class="adm-select adm-select-sm" aria-label="Filter content type">
              <option value="">All types</option>${selectOptions(TYPES)}
            </select>
            <select id="contentStatusFilter" class="adm-select adm-select-sm" aria-label="Filter content status">
              ${selectOptions(STATUSES, "published")}
            </select>
          </div>
          <div id="contentList" class="adm-table-wrap">${admEmpty("ph-note-pencil", "No content entries", "Create a draft or switch the filters.")}</div>
        </div>
        ${exportStatusTemplate()}
        ${workflowTemplate(admEmpty)}
        ${previewTemplate()}
      </div>
    </div>
  `;
}

function readPayloadJson() {
  return JSON.parse(document.getElementById("contentPayload").value || "{}");
}

function safePayloadJson() {
  try {
    return readPayloadJson();
  } catch {
    return {};
  }
}

function readSeoJson() {
  return JSON.parse(document.getElementById("contentSeo").value || "{}");
}

function readStructuredValues() {
  const values = {};
  document.querySelectorAll("[data-content-payload-field]").forEach((control) => {
    const key = control.dataset.contentPayloadField;
    values[key] = control.type === "checkbox" ? control.checked : control.value;
  });
  return values;
}

function readSeoValues() {
  const values = {};
  document.querySelectorAll("[data-content-seo-field]").forEach((control) => {
    values[control.dataset.contentSeoField] = control.value;
  });
  return values;
}

function readScheduledAt() {
  const value = document.getElementById("contentScheduledAt")?.value || "";
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Scheduled publish time is invalid.");
  }
  return date.toISOString();
}

function selectedFormEntry({ validate = false } = {}) {
  const form = document.getElementById("contentForm");
  if (validate && form && !form.reportValidity()) {
    throw new Error("Complete the required content fields before saving.");
  }
  let payload;
  let seo;
  try {
    const type = document.getElementById("contentType").value;
    payload = mergeStructuredPayload(type, readPayloadJson(), readStructuredValues());
    seo = mergeSeoPayload(readSeoJson(), readSeoValues());
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
  return {
    type: document.getElementById("contentType").value,
    locale: document.getElementById("contentLocale").value.trim() || "en",
    title: document.getElementById("contentTitle").value.trim(),
    slug: slugifyContentTitle(document.getElementById("contentSlug").value.trim()),
    scheduled_at: readScheduledAt(),
    payload,
    seo,
  };
}

export function createContentTab({ $, api, state, admSkeleton, admEmpty }) {
  let mounted = false;
  let assetTargetField = "image";
  let assetTargetKind = "payload";
  let assetCache = new Map();
  let currentEntry = {};
  let currentEntryKey = "";
  let editorLockOwned = false;
  let workflowEntries = [];
  let slugManuallyEdited = false;
  let lastGeneratedSlug = "";

  function setStatus(text, kind = "") {
    const el = $("contentStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = kind;
  }

  function selectedEntryIdentity() {
    return {
      type: $("contentType")?.value || "service",
      slug: slugifyContentTitle($("contentSlug")?.value || ""),
      locale: $("contentLocale")?.value.trim() || "en",
    };
  }

  function usedContentSlugs(type, locale) {
    return new Set(
      [...(state.content || []), ...(workflowEntries || [])]
        .filter((entry) => entry.type === type && (entry.locale || "en") === (locale || "en"))
        .map((entry) => entry.slug)
        .filter(Boolean),
    );
  }

  function duplicateSlug(entry = {}) {
    const base = slugifyContentTitle(`${entry.slug || entry.title || "content"}-copy`) || "content-copy";
    const used = usedContentSlugs(entry.type || "service", entry.locale || "en");
    if (!used.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const suffix = `-${index}`;
      const next = `${base.slice(0, Math.max(1, 96 - suffix.length))}${suffix}`;
      if (!used.has(next)) return next;
    }
    return `${Date.now()}-${base}`.slice(0, 96);
  }

  function editorBlockedByLock() {
    return activeContentLock(currentEntry) && !editorLockOwned;
  }

  function stopIfLocked() {
    if (!editorBlockedByLock()) return false;
    setStatus("This entry is locked by another editor. Force unlock it before editing.", "err");
    return true;
  }

  function updateLockUi(entry = currentEntry) {
    const lockStatus = $("contentLockStatus");
    const locked = activeContentLock(entry);
    const hasEntry = Boolean(entry.type && entry.slug);
    const blocked = locked && !editorLockOwned;
    if (lockStatus) {
      const lockedAt = entry.locked_at ? new Date(entry.locked_at).toLocaleString() : "";
      lockStatus.textContent = !hasEntry
        ? "Save an entry before locking"
        : locked && editorLockOwned
          ? `Locked by you${lockedAt ? ` since ${lockedAt}` : ""}`
          : locked
            ? `Locked by another editor${lockedAt ? ` since ${lockedAt}` : ""}`
            : entry.locked_by
              ? "Prior lock expired"
              : "Unlocked";
      lockStatus.dataset.state = blocked ? "err" : locked ? "ok" : "";
    }
    const root = $("admContent");
    const archived = entry.status === "archived";
    const archiveButton = root?.querySelector('[data-content-action="archive"]');
    const unarchiveButton = root?.querySelector('[data-content-action="unarchive"]');
    if (archiveButton) archiveButton.hidden = archived;
    if (unarchiveButton) unarchiveButton.hidden = !archived;
    root?.querySelectorAll('[data-content-action="duplicate"], [data-content-action="draft"], [data-content-action="publish"], [data-content-action="archive"], [data-content-action="unarchive"], [data-content-workflow]')
      .forEach((control) => { control.disabled = blocked; });
    const lockButton = root?.querySelector('[data-content-action="lock"]');
    const unlockButton = root?.querySelector('[data-content-action="unlock"]');
    const forceButton = root?.querySelector('[data-content-action="force_unlock"]');
    if (lockButton) lockButton.disabled = !hasEntry || (locked && editorLockOwned);
    if (unlockButton) unlockButton.disabled = !hasEntry || !locked || !editorLockOwned;
    if (forceButton) forceButton.disabled = !hasEntry || !locked || editorLockOwned;
  }

  function publishStatusText(result = {}) {
    const hook = result.publish_hook;
    if (!hook) return "Published.";
    if (hook.skipped) return "Published in CMS. Static rebuild hook is not configured, so public pages keep the previous export until a build runs.";
    if (hook.ok) return "Published. Static rebuild triggered.";
    const detail = hook.status || hook.message || hook.error || "hook failed";
    return `Published. Static rebuild failed: ${detail}.`;
  }

  function publishScheduledStatusText(result = {}) {
    const count = Number(result.count || 0);
    if (!count) return "No due scheduled content to publish.";
    const noun = count === 1 ? "item" : "items";
    const base = `Published ${count} scheduled ${noun}.`;
    const hook = result.publish_hook;
    if (!hook) return base;
    if (hook.skipped) return `${base} Static rebuild hook is not configured, so public pages keep the previous export until a build runs.`;
    if (hook.ok) return `${base} Static rebuild triggered.`;
    const detail = hook.status || hook.message || hook.error || "hook failed";
    return `${base} Static rebuild failed: ${detail}.`;
  }

  function publishStatusKind(result = {}) {
    const hook = result.publish_hook;
    if (hook?.ok === false) return "err";
    if (hook?.skipped) return "warn";
    return "ok";
  }

  function mount() {
    const root = $("admContent");
    if (!root || mounted) return;
    root.innerHTML = shellTemplate(admEmpty);
    renderStructuredFields("service", {});
    renderSeoFields({});
    $("contentPreviewFrame")?.addEventListener("load", () => refreshPreview());
    void renderExportStatus();
    mounted = true;
  }

  function renderStructuredFields(type, payload = {}) {
    const box = $("contentStructuredFields");
    if (!box) return;
    box.innerHTML = structuredFieldsTemplate(type, payload);
  }

  function updateSeoMeters() {
    for (const field of SEO_FIELDS) {
      if (!field.max) continue;
      const control = document.querySelector(`[data-content-seo-field="${field.key}"]`);
      const meter = $(`contentSeo${field.key}Count`);
      if (!control || !meter) continue;
      const count = String(control.value || "").length;
      meter.textContent = `${count} / ${field.max}`;
      meter.dataset.state = count >= field.max ? "warn" : "";
    }
  }

  function renderSeoFields(seo = {}) {
    const box = $("contentSeoFields");
    if (!box) return;
    box.innerHTML = `<legend>Search metadata</legend>${seoFieldsTemplate(seo)}`;
    updateSeoMeters();
  }

  function syncStructuredPayload() {
    try {
      const type = $("contentType")?.value || "service";
      const payload = mergeStructuredPayload(type, readPayloadJson(), readStructuredValues());
      $("contentPayload").value = jsonText(payload);
      setStatus("");
      refreshPreview();
    } catch (error) {
      setStatus(`Invalid JSON: ${error.message}`, "err");
    }
  }

  function syncSeoPayload() {
    try {
      const seo = mergeSeoPayload(readSeoJson(), readSeoValues());
      $("contentSeo").value = jsonText(seo);
      updateSeoMeters();
      setStatus("");
      refreshPreview();
    } catch (error) {
      setStatus(`Invalid JSON: ${error.message}`, "err");
    }
  }

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

  async function renderExportStatus() {
    const box = $("contentExportStatus");
    if (!box) return;
    const rows = $("contentManifestRows");
    try {
      const response = await fetch("data/content/manifest.json", { cache: "no-store" });
      if (!response.ok) throw new Error("No manifest");
      const manifest = await response.json();
      box.textContent = `Last static export: ${new Date(manifest.generated_at).toLocaleString()}`;
      box.dataset.state = "ok";
      if (rows) rows.innerHTML = manifestFileRows(manifest.files || {});
    } catch {
      box.textContent = "Static export manifest not generated in this environment.";
      box.dataset.state = "";
      if (rows) rows.innerHTML = "";
    }
  }

  function populateForm(entry = {}, { lockOwned = false, preserveLockOwner = false } = {}) {
    const nextKey = entryKeyValue(entry);
    const sameEntry = nextKey && nextKey === currentEntryKey;
    currentEntry = entry || {};
    currentEntryKey = nextKey;
    editorLockOwned = Boolean(lockOwned || (preserveLockOwner && sameEntry && editorLockOwned && activeContentLock(entry)));
    $("contentType").value = entry.type || "service";
    $("contentLocale").value = entry.locale || "en";
    $("contentTitle").value = entry.title || "";
    $("contentSlug").value = entry.slug || "";
    $("contentScheduledAt").value = dateTimeLocalValue(entry.scheduled_at);
    $("contentWorkflowNote").value = entry.review_note || "";
    slugManuallyEdited = Boolean(entry.slug);
    lastGeneratedSlug = slugifyContentTitle(entry.title || "");
    $("contentPayload").value = jsonText(entry.payload);
    $("contentSeo").value = jsonText(entry.seo);
    renderStructuredFields(entry.type || "service", entry.payload || {});
    renderSeoFields(entry.seo || {});
    const badge = $("contentEditorBadge");
    if (badge) {
      badge.textContent = entry.status || "draft";
      badge.dataset.s = entry.status || "draft";
    }
    setStatus("");
    void loadRevisions(entry);
    updateLockUi(entry);
    refreshPreview();
  }

  function syncSlugFromTitle() {
    const title = $("contentTitle");
    const slug = $("contentSlug");
    if (!title || !slug || slugManuallyEdited) return;
    if (slug.value && slug.value !== lastGeneratedSlug) {
      slugManuallyEdited = true;
      return;
    }
    const nextSlug = slugifyContentTitle(title.value);
    slug.value = nextSlug;
    lastGeneratedSlug = nextSlug;
    refreshPreview();
  }

  function normalizeManualSlug() {
    const slug = $("contentSlug");
    if (!slug) return;
    slug.value = slugifyContentTitle(slug.value);
    slugManuallyEdited = Boolean(slug.value);
    lastGeneratedSlug = slug.value;
    refreshPreview();
  }

  function renderRevisionList(revisions = []) {
    if (!revisions.length) {
      return admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.");
    }
    return revisions.map((revision) => `
      <button class="adm-list-row adm-content-revision-row" type="button" data-content-revision="${esc(revision.version)}">
        <b>Version ${esc(revision.version)}</b>
        <span>${esc(revision.status || "")}${revision.created_at ? ` · ${esc(new Date(revision.created_at).toLocaleString())}` : ""}</span>
        ${revision.note ? `<small>${esc(revision.note)}</small>` : ""}
      </button>
    `).join("");
  }

  async function loadRevisions(entry = {}) {
    const list = $("contentRevisionList");
    if (!list) return;
    if (!entry.type || !entry.slug) {
      list.innerHTML = admEmpty("ph-clock-counter-clockwise", "No revisions", "Save a draft to create a revision.");
      return;
    }
    list.innerHTML = admSkeleton(3);
    const query = new URLSearchParams({
      type: entry.type,
      slug: entry.slug,
      locale: entry.locale || "en",
    });
    try {
      const data = await api(`/api/admin/content-revisions?${query.toString()}`);
      list.innerHTML = renderRevisionList(data.revisions || []);
    } catch (error) {
      list.innerHTML = admEmpty(
        "ph-warning",
        "Revision history unavailable",
        error.data?.message || error.data?.error || error.message || "Try again.",
      );
    }
  }

  function closeAssetPicker() {
    const panel = $("contentAssetPicker");
    if (panel) panel.hidden = true;
  }

  function assetValue(asset = {}) {
    return asset.public_url || asset.storage_path || "";
  }

  function assetRowTemplate(asset = {}) {
    const value = assetValue(asset);
    const status = asset.status || "available";
    const storagePath = asset.storage_path || value;
    const archived = status === "archived";
    const nextStatus = archived ? "available" : "archived";
    const statusLabel = archived ? "Restore" : "Archive";
    const statusIcon = archived ? "ph-arrow-counter-clockwise" : "ph-archive";
    return `
      <div class="adm-list-row adm-content-asset-row" data-content-asset-status="${esc(status)}">
        <span class="adm-content-asset-thumb" aria-hidden="true">${value ? `<img src="${esc(value)}" alt="" loading="lazy">` : `<i class="ph ph-image"></i>`}</span>
        <span class="adm-content-asset-info">
          <b>${esc(asset.storage_path || value)}</b>
          <span>${esc(asset.alt || "No alt text")}</span>
          <small>${esc([status, asset.credit || "", asset.mime_type || ""].filter(Boolean).join(" · "))}</small>
        </span>
        <span class="adm-content-asset-actions">
          <button class="btn btn-secondary btn-sm" type="button" data-content-asset-kind="${esc(assetTargetKind)}" data-content-asset-field="${esc(assetTargetField)}" data-content-asset-path="${esc(value)}" data-content-asset-alt="${esc(asset.alt || "")}">
            <i class="ph ph-check" aria-hidden="true"></i> Select
          </button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-asset-status-action data-content-asset-storage-path="${esc(storagePath)}" data-content-asset-next-status="${esc(nextStatus)}">
            <i class="ph ${esc(statusIcon)}" aria-hidden="true"></i> ${esc(statusLabel)}
          </button>
        </span>
      </div>
    `;
  }

  async function loadAssets() {
    const panel = $("contentAssetPicker");
    const list = $("contentAssetRows") || panel?.querySelector(".adm-list");
    if (!list) return;
    const query = new URLSearchParams();
    const q = $("contentAssetSearch")?.value.trim() || "";
    const status = $("contentAssetStatusFilter")?.value || "available";
    if (q) query.set("q", q);
    if (status) query.set("status", status);
    list.innerHTML = admSkeleton(5);
    try {
      const path = `/api/admin/content-assets${query.toString() ? `?${query.toString()}` : ""}`;
      const data = await api(path);
      const assets = data.assets || [];
      assetCache = new Map(assets.map((asset) => [asset.storage_path || assetValue(asset), asset]));
      list.innerHTML = assets.map((asset) => assetRowTemplate(asset)).join("")
        || admEmpty("ph-image", "No assets", "Upload an image or register an existing path.");
    } catch (error) {
      list.innerHTML = admEmpty(
        "ph-warning",
        "Assets unavailable",
        error.data?.message || error.data?.error || error.message || "Try again.",
      );
    }
  }

  async function updateAssetStatus(button) {
    const storagePath = button.dataset.contentAssetStoragePath || "";
    const nextStatus = button.dataset.contentAssetNextStatus === "archived" ? "archived" : "available";
    const asset = assetCache.get(storagePath);
    if (!storagePath || !asset) {
      setStatus("Refresh assets before updating this asset.", "err");
      return;
    }
    const alt = String(asset.alt || "").trim();
    if (!alt) {
      setStatus("Add alt text before changing this asset status.", "err");
      return;
    }
    button.disabled = true;
    setStatus(nextStatus === "archived" ? "Archiving asset..." : "Restoring asset...");
    try {
      const result = await api("/api/admin/content-assets", {
        method: "POST",
        body: {
          ...asset,
          storage_path: storagePath,
          alt,
          status: nextStatus,
        },
      });
      const updated = result.asset || { ...asset, status: nextStatus };
      assetCache.set(updated.storage_path || storagePath, updated);
      setStatus(nextStatus === "archived" ? "Asset archived." : "Asset restored.", "ok");
      await loadAssets();
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset status update failed.", "err");
    } finally {
      button.disabled = false;
    }
  }

  async function openAssetPicker(fieldKey, kind = "payload") {
    const panel = $("contentAssetPicker");
    if (!panel) return;
    assetTargetField = fieldKey || assetTargetField || "image";
    assetTargetKind = kind || "payload";
    panel.hidden = false;
    await loadAssets();
  }

  function pairedAssetAltField(fieldKey) {
    if (!fieldKey) return "";
    if (fieldKey === "image") return "image_alt";
    return `${fieldKey}_alt`;
  }

  function findPayloadField(root, fieldKey) {
    if (!root || !fieldKey) return null;
    const selectorKey = window.CSS?.escape ? CSS.escape(fieldKey) : fieldKey.replace(/"/g, '\\"');
    return root.querySelector(`[data-content-payload-field="${selectorKey}"]`);
  }

  function findSeoField(root, fieldKey) {
    if (!root || !fieldKey) return null;
    const selectorKey = window.CSS?.escape ? CSS.escape(fieldKey) : fieldKey.replace(/"/g, '\\"');
    return root.querySelector(`[data-content-seo-field="${selectorKey}"]`);
  }

  function assignAssetValue(fieldKey, assetPath, assetAlt = "", message = "Asset path inserted.", kind = assetTargetKind) {
    const root = $("admContent");
    const control = kind === "seo"
      ? findSeoField(root, fieldKey)
      : findPayloadField(root, fieldKey) || findSeoField(root, fieldKey);
    if (control) {
      control.value = assetPath || "";
      if (kind === "seo") {
        syncSeoPayload();
      } else {
        const altControl = findPayloadField(root, pairedAssetAltField(fieldKey));
        if (assetAlt && altControl) altControl.value = assetAlt;
        syncStructuredPayload();
      }
      setStatus(message, "ok");
    }
    const panel = $("contentAssetPicker");
    if (panel) panel.hidden = true;
  }

  function assignAssetPath(button) {
    assignAssetValue(
      button.dataset.contentAssetField || assetTargetField,
      button.dataset.contentAssetPath || "",
      button.dataset.contentAssetAlt || "",
      "Asset path inserted.",
      button.dataset.contentAssetKind || assetTargetKind,
    );
  }

  async function uploadAsset() {
    const fileInput = $("contentAssetFile");
    const altInput = $("contentAssetAlt");
    const folderInput = $("contentAssetFolder");
    const file = fileInput?.files?.[0];
    const alt = altInput?.value.trim() || "";
    if (!file) {
      setStatus("Choose an image before uploading.", "err");
      return;
    }
    if (!alt) {
      setStatus("Add alt text before uploading.", "err");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    form.append("alt", alt);
    form.append("usage", assetTargetField || "image");
    form.append("folder", folderInput?.value.trim() || "cms");
    setStatus("Uploading asset...");
    try {
      const result = await api("/api/admin/content-assets", { method: "POST", body: form });
      const assetPath = result.asset?.public_url || result.asset?.storage_path || "";
      if (!assetPath) throw new Error("upload_missing_asset_path");
      if (fileInput) fileInput.value = "";
      if (altInput) altInput.value = "";
      assignAssetValue(assetTargetField, assetPath, result.asset?.alt || alt, "Asset uploaded.", assetTargetKind);
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset upload failed.", "err");
    }
  }

  async function registerAsset() {
    const pathInput = $("contentAssetPath");
    const altInput = $("contentAssetPathAlt");
    const creditInput = $("contentAssetCredit");
    const storagePath = pathInput?.value.trim() || "";
    const alt = altInput?.value.trim() || "";
    if (!storagePath) {
      setStatus("Add an existing path or public URL before registering.", "err");
      return;
    }
    if (!alt) {
      setStatus("Add alt text before registering an asset.", "err");
      return;
    }
    setStatus("Registering asset...");
    try {
      const result = await api("/api/admin/content-assets", {
        method: "POST",
        body: {
          storage_path: storagePath,
          alt,
          credit: creditInput?.value.trim() || "",
          usage: [assetTargetField || "image"],
        },
      });
      if (pathInput) pathInput.value = "";
      if (altInput) altInput.value = "";
      if (creditInput) creditInput.value = "";
      assignAssetValue(assetTargetField, assetValue(result.asset), result.asset?.alt || alt, "Asset registered.", assetTargetKind);
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset registration failed.", "err");
    }
  }

  function filters() {
    const type = $("contentTypeFilter")?.value || "";
    const status = $("contentStatusFilter")?.value || "published";
    return { type, status };
  }

  async function loadContentEntries({ type = "", status = "published" } = {}) {
    const query = new URLSearchParams();
    if (type) query.set("type", type);
    if (status) query.set("status", status);
    const data = await api(`/api/admin/content?${query.toString()}`);
    return data.entries || [];
  }

  function renderList() {
    const list = $("contentList");
    if (!list) return;
    list.innerHTML = listTemplate(state.content || [], admEmpty);
  }

  function renderWorkflowQueue() {
    const list = $("contentWorkflowRows");
    if (!list) return;
    const rows = (workflowEntries || []).filter((entry) => (
      ["in_review", "changes_requested", "scheduled"].includes(entry.status)
    ));
    if (!rows.length) {
      list.innerHTML = admEmpty("ph-kanban", "No workflow items", "Submit drafts for review or schedule content to populate this queue.");
      return;
    }
    list.innerHTML = rows.map((entry) => `
      <button class="adm-list-row adm-content-workflow-row" type="button" data-content-edit="${esc(entry.type)}:${esc(entry.slug)}:${esc(entry.locale || "en")}">
        <b>${esc(entry.title)}</b>
        <span>${esc(labelFor(TYPES, entry.type))} · ${esc(entry.status.replace(/_/g, " "))}</span>
        ${entry.status === "scheduled" && scheduledDisplay(entry.scheduled_at) ? `<small>Scheduled for ${esc(scheduledDisplay(entry.scheduled_at))}</small>` : ""}
        ${entry.review_note ? `<small>${esc(entry.review_note)}</small>` : ""}
      </button>
    `).join("");
  }

  async function renderContent({ refetch = true } = {}) {
    mount();
    if (refetch) {
      const list = $("contentList");
      if (list) list.innerHTML = admSkeleton(5);
      const { type, status } = filters();
      const listRequest = loadContentEntries({ type, status });
      const workflowRequest = status === "all" ? listRequest : loadContentEntries({ type, status: "all" });
      const [listResult, workflowResult] = await Promise.allSettled([listRequest, workflowRequest]);
      if (listResult.status === "fulfilled") {
        state.content = listResult.value;
        state.loaded.add("content");
      } else {
        const error = listResult.reason || {};
        state.content = [];
        setStatus(error.data?.message || error.data?.error || "Content entries unavailable.", "err");
      }
      workflowEntries = workflowResult.status === "fulfilled" ? workflowResult.value : [];
    }
    renderList();
    renderWorkflowQueue();
  }

  async function saveContent({ publish = false } = {}) {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    setStatus(publish ? "Publishing..." : "Saving draft...");
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { publish, entry: selectedFormEntry({ validate: true }) },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus(
        publish ? publishStatusText(result) : "Draft saved.",
        publish ? publishStatusKind(result) : "ok",
      );
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Save failed.", "err");
    }
  }

  async function runWorkflow(action) {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    try {
      const entry = selectedFormEntry({ validate: true });
      if (action === "schedule" && !entry.scheduled_at) {
        setStatus("Choose a publish date before scheduling.", "err");
        $("contentScheduledAt")?.focus();
        return;
      }
      const note = $("contentWorkflowNote")?.value.trim() || "";
      setStatus(`Updating workflow: ${action.replace(/_/g, " ")}...`);
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action, note, entry },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus(`Workflow updated: ${action.replace(/_/g, " ")}.`, "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Workflow update failed.", "err");
    }
  }

  async function publishScheduledContent() {
    setStatus("Publishing due scheduled content...");
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action: "publish_scheduled" },
      });
      setStatus(
        publishScheduledStatusText(result),
        publishStatusKind(result),
      );
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Scheduled publish failed.", "err");
    }
  }

  async function archiveContent() {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    let entry;
    try {
      entry = selectedFormEntry();
    } catch (error) {
      setStatus(error.message, "err");
      return;
    }
    if (!entry.type || !entry.slug) {
      setStatus("Choose an entry before archiving.", "err");
      return;
    }
    setStatus("Archiving...");
    try {
      const result = await api("/api/admin/content", {
        method: "DELETE",
        body: { type: entry.type, slug: entry.slug, locale: entry.locale },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus("Archived.", "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Archive failed.", "err");
    }
  }

  function duplicateContent() {
    if (stopIfLocked()) return;
    let entry;
    try {
      entry = selectedFormEntry();
    } catch (error) {
      setStatus(error.message, "err");
      return;
    }
    if (!entry.type || !entry.slug || !entry.title) {
      setStatus("Choose an entry before duplicating.", "err");
      return;
    }
    populateForm({
      ...entry,
      title: `${entry.title} copy`,
      slug: duplicateSlug(entry),
      status: "draft",
      scheduled_at: null,
      published_at: null,
      review_note: null,
      locked_by: null,
      locked_at: null,
    });
    setStatus("Duplicated as a new draft. Review the slug, then save.", "ok");
  }

  async function unarchiveContent() {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    const entry = selectedEntryIdentity();
    if (!entry.type || !entry.slug) {
      setStatus("Choose an archived entry before restoring.", "err");
      return;
    }
    setStatus("Restoring archived entry...");
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action: "unarchive", entry },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus("Restored as draft.", "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Restore failed.", "err");
    }
  }

  async function restoreRevision(version) {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    let entry;
    try {
      entry = selectedFormEntry();
    } catch (error) {
      setStatus(error.message, "err");
      return;
    }
    if (!entry.type || !entry.slug) {
      setStatus("Choose an entry before restoring a revision.", "err");
      return;
    }
    setStatus(`Restoring version ${version}...`);
    try {
      const result = await api("/api/admin/content-revisions", {
        method: "POST",
        body: { type: entry.type, slug: entry.slug, locale: entry.locale, version },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus(`Restored version ${version} as a draft.`, "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Restore failed.", "err");
    }
  }

  async function updateContentLock(action) {
    const entry = selectedEntryIdentity();
    if (!entry.type || !entry.slug) {
      setStatus("Choose a saved entry before changing the editor lock.", "err");
      return;
    }
    const label = action === "lock" ? "Claiming lock..." : action === "force_unlock" ? "Force unlocking..." : "Releasing lock...";
    setStatus(label);
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action, entry },
      });
      populateForm(result.entry || currentEntry, { lockOwned: action === "lock" });
      setStatus(action === "lock" ? "Lock claimed." : "Lock released.", "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Lock update failed.", "err");
      updateLockUi();
    }
  }

  function editEntry(key) {
    const [type, slug, locale] = String(key || "").split(":");
    const entry = [...(state.content || []), ...(workflowEntries || [])].find((row) => (
      row.type === type && row.slug === slug && (row.locale || "en") === (locale || "en")
    ));
    if (entry) populateForm(entry);
  }

  function wireContent() {
    const root = $("admContent");
    if (!root) return;
    root.addEventListener("change", (event) => {
      if (event.target.matches("#contentType")) {
        renderStructuredFields(event.target.value, safePayloadJson());
        syncStructuredPayload();
        return;
      }
      if (event.target.matches("#contentPayload")) {
        try {
          renderStructuredFields($("contentType")?.value || "service", readPayloadJson());
          setStatus("");
          refreshPreview();
        } catch (error) {
          setStatus(`Invalid JSON: ${error.message}`, "err");
        }
      }
      if (event.target.matches("#contentSeo")) {
        try {
          renderSeoFields(readSeoJson());
          setStatus("");
          refreshPreview();
        } catch (error) {
          setStatus(`Invalid JSON: ${error.message}`, "err");
        }
      }
      if (event.target.matches("#contentTypeFilter, #contentStatusFilter")) {
        renderContent({ refetch: true });
      }
      if (event.target.matches("#contentAssetStatusFilter")) {
        void loadAssets();
      }
    });
    root.addEventListener("input", (event) => {
      if (event.target.matches("#contentTitle")) syncSlugFromTitle();
      if (event.target.matches("#contentSlug")) normalizeManualSlug();
      if (event.target.matches("#contentScheduledAt")) refreshPreview();
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
      if (event.target.matches("[data-content-seo-field]")) syncSeoPayload();
    });
    root.addEventListener("change", (event) => {
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
      if (event.target.matches("[data-content-seo-field]")) syncSeoPayload();
    });
    delegate(root, "click", "[data-content-edit]", (_event, button) => editEntry(button.dataset.contentEdit));
    delegate(root, "click", "[data-content-revision]", (_event, button) => restoreRevision(button.dataset.contentRevision));
    delegate(root, "click", "[data-content-asset-path]", (_event, button) => assignAssetPath(button));
    delegate(root, "click", "[data-content-asset-status-action]", (_event, button) => updateAssetStatus(button));
    delegate(root, "click", "[data-content-workflow]", (_event, button) => runWorkflow(button.dataset.contentWorkflow));
    delegate(root, "click", "[data-content-action]", (_event, button) => {
      const action = button.dataset.contentAction;
      if (action === "new") return populateForm();
      if (action === "duplicate") return duplicateContent();
      if (action === "lock") return updateContentLock("lock");
      if (action === "unlock") return updateContentLock("unlock");
      if (action === "force_unlock") return updateContentLock("force_unlock");
      if (action === "draft") return saveContent({ publish: false });
      if (action === "publish") return saveContent({ publish: true });
      if (action === "publish_scheduled") return publishScheduledContent();
      if (action === "archive") return archiveContent();
      if (action === "unarchive") return unarchiveContent();
      if (action === "preview") return refreshPreview();
      if (action === "asset") return openAssetPicker(button.dataset.contentAssetTarget);
      if (action === "seo_asset") return openAssetPicker(button.dataset.contentSeoAssetTarget, "seo");
      if (action === "refresh_assets") return loadAssets();
      if (action === "close_assets") return closeAssetPicker();
      if (action === "upload_asset") return uploadAsset();
      if (action === "register_asset") return registerAsset();
    });
  }

  return { renderContent, wireContent };
}
