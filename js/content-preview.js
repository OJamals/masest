const root = document.getElementById("contentPreviewRoot");

const LABELS = {
  service: "Service",
  service_package: "Service package",
  proof_card: "Proof card",
  resource_card: "Resource card",
  industry_card: "Industry card",
  faq_block: "FAQ block",
  page_meta: "Page metadata",
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function previewSummary(payload = {}) {
  return payload.summary
    || payload.description
    || payload.result
    || payload.answer
    || payload.category
    || "";
}

function definitionRows(payload = {}) {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `
      <dt>${esc(key.replace(/_/g, " "))}</dt>
      <dd>${esc(Array.isArray(value) ? value.join(", ") : value)}</dd>
    `).join("");
}

export function renderPreview(entry = {}) {
  if (!root) return;
  const payload = objectValue(entry.payload);
  const rows = definitionRows(payload);
  const summary = previewSummary(payload);
  root.innerHTML = `
    <div class="wrap">
      <article class="content-preview-card">
        <div class="content-preview-meta">
          <span class="content-preview-pill">${esc(LABELS[entry.type] || entry.type || "Content")}</span>
          <span class="content-preview-pill">${esc(entry.locale || "en")}</span>
          <span class="content-preview-pill">${esc(entry.slug || "unsaved")}</span>
        </div>
        <h1 class="headline">${esc(entry.title || "Untitled draft")}</h1>
        ${summary ? `<p class="subhead">${esc(summary)}</p>` : ""}
        <div class="content-preview-grid">
          ${rows ? `<dl>${rows}</dl>` : '<p class="muted">No structured payload fields yet.</p>'}
          <pre class="content-preview-code">${esc(JSON.stringify(payload, null, 2))}</pre>
        </div>
      </article>
    </div>
  `;
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type !== "masest:content-preview") return;
  renderPreview(event.data.entry || {});
});
