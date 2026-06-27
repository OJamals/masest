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
        <div id="contentStructuredFields" class="adm-content-fields full"></div>
        <label class="full">Payload JSON <textarea id="contentPayload" class="adm-textarea" spellcheck="false">{}</textarea></label>
        <label class="full">SEO JSON <textarea id="contentSeo" class="adm-textarea" spellcheck="false">{}</textarea></label>
        <div class="adm-inline-actions full">
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="new"><i class="ph ph-plus" aria-hidden="true"></i> New</button>
          <button class="btn btn-secondary btn-sm" type="button" data-content-action="draft"><i class="ph ph-floppy-disk" aria-hidden="true"></i> Save draft</button>
          <button class="btn btn-primary btn-sm" type="button" data-content-action="publish"><i class="ph ph-upload-simple" aria-hidden="true"></i> Publish</button>
          <button class="btn btn-ghost btn-sm" type="button" data-content-action="archive"><i class="ph ph-archive" aria-hidden="true"></i> Archive</button>
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
      </div>
      <form id="contentAssetUpload" class="adm-content-upload" onsubmit="return false">
        <label>Image file
          <input id="contentAssetFile" class="adm-input" type="file" accept="image/*">
        </label>
        <label>Alt text
          <input id="contentAssetAlt" class="adm-input" type="text" placeholder="Describe the image">
        </label>
        <button class="btn btn-secondary btn-sm" type="button" data-content-action="upload_asset">
          <i class="ph ph-upload-simple" aria-hidden="true"></i> Upload
        </button>
      </form>
      <div class="adm-list">${admEmpty("ph-image", "No assets", "Add asset metadata before selecting media.")}</div>
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

function readStructuredValues() {
  const values = {};
  document.querySelectorAll("[data-content-payload-field]").forEach((control) => {
    const key = control.dataset.contentPayloadField;
    values[key] = control.type === "checkbox" ? control.checked : control.value;
  });
  return values;
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
    seo = JSON.parse(document.getElementById("contentSeo").value || "{}");
  } catch (error) {
    throw new Error(`Invalid JSON: ${error.message}`);
  }
  return {
    type: document.getElementById("contentType").value,
    locale: document.getElementById("contentLocale").value.trim() || "en",
    title: document.getElementById("contentTitle").value.trim(),
    slug: slugifyContentTitle(document.getElementById("contentSlug").value.trim()),
    payload,
    seo,
  };
}

