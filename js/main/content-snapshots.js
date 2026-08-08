import { initReveal } from "./effects.js";
import { esc } from "../util.js";
import { canonicalPublicImageUrl } from "../image-url.js?v=20260723a";
import { proofCardHtml } from "../proof-records.js?v=20260807g";
import {
  browserContentDeliveries,
  normalizeContentPageKey,
} from "../content-types.js";
import { loadPricingData } from "./pricing-data.js?v=20260807g";

const BROWSER_RENDERERS = Object.freeze({
  proof_card: proofCardHtml,
  resource_card: resourceCard,
  industry_sector: industrySector,
  faq_block: faqBlock,
  page_section: pageSection,
  pricing_tier: pricingTier,
});

export function contentSnapshotMounts() {
  return browserContentDeliveries().map((delivery) => {
    const renderer = BROWSER_RENDERERS[delivery.renderer];
    if (typeof renderer !== "function") {
      throw new Error(`content_renderer_missing:${delivery.renderer}`);
    }
    return { ...delivery, renderer };
  });
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

export function filterContentRows(rows = [], {
  category = "",
  page = "",
  region = "",
} = {}) {
  if (!Array.isArray(rows)) return [];
  const wanted = normalizeCategory(category);
  const wantedPage = normalizeContentPageKey(page);
  const wantedRegion = normalizeToken(region);
  return rows.filter((row) => {
    if (row?.active === false) return false;
    const rowCategory = normalizeCategory(row?.category);
    const rowPage = normalizeContentPageKey(row?.page);
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

export async function loadContentSnapshot({ file, endpoint, key }) {
  if (endpoint) {
    try {
      const pricing = await loadPricingData();
      return Array.isArray(pricing?.[key])
        ? { [key]: pricing[key] }
        : null;
    } catch {
      return null;
    }
  }
  try {
    const response = await fetch(`/data/content/${file}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
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
  const image = canonicalPublicImageUrl(row.image);
  return `
    <section id="${esc(row.slug || "")}" class="cms-page-section reveal">
      <div class="wrap cms-page-section-inner">
        <div class="cms-page-section-copy">
          ${row.eyebrow ? `<span class="eyebrow">${esc(row.eyebrow)}</span>` : ""}
          <h2 class="headline">${esc(row.headline || row.title || "Untitled section")}</h2>
          ${row.body ? `<p class="subhead">${esc(row.body)}</p>` : ""}
          ${href && row.cta ? `<a class="btn btn-primary" href="${esc(href)}">${esc(row.cta)}</a>` : ""}
        </div>
        ${image ? `
          <figure class="cms-page-section-media">
            <img src="${esc(image)}" alt="${esc(row.image_alt || row.headline || row.title || "")}" width="${esc(row.image_w || 1600)}" height="${esc(row.image_h || 900)}" loading="lazy">
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
  const image = canonicalPublicImageUrl(card.image);
  const thumb = image && card.href
    ? `<a class="row-thumb" href="${esc(safeContentHref(card.href, ""))}"${card.image_label ? ` aria-label="${esc(card.image_label)}"` : ""}><img src="${esc(image)}" alt="${esc(card.image_alt || card.title || "")}" loading="lazy"${dims}></a>`
    : "";
  return `
    <article id="${esc(card.slug || "")}" class="row-card${image ? " has-photo" : ""}">
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

function restoreHashTarget() {
  const rawId = window.location.hash.slice(1);
  if (!rawId) return;
  let id;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return;
  }
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

export async function initContentSnapshots() {
  const mounts = contentSnapshotMounts();
  const snapshots = await Promise.all(mounts.map(loadContentSnapshot));
  const rendered = mounts.map(({ key, renderer }, index) => {
    return renderMount(key, snapshots[index], key, renderer);
  }).some(Boolean);

  // CMS content is injected after initReveal() ran at DOMContentLoaded, so the
  // scroll-reveal IntersectionObserver never saw these nodes. Re-run the
  // idempotent reveal pass so injected `.reveal` sections/cards become visible
  // for motion-enabled users without requiring a scroll/resize.
  if (rendered) {
    initReveal();
    restoreHashTarget();
  }
}
