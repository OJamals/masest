import { initReveal } from "./effects.js";

const SNAPSHOT_FILES = {
  proof_cards: "proof.json",
  resource_cards: "resources.json",
  industry_cards: "industries.json",
  faq_blocks: "faqs.json",
  page_sections: "page-sections.json",
  pricing_tiers: "pricing.json",
  industry_sectors: "industry-sectors.json",
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

export function mergeCmsMountHtml(fallbackHtml = "", cmsHtml = "", { mode = "", alreadyLoaded = false } = {}) {
  const fallback = String(fallbackHtml || "");
  const cms = String(cmsHtml || "");
  if (alreadyLoaded || !cms) return fallback;
  if (String(mode || "").trim().toLowerCase() === "replace") return cms;
  if (!fallback.trim()) return cms;
  return `${fallback}${cms}`;
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
  const dims = `${card.image_w ? ` width="${esc(card.image_w)}"` : ""}${card.image_h ? ` height="${esc(card.image_h)}"` : ""}`;
  const img = card.image
    ? `<img src="${esc(card.image)}" alt="${esc(card.image_alt || card.title || "")}" loading="lazy"${dims}>`
    : "";
  const afterDims = `${card.image_after_w ? ` width="${esc(card.image_after_w)}"` : ""}${card.image_after_h ? ` height="${esc(card.image_after_h)}"` : ""}`;
  const afterImg = card.image_after
    ? `<img src="${esc(card.image_after)}" alt="${esc(card.image_after_alt || card.title || "")}" loading="lazy"${afterDims}>`
    : "";
  // A proof card renders one of three medias: a before/after pair (image +
  // image_after → two-figure .case-ba), a source-PDF doc-link (href set → badge
  // wrapper, kept a direct child of .case-card for the 16:10 aspect-ratio), or a
  // plain figure. `href` doubles as the PDF doc link for single-image cards.
  const docHref = card.href ? safeContentHref(card.href, "") : "";
  let media = "";
  if (img && afterImg) {
    media = `<div class="case-ba"><figure>${img}<figcaption>Before</figcaption></figure><figure>${afterImg}<figcaption>After</figcaption></figure></div>`;
  } else if (img && docHref) {
    media = `<a class="doc-link" href="${esc(docHref)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(card.title || "Proof")} (opens PDF in new tab)">${img}<span class="doc-badge" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 2 4 4h-4V4ZM8 13h8v1.5H8V13Zm0 3h8v1.5H8V16Zm0-6h4v1.5H8V10Z"/></svg>PDF</span></a>`;
  } else if (img) {
    media = `<figure class="case-media">${img}</figure>`;
  }
  return `
    <article id="${esc(card.slug || "")}" class="case-card reveal" data-proof-card data-proof-kind="${esc(card.kind || "all")}">
      ${media}
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

function pricingTier(tier) {
  const href = safeContentHref(tier.href, "contact");
  const featured = tier.featured === true;
  const features = Array.isArray(tier.features) ? tier.features : [];
  const list = features.length
    ? `<ul class="tier-list">${features.map((item) => `<li><i class="ph ph-check" aria-hidden="true"></i>${esc(item)}</li>`).join("")}</ul>`
    : "";
  return `
    <div class="tier-card${featured ? " featured" : ""} reveal">
      ${tier.badge ? `<span class="tier-badge">${esc(tier.badge)}</span>` : ""}
      <div class="tier-name">${esc(tier.name || tier.title || "Tier")}</div>
      ${tier.audience ? `<div class="tier-sub">${esc(tier.audience)}</div>` : ""}
      ${tier.price ? `<div class="tier-price">${esc(tier.price)}${tier.price_unit ? `<small> ${esc(tier.price_unit)}</small>` : ""}</div>` : ""}
      ${tier.annual ? `<div class="tier-annual">${esc(tier.annual)}</div>` : ""}
      ${list}
      ${tier.replaces ? `<p class="tier-foot">${esc(tier.replaces)}</p>` : ""}
      ${tier.cta ? `<a class="btn ${featured ? "btn-primary" : "btn-ghost"} btn-sm" href="${esc(href)}">${esc(tier.cta)}</a>` : ""}
    </div>
  `;
}

function industrySector(card) {
  const fit = `industries/${esc(card.slug || "")}`;
  const dims = `${card.image_w ? ` width="${esc(card.image_w)}"` : ""}${card.image_h ? ` height="${esc(card.image_h)}"` : ""}`;
  const icon = card.icon || "ph-buildings";
  const thumb = card.image && card.href
    ? `<a class="row-thumb" href="${esc(safeContentHref(card.href, ""))}"${card.image_label ? ` aria-label="${esc(card.image_label)}"` : ""}><img src="${esc(card.image)}" alt="${esc(card.image_alt || card.title || "")}" loading="lazy"${dims}></a>`
    : "";
  return `
    <article id="${esc(card.slug || "")}" class="row-card${card.image ? " has-photo" : ""}">
      <i class="ph ${esc(icon)}" aria-hidden="true"></i>
      <div><h3>${esc(card.title || "Industry")}</h3><p>${esc(card.summary || "")}</p></div>
      ${thumb}
      <a class="btn btn-ghost btn-sm" href="${fit}">View fit</a>
    </article>
  `;
}

function renderMount(name, snapshot, key, renderer) {
  let rendered = false;
  document.querySelectorAll(`[data-cms-content="${name}"]`).forEach((mount) => {
    if (mount.dataset.cmsLoaded === "true") return;
    const rows = filterContentRows(snapshot?.[key], {
      category: mount.dataset.cmsCategory,
      page: mount.dataset.cmsPage,
      region: mount.dataset.cmsRegion,
    });
    if (!rows.length) return;
    const html = rows.map(renderer).join("");
    const mode = mount.dataset.cmsRender || "";
    const shouldReplace = String(mode).trim().toLowerCase() === "replace";
    if (shouldReplace || !mount.innerHTML.trim()) {
      mount.innerHTML = mergeCmsMountHtml(mount.innerHTML, html, { mode });
    } else {
      mount.insertAdjacentHTML("beforeend", html);
    }
    mount.dataset.cmsLoaded = "true";
    rendered = true;
  });
  return rendered;
}

export async function initContentSnapshots() {
  const [proof, resources, industries, faqs, pageSections, pricingTiers, industrySectors] = await Promise.all([
    loadContentSnapshot(SNAPSHOT_FILES.proof_cards),
    loadContentSnapshot(SNAPSHOT_FILES.resource_cards),
    loadContentSnapshot(SNAPSHOT_FILES.industry_cards),
    loadContentSnapshot(SNAPSHOT_FILES.faq_blocks),
    loadContentSnapshot(SNAPSHOT_FILES.page_sections),
    loadContentSnapshot(SNAPSHOT_FILES.pricing_tiers),
    loadContentSnapshot(SNAPSHOT_FILES.industry_sectors),
  ]);

  const rendered = [
    renderMount("proof_cards", proof, "proof_cards", proofCard),
    renderMount("resource_cards", resources, "resource_cards", resourceCard),
    renderMount("industry_cards", industries, "industry_cards", industryCard),
    renderMount("faq_blocks", faqs, "faq_blocks", faqBlock),
    renderMount("page_sections", pageSections, "page_sections", pageSection),
    renderMount("pricing_tiers", pricingTiers, "pricing_tiers", pricingTier),
    renderMount("industry_sectors", industrySectors, "industry_sectors", industrySector),
  ].some(Boolean);

  // CMS content is injected after initReveal() ran at DOMContentLoaded, so the
  // scroll-reveal IntersectionObserver never saw these nodes. Re-run the
  // idempotent reveal pass so injected `.reveal` sections/cards become visible
  // for motion-enabled users without requiring a scroll/resize.
  if (rendered) initReveal();
}
