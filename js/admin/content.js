import { esc, delegate, confirmDialog, fmtDate } from "../util.js?v=20260725b";
import { renderMarkdown } from "../md.js?v=20260725b";
import { supabase } from "../auth.js?v=20260725b";
import { createContentAssets } from "./content-assets.js?v=20260725b";
import { openImageLibraryPicker } from "./image-library-picker.js?v=20260725b";
import { createContentRevisions } from "./content-revisions.js?v=20260725b";
import {
  createRichTextEditor,
  insertMarkdownIntoRichEditor,
  referencePickerTemplate as richReferencePickerTemplate,
  richEditorTemplate,
} from "./rich-editor.js?v=20260725b";
import {
  CONTENT_TYPE_DEFINITIONS,
  contentPayloadFields,
  contentTypeOptions,
  normalizeStructuredPayload,
  structuredPayloadKeys,
  validateStructuredPayload,
} from "../content-types.js?v=20260725b";

const TYPES = contentTypeOptions();
const ASSET_FIELD_KEYS = new Set(["image", "image_after", "og_image", "hero"]);

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
const PLACEMENT_HINTS = Object.freeze({
  service: "Feeds the public services snapshot. Product catalog, pricing, and checkout details stay in Catalog.",
  service_package: "Feeds service package cards used on public services and pricing surfaces.",
  proof_card: "Feeds proof and case-study cards across the public site.",
  resource_card: "Feeds resource cards and downloadable links.",
  industry_card: "Feeds industry overview cards on sector pages.",
  industry_sector: "Feeds individual industry sector pages and related cards.",
  faq_block: "Feeds FAQ sections on public pages.",
  page_section: "Feeds editable public page sections such as headlines, body copy, CTAs, and images.",
  page_meta: "Feeds SEO metadata for public pages.",
  pricing_tier: "Feeds public pricing tier copy. Transaction pricing still belongs in Catalog.",
  blog_post: "Feeds the static blog. Publishing updates the CMS and requests a static rebuild; if automation is unavailable, run `npm run publish:blog`.",
});

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

function placementText(type) {
  if (!CONTENT_TYPE_DEFINITIONS[type]?.snapshot) {
    return `${labelFor(TYPES, type)} stays server-side and configures paid checkout shipping options. Published entries override the environment fallback.`;
  }
  return PLACEMENT_HINTS[type] || `${labelFor(TYPES, type)} publishes into static website snapshots.`;
}