export function createContentTab({ $, api, state, admSkeleton, admEmpty }) {
  let mounted = false;
  let assetTargetField = "image";
  let workflowEntries = [];
  let slugManuallyEdited = false;
  let lastGeneratedSlug = "";

  function setStatus(text, kind = "") {
    const el = $("contentStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.state = kind;
  }

  function publishStatusText(result = {}) {
    const hook = result.publish_hook;
    if (!hook) return "Published.";
    if (hook.skipped) return "Published. Static rebuild hook not configured.";
    if (hook.ok) return "Published. Static rebuild triggered.";
    const detail = hook.status || hook.message || hook.error || "hook failed";
    return `Published. Static rebuild failed: ${detail}.`;
  }

  function mount() {
    const root = $("admContent");
    if (!root || mounted) return;
    root.innerHTML = shellTemplate(admEmpty);
    renderStructuredFields("service", {});
    $("contentPreviewFrame")?.addEventListener("load", () => refreshPreview());
    void renderExportStatus();
    mounted = true;
  }

  function renderStructuredFields(type, payload = {}) {
    const box = $("contentStructuredFields");
    if (!box) return;
    box.innerHTML = structuredFieldsTemplate(type, payload);
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

  function populateForm(entry = {}) {
    $("contentType").value = entry.type || "service";
    $("contentLocale").value = entry.locale || "en";
    $("contentTitle").value = entry.title || "";
    $("contentSlug").value = entry.slug || "";
    slugManuallyEdited = Boolean(entry.slug);
    lastGeneratedSlug = slugifyContentTitle(entry.title || "");
    $("contentPayload").value = jsonText(entry.payload);
    $("contentSeo").value = jsonText(entry.seo);
    renderStructuredFields(entry.type || "service", entry.payload || {});
    const badge = $("contentEditorBadge");
    if (badge) {
      badge.textContent = entry.status || "draft";
      badge.dataset.s = entry.status || "draft";
    }
    setStatus("");
    void loadRevisions(entry);
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

  async function openAssetPicker(fieldKey) {
    const panel = $("contentAssetPicker");
    if (!panel) return;
    assetTargetField = fieldKey || assetTargetField || "image";
    panel.hidden = false;
    const list = panel.querySelector(".adm-list");
    if (!list) return;
    list.innerHTML = admSkeleton(5);
    try {
      const data = await api("/api/admin/content-assets");
      const assets = data.assets || [];
      list.innerHTML = assets.map((asset) => `
        <button class="adm-list-row adm-content-asset-row" type="button" data-content-asset-field="${esc(assetTargetField)}" data-content-asset-path="${esc(asset.public_url || asset.storage_path)}" data-content-asset-alt="${esc(asset.alt || "")}">
          <b>${esc(asset.storage_path)}</b>
          <span>${esc(asset.alt || "")}</span>
        </button>
      `).join("") || admEmpty("ph-image", "No assets", "Add asset metadata before selecting media.");
    } catch (error) {
      list.innerHTML = admEmpty(
        "ph-warning",
        "Assets unavailable",
        error.data?.message || error.data?.error || error.message || "Try again.",
      );
    }
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

  function assignAssetValue(fieldKey, assetPath, assetAlt = "", message = "Asset path inserted.") {
    const root = $("admContent");
    const control = findPayloadField(root, fieldKey);
    if (control) {
      control.value = assetPath || "";
      const altControl = findPayloadField(root, pairedAssetAltField(fieldKey));
      if (assetAlt && altControl) altControl.value = assetAlt;
      syncStructuredPayload();
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
    );
  }

  async function uploadAsset() {
    const fileInput = $("contentAssetFile");
    const altInput = $("contentAssetAlt");
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
    setStatus("Uploading asset...");
    try {
      const result = await api("/api/admin/content-assets", { method: "POST", body: form });
      const assetPath = result.asset?.public_url || result.asset?.storage_path || "";
      if (!assetPath) throw new Error("upload_missing_asset_path");
      if (fileInput) fileInput.value = "";
      if (altInput) altInput.value = "";
      assignAssetValue(assetTargetField, assetPath, result.asset?.alt || alt, "Asset uploaded.");
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Asset upload failed.", "err");
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
    setStatus(publish ? "Publishing..." : "Saving draft...");
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { publish, entry: selectedFormEntry({ validate: true }) },
      });
      populateForm(result.entry || {});
      setStatus(
        publish ? publishStatusText(result) : "Draft saved.",
        publish && result.publish_hook?.ok === false ? "err" : "ok",
      );
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || error.message || "Save failed.", "err");
    }
  }

  async function runWorkflow(action) {
    setStatus(`Updating workflow: ${action.replace(/_/g, " ")}...`);
    try {
      const result = await api("/api/admin/content", {
        method: "POST",
        body: { action, entry: selectedFormEntry({ validate: true }) },
      });
      populateForm(result.entry || {});
      setStatus(`Workflow updated: ${action.replace(/_/g, " ")}.`, "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Workflow update failed.", "err");
    }
  }

  async function archiveContent() {
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
      populateForm(result.entry || {});
      setStatus("Archived.", "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Archive failed.", "err");
    }
  }

  async function restoreRevision(version) {
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
      populateForm(result.entry || {});
      setStatus(`Restored version ${version} as a draft.`, "ok");
      await renderContent({ refetch: true });
    } catch (error) {
      setStatus(error.data?.message || error.data?.error || "Restore failed.", "err");
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
      if (event.target.matches("#contentTypeFilter, #contentStatusFilter")) {
        renderContent({ refetch: true });
      }
    });
    root.addEventListener("input", (event) => {
      if (event.target.matches("#contentTitle")) syncSlugFromTitle();
      if (event.target.matches("#contentSlug")) normalizeManualSlug();
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
    });
    root.addEventListener("change", (event) => {
      if (event.target.matches("[data-content-payload-field]")) syncStructuredPayload();
    });
    delegate(root, "click", "[data-content-edit]", (_event, button) => editEntry(button.dataset.contentEdit));
    delegate(root, "click", "[data-content-revision]", (_event, button) => restoreRevision(button.dataset.contentRevision));
    delegate(root, "click", "[data-content-asset-path]", (_event, button) => assignAssetPath(button));
    delegate(root, "click", "[data-content-workflow]", (_event, button) => runWorkflow(button.dataset.contentWorkflow));
    delegate(root, "click", "[data-content-action]", (_event, button) => {
      const action = button.dataset.contentAction;
      if (action === "new") return populateForm();
      if (action === "draft") return saveContent({ publish: false });
      if (action === "publish") return saveContent({ publish: true });
      if (action === "archive") return archiveContent();
      if (action === "preview") return refreshPreview();
      if (action === "asset") return openAssetPicker(button.dataset.contentAssetTarget);
      if (action === "upload_asset") return uploadAsset();
    });
  }

  return { renderContent, wireContent };
}
