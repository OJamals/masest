const SNAPSHOT_FILES = {
  proof_cards: "proof.json",
  resource_cards: "resources.json",
  industry_cards: "industries.json",
  faq_blocks: "faqs.json",
  page_sections: "page-sections.json",
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

function normalizeToken(value) {
  return String(value || "").trim().toLowerCase();
}

export function safeContentHref(value, fallback = "") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (/^(?:javascript|data|vbscript):/i.test(raw)) return fallback;
  return raw;
}

export function filterContentRows(rows = [], { category = "", page = "", region = "" } = {}) {
  if (!Array.isArray(rows)) return [];
  const wanted = normalizeCategory(category);
  const wantedPage = normalizeToken(page);
  const wantedRegion = normalizeToken(region);
  return rows.filter((row) => {
    if (row?.active === false) return false;
    const rowCategory = normalizeCategory(row?.category);
    const rowPage = normalizeToken(row?.page);
    const rowRegion = normalizeToken(row?.region);
    if (wanted && rowCategory && rowCategory !== wanted) return false;
    if (wantedPage && rowPage && rowPage !== wantedPage) return false;
    if (wantedRegion && rowRegion && rowRegion !== wantedRegion) return false;
    return true;
  }).sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0));
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
  if (card.image) {
    return `
      <a class="route-card route-card-media-card" href="${esc(href)}">
        <figure class="route-card-media">
          <img src="${esc(card.image)}" alt="${esc(card.image_alt || card.title || "")}" loading="lazy">
        </figure>
        <span class="route-card-kicker">${esc(card.category || "Industry")}</span>
        <strong>${esc(card.title || "Untitled industry")}</strong>
        <b>${esc(card.summary || "")}</b>
      </a>
    `;
  }
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

function pageSection(row) {
  const href = safeContentHref(row.href, "");
  return `
    <section id="${esc(row.slug || "")}" class="cms-page-section reveal">
      <div class="wrap cms-page-section-inner">
        <div class="cms-page-section-copy">
          ${row.eyebrow ? `<span class="eyebrow">${esc(row.eyebrow)}</span>` : ""}
          <h2 class="headline">${esc(row.headline || row.title || "Untitled section")}</h2>
          ${row.body ? `<p class="subhead">${esc(row.body)}</p>` : ""}
          ${href && row.cta ? `<a class="btn btn-primary" href="${esc(href)}">${esc(row.cta)}</a>` : ""}
        </div>
        ${row.image ? `
          <figure class="cms-page-section-media">
            <img src="${esc(row.image)}" alt="${esc(row.image_alt || row.headline || row.title || "")}" loading="lazy">
          </figure>
        ` : ""}
      </div>
    </section>
  `;
}

function renderMount(name, snapshot, key, renderer) {
  document.querySelectorAll(`[data-cms-content="${name}"]`).forEach((mount) => {
    const rows = filterContentRows(snapshot?.[key], {
      category: mount.dataset.cmsCategory,
      page: mount.dataset.cmsPage,
      region: mount.dataset.cmsRegion,
    });
    if (!rows.length) return;
    mount.innerHTML = rows.map(renderer).join("");
    mount.dataset.cmsLoaded = "true";
  });
}

export async function initContentSnapshots() {
  const [proof, resources, industries, faqs, pageSections] = await Promise.all([
    loadContentSnapshot(SNAPSHOT_FILES.proof_cards),
    loadContentSnapshot(SNAPSHOT_FILES.resource_cards),
    loadContentSnapshot(SNAPSHOT_FILES.industry_cards),
    loadContentSnapshot(SNAPSHOT_FILES.faq_blocks),
    loadContentSnapshot(SNAPSHOT_FILES.page_sections),
  ]);

  renderMount("proof_cards", proof, "proof_cards", proofCard);
  renderMount("resource_cards", resources, "resource_cards", resourceCard);
  renderMount("industry_cards", industries, "industry_cards", industryCard);
  renderMount("faq_blocks", faqs, "faq_blocks", faqBlock);
  renderMount("page_sections", pageSections, "page_sections", pageSection);
}