function updatePlacementHint(type = document.getElementById("contentType")?.value || "service") {
  const hint = document.getElementById("contentPlacementHint");
  if (hint) hint.textContent = placementText(type);
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

function chipSpan(tag) {
  return `<span class="adm-chip" data-chip="${esc(tag)}">${esc(tag)}<button type="button" class="adm-chip-x" data-chip-remove aria-label="Remove ${esc(tag)}">×</button></span>`;
}

// Rewrite the hidden list field from the current chips and notify listeners
// (the root "input" handler re-syncs the structured payload JSON).
function chipHiddenSync(container) {
  const values = [...container.querySelectorAll(".adm-chip")].map((c) => c.dataset.chip);
  const hidden = container.querySelector('input[type="hidden"][data-content-payload-field]');
  if (!hidden) return;
  hidden.value = values.join(", ");
  hidden.dispatchEvent(new Event("input", { bubbles: true }));
}

function addChip(container, raw) {
  const val = String(raw || "").trim().replace(/,+$/, "").trim();
  if (!val) return;
  const existing = [...container.querySelectorAll(".adm-chip")].map((c) => c.dataset.chip.toLowerCase());
  if (existing.includes(val.toLowerCase())) return;
  container.querySelector(".adm-chips-list").insertAdjacentHTML("beforeend", chipSpan(val));
  chipHiddenSync(container);
}

function fieldTemplate(field, payload) {
  const value = fieldValue(payload, field.key);
  const cls = field.className || "";
  const required = field.required ? " required aria-required=\"true\"" : "";
  if (field.widget === "chips") {
    const items = String(value || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    return `
      <label class="${esc(cls)}">${esc(field.label)}
        <div class="adm-chips" data-chips-for="${esc(field.key)}">
          <span class="adm-chips-list">${items.map(chipSpan).join("")}</span>
          <input class="adm-chip-input" name="${esc(field.key)}_entry" type="text" autocomplete="off" data-chip-input placeholder="Add tag, press Enter">
          <input type="hidden" data-content-payload-field="${esc(field.key)}" data-content-field-kind="list" value="${esc(items.join(", "))}">
        </div>
      </label>
    `;
  }
  if (field.kind === "textarea" || field.kind === "list") {
    const isMd = field.preview === "markdown";
    if (isMd) {
      const textareaAttrs = [
        'class="adm-textarea adm-content-field-text"',
        `data-content-payload-field="${esc(field.key)}"`,
        `data-content-field-kind="${esc(field.kind)}"`,
        field.required ? 'data-rich-required="true"' : "",
        'spellcheck="true"',
      ].filter(Boolean).join(" ");
      const editor = richEditorTemplate({
        key: field.key,
        label: field.label,
        value,
        textareaAttrs,
        minHeight: 300,
      });
      const preview = `<div class="adm-md-preview" data-md-preview-for="${esc(field.key)}" aria-live="polite"><span class="adm-md-preview-label">Live preview</span><div class="adm-md-preview-body blog-body"></div></div>`;
      return `
        <div class="${esc(cls)}">
          ${editor}
        </div>
        ${preview}
      `;
    }
    const preview = isMd
      ? `<div class="adm-md-preview" data-md-preview-for="${esc(field.key)}" aria-live="polite"><span class="adm-md-preview-label">Preview</span><div class="adm-md-preview-body blog-body"></div></div>`
      : "";
    return `
      <label class="${esc(cls)}">${esc(field.label)}
        <textarea class="adm-textarea adm-content-field-text" data-content-payload-field="${esc(field.key)}" data-content-field-kind="${esc(field.kind)}" spellcheck="true"${required}>${esc(value)}</textarea>
      </label>
      ${preview}
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
  if (field.kind === "select") {
    const opts = ["", ...(field.options || [])]
      .map((o) => `<option value="${esc(o)}"${String(value) === o ? " selected" : ""}>${o ? esc(o) : "— select —"}</option>`)
      .join("");
    return `
      <label class="${esc(cls)}">${esc(field.label)}
        <select class="adm-select" data-content-payload-field="${esc(field.key)}" data-content-field-kind="select"${required}>${opts}</select>
      </label>
    `;
  }
  const inputType = field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text";
  const input = `<input class="adm-input" type="${inputType}"${field.kind === "number" ? ' step="0.01"' : ""}${field.pattern ? ` pattern="${esc(field.pattern)}"` : ""} data-content-payload-field="${esc(field.key)}" data-content-field-kind="${esc(field.kind)}" value="${esc(value)}"${required}>`;
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
  // Blog titles use the shared Title field above. Keep payload.title synchronized
  // in code instead of rendering a second, conflicting Title input.
  const fields = contentPayloadFields(type).filter((field) => type !== "blog_post" || field.key !== "title");
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

function formTemplate({ blog = false } = {}) {
  const typeControl = blog
    ? `<input id="contentType" type="hidden" value="blog_post"><p class="adm-content-placement full" role="note">${esc(placementText("blog_post"))}</p>`
    : `<label class="adm-content-selector">Content area <select id="contentType" name="content_type" class="adm-select">${selectOptions(TYPES, "service")}</select></label>`;
  return `
    <div class="adm-card adm-content-editor">
      <div class="adm-panel-header">
        <div>
          <p class="adm-eyebrow">${blog ? "Blog CMS" : "CMS"}</p>
          <h2>${blog ? "Blog editor" : "Edit website content"}</h2>
          <p class="muted">${blog ? "Write formatted posts in a normal editor; the system saves Markdown for the static blog." : "Choose where the content appears, edit the fields people see on the site, then save or publish."}</p>
        </div>
        <span id="contentEditorBadge" class="badge" data-s="draft">draft</span>
      </div>
      <form id="contentForm" class="adm-form-grid" onsubmit="return false" data-capability-scope="content.write">
        ${typeControl}
        <label class="adm-content-locale">Language <select id="contentLocale" name="content_locale" class="adm-select"><option value="en">English (en)</option></select></label>
        <p id="contentPlacementHint" class="adm-content-placement full" role="note"${blog ? " hidden" : ""}>${esc(placementText("service"))}</p>
        <label class="wide">Title <input id="contentTitle" name="content_title" autocomplete="off" class="adm-input" required></label>
        <label class="wide">Page slug <input id="contentSlug" name="content_slug" autocomplete="off" class="adm-input" required></label>
        <label class="wide">Schedule CMS publish <input id="contentScheduledAt" name="content_scheduled_at" class="adm-input" type="datetime-local"></label>
        <div id="contentStructuredFields" class="adm-content-fields full"></div>
        <fieldset id="contentSeoFields" class="adm-content-seo full"></fieldset>
        <details class="adm-content-json full">
          <summary>Developer JSON</summary>
          <label>Payload JSON <textarea id="contentPayload" name="content_payload" class="adm-textarea" spellcheck="false">{}</textarea></label>
          <label>SEO JSON <textarea id="contentSeo" name="content_seo" class="adm-textarea" spellcheck="false">{}</textarea></label>
        </details>
        <div class="adm-inline-actions adm-content-actions full" aria-label="CMS editor actions">
          <div class="adm-content-action-group" data-content-action-group="draft-publish" aria-label="Draft and publish">
            <button class="btn btn-secondary btn-sm" type="button" data-content-action="draft" data-capability="content.write"><i class="ph ph-floppy-disk" aria-hidden="true"></i> Save Draft</button>
            <button class="btn btn-primary btn-sm" type="button" data-content-action="publish" data-capability="content.publish"><i class="ph ph-upload-simple" aria-hidden="true"></i> Publish to CMS</button>
            <button class="btn btn-ghost btn-sm" type="button" data-content-workflow="schedule" data-capability="content.publish"><i class="ph ph-calendar-check" aria-hidden="true"></i> Schedule CMS Publish</button>
          </div>
          <div class="adm-content-action-group" data-content-action-group="manage" aria-label="Manage entry">
            <button class="btn btn-ghost btn-sm" type="button" data-content-action="new" data-capability="content.write"><i class="ph ph-plus" aria-hidden="true"></i> New</button>
            <button class="btn btn-ghost btn-sm" type="button" data-content-action="duplicate" data-capability="content.write"><i class="ph ph-copy" aria-hidden="true"></i> Duplicate</button>
            <button class="btn btn-ghost btn-sm" type="button" data-content-action="archive" data-capability="content.write"><i class="ph ph-archive" aria-hidden="true"></i> Archive</button>
            <button class="btn btn-secondary btn-sm" type="button" data-content-action="unarchive" data-capability="content.write" hidden><i class="ph ph-arrow-counter-clockwise" aria-hidden="true"></i> Restore Draft</button>
          </div>
        </div>
        <p class="adm-publish-contract full" role="note"><strong>Publication status:</strong> Publishing updates the CMS first. The public site changes after the static rebuild completes. If the rebuild hook is unavailable, run <code>${blog ? "npm run publish:blog" : "npm run publish:content"}</code>.</p>
        <details class="adm-content-disclosure full">
          <summary>Review workflow &amp; editor lock (multi-editor tools)</summary>
          <div class="adm-content-disclosure-body">
            <label>Workflow note
              <textarea id="contentWorkflowNote" name="workflow_note" class="adm-textarea" rows="3" placeholder="Reviewer instructions, change requests, or scheduling context"></textarea>
            </label>
            <div class="adm-content-action-group" data-content-action-group="review" aria-label="Review workflow">
              <button class="btn btn-secondary btn-sm" type="button" data-content-workflow="submit_review" data-capability="content.write"><i class="ph ph-check-square-offset" aria-hidden="true"></i> Submit for review</button>
              <button class="btn btn-ghost btn-sm" type="button" data-content-workflow="request_changes" data-capability="content.review"><i class="ph ph-warning-circle" aria-hidden="true"></i> Request changes</button>
            </div>
            <div class="adm-content-lockbar">
              <span id="contentLockStatus" class="adm-content-lock-status" data-state="">Unlocked</span>
              <button class="btn btn-ghost btn-sm" type="button" data-content-action="lock" data-capability="content.write"><i class="ph ph-lock-key" aria-hidden="true"></i> Claim lock</button>
              <button class="btn btn-ghost btn-sm" type="button" data-content-action="unlock" data-capability="content.write"><i class="ph ph-lock-key-open" aria-hidden="true"></i> Release</button>
              <button class="btn btn-ghost btn-sm" type="button" data-content-action="force_unlock" data-capability="content.review"><i class="ph ph-warning-circle" aria-hidden="true"></i> Force unlock</button>
            </div>
          </div>
        </details>
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
      <div id="contentRevisionDiff" class="adm-content-revision-diff" hidden></div>
    </div>
  `;
}

function assetPickerTemplate() {
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
      <button class="btn btn-secondary adm-content-open-assets" type="button" data-content-action="open_asset_viewer">
        <i class="ph ph-images" aria-hidden="true"></i> Open Asset Viewer
      </button>
      <form id="contentAssetUpload" class="adm-content-upload" onsubmit="return false">
        <label>Folder
          <input id="contentAssetFolder" name="asset_folder" autocomplete="off" class="adm-input" type="text" value="cms" maxlength="64">
        </label>
        <label>Image file
          <input id="contentAssetFile" name="asset_file" class="adm-input" type="file" accept=".avif,.jpg,.jpeg,.png,.webp,image/avif,image/jpeg,image/png,image/webp">
        </label>
        <label>Alt text
          <input id="contentAssetAlt" name="asset_alt" autocomplete="off" class="adm-input" type="text" placeholder="e.g. Technician cleaning a stainless tank…">
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="upload_asset" data-capability="content.assets">
          <i class="ph ph-upload-simple" aria-hidden="true"></i> Upload
        </button>
      </form>
      <form id="contentAssetRegister" class="adm-content-register" onsubmit="return false">
        <label>Existing path or URL
          <input id="contentAssetPath" name="asset_path" autocomplete="off" class="adm-input" type="text" placeholder="e.g. img/proof/cases/tank.webp…">
        </label>
        <label>Alt text
          <input id="contentAssetPathAlt" name="asset_alt" autocomplete="off" class="adm-input" type="text" placeholder="e.g. Technician cleaning a stainless tank…">
        </label>
        <label>Credit
          <input id="contentAssetCredit" name="asset_credit" autocomplete="off" class="adm-input" type="text" placeholder="e.g. MASEST field team…">
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="register_asset" data-capability="content.assets">
          <i class="ph ph-link-simple" aria-hidden="true"></i> Register
        </button>
      </form>
    </div>
  `;
}

function previewTemplate() {
  return `
    <div class="adm-card adm-content-preview">
      <div class="adm-panel-header">
        <div>
          <h2>Field check</h2>
          <p class="muted">What each field contains right now — not the styled page. Publish, then view the live page for the real layout.</p>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" data-content-action="preview" data-permission-exempt>
          <i class="ph ph-arrows-clockwise" aria-hidden="true"></i> Refresh
        </button>
      </div>
      <iframe id="contentPreviewFrame" title="Content field check" src="content-preview.html"></iframe>
    </div>
  `;
}

function contentHubTemplate() {
  return `
    <div class="adm-content-hub">
      <div>
        <p class="adm-eyebrow">Website CMS</p>
        <h2>Content prepared for the public site</h2>
        <p class="muted">Edit copy, proof cards, FAQs, page metadata, pricing copy, and industry content without leaving the admin dashboard.</p>
      </div>
      <div id="contentHubMetrics" class="adm-content-hub-metrics" aria-label="CMS summary">
        <span><b>0</b> loaded</span>
        <span><b>0</b> workflow</span>
        <span><b>0</b> scheduled</span>
      </div>
    </div>
  `;
}

function listTemplate(entries, admEmpty) {
  if (!entries.length) {
    return admEmpty("ph-note-pencil", "No content entries", "Create a draft or switch the filters.");
  }
  return `
    <div class="adm-content-entry-list">
      ${entries.map((entry) => `
        <button class="adm-content-entry-row" type="button" data-content-edit="${esc(entry.type)}:${esc(entry.slug)}:${esc(entry.locale || "en")}">
          <span class="adm-content-entry-main">
            <span class="adm-content-title">${esc(entry.title)}</span>
            <span class="adm-content-meta">${esc(labelFor(TYPES, entry.type))} · ${esc(entry.slug)} · ${esc(entry.locale || "en")}</span>
          </span>
          <span class="badge" data-s="${esc(entry.status)}">${esc(entry.status)}</span>
          <span class="adm-content-updated">${esc(entry.updated_at ? (fmtDate(entry.updated_at) || "Date unavailable") : "Not saved")}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function workflowTemplate(admEmpty, { blog = false } = {}) {
  const queueCopy = blog
    ? `Scheduled blog posts stay visible here. Press "Publish due to CMS" when their scheduled time arrives; the static build runs separately.`
    : `Scheduled, review, and change-request items stay visible even when the list is filtered. Press "Publish due to CMS" when their scheduled time arrives.`;
  return `
    <div class="adm-card adm-content-workflow" id="contentWorkflowQueue">
      <div class="adm-panel-header">
        <div>
          <h2>Review queue</h2>
          <p class="muted">${esc(queueCopy)}</p>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="publish_scheduled" data-capability="content.publish">
          <i class="ph ph-clock-countdown" aria-hidden="true"></i> Publish due to CMS
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
    <details class="adm-card adm-content-export">
      <summary class="adm-content-export-summary">Static export status</summary>
      <p id="contentExportStatus" class="adm-status" role="status">Checking static export manifest...</p>
      <div id="contentManifestRows" class="adm-content-manifest" aria-label="Static export snapshot counts"></div>
    </details>
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
    <div class="adm-content-shell">
      ${contentHubTemplate()}
      <div class="adm-content-layout">
        <div class="adm-content-stack">
          ${formTemplate()}
          ${assetPickerTemplate()}
          ${richReferencePickerTemplate({ prefix: "content", admEmpty })}
          ${revisionsTemplate(admEmpty)}
        </div>
        <div class="adm-content-side">
          <div class="adm-card adm-content-list">
            <div class="adm-panel-header">
              <div>
                <h2>Content library</h2>
                <p class="muted">Pick an entry to edit. Filters only change this list, not the review queue.</p>
              </div>
            </div>
            <div class="adm-tools adm-tools-flush">
              <select id="contentTypeFilter" class="adm-select adm-select-sm" aria-label="Filter content type">
                <option value="">All types</option>${selectOptions(TYPES)}
              </select>
              <select id="contentStatusFilter" class="adm-select adm-select-sm" aria-label="Filter content status">
                ${selectOptions(STATUSES, "all")}
              </select>
            </div>
            <div id="contentList" class="adm-content-list-body">${admEmpty("ph-note-pencil", "No content entries", "Create a draft or switch the filters.")}</div>
          </div>
          ${workflowTemplate(admEmpty)}
          ${previewTemplate()}
          ${exportStatusTemplate()}
        </div>
      </div>
    </div>
  `;
}

function blogShellTemplate(admEmpty) {
  return `
    <div class="adm-content-shell adm-blog-shell">
      <div class="adm-content-hub">
        <div>
          <p class="adm-eyebrow">Blog CMS</p>
          <h2>Blog editor</h2>
          <p class="muted">Draft, format, reference products or services, preview, and publish static blog posts.</p>
        </div>
        <div id="contentHubMetrics" class="adm-content-hub-metrics" aria-label="Blog summary">
          <span><b>0</b> posts</span>
          <span><b>0</b> drafts</span>
          <span><b>0</b> scheduled</span>
        </div>
      </div>
      <div class="adm-content-layout">
        <div class="adm-content-stack">
          ${formTemplate({ blog: true })}
          ${assetPickerTemplate()}
          ${richReferencePickerTemplate({ prefix: "content", admEmpty })}
          ${revisionsTemplate(admEmpty)}
        </div>
        <div class="adm-content-side">
          <div class="adm-card adm-content-list">
            <div class="adm-panel-header">
              <div>
                <h2>Current posts</h2>
                <p class="muted">Published posts, drafts, review items, and scheduled posts scoped to the blog.</p>
              </div>
            </div>
            <div id="contentList" class="adm-content-list-body">${admEmpty("ph-note-pencil", "No blog posts", "Create a blog draft to get started.")}</div>
          </div>
          ${workflowTemplate(admEmpty, { blog: true })}
          ${previewTemplate()}
          ${exportStatusTemplate()}
        </div>
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

function readStructuredValuesForType(type) {
  const values = readStructuredValues();
  if (type === "blog_post") {
    values.title = document.getElementById("contentTitle")?.value.trim() || "";
  }
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
    const structuredValues = readStructuredValuesForType(type);
    if (validate) {
      const validation = validateStructuredPayload(type, structuredValues);
      if (!validation.ok) throw new Error(`Complete required content fields (${validation.error || "invalid_content_payload"}).`);
    }
    payload = mergeStructuredPayload(type, readPayloadJson(), structuredValues);
    seo = mergeSeoPayload(readSeoJson(), readSeoValues());
  } catch (error) {
    if (/content fields|_required|_invalid|invalid_content_payload/.test(error.message || "")) throw error;
    throw new Error(error.message?.startsWith("Invalid JSON") ? error.message : `Invalid JSON: ${error.message}`);
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
  let mountedRootId = "";
  let blogMode = false;
  // Asset library (picker, upload/register, alt-text, archive/restore) extracted to
  // ./content-assets.js. It owns the picker's own state; choosing an asset calls back
  // into applyChosenAsset (below) to write the value into the editor form.
  const assets = createContentAssets({ $, api, admSkeleton, admEmpty, setStatus, applyChosenAsset });
  // Revision history (list + field-level diff) extracted to ./content-revisions.js. It is
  // read-only display; the one write action (restore → populateForm + re-render) stays here
  // and is wired to the restore button the module renders. The diff reads live editor state
  // via getCurrentEntry.
  const revisions = createContentRevisions({ $, api, admSkeleton, admEmpty, getCurrentEntry: () => currentEntry });
  let currentEntry = {};
  let currentEntryKey = "";
  let editorLockOwned = false;
  let workflowEntries = [];
  let slugManuallyEdited = false;
  let contentListFailed = false;
  let formDirty = false;
  let ownUserId = null; // resolved once; lets a reload recognise our own editor lock
  let lastGeneratedSlug = "";

  function activeRoot() {
    return $(mountedRootId) || $("admContent") || $("admBlog");
  }

  function setStatus(text, kind = "") {
    const el = $("contentStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = kind;
  }

  function renderContentHubMetrics() {
    const box = $("contentHubMetrics");
    if (!box) return;
    const all = workflowEntries || [];
    const published = all.filter((entry) => entry.status === "published").length;
    const drafts = all.filter((entry) => ["draft", "in_review", "changes_requested"].includes(entry.status)).length;
    const scheduled = all.filter((entry) => entry.status === "scheduled").length;
    box.innerHTML = `
      <span><b>${esc(published)}</b> published</span>
      <span><b>${esc(drafts)}</b> drafts</span>
      <span><b>${esc(scheduled)}</b> scheduled</span>
    `;
  }

  function selectedEntryIdentity() {
    return {
      type: $("contentType")?.value || (blogMode ? "blog_post" : "service"),
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
    const root = activeRoot();
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
    const blogText = blogWorkflowStatusText(result);
    const hook = result.publish_hook;
    if (!hook) return `Published.${blogText}`;
    if (hook.skipped) return `Published in CMS. Static rebuild hook is not configured, so public pages keep the previous export until a build runs.${blogText}`;
    if (hook.ok) return `Published. Static rebuild triggered.${blogText}`;
    const detail = hook.status || hook.message || hook.error || "hook failed";
    return `Published. Static rebuild failed: ${detail}.${blogText}`;
  }

  function blogWorkflowStatusText(result = {}) {
    const workflow = result.blog_workflow;
    if (!workflow) return "";
    if (workflow.skipped) return " Static blog generation is not configured, so run `npm run publish:blog` to regenerate pages.";
    if (workflow.ok) return " Static blog generation triggered.";
    const detail = workflow.status || workflow.message || workflow.error || "workflow failed";
    return ` Static blog generation failed: ${detail}.`;
  }

  function publishScheduledStatusText(result = {}) {
    const count = Number(result.count || 0);
    const failed = Array.isArray(result.skipped) ? result.skipped.length : 0;
    if (!count) {
      return failed
        ? `No content published — ${failed} due ${failed === 1 ? "entry" : "entries"} failed validation. Fix and retry.`
        : "No due scheduled content to publish.";
    }
    const noun = count === 1 ? "item" : "items";
    let base = `Published ${count} scheduled ${noun}.`;
    if (failed) base += ` ${failed} could not publish (validation) — fix and retry.`;
    const blogText = blogWorkflowStatusText(result);
    const hook = result.publish_hook;
    if (!hook) return `${base}${blogText}`;
    if (hook.skipped) return `${base} Static rebuild hook is not configured, so public pages keep the previous export until a build runs.${blogText}`;
    if (hook.ok) return `${base} Static rebuild triggered.${blogText}`;
    const detail = hook.status || hook.message || hook.error || "hook failed";
    return `${base} Static rebuild failed: ${detail}.${blogText}`;
  }

  function publishStatusKind(result = {}) {
    const hook = result.publish_hook;
    if (result.blog_workflow?.ok === false) return "err";
    if (hook?.ok === false) return "err";
    if (Array.isArray(result.skipped) && result.skipped.length) return "warn";
    if (result.blog_workflow?.skipped) return "warn";
    if (hook?.skipped) return "warn";
    return "ok";
  }

  function mount({ blog = false } = {}) {
    const rootId = blog ? "admBlog" : "admContent";
    const root = $(rootId);
    if (!root) return;
    if (mounted && mountedRootId === rootId) return;
    const other = $(blog ? "admContent" : "admBlog");
    if (other) other.innerHTML = "";
    mounted = false;
    mountedRootId = rootId;
    blogMode = blog;
    root.innerHTML = blog ? blogShellTemplate(admEmpty) : shellTemplate(admEmpty);
    renderStructuredFields(blog ? "blog_post" : "service", {});
    renderSeoFields({});
    const type = $("contentType");
    if (type) {
      type.value = blog ? "blog_post" : "service";
      type.disabled = blog;
    }
    updatePlacementHint(blog ? "blog_post" : "service");
    renderContentHubMetrics();
    $("contentPreviewFrame")?.addEventListener("load", () => refreshPreview());
    void renderExportStatus();
    mounted = true;
  }

  function mountRichEditors(root = activeRoot()) {
    root?.querySelectorAll("[data-rich-editor-key]").forEach((editor) => {
      createRichTextEditor(editor, {
        root,
        api,
        onChange: () => syncStructuredPayload(),
        referencePickerSelector: "#contentReferencePicker",
        referenceRowsSelector: "#contentReferenceRows",
        onInsertImage: async (_key, ctx) => {
          const details = await openImageLibraryPicker({ api, trigger: ctx.button, usage: "blog" });
          if (details) ctx.insertMarkdown(`![${details.alt || "image"}](${details.url})`);
        },
      });
    });
  }

  function updateMarkdownPreviews() {
    document.querySelectorAll("[data-md-preview-for]").forEach((wrap) => {
      const key = wrap.dataset.mdPreviewFor;
      const src = document.querySelector(`[data-content-payload-field="${key}"]`);
      const body = wrap.querySelector(".adm-md-preview-body");
      if (!src || !body) return;
      body.innerHTML = renderMarkdown(src.value || "");
    });
  }

  function renderStructuredFields(type, payload = {}) {
    const box = $("contentStructuredFields");
    if (!box) return;
    box.innerHTML = structuredFieldsTemplate(type, payload);
    mountRichEditors();
    updateMarkdownPreviews();
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
      const payload = mergeStructuredPayload(type, readPayloadJson(), readStructuredValuesForType(type));
      $("contentPayload").value = jsonText(payload);
      setStatus("");
      updateMarkdownPreviews();
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
    editorLockOwned = Boolean(
      lockOwned
      || (preserveLockOwner && sameEntry && editorLockOwned && activeContentLock(entry))
      // After a reload the lock is still OURS if locked_by matches the signed-in user —
      // without this, your own lock renders as "Locked by another editor" and blocks editing.
      || (ownUserId && entry.locked_by === ownUserId && activeContentLock(entry)),
    );
    $("contentType").value = entry.type || (blogMode ? "blog_post" : "service");
    // Language is a fixed select (free text forked entries on typos); existing
    // non-en entries still open — inject their locale as an option on demand.
    const localeSel = $("contentLocale");
    const locale = entry.locale || "en";
    if (localeSel && ![...localeSel.options].some((o) => o.value === locale)) {
      localeSel.insertAdjacentHTML("beforeend", `<option value="${esc(locale)}">${esc(locale)}</option>`);
    }
    localeSel.value = locale;
    $("contentTitle").value = entry.title || entry.payload?.title || "";
    $("contentSlug").value = entry.slug || "";
    $("contentScheduledAt").value = dateTimeLocalValue(entry.scheduled_at);
    $("contentWorkflowNote").value = entry.review_note || "";
    slugManuallyEdited = Boolean(entry.slug);
    lastGeneratedSlug = slugifyContentTitle(entry.title || "");
    $("contentPayload").value = jsonText(entry.payload);
    $("contentSeo").value = jsonText(entry.seo);
    renderStructuredFields(entry.type || (blogMode ? "blog_post" : "service"), entry.payload || {});
    renderSeoFields(entry.seo || {});
    updatePlacementHint(entry.type || (blogMode ? "blog_post" : "service"));
    const badge = $("contentEditorBadge");
    if (badge) {
      badge.textContent = entry.status || "draft";
      badge.dataset.s = entry.status || "draft";
    }
    setStatus("");
    formDirty = false;
    void revisions.loadRevisions(entry);
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

  // Callback for the asset module: write a chosen asset's path/alt into the editor form
  // and re-sync the preview. The module owns opening/closing the picker; this only
  // touches the editor. Declared as a function so it's hoisted for createContentAssets.
  function applyChosenAsset(fieldKey, assetPath, assetAlt = "", message = "Asset path inserted.", kind = "payload") {
    const root = activeRoot();
    // Insert Markdown image at the caret of a body textarea (in-post images).
    if (kind === "markdown") {
      const editor = root?.querySelector(`[data-rich-editor-key="${CSS.escape(fieldKey)}"]`);
      const md = `![${assetAlt || "image"}](${assetPath || ""})`;
      if (editor && insertMarkdownIntoRichEditor(editor, md, () => syncStructuredPayload())) {
        setStatus("Image inserted into body.", "ok");
        return;
      }
      const ta = findPayloadField(root, fieldKey);
      if (ta) {
        const start = Number.isInteger(ta.selectionStart) ? ta.selectionStart : ta.value.length;
        const end = Number.isInteger(ta.selectionEnd) ? ta.selectionEnd : ta.value.length;
        ta.value = ta.value.slice(0, start) + md + ta.value.slice(end);
        const caret = start + md.length;
        ta.focus();
        ta.setSelectionRange(caret, caret);
        syncStructuredPayload();
        setStatus("Image inserted into body.", "ok");
      }
      return;
    }
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
  }

  function filters() {
    const type = blogMode ? "blog_post" : ($("contentTypeFilter")?.value || "");
    const status = $("contentStatusFilter")?.value || "all";
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
    if (contentListFailed) {
      // A server error must not masquerade as an empty library.
      list.innerHTML = admEmpty("ph-warning", "Couldn't load content", "The list request failed. Reload or switch filters to retry.");
      return;
    }
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
    mount({ blog: false });
    if (refetch) {
      const list = $("contentList");
      if (list) list.innerHTML = admSkeleton(5);
      const { type, status } = filters();
      const listRequest = loadContentEntries({ type, status });
      // The review queue + hub metrics are always the FULL set — the on-screen copy
      // promises "Filters only change this list, not the review queue".
      const workflowRequest = (status === "all" && !type) ? listRequest : loadContentEntries({ type: "", status: "all" });
      const [listResult, workflowResult] = await Promise.allSettled([listRequest, workflowRequest]);
      if (listResult.status === "fulfilled") {
        state.content = listResult.value;
        state.loaded.add("content");
      } else {
        const error = listResult.reason || {};
        state.content = [];
        contentListFailed = true;
        setStatus(error.data?.message || error.data?.error || "Content entries unavailable.", "err");
      }
      if (listResult.status === "fulfilled") contentListFailed = false;
      workflowEntries = workflowResult.status === "fulfilled" ? workflowResult.value : [];
    }
    renderList();
    renderWorkflowQueue();
    renderContentHubMetrics();
  }

  async function renderBlog({ refetch = true } = {}) {
    mount({ blog: true });
    const type = $("contentType");
    if (type) {
      type.value = "blog_post";
      type.disabled = true;
    }
    if (refetch) {
      const list = $("contentList");
      if (list) list.innerHTML = admSkeleton(5);
      const listRequest = loadContentEntries({ type: "blog_post", status: "all" });
      const [listResult] = await Promise.allSettled([listRequest]);
      if (listResult.status === "fulfilled") {
        state.content = listResult.value;
        workflowEntries = listResult.value;
        state.loaded.add("blog");
        contentListFailed = false;
      } else {
        const error = listResult.reason || {};
        state.content = [];
        workflowEntries = [];
        contentListFailed = true;
        setStatus(error.data?.message || error.data?.error || "Blog posts unavailable.", "err");
      }
    }
    renderList();
    renderWorkflowQueue();
    renderContentHubMetrics();
  }

  async function renderActiveContent({ refetch = true } = {}) {
    return blogMode ? renderBlog({ refetch }) : renderContent({ refetch });
  }

  async function saveContent({ publish = false } = {}) {
    if (stopIfLocked()) return;
    const preserveLockOwner = editorLockOwned;
    // Saving a published entry as draft silently unpublishes it at the next site
    // rebuild (single-row model; only published rows export) — say so first.
    if (!publish && currentEntry.status === "published") {
      const ok = await confirmDialog(
        "This entry is live. Saving as a draft takes it OFF the public site at the next rebuild. Publish instead to keep it live.",
        { confirmText: "Save draft (unpublish)", cancelText: "Cancel", danger: true },
      );
      if (!ok) return;
    }
    // Editing slug/type/locale forks a brand-new entry; the original stays live.
    const formKey = `${$("contentType")?.value || ""}:${slugifyContentTitle($("contentSlug")?.value || "")}:${$("contentLocale")?.value.trim() || "en"}`;
    if (currentEntryKey && formKey !== currentEntryKey) {
      const ok = await confirmDialog(
        "You changed the slug, type, or language — saving creates a NEW entry and the original keeps its current status. Continue?",
        { confirmText: "Create new entry", cancelText: "Cancel" },
      );
      if (!ok) return;
    }
    setStatus(publish ? "Publishing…" : "Saving draft…");
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
      await renderActiveContent({ refetch: true });
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
      setStatus(`Updating workflow: ${action.replace(/_/g, " ")}…`);
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action, note, entry },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus(`Workflow updated: ${action.replace(/_/g, " ")}.`, "ok");
      await renderActiveContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Workflow update failed.", "err");
    }
  }

  async function publishScheduledContent() {
    setStatus("Publishing due scheduled content…");
    try {
      const body = blogMode
        ? { action: "publish_scheduled", type: "blog_post" }
        : { action: "publish_scheduled" };
      const result = await api("/api/admin/content", {
        method: "POST",
        body,
      });
      setStatus(
        publishScheduledStatusText(result),
        publishStatusKind(result),
      );
      await renderActiveContent({ refetch: true });
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
    // Archiving a live entry also unpublishes it — at least as destructive as the
    // save-draft-on-published path, which already warns. Confirm the same way.
    if (currentEntry.status === "published") {
      const ok = await confirmDialog(
        "This entry is live. Archiving takes it OFF the public site at the next rebuild and removes it from the library.",
        { confirmText: "Archive (unpublish)", cancelText: "Cancel", danger: true },
      );
      if (!ok) return;
    } else {
      const ok = await confirmDialog(
        "Archive this entry? It will be removed from the content library.",
        { confirmText: "Archive", cancelText: "Cancel", danger: true },
      );
      if (!ok) return;
    }
    setStatus("Archiving…");
    try {
      const result = await api("/api/admin/content", {
        method: "DELETE",
        body: { type: entry.type, slug: entry.slug, locale: entry.locale },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus("Archived.", "ok");
      await renderActiveContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Archive failed.", "err");
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
    setStatus("Restoring archived entry…");
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action: "unarchive", entry },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      setStatus("Restored as draft.", "ok");
      await renderActiveContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Restore failed.", "err");
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
    setStatus(`Restoring version ${version}…`);
    try {
      const result = await api("/api/admin/content-revisions", {
        method: "POST",
        body: { type: entry.type, slug: entry.slug, locale: entry.locale, version },
      });
      populateForm(result.entry || {}, { preserveLockOwner });
      revisions.closeRevisionDiff();
      setStatus(`Restored version ${version} as a draft.`, "ok");
      await renderActiveContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Restore failed.", "err");
    }
  }

  async function updateContentLock(action) {
    const entry = selectedEntryIdentity();
    if (!entry.type || !entry.slug) {
      setStatus("Choose a saved entry before changing the editor lock.", "err");
      return;
    }
    // Force-unlock clobbers another editor's active claim — confirm before firing.
    if (action === "force_unlock") {
      const ok = await confirmDialog(
        "Force-unlock this entry? The editor holding the lock may lose in-progress edits.",
        { confirmText: "Force unlock", cancelText: "Cancel", danger: true },
      );
      if (!ok) return;
    }
    const label = action === "lock" ? "Claiming lock…" : action === "force_unlock" ? "Force unlocking…" : "Releasing lock…";
    setStatus(label);
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action, entry },
      });
      populateForm(result.entry || currentEntry, { lockOwned: action === "lock" });
      setStatus(action === "lock" ? "Lock claimed." : "Lock released.", "ok");
      await renderActiveContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Lock update failed.", "err");
      updateLockUi();
    }
  }

  async function confirmDiscardEdits() {
    if (!formDirty) return true;
    return confirmDialog("Discard unsaved edits in the editor?", { confirmText: "Discard", cancelText: "Keep editing", danger: true });
  }

  async function editEntry(key) {
    if (!(await confirmDiscardEdits())) return;
    const [type, slug, locale] = String(key || "").split(":");
    const entry = [...(state.content || []), ...(workflowEntries || [])].find((row) => (
      row.type === type && row.slug === slug && (row.locale || "en") === (locale || "en")
    ));
    if (entry) populateForm(entry);
  }


  function wireContentRoot(root) {
    if (!root || root.dataset.contentWired === "1") return;
    root.dataset.contentWired = "1";
    // Resolve our user id once so reloads recognise our own editor lock (best-effort).
    supabase?.auth?.getSession?.().then((r) => { ownUserId = r?.data?.session?.user?.id || null; }).catch(() => {});
    // Unsaved edits are otherwise silently lost on tab close / navigation.
    window.addEventListener("beforeunload", (event) => {
      if (!formDirty) return;
      event.preventDefault();
      event.returnValue = "";
    });
    root.addEventListener("change", (event) => {
      if (event.target.matches("#contentType")) {
        renderStructuredFields(event.target.value, safePayloadJson());
        updatePlacementHint(event.target.value);
        syncStructuredPayload();
        return;
      }
      if (event.target.matches("#contentPayload")) {
        try {
          renderStructuredFields($("contentType")?.value || (blogMode ? "blog_post" : "service"), readPayloadJson());
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
      if (event.target.matches("#contentSlug")) normalizeManualSlug();
      if (event.target.matches("#contentTypeFilter, #contentStatusFilter")) {
        renderActiveContent({ refetch: true });
      }
    });
    root.addEventListener("input", (event) => {
      if (event.target.closest("#contentForm")) formDirty = true;
      if (event.target.matches("#contentTitle")) {
        syncSlugFromTitle();
        if (blogMode) syncStructuredPayload();
      }
      // Slug normalizes on CHANGE (blur), not per keystroke — per-keystroke slugify
      // stripped trailing "-", made spaces/hyphens untypable and jumped the caret.
      if (event.target.matches("#contentSlug")) slugManuallyEdited = true;
      if (event.target.matches("#contentScheduledAt")) refreshPreview();
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
      if (event.target.matches("[data-content-seo-field]")) syncSeoPayload();
    });
    root.addEventListener("change", (event) => {
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
      if (event.target.matches("[data-content-seo-field]")) syncSeoPayload();
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && $("contentAssetPicker") && !$("contentAssetPicker").hidden) assets.closeAssetPicker();
      if (event.target.matches("[data-chip-input]") && (event.key === "Enter" || event.key === ",")) {
        event.preventDefault();
        addChip(event.target.closest(".adm-chips"), event.target.value);
        event.target.value = "";
      }
    });
    // Commit a half-typed tag when the chip input loses focus.
    root.addEventListener("blur", (event) => {
      if (event.target.matches("[data-chip-input]") && event.target.value.trim()) {
        addChip(event.target.closest(".adm-chips"), event.target.value);
        event.target.value = "";
      }
    }, true);
    delegate(root, "click", "[data-chip-remove]", (_event, button) => {
      const container = button.closest(".adm-chips");
      button.closest(".adm-chip")?.remove();
      if (container) chipHiddenSync(container);
    });
    delegate(root, "click", "[data-content-edit]", (_event, button) => editEntry(button.dataset.contentEdit));
    delegate(root, "click", "[data-content-revision]", (_event, button) => revisions.inspectRevision(button.dataset.contentRevision));
    delegate(root, "click", "[data-content-revision-restore]", (_event, button) => restoreRevision(button.dataset.contentRevisionRestore));
    delegate(root, "click", "[data-content-revision-close]", () => revisions.closeRevisionDiff());
    delegate(root, "click", '[data-editor-action="close_reference"]', () => {
      const picker = $("contentReferencePicker");
      if (picker) picker.hidden = true;
    });
    delegate(root, "click", "[data-content-workflow]", (_event, button) => runWorkflow(button.dataset.contentWorkflow));
    delegate(root, "click", "[data-content-action]", (_event, button) => {
      const action = button.dataset.contentAction;
      if (action === "new") return confirmDiscardEdits().then((ok) => { if (ok) populateForm(); });
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
      if (action === "asset") return assets.openAssetPicker(button.dataset.contentAssetTarget, "payload", button);
      if (action === "asset_md") return assets.openAssetPicker(button.dataset.contentAssetTarget, "markdown", button);
      if (action === "seo_asset") return assets.openAssetPicker(button.dataset.contentSeoAssetTarget, "seo", button);
      if (action === "close_reference") {
        const picker = $("contentReferencePicker");
        if (picker) picker.hidden = true;
        return null;
      }
      if (action === "open_asset_viewer") return assets.openAssetViewer(button);
      if (action === "close_assets") return assets.closeAssetPicker();
      if (action === "upload_asset") return assets.uploadAsset();
      if (action === "register_asset") return assets.registerAsset();
    });
  }

  function wireContent() {
    wireContentRoot($("admContent"));
  }

  function wireBlog() {
    wireContentRoot($("admBlog"));
  }

  return { renderContent, renderBlog, wireContent, wireBlog };
}
