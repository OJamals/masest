const SNAPSHOT_FILES = {
  proof_cards: "proof.json",
  resource_cards: "resources.json",
  industry_cards: "industries.json",
  faq_blocks: "faqs.json",
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

function normalizeCategory(value) {
  return String(value || "").trim().toLowerCase();
}

export function safeContentHref(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^(?:javascript|data|vbscript):/i.test(raw)) return fallback;
  return raw;
}

export function filterContentRows(rows = [], { category = "" } = {}) {
  if (!Array.isArray(rows)) return [];
  const wanted = normalizeCategory(category);
  if (!wanted) return rows;
  return rows.filter((row) => {
    const rowCategory = normalizeCategory(row?.category);
    return !rowCategory || rowCategory === wanted;
  });
}

export async function loadContentSnapshot(file) {
  try {
    const response = await fetch(`/data/content/${file}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function proofCard(card) {
  const chips = Array.isArray(card.chips) ? card.chips : [];
  return `
    <article id="${esc(card.slug || "")}" class="case-card reveal" data-proof-card data-proof-kind="${esc(card.kind || "all")}">
      ${card.image ? `<figure class="case-media"><img src="${esc(card.image)}" alt="${esc(card.image_alt || card.title || "")}" loading="lazy"></figure>` : ""}
      <div class="case-body">
        <span class="case-eyebrow">${esc(card.eyebrow || "Proof")}</span>
        <h3>${esc(card.title || "Untitled proof")}</h3>
        <p class="case-result">${esc(card.result || card.summary || "")}</p>
        ${chips.length ? `<div class="case-meta">${chips.map((chip) => `<span class="case-chip">${esc(chip)}</span>`).join("")}</div>` : ""}
        ${card.source ? `<span class="case-source">${esc(card.source)}</span>` : ""}
      </div>
    </article>
  `;
}

function resourceCard(card) {
  const href = safeContentHref(card.href, "resources.html");
  return `
    <a class="route-card" href="${esc(href)}">
      <span>${esc(card.icon || card.cta || "Resource")}</span>
      <strong>${esc(card.title || "Untitled resource")}</strong>
      <b>${esc(card.description || "")}</b>
    </a>
  `;
}

function industryCard(card) {
  const href = safeContentHref(card.href, "industries.html");
  return `
    <a class="route-card" href="${esc(href)}">
      <span>${esc(card.category || "Industry")}</span>
      <strong>${esc(card.title || "Untitled industry")}</strong>
      <b>${esc(card.summary || "")}</b>
    </a>
  `;
}

function faqBlock(row) {
  return `
    <details class="resource-disclosure" id="${esc(row.slug || "")}">
      <summary>${esc(row.question || row.title || "Question")}</summary>
      <p>${esc(row.answer || "")}</p>
    </details>
  `;
}

function renderMount(name, snapshot, key, renderer) {
  document.querySelectorAll(`[data-cms-content="${name}"]`).forEach((mount) => {
    const rows = filterContentRows(snapshot?.[key], { category: mount.dataset.cmsCategory });
    if (!rows.length) return;
    mount.innerHTML = rows.map(renderer).join("");
    mount.dataset.cmsLoaded = "true";
  });
}

export async function initContentSnapshots() {
  const [proof, resources, industries, faqs] = await Promise.all([
    loadContentSnapshot(SNAPSHOT_FILES.proof_cards),
    loadContentSnapshot(SNAPSHOT_FILES.resource_cards),
    loadContentSnapshot(SNAPSHOT_FILES.industry_cards),
    loadContentSnapshot(SNAPSHOT_FILES.faq_blocks),
  ]);

  renderMount("proof_cards", proof, "proof_cards", proofCard);
  renderMount("resource_cards", resources, "resource_cards", resourceCard);
  renderMount("industry_cards", industries, "industry_cards", industryCard);
  renderMount("faq_blocks", faqs, "faq_blocks", faqBlock);
}
