#!/usr/bin/env node
/**
 * Idempotent SEO/static-page injector.
 *
 * Writes canonical/OG/JSON-LD blocks into committed HTML, generates static
 * product detail pages, and regenerates sitemap.xml from final extensionless
 * public URLs. Cloudflare Pages serves these files directly.
 *
 * Run `npm run seo-inject` (not `node tools/seo-inject.mjs` directly) so the
 * `preseo-inject` hook refreshes data/reviews.json first — this tool reads that
 * tracked snapshot to bake static AggregateRating JSON-LD for product/service
 * pages, same as it already reads data/content/page-meta.json for CMS overrides.
 */
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import {
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCTS,
  QUOTE_FIRST_IDS,
  productHighlights,
} from "../js/main/catalog-data.js";
import {
  contentPageMount,
  ensureContentPageMount,
  normalizeContentPageKey,
  specializedContentDeliveries,
} from "../js/content-types.js";
import { proofRecordsHtml } from "../js/proof-records.js";
import {
  documentAllowedOnSurface,
  documentEffectiveDate,
  documentRevision,
  documentSurfaceMode,
  documentType,
} from "./public-document-policy.mjs";
import { organizationJsonLd } from "./company-identity.mjs";
import { COMPONENT_VERSION, MAIN_VERSION, NAVIGATION_VERSION, STYLE_VERSION } from "./static-release.mjs";

const CATALOG_SEED = JSON.parse(readFileSync(new URL("../data/catalog.seed.json", import.meta.url), "utf8"));
const GENERATED_PRODUCT_FILES = new Set(
  CATALOG_SEED.products.map((product) => `${product.slug}.html`),
);
const SPECIALIZED_CONTENT = specializedContentDeliveries();
const BLOG_DELIVERY = SPECIALIZED_CONTENT.find(({ generator }) => generator === "blog_pages");
const PAGE_META_DELIVERY = SPECIALIZED_CONTENT.find(({ generator }) => generator === "page_metadata");
if (!BLOG_DELIVERY || !PAGE_META_DELIVERY) throw new Error("specialized_content_delivery_missing");
const BLOG_SNAPSHOT = JSON.parse(readFileSync(
  new URL(`../data/content/${BLOG_DELIVERY.file}`, import.meta.url),
  "utf8",
));
const INDUSTRY_APPLICATIONS = JSON.parse(
  readFileSync(new URL("../data/industry-applications.json", import.meta.url), "utf8"),
).industries;
const INDUSTRY_SLUGS = INDUSTRY_APPLICATIONS.map((industry) => industry.slug);
const MARINE_PRODUCT_NAMES_BY_BASE = new Map(
  (INDUSTRY_APPLICATIONS.find((industry) => industry.slug === "marine")?.approved_product_names || [])
    .map((product) => [product.base_product, product]),
);
const PROOF_RECORDS = JSON.parse(
  readFileSync(new URL("../data/content/proof.json", import.meta.url), "utf8"),
).proof_cards;
const SITE_IMAGE_DIMENSIONS = new Map(
  JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8")).assets
    .map((asset) => [asset.public_url, { width: asset.width, height: asset.height, alt: asset.alt }]),
);
// A URL that 301s must not appear in the sitemap — Search Console reports a redirecting
// sitemap URL as an error, and it asks the crawler to keep re-fetching a page that only
// forwards. The post itself stays in the CMS and its page keeps generating; the redirect
// map in data/content-redirects.json is the single switch that retires the URL.
const REDIRECTED_PATHS = new Set(
  JSON.parse(readFileSync(new URL("../data/content-redirects.json", import.meta.url), "utf8"))
    .redirects.map(({ from }) => from),
);
const BLOG_POST_SLUGS = (BLOG_SNAPSHOT[BLOG_DELIVERY.key] || [])
  .map((post) => post.slug)
  .filter(Boolean)
  .filter((slug) => !REDIRECTED_PATHS.has(`/blog/${slug}`));
const DOCUMENT_REVIEW = JSON.parse(readFileSync(new URL("../data/public-document-review.json", import.meta.url), "utf8"));
const DOCUMENTS = new Map(DOCUMENT_REVIEW.documents.map((document) => [document.path, document]));
const AUTHORITY_RECORDS = DOCUMENT_REVIEW.documents.flatMap((document) => document.authority_records || []);
const PROOF_RECORDS_BY_SLUG = new Map(PROOF_RECORDS.map((record) => [record.slug, record]));
const DOCUMENT_SKU_LABELS = new Map([
  ["VK-HCR", "VertKleen CIP HCR"],
  ["VK-HCR-T16", "VertKleen HVAC HCR"],
  ["VK-CR", "VertKleen CIP CR"],
  ["VK-CR2", "VertKleen HVAC CR"],
  ["VK-CRHD", "VertKleen CR HD"],
  ["VK-ALB", "VertKleen AlumiBrite"],
  ["VK-CRS", "VertKleen CRS"],
  ["VK-DESC", "VertKleen Descaler"],
  ["VK-NEUT", "VertKleen Neutral"],
  ["VK-MW", "VertKleen MultiWash"],
  ["VK-WS60", "WaterSafe60"],
  ["VK-PRG", "Purgo"],
  ["VK-LAM3", "VertKleen LAM3"],
  ["VK-SAR", "VertKleen SAR"],
  ["VK-TRQ", "VertKleen Torque"],
]);

const BASE = "https://masest.co";
const OG_IMAGE = `${BASE}/img/og-card.png`;
const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";
const START = "<!-- seo:auto -->";
const END = "<!-- /seo:auto -->";

const PRODUCT_IDS = CATALOG_ORDER.filter((id) => PRODUCTS[id]);

// Merchandising links from exact product routes to existing, reviewed comparison
// guides. Keep CIP and HVAC formulations separate: hcr-t16 owns facility
// descaling comparisons; cr/hcr own the two-step brewery cycle guide.
const PRODUCT_COMPARISONS = new Map([
  ["cr", [{
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer-line cleaner cost guide",
    summary: "Product, cycle time, rinses, labor, and downtime",
  }]],
  ["hcr", [{
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer-line cleaner cost guide",
    summary: "Product, cycle time, rinses, labor, and downtime",
  }]],
  ["hcr-t16", [{
    slug: "vertkleen-hcr-vs-clr",
    title: "HCR vs CLR",
    summary: "Rust, scale, labor, and total job cost",
  }, {
    slug: "hcr-vs-rydlyme",
    title: "HCR vs RYDLYME",
    summary: "Product use, rinse water, and downtime",
  }]],
  ["crhd", [{
    slug: "cr-hd-vs-simple-green",
    title: "CR HD vs Simple Green",
    summary: "Heavy grease, repeat passes, water, and labor",
  }]],
  ["lam3", [{
    slug: "lam3-vs-wet-forget",
    title: "LAM3 vs Wet & Forget",
    summary: "Finished area, labor, and maintenance cycle",
  }]],
]);

// Editorial catalog id -> commerce/reviews sku. Reviews and order items key on
// the commerce sku, not the editorial id. Keep this aligned with commerce-ui.
const COMMERCE_SKU_ALIAS = { crhd: "cr-hd" };
const commerceSku = (id) => COMMERCE_SKU_ALIAS[id] || id;

const CATALOG_PRODUCTS_BY_SLUG = new Map(
  CATALOG_SEED.products.map((product) => [product.slug, product]),
);
const SERVICE_CATEGORIES = CATALOG_SEED.service_categories || [];
const SERVICE_ROWS = [...(CATALOG_SEED.services || []), ...(CATALOG_SEED.service_packages || [])]
  .filter((item) => item?.active !== false);

function serviceCategoryKey(value) {
  return value === "Lab Testing - Materials" ? "Testing - Materials" : value;
}

function serviceCategoryItems(category) {
  return SERVICE_ROWS.filter((item) => serviceCategoryKey(item.category) === category.key);
}

const ORG = organizationJsonLd();

const PUBLIC = {
  "index.html": { loc: "/", priority: "1.0", changefreq: "weekly", jsonld: [ORG, { "@type": "WebSite", name: "MASEST VertKleen", url: `${BASE}/` }] },
  "about.html": { loc: "/about", priority: "0.5", changefreq: "monthly", jsonld: [ORG] },
  "contact.html": { loc: "/contact", priority: "0.6", changefreq: "monthly", jsonld: [ORG] },
  "products.html": { loc: "/products", priority: "0.9", changefreq: "weekly", jsonld: [ORG] },
  "services.html": { loc: "/services", priority: "0.8", changefreq: "monthly", jsonld: [ORG] },
  "programs.html": { loc: "/programs", priority: "0.8", changefreq: "monthly", jsonld: [ORG] },
  "proof.html": { loc: "/proof", priority: "0.7", changefreq: "monthly", jsonld: [ORG] },
  "resources.html": { loc: "/resources", priority: "0.6", changefreq: "monthly", jsonld: [ORG] },
  "blog.html": { loc: "/blog", priority: "0.7", changefreq: "weekly", jsonld: [{ "@type": "Blog", name: "MASEST VertKleen Blog", url: `${BASE}/blog`, publisher: ORG }] },
  "newsletter.html": { loc: "/newsletter", priority: "0.5", changefreq: "monthly", jsonld: [ORG, { "@type": "WebPage", name: "Newsletter", url: `${BASE}/newsletter` }] },
  "privacy.html": { loc: "/privacy", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "Privacy", url: `${BASE}/privacy` }] },
  "terms.html": { loc: "/terms", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "Terms", url: `${BASE}/terms` }] },
  "eula.html": { loc: "/eula", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "End-User License Agreement", url: `${BASE}/eula` }] },
  "shipping-returns.html": { loc: "/shipping-returns", priority: "0.4", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "Shipping and Returns", url: `${BASE}/shipping-returns` }] },
  "industries.html": { loc: "/industries", priority: "0.7", changefreq: "monthly", jsonld: [ORG] },
};

Object.assign(PUBLIC, Object.fromEntries([
  ...INDUSTRY_SLUGS.map((slug) => [`industries/${slug}.html`, `/industries/${slug}`, "0.6"]),
  ["pricing-hvac-facilities.html", "/pricing-hvac-facilities", "0.7"],
  ["pricing-cip-food-beverage.html", "/pricing-cip-food-beverage", "0.7"],
  ["comparisons/vertkleen-hcr-vs-clr.html", "/comparisons/vertkleen-hcr-vs-clr", "0.7"],
  ["comparisons/hcr-vs-rydlyme.html", "/comparisons/hcr-vs-rydlyme", "0.7"],
  ["comparisons/cr-hd-vs-simple-green.html", "/comparisons/cr-hd-vs-simple-green", "0.7"],
  ["comparisons/lam3-vs-wet-forget.html", "/comparisons/lam3-vs-wet-forget", "0.7"],
  ["comparisons/beer-line-cleaner-cost-comparison.html", "/comparisons/beer-line-cleaner-cost-comparison", "0.7"],
].map(([file, loc, priority]) => [file, { loc, priority, changefreq: "monthly" }])));

const PRIVATE = [
  "404.html",
  "account.html",
  "admin.html",
  "business.html",
  "cart.html",
  "checkout.html",
  "content-preview.html",
  "dashboard.html",
  "order-confirmed.html",
  "review.html",
];

const RELEASE_ONLY = [
  "quickbooks-connect.html",
  "quickbooks-disconnect.html",
  "quickbooks-launch.html",
];

const attr = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;");

const text = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

function currentDocument(path, surface) {
  const document = DOCUMENTS.get(path);
  if (!document) throw new Error(`Public page references unreviewed document: ${path}`);
  if (!documentAllowedOnSurface(document, surface)) return null;
  return document;
}

function productProofRecords(productId) {
  const records = new Map();
  for (const authority of AUTHORITY_RECORDS.filter((record) => record.product === productId)) {
    const proof = PROOF_RECORDS_BY_SLUG.get(authority.proof_slug);
    if (!proof) throw new Error(`Missing authority proof ${authority.proof_slug}`);
    const current = records.get(proof.slug);
    if (current && current.record_type !== authority.type) {
      throw new Error(`Authority proof ${proof.slug} mixes record types`);
    }
    records.set(proof.slug, {
      ...proof,
      record_type: authority.type,
      record_label: `Exact-product ${authority.type} record`,
    });
  }
  for (const slug of PRODUCT_CATALOG_COPY[productId]?.proof_slugs || []) {
    const proof = PROOF_RECORDS_BY_SLUG.get(slug);
    if (!proof || proof.publication_scope !== "Published result summary") {
      throw new Error(`Missing published result summary ${slug}`);
    }
    if (records.has(slug)) throw new Error(`Proof ${slug} mixes authority and result mappings`);
    records.set(slug, { ...proof, record_label: "Real-world result" });
  }
  return [...records.values()];
}

function documentControl(document) {
  return `${document.document_id} · Rev ${documentRevision(document, DOCUMENT_REVIEW.document_control)} · SKUs: ${document.skus.join(", ")}`;
}

function documentAnalyticsName(document) {
  return document.title
    .replace("Safety Data Sheet", "SDS")
    .replace("Technical Data Sheet", "TDS");
}

function documentDisplayTitle(document, categoryKey = "") {
  if (categoryKey === "safety-data-sheets") return "Safety Data Sheet";
  if (categoryKey === "technical-data-sheets") return "Technical Data Sheet";
  return document.title
    .replace("VertKleen Cooling Tower Chemistry Brochure", "VertKleen Cooling Tower Brochure");
}

function documentLibrary() {
  const available = DOCUMENT_REVIEW.documents.filter(
    (entry) => documentAllowedOnSurface(entry, "resource")
      && documentSurfaceMode(entry, "resource") === "download",
  );
  const categories = [
    {
      key: "labels",
      label: "Labels",
      description: "Find the right label for your VertKleen product and application.",
      matches: (document) => /label/i.test(document.title),
    },
    {
      key: "safety-data-sheets",
      label: "Safety Data Sheets",
      description: "Download current public SDS files by product.",
      matches: (document) => documentType(document) === "sds",
    },
    {
      key: "technical-data-sheets",
      label: "Technical Data Sheets",
      description: "Download current public technical product information.",
      matches: (document) => documentType(document) === "tds",
    },
    {
      key: "supporting-documents",
      label: "Guides, Tests & Results",
      description: "Browse practical guides, test results, comparisons, and product help.",
      matches: () => true,
    },
  ];
  const assigned = new Set();
  const labelCollections = new Map([
    ["marine", "Marine labels"],
    ["hvac", "HVAC labels"],
    ["cip", "CIP labels"],
    ["general", "General product labels"],
    ["earlier-public", "Other product labels"],
  ]);

  const renderDocument = (document, categoryKey) => {
    const revision = documentRevision(document, DOCUMENT_REVIEW.document_control);
    const displayTitle = documentDisplayTitle(document, categoryKey);
    const accessibleTitle = documentDisplayTitle(document);
    const common = `data-document-id="${attr(document.document_id)}" data-document-revision="${attr(revision)}" data-document-effective="${attr(documentEffectiveDate(document, DOCUMENT_REVIEW.document_control))}" data-document-skus="${attr(document.skus.join(" "))}" data-document-name="${attr(documentAnalyticsName(document))}"`;
    return `            <a class="doc-chip" href="${attr(document.path)}" ${common} data-document-download target="_blank" rel="noopener" download aria-label="Download ${attr(accessibleTitle)} (PDF)"><span class="doc-title">${text(displayTitle)}</span><span class="doc-request-state">Download PDF</span></a>`;
  };

  return categories.map((category) => {
    const documents = available.filter((document) => {
      if (assigned.has(document.document_id) || !category.matches(document)) return false;
      assigned.add(document.document_id);
      return true;
    });
    if (!documents.length) return "";
    const groups = new Map();
    for (const document of documents) {
      const groupKey = category.key === "labels"
        ? document.collection || "earlier-public"
        : document.skus[0];
      const groupLabel = category.key === "labels"
        ? labelCollections.get(groupKey)
        : DOCUMENT_SKU_LABELS.get(groupKey);
      if (!groupLabel) throw new Error(`Unknown document group: ${groupKey}`);
      if (!groups.has(groupKey)) groups.set(groupKey, { label: groupLabel, documents: [] });
      groups.get(groupKey).documents.push(document);
    }
    const groupHtml = [...groups.entries()].map(([groupKey, group]) => {
      const links = group.documents
        .sort((left, right) => left.title.localeCompare(right.title))
        .map((document) => renderDocument(document, category.key))
        .join("\n");
      const sku = category.key === "labels" ? "" : groupKey;
      const lifecycle = category.key === "labels"
        ? groupKey === "earlier-public"
          ? "earlier public"
          : "current"
        : "current";
      const count = `${group.documents.length} ${group.documents.length === 1 ? "file" : "files"}`;
      return `          <div class="doc-lib-item" data-document-group="${attr(groupKey)}" data-document-lifecycle="${attr(lifecycle.replaceAll(" ", "-"))}"${sku ? ` data-document-sku="${attr(sku)}"` : ""}>
            <div class="doc-lib-head"><b>${text(group.label)}</b><span>${sku ? `${attr(sku)} · ` : ""}${count}</span></div>
            <div class="doc-lib-links">
${links}
            </div>
          </div>`;
    }).join("\n");
    return `        <section class="doc-lib-category" data-document-category="${attr(category.key)}" aria-labelledby="doc-category-${attr(category.key)}">
          <div class="doc-lib-category-head">
            <h3 id="doc-category-${attr(category.key)}">${text(category.label)}</h3>
            <p>${text(category.description)}</p>
          </div>
          <div class="doc-lib-category-grid">
${groupHtml}
          </div>
        </section>`;
  }).filter(Boolean).join("\n");
}

function injectDocumentLibrary(html) {
  const start = "<!-- doclib:auto -->";
  const end = "<!-- /doclib:auto -->";
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error("resources.html: doclib markers missing");
  return `${html.slice(0, from)}${start}\n${documentLibrary()}\n      ${html.slice(to)}`;
}

function injectProofRecords(html) {
  const start = "<!-- proof-records:auto -->";
  const end = "<!-- /proof-records:auto -->";
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error("proof record markers missing");
  return `${html.slice(0, from)}${start}\n${proofRecordsHtml(PROOF_RECORDS)}\n    ${html.slice(to)}`;
}

function serviceCategoryDirectory() {
  const links = SERVICE_CATEGORIES.map((category) => `
          <a class="service-guide-directory-card" href="services/${attr(category.slug)}">
            <i class="ph ${attr(category.icon)}" aria-hidden="true"></i>
            <span><b>${text(category.title)}</b><small>${text(category.note)}</small></span>
            <i class="ph ph-arrow-right" aria-hidden="true"></i>
          </a>`).join("");

  return `<section class="service-guide-directory section-slim" aria-labelledby="serviceGuideDirectoryTitle">
      <div class="container">
        <div class="service-guide-directory-head">
          <span class="eyebrow">Service guides</span>
          <h2 id="serviceGuideDirectoryTitle" class="headline">Compare service categories before you request a quote.</h2>
          <p>See what to send, what each category covers, what you receive, and how work starts.</p>
        </div>
        <nav class="service-guide-directory-grid" aria-label="Service category guides">${links}
        </nav>
      </div>
    </section>`;
}

function injectServiceCategoryDirectory(html) {
  const start = "<!-- service-category-directory:auto -->";
  const end = "<!-- /service-category-directory:auto -->";
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from === -1 || to === -1) throw new Error("services.html: service category directory markers missing");
  return `${html.slice(0, from)}${start}\n    ${serviceCategoryDirectory()}\n    ${html.slice(to)}`;
}

const pick = (html, re) => html.match(re)?.[1]?.trim() || "";

function loadContentPageMeta() {
  const file = `data/content/${PAGE_META_DELIVERY.file}`;
  if (!existsSync(file)) return new Map();
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(parsed[PAGE_META_DELIVERY.key])
    ? parsed[PAGE_META_DELIVERY.key]
    : [];
  const out = new Map();
  for (const row of rows) {
    for (const key of [row.page, row.slug]) {
      const normalized = normalizeContentPageKey(key);
      if (normalized) out.set(normalized, row);
    }
  }
  return out;
}

// tools/build-reviews.mjs writes this tracked snapshot from approved reviews,
// keyed "<kind>:<sku>" -> { avg, count }. Best-effort: an absent/malformed file
// (e.g. reviews not provisioned yet) means "no ratings to bake" — never a hard
// build failure.
function loadReviewsSnapshot() {
  const file = "data/reviews.json";
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Static AggregateRating for one kind:sku, or null when there are no approved
// reviews yet (matches the "no reviews yet" client state — inject nothing).
function aggregateRatingNode(kind, sku, reviewsSnapshot) {
  const entry = reviewsSnapshot?.[`${kind}:${sku}`];
  if (!entry || !entry.count) return null;
  return {
    "@type": "AggregateRating",
    ratingValue: entry.avg,
    reviewCount: entry.count,
    bestRating: 5,
    worstRating: 1,
  };
}

// Static counterpart to services.html's single page hosting dozens of SKUs:
// one Service node per reviewed SKU, appended to the page's @graph so crawlers
// see per-service ratings before js/main/service-catalog.js hydrates cards.
function serviceReviewNodes(reviewsSnapshot) {
  const file = "data/services.json";
  if (!existsSync(file)) return [];
  let services;
  try {
    services = JSON.parse(readFileSync(file, "utf8"))?.services;
  } catch {
    return [];
  }
  if (!Array.isArray(services)) return [];
  const nodes = [];
  for (const svc of services) {
    const sku = String(svc?.sku || "").trim();
    if (!sku) continue;
    const aggregateRating = aggregateRatingNode("service", sku, reviewsSnapshot);
    if (!aggregateRating) continue;
    nodes.push({
      "@type": "Service",
      name: svc.name,
      sku,
      ...(svc.category ? { serviceType: svc.category } : {}),
      provider: { "@type": "Organization", name: ORG.name, url: ORG.url },
      aggregateRating,
    });
  }
  return nodes;
}

function cleanPath(path) {
  if (path === "index.html") return "";
  if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
  return path.replace(/\.html$/i, "");
}

function pageMetaOverrides(entry = {}) {
  const seo = entry.seo && typeof entry.seo === "object" ? entry.seo : {};
  return {
    title: seo.title || entry.meta_title || entry.title || "",
    description: seo.description || entry.meta_description || entry.description || "",
    og_image: seo.og_image || entry.og_image || "",
    jsonld: seo.jsonld || entry.jsonld || null,
  };
}

function applyContentPageMeta(file, meta, contentPageMeta) {
  const override = contentPageMeta.get(normalizeContentPageKey(file));
  if (!override) return meta;
  return { ...meta, content: pageMetaOverrides(override) };
}

function cleanRelativePath(prefix, path) {
  if (path === "index.html") return prefix || "/";
  return `${prefix}${cleanPath(path)}`;
}

function cleanPublicUrl(raw) {
  if (!raw || /^(?:mailto:|tel:|data:|blob:|javascript:|#)/i.test(raw)) return raw;
  if (/^index(?:[?#]|$)/i.test(raw)) return raw.replace(/^index/i, "/");
  if (/^\.\.\/index(?:[?#]|$)/i.test(raw)) return raw.replace(/^\.\.\/index/i, "../");
  return raw
    .replace(/https:\/\/masest\.co\/product\.html\?id=([a-z0-9-]+)/gi, `${BASE}/products/$1`)
    .replace(/(^|[="'(\s])((?:\.\.\/)?|\/?)product\.html\?id=([a-z0-9-]+)/gi, "$1$2products/$3")
    .replace(/https:\/\/masest\.co\/([a-z0-9_/-]+)\.html(?=([?#"'<)\s]|$))/gi, (_match, p) => `${BASE}/${cleanPath(p)}`)
    .replace(/(^|[="'(\s])((?:\.\.\/)?|\/?)([a-z0-9_/-]+)\.html(?=([?#"'<)\s]|$))/gi,
      (_match, lead, prefix, p) => `${lead}${cleanRelativePath(prefix, p)}`);
}

function normalizePublicUrls(html) {
  return html
    .replace(/\b(?:href|action)=["']([^"']+)["']/gi, (match, raw) => match.replace(raw, cleanPublicUrl(raw)))
    .replace(/https:\/\/masest\.co\/product\.html\?id=([a-z0-9-]+)/gi, `${BASE}/products/$1`)
    .replace(/https:\/\/masest\.co\/([a-z0-9_/-]+)\.html(?=([?#"'<)\s]|$))/gi, (_match, p) => `${BASE}/${cleanPath(p)}`);
}

function stripOld(html) {
  const re = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, "g");
  return html
    .replace(re, "\n")
    .replace(/\n?\s*<link\s+[^>]*rel=["']canonical["'][^>]*>\s*/gi, "\n")
    .replace(/\n?\s*<meta\s+[^>]*property=["']og:url["'][^>]*>\s*/gi, "\n")
    .replace(/\n?\s*<meta\s+[^>]*property=["']og:image["'][^>]*>\s*/gi, "\n")
    .replace(/\n?\s*<meta\s+[^>]*name=["']twitter:card["'][^>]*>\s*/gi, "\n");
}

function jsonLd(data) {
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

function absoluteAssetUrl(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${BASE}/${value.replace(/^\/+/, "")}`;
}

function replaceTitle(html, title) {
  if (!title) return html;
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${text(title)}</title>`);
  }
  return html.replace(/<head>/i, `<head>\n<title>${text(title)}</title>`);
}

function replaceMetaDescription(html, description) {
  if (!description) return html;
  const tag = `<meta name="description" content="${attr(description)}">`;
  if (/<meta\s+name=["']description["'][^>]*>/i.test(html)) {
    return html.replace(/<meta\s+name=["']description["'][^>]*>/i, tag);
  }
  return html.replace(/<\/title>/i, `</title>\n${tag}`);
}

function applyContentHtmlMeta(html, content = {}) {
  return replaceMetaDescription(replaceTitle(html, content.title), content.description);
}

function buildBlock(html, meta) {
  const content = meta.content || {};
  const title = content.title || pick(html, /<title>([^<]*)<\/title>/i) || "MASEST VertKleen";
  const desc = content.description || pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i) || "";
  const ogImage = absoluteAssetUrl(content.og_image) || OG_IMAGE;
  const baseJsonld = content.jsonld || meta.jsonld;
  // reviewJsonld is appended regardless of a CMS jsonld override, so a static
  // rating never silently drops if page-meta.json later supplies its own jsonld.
  const jsonld = meta.reviewJsonld?.length
    ? [...(baseJsonld || []), ...meta.reviewJsonld]
    : baseJsonld;
  const url = `${BASE}${meta.loc}`;
  const hasOgTitle = /property="og:title"/.test(html);
  const hasOgDesc = /property="og:description"/.test(html);
  const lines = [START];
  lines.push(`<link rel="canonical" href="${url}">`);
  if (!hasOgTitle) lines.push(`<meta property="og:title" content="${attr(title)}">`);
  if (!hasOgDesc && desc) lines.push(`<meta property="og:description" content="${attr(desc)}">`);
  lines.push(`<meta property="og:url" content="${url}">`);
  lines.push(`<meta property="og:image" content="${attr(ogImage)}">`);
  lines.push('<meta name="twitter:card" content="summary_large_image">');
  if (jsonld?.length) {
    const data = jsonld.length === 1
      ? { "@context": "https://schema.org", ...jsonld[0] }
      : { "@context": "https://schema.org", "@graph": jsonld };
    lines.push(jsonLd(data));
  }
  lines.push(END);
  return lines.join("\n");
}

async function processPage(file, meta, isPrivate = false) {
  let html = await readFile(file, "utf8");
  const before = html;
  html = html.replace(/css\/style\.css\?v=[^"']+/g, `css/style.css?v=${STYLE_VERSION}`);
  html = html.replace(/(js\/main\.js)\?v=[^"']+/g, `$1?v=${MAIN_VERSION}`);
  html = html.replace(
    /css\/components\.css(?:\?v=[^"']+)?/g,
    `css/components.css?v=${COMPONENT_VERSION}`,
  );
  html = stripOld(html);
  if (file === "resources.html") html = injectDocumentLibrary(html);
  if (file === "proof.html") html = injectProofRecords(html);
  if (file === "services.html") html = injectServiceCategoryDirectory(html);
  if (isPrivate) {
    if (!/name="robots"/.test(html)) {
      html = html.replace(/(<meta name="viewport"[^>]*>)/i, '$1\n<meta name="robots" content="noindex">');
    }
  } else {
    html = normalizePublicUrls(html);
    html = ensureContentPageMount(html, meta.loc);
    html = applyContentHtmlMeta(html, meta.content);
    html = html.replace(/<\/head>/i, `${buildBlock(html, meta)}\n</head>`);
  }
  if (html !== before) {
    await writeFile(file, html);
    return 1;
  }
  return 0;
}

async function processReleaseOnlyPage(file) {
  const before = await readFile(file, "utf8");
  const html = before
    .replace(/css\/style\.css\?v=[^"']+/g, `css/style.css?v=${STYLE_VERSION}`)
    .replace(/(js\/main\.js)\?v=[^"']+/g, `$1?v=${MAIN_VERSION}`)
    .replace(
      /css\/components\.css(?:\?v=[^"']+)?/g,
      `css/components.css?v=${COMPONENT_VERSION}`,
    );
  if (html === before) return 0;
  await writeFile(file, html);
  return 1;
}

// Retain DBNPA as a legacy quote-only ID for old records. It is discontinued,
// excluded from CATALOG_ORDER, and has no public product route.
const QUOTE_ONLY_IDS = new Set([...QUOTE_FIRST_IDS, "dbnpa"]);

function terminate(part) {
  const trimmed = String(part).trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function productRouteCopy(id) {
  return QUOTE_ONLY_IDS.has(id)
    ? "Ask us for current pricing."
    : "Shop available sizes online. Need a drum or tote? Ask for a quote.";
}

function productDescription(id, product) {
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const replaces = /^Replaces\b/i.test(product.replaces || "") ? product.replaces : "";
  const parts = [
    copy.summary,
    copy.operator_advantage,
    replaces,
    productRouteCopy(id),
  ].filter(Boolean).map(terminate);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function productMetaDescription(id, product) {
  const sentence = productDescription(id, product);
  if (sentence.length <= 155) return sentence;
  return `${sentence.slice(0, 152).replace(/\s+\S*$/, "")}…`;
}

function productComparisonPanel(id) {
  const comparisons = PRODUCT_COMPARISONS.get(id) || [];
  if (!comparisons.length) return "";
  const links = comparisons.map((comparison) => `
          <a class="product-comparison-link" href="../comparisons/${attr(comparison.slug)}" data-product-comparison="${attr(comparison.slug)}">
            <span><b>${text(comparison.title)}</b><small>${text(comparison.summary)}</small></span>
            <i class="ph ph-arrow-right" aria-hidden="true"></i>
          </a>`).join("");

  return `<article class="product-static-panel product-comparison-panel" aria-labelledby="product-comparisons-${attr(id)}">
        <div>
          <span class="eyebrow">Cleaner comparison</span>
          <h2 id="product-comparisons-${attr(id)}">Compare before you switch.</h2>
          <p>See product use, labor, rinse water, downtime, and finished-result tradeoffs for the cleaner you use now.</p>
        </div>
        <nav class="product-comparison-links" aria-label="Product comparisons">${links}
        </nav>
      </article>`;
}

function productSchema(id, product, reviewsSnapshot) {
  const aggregateRating = aggregateRatingNode("product", commerceSku(id), reviewsSnapshot);
  const sku = CATALOG_PRODUCTS_BY_SLUG.get(commerceSku(id))?.sku_stem;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORG,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
          { "@type": "ListItem", position: 2, name: "Products", item: `${BASE}/products` },
          { "@type": "ListItem", position: 3, name: product.name, item: `${BASE}/products/${id}` },
        ],
      },
      {
        "@type": "Product",
        name: product.name,
        ...(sku ? { sku } : {}),
        brand: { "@type": "Brand", name: "VertKleen" },
        category: "Industrial cleaning products",
        description: productDescription(id, product),
        url: `${BASE}/products/${id}`,
        image: product.image ? `${BASE}/${product.image}` : `${BASE}/${PRODUCT_FALLBACK_IMAGE}`,
        additionalProperty: [
          { "@type": "PropertyValue", name: "HMIS rating", value: product.hmis },
          {
            "@type": "PropertyValue",
            name: "Alternative to",
            value: String(product.replaces || "").replace(/^(?:Replaces|Compared with|Evaluated against|Evaluated for)\s+/i, ""),
          },
          {
            "@type": "PropertyValue",
            name: "How to buy",
            value: QUOTE_ONLY_IDS.has(id) ? "Quoted before purchase" : "Small packs in stock; bulk quoted",
          },
          { "@type": "PropertyValue", name: "Shipping", value: "Non-hazmat" },
          {
            "@type": "PropertyValue",
            name: "Routine work-area controls",
            value: "No special ventilation or area clearance required",
          },
        ].filter((item) => item.value),
        // No approved reviews yet -> omit entirely (matches the "no reviews yet"
        // client state instead of asserting a fabricated rating).
        ...(aggregateRating ? { aggregateRating } : {}),
      },
    ],
  };
}

function productPage(id, product, reviewsSnapshot) {
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const marineProduct = MARINE_PRODUCT_NAMES_BY_BASE.get(id);
  if (marineProduct && !/^img\/products\/vertkleen-.+-marine-studio\.webp$/.test(marineProduct.image || "")) {
    throw new Error(`Missing final marine product image for ${id}`);
  }
  const marineAlias = marineProduct
    ? `\n        <a class="product-market-alias" href="../industries/marine#products-for-this-industry" data-product-market="marine" data-product-market-name="${attr(marineProduct.name)}" data-product-market-product="${attr(id)}" data-product-market-image="/${attr(marineProduct.image)}" data-product-market-image-alt="${attr(marineProduct.name)} marine product jug" aria-label="See ${attr(marineProduct.name)} in the VertKleen marine line">
          <span>Marine line</span><b>${text(marineProduct.name)}</b><small>${text(marineProduct.job_focus)}</small>
        </a>`
    : "";
  // Full catalog copy is published in the hero on purpose (see
  // product-layout.test: static heroes are the SEO surface for desc text).
  const heroDesc = productDescription(id, product);
  const metaDesc = productMetaDescription(id, product);
  const img = product.image ? `../${product.image}` : `../${PRODUCT_FALLBACK_IMAGE}`;
  // The brand poster is a placeholder, not a product photo. Use the shared tile.
  const hasPhoto = product.image && !/masest-poster-transparent/.test(product.image);
  const heroSize = hasPhoto ? SITE_IMAGE_DIMENSIONS.get(`/${product.image.replace(/^\/+/, "")}`) : null;
  if (hasPhoto && !heroSize) throw new Error(`Missing CMS image metadata for /${product.image.replace(/^\/+/, "")}`);
  const heroMedia = hasPhoto
    ? `<figure class="product-hero-media reveal" data-commerce-media="${id}">
        <img src="${attr(img)}" alt="${attr(product.name)} product photo" width="${heroSize.width}" height="${heroSize.height}" fetchpriority="high" decoding="async">
      </figure>`
    : `<figure class="product-hero-media media-fallback reveal" data-commerce-media="${id}">
        <span class="media-fallback-label">${text(product.name)}</span>
      </figure>`;
  const applicationPath = product.application_image
    ? `/${product.application_image.replace(/^\/+/, "")}`
    : "";
  const applicationImage = applicationPath ? SITE_IMAGE_DIMENSIONS.get(applicationPath) : null;
  if (applicationPath && !applicationImage) {
    throw new Error(`Missing CMS image metadata for ${applicationPath}`);
  }
  const applicationMedia = applicationImage
    ? `<figure class="product-application-media">
        <img src="../${attr(product.application_image)}" alt="${attr(applicationImage.alt)}" width="${applicationImage.width}" height="${applicationImage.height}" loading="lazy" decoding="async">
        <figcaption><b>Built for real work</b><span>A look at the kind of cleaning job this product is made to handle.</span></figcaption>
      </figure>`
    : "";
  const uses = (product.uses || copy.fits || []).map((item) => `<li>${text(item)}</li>`).join("\n");
  const specs = productHighlights(id)
    .map((spec) => `<li><b>${text(spec[1] || spec[0])}</b><span>${text(spec[2] || "")}</span></li>`)
    .join("\n");
  const proofRecords = productProofRecords(id);
  const proofLinks = proofRecords
    .map((record) => (
      `<li class="doc-file"><a href="../proof#${attr(record.slug)}"><span class="doc-file-copy">${text(record.title)}</span><span class="doc-pill">Result</span></a></li>`
    ))
    .join("\n");
  // The hero asks for the purchase decision while the evidence for its strongest claim sits
  // a full screen below. This jumps to that block rather than off-site, so proof is reachable
  // from the claim without spending the buyer's place on the page. Rendered as a trailing
  // child of .product-hero-facts (SQ-11: one chip row instead of three matching chips plus
  // a plain link on its own line) — indentation matches its <span> siblings.
  const heroProof = proofRecords.length
    ? `
          <a class="product-hero-proof" href="#records"><i class="ph ph-seal-check" aria-hidden="true"></i>See ${proofRecords.length} real job result${proofRecords.length === 1 ? "" : "s"}</a>`
    : "";
  const docs = (product.docs || [])
    .flatMap((doc) => {
      if (doc && typeof doc === "object" && doc.file) {
        const document = currentDocument(doc.file, "product");
        if (!document || documentSurfaceMode(document, "product") !== "download") return [];
        const common = `data-document-id="${attr(document.document_id)}" data-document-revision="${attr(documentRevision(document, DOCUMENT_REVIEW.document_control))}" data-document-effective="${attr(documentEffectiveDate(document, DOCUMENT_REVIEW.document_control))}" data-document-skus="${attr(document.skus.join(" "))}" data-document-name="${attr(documentAnalyticsName(document))}"`;
        return [`<li class="doc-file"><a href="../${attr(doc.file)}" ${common} data-document-download target="_blank" rel="noopener" download><span class="doc-file-copy">${text(doc.label)}</span><span class="doc-pill">Download</span></a></li>`];
      }
      return [];
    })
    .join("\n");
  const backingSections = [
    proofLinks && `<h3 id="records">Results</h3><ul class="product-fit-list">${proofLinks}</ul>`,
    docs && `<h3>Labels & guides</h3><ul class="product-fit-list">${docs}</ul>`,
  ].filter(Boolean).join("\n        ");
  const procurement = QUOTE_ONLY_IDS.has(id)
    ? "Quoted before purchase."
    : "Buy small packs online or ask us to price drums, totes, and recurring supply.";
  const replacement = String(product.replaces || "Industrial cleaner")
    .replace(/^(?:Replaces|Compared with|Evaluated against|Evaluated for)\s+/i, "");
  const supply = QUOTE_ONLY_IDS.has(id) ? "Quoted to fit" : "Small packs in stock";
  const eyebrow = id === "dbnpa" ? "Program component" : "VertKleen product";
  const quoteButtonClass = QUOTE_ONLY_IDS.has(id) ? "btn-primary" : "btn-secondary";
  const comparisonPanel = productComparisonPanel(id);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${text(product.name)} | MASEST VertKleen</title>
<meta name="description" content="${attr(metaDesc)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="${attr(product.name)} | MASEST VertKleen">
<meta property="og:description" content="${attr(metaDesc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="../css/components.css?v=${COMPONENT_VERSION}">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/products/${id}">
<meta property="og:url" content="${BASE}/products/${id}">
<meta property="og:image" content="${product.image ? `${BASE}/${product.image}` : OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd(productSchema(id, product, reviewsSnapshot))}
<!-- /seo:auto -->
</head>
<body class="site-soft-bg product-detail-page">
<!-- Reserves the nav's 59px height. chrome.js injects the nav, so without this the
     page paints once without it and again 59px lower: 0.041 CLS, attributed to
     MAIN#main, on every page that lacked it. Height lives in css/style.css. -->
<div id="nav-reserve" aria-hidden="true"></div>
<noscript><style>#nav-reserve{display:none}</style></noscript>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <span>Applications</span>
  <a href="../industries">Industries</a>
  <a href="../proof">Results</a>
  <a href="../resources">SDS &amp; Resources</a>
</nav>
</noscript>
<main id="main">
  <section class="hero product-detail-hero">
    <div class="wrap hero-grid">
      <div class="hero-copy reveal">
        <span class="eyebrow">${text(eyebrow)}</span>
        <h1 class="display">${text(product.name)}</h1>
        <div class="product-hero-facts" aria-label="Product highlights">
          <span><b>HMIS</b>${text(product.hmis || "0-0-0")}</span>
          <span><b>Replaces</b>${text(replacement)}</span>
          <span><b>Available</b>${text(supply)}</span>${heroProof}
        </div>${marineAlias}${QUOTE_ONLY_IDS.has(id) ? `
        <p class="product-hero-policy">Quoted orders ship by freight, and approved businesses can pay on NET terms. <a href="../shipping-returns#payment">Payment terms</a></p>` : `
        <!-- Hydrated by js/main.js (refreshCommerceActions): live price + volume select
             incl. bulk drum/tote sizes, Add-to-cart or quote-swap. Static fallback stays
             the "Get a quote" CTA below (data-quote-fallback="off" keeps this empty
             when the catalog API is unavailable). -->
        <div class="product-hero-buy">
          <span class="shop-card-price" data-commerce-price="${id}" hidden></span>
          <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button" data-quote-fallback="off"></span>
        </div>
        <p class="product-hero-policy">Orders by 2 pm ET ship the next business day. Unopened returns within 30 days. <a href="../shipping-returns">Shipping and returns</a></p>`}
        <p class="subhead">${text(heroDesc)}</p>
        <div class="hero-actions">
          <a class="btn ${quoteButtonClass}" href="../contact?type=quote&product=${encodeURIComponent(product.name)}#quoteForm">${text(copy.quote_cta || "Get a quote")}</a>
          <a class="btn btn-ghost" href="../contact?type=sample&product=${encodeURIComponent(product.name)}#quoteForm">${text(copy.sample_cta || "Try a free sample")}</a>
        </div>
        <a class="product-back-link" href="../products">Browse all cleaners</a>
      </div>
      ${heroMedia}
    </div>
  </section>
  <section class="section product-static-section">
    <div class="wrap product-static-grid">${applicationMedia ? `
      ${applicationMedia}` : ""}
      <article class="product-static-panel">
        <h2>Made for jobs like these.</h2>
        <p>${text(procurement)}</p>
        <ul class="product-fit-list">${uses}</ul>
      </article>
      <article class="product-static-panel">
        <h2>Why crews choose it.</h2>
        <ul class="spec-list">${specs}</ul>${backingSections ? `
        ${backingSections}` : ""}
      </article>${comparisonPanel ? `
      ${comparisonPanel}` : ""}
    </div>
  </section>
  <section class="section-slim product-handling-section" aria-labelledby="product-handling-${id}">
    <div class="wrap">
      <article class="product-static-panel product-handling-panel">
        <div>
          <span class="eyebrow">Before you clean</span>
          <h2 id="product-handling-${id}">Use ${text(product.name)} with confidence.</h2>
          <p>Read the latest label and SDS, try a small area first, and follow the safety rules for your workplace.</p>
          <p>Record the buildup, surface, dilution, temperature, contact time, agitation, and rinse result so repeat jobs can begin from the same tested settings.</p>
        </div>
        <ul class="product-handling-list">
          <li><b>Read the directions</b><span>Use the label made for this product and package.</span></li>
          <li><b>Check the surface</b><span>Try a small, hidden area before cleaning the whole job.</span></li>
          <li><b>Follow workplace rules</b><span>Use the PPE, ventilation, and rinse-water steps required at your site.</span></li>
          <li><b>Ask us</b><span>Not sure where to start? MASEST can help with product choice and first-use planning.</span></li>
        </ul>
      </article>
    </div>
  </section>
  <section class="section-slim" data-reviews-section hidden>
    <div class="wrap reveal">
      <div data-reviews data-sku="${attr(commerceSku(id))}" data-kind="product" data-name="${attr(product.name)}"></div>
    </div>
  </section>
  ${contentPageMount(`products/${id}`)}
</main>
<script type="module" src="../js/main.js?v=${MAIN_VERSION}"></script>
<script type="module" src="../js/reviews.js?v=20260913b"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

async function writeProductPages(reviewsSnapshot) {
  let changed = 0;
  await mkdir("products", { recursive: true });
  const publicFiles = new Set(PRODUCT_IDS.map((id) => `${id}.html`));
  for (const id of PRODUCT_IDS) {
    const file = `products/${id}.html`;
    const html = productPage(id, PRODUCTS[id], reviewsSnapshot);
    const before = existsSync(file) ? await readFile(file, "utf8") : "";
    if (before !== html) {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, html);
      changed++;
      console.log("updated", file);
    }
  }
  for (const entry of await readdir("products", { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".html") || publicFiles.has(entry.name)) continue;
    if (!GENERATED_PRODUCT_FILES.has(entry.name)) continue;
    const file = `products/${entry.name}`;
    await unlink(file);
    changed++;
    console.log("removed", file);
  }
  return changed;
}

function serviceDisplayName(value) {
  return String(value || "")
    .replace(/\bStd\b/g, "Standard")
    .replace(/\bBio\b/g, "Biological")
    .replace(/\bSpecie ID\b/g, "Species ID");
}

function serviceCategorySchema(category, items) {
  const url = `${BASE}/services/${category.slug}`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      ORG,
      {
        "@type": "CollectionPage",
        name: category.title,
        description: category.seo_description,
        url,
        isPartOf: { "@type": "WebSite", name: "MASEST VertKleen", url: `${BASE}/` },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
          { "@type": "ListItem", position: 2, name: "Services", item: `${BASE}/services` },
          { "@type": "ListItem", position: 3, name: category.title, item: url },
        ],
      },
      {
        "@type": "Service",
        name: `${category.title} services`,
        description: category.description,
        serviceType: category.key,
        url,
        areaServed: "United States",
        provider: { "@type": "Organization", name: ORG.name, url: ORG.url },
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${category.title} catalog`,
          itemListElement: items.map((item) => ({
            "@type": "Offer",
            itemOffered: {
              "@type": "Service",
              name: serviceDisplayName(item.name),
              description: item.summary,
              sku: item.sku,
              serviceType: category.key,
            },
          })),
        },
      },
    ],
  };
}

function serviceCategoryCard(item) {
  const name = serviceDisplayName(item.name);
  const note = encodeURIComponent(`Service request: ${name} (${item.sku}).`);
  const unit = String(item.unit || "per service").replace(/^per\s+/i, "per ");
  return `<article class="service-guide-card" data-service-sku="${attr(item.sku)}">
          <div>
            <h3>${text(name)}</h3>
            <p>${text(item.summary)}</p>
          </div>
          <div class="service-guide-card-foot">
            <span><small>Billing unit</small><b>${text(unit)}</b></span>
            <a class="btn btn-secondary btn-sm" href="../contact?type=services&amp;message=${note}" aria-label="Request ${attr(name)}">Request this service</a>
          </div>
        </article>`;
}

function serviceCategoryPage(category) {
  const items = serviceCategoryItems(category);
  if (!items.length) throw new Error(`Service category has no items: ${category.key}`);
  const countLabel = category.key === "Service Packages"
    ? `${items.length} service packages`
    : `${items.length} services`;
  const requestNote = encodeURIComponent(`Service category request: ${category.title}.`);
  const imagePath = category.representative_image || "";
  const image = imagePath ? SITE_IMAGE_DIMENSIONS.get(imagePath) : null;
  if (imagePath && !image) throw new Error(`Missing CMS image metadata for ${imagePath}`);
  const heroAside = image
    ? `<figure class="service-guide-hero-media">
        <img src="..${attr(imagePath)}" alt="${attr(image.alt)}" width="${image.width}" height="${image.height}" fetchpriority="high" decoding="async">
      </figure>`
    : `<aside class="service-guide-summary" aria-label="Category summary">
        <i class="ph ${attr(category.icon)}" aria-hidden="true"></i>
        <span>${text(countLabel)}</span>
        <b>${text(category.note)}</b>
        <p>${text(category.timing)}</p>
      </aside>`;
  const otherLinks = SERVICE_CATEGORIES
    .filter((candidate) => candidate.slug !== category.slug)
    .map((candidate) => `<a href="../services/${attr(candidate.slug)}" data-service-category-link>${text(candidate.title)}</a>`)
    .join("\n          ");
  const ogImage = imagePath ? `${BASE}${imagePath}` : OG_IMAGE;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#fafbfc">
<title>${text(category.seo_title)}</title>
<meta name="description" content="${attr(category.seo_description)}">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="${attr(category.seo_title)}">
<meta property="og:description" content="${attr(category.seo_description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<meta property="og:url" content="${BASE}/services/${attr(category.slug)}">
<meta property="og:image" content="${attr(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${BASE}/services/${attr(category.slug)}">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="../css/components.css?v=${COMPONENT_VERSION}">
${jsonLd(serviceCategorySchema(category, items))}
</head>
<body class="site-soft-bg services-page service-category-page">
<!-- Reserves the nav's 59px height. chrome.js injects the nav, so without this the
     page paints once without it and again 59px lower: 0.041 CLS, attributed to
     MAIN#main, on every page that lacked it. Height lives in css/style.css. -->
<div id="nav-reserve" aria-hidden="true"></div>
<noscript><style>#nav-reserve{display:none}</style></noscript>
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <a href="../industries">Industries</a>
  <a href="../proof">Results</a>
  <a href="../resources">SDS &amp; Resources</a>
</nav>
</noscript>
<main id="main">
  <section class="hero service-guide-hero">
    <div class="container service-guide-hero-grid">
      <!-- hero-anim goes on the children, never on this wrapper, and never on the h1.
           heroRise starts at opacity:0, and Chromium records a text node's paint once,
           so an element whose first paint is transparent is dropped from LCP candidacy
           permanently. With the animation on the wrapper the h1 never entered the
           candidate list and LCP fell through to the back link: ~628ms of FCP->LCP gap
           on every generated guide. Keep the wrapper bare. -->
      <div class="service-guide-hero-copy">
        <a class="service-guide-back hero-anim" href="../services">Services <span aria-hidden="true">/</span> ${text(category.title)}</a>
        <span class="eyebrow hero-anim">Technical service guide</span>
        <h1 class="display">${text(category.title)}</h1>
        <p class="subhead hero-anim">${text(category.description)}</p>
        <div class="service-guide-hero-facts hero-anim" aria-label="Category facts">
          <span><b>${items.length}</b>${category.key === "Service Packages" ? "packages" : "services"}</span>
          <span><b>Quote first</b>Scope confirmed before work</span>
        </div>
        <div class="hero-actions hero-anim">
          <a class="btn btn-primary" href="../contact?type=services&amp;message=${requestNote}">Request ${text(category.title.toLocaleLowerCase())}</a>
          <a class="btn btn-secondary" href="../services#service-${attr(category.key.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}">See catalog pricing</a>
        </div>
      </div>
      ${heroAside}
    </div>
  </section>

  <section class="section-slim service-guide-decision" aria-labelledby="serviceGuideDecisionTitle">
    <div class="container">
      <div class="service-guide-section-head">
        <span class="eyebrow">Before work starts</span>
        <h2 id="serviceGuideDecisionTitle" class="headline">Know what moves between your team and MASEST.</h2>
      </div>
      <div class="service-guide-decision-grid">
        <article><span>01</span><h3>What you send</h3><p>${text(category.what_you_send)}</p></article>
        <article><span>02</span><h3>What MASEST does</h3><p>${text(category.description)}</p></article>
        <article><span>03</span><h3>What you receive</h3><p>${text(category.what_you_receive)}</p></article>
        <article><span>04</span><h3>Timing &amp; preparation</h3><p>${text(category.timing)}</p></article>
      </div>
    </div>
  </section>

  <section class="section service-guide-catalog" aria-labelledby="serviceGuideCatalogTitle">
    <div class="container">
      <div class="service-guide-section-head">
        <span class="eyebrow">${text(countLabel)}</span>
        <h2 id="serviceGuideCatalogTitle" class="headline">Choose the result you need.</h2>
        <p>${text(category.note)}</p>
      </div>
      <div class="service-guide-list">
        ${items.map(serviceCategoryCard).join("\n        ")}
      </div>
    </div>
  </section>

  <section class="section-slim service-guide-related" aria-labelledby="relatedServiceGuidesTitle">
    <div class="container">
      <div class="service-guide-related-panel">
        <div>
          <span class="eyebrow">More service guides</span>
          <h2 id="relatedServiceGuidesTitle" class="headline">Explore another category.</h2>
        </div>
        <nav class="service-guide-related-links" aria-label="Other service category guides">
          ${otherLinks}
        </nav>
      </div>
    </div>
  </section>

  <section class="section-slim service-guide-final">
    <div class="container services-final-panel">
      <div><h2 class="headline">Need help choosing the exact service?</h2><p>Send the system, sample, site, and result your team needs.</p></div>
      <a class="btn btn-primary" href="../contact?type=services&amp;message=${requestNote}">Plan this service</a>
    </div>
  </section>
</main>
<script type="module" src="../js/main.js?v=${MAIN_VERSION}"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

async function writeServiceCategoryPages() {
  let changed = 0;
  await mkdir("services", { recursive: true });
  for (const category of SERVICE_CATEGORIES) {
    const file = `services/${category.slug}.html`;
    const html = serviceCategoryPage(category);
    const before = existsSync(file) ? await readFile(file, "utf8") : "";
    if (before !== html) {
      await writeFile(file, html);
      changed++;
      console.log("updated", file);
    }
  }
  return changed;
}

const LASTMOD_CACHE = new Map();

function fileLastModified(file) {
  if (LASTMOD_CACHE.has(file)) return LASTMOD_CACHE.get(file);
  let lastmod = "";
  try {
    const dirty = execFileSync("git", ["status", "--porcelain", "--", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!dirty) {
      const committedAt = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (committedAt) lastmod = new Date(committedAt).toISOString().slice(0, 10);
    }
  } catch {
    // Source archives and local previews may not include Git metadata.
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastmod)) {
    lastmod = statSync(file).mtime.toISOString().slice(0, 10);
  }
  LASTMOD_CACHE.set(file, lastmod);
  return lastmod;
}

async function writeSitemap() {
  const entries = [
    ...Object.entries(PUBLIC).map(([file, entry]) => ({ ...entry, lastmod: fileLastModified(file) })),
    ...PRODUCT_IDS.map((id) => ({
      loc: `/products/${id}`,
      priority: "0.7",
      changefreq: "monthly",
      lastmod: fileLastModified(`products/${id}.html`),
    })),
    ...SERVICE_CATEGORIES.map((category) => ({
      loc: `/services/${category.slug}`,
      priority: "0.7",
      changefreq: "monthly",
      lastmod: fileLastModified(`services/${category.slug}.html`),
    })),
    ...BLOG_POST_SLUGS.map((slug) => ({
      loc: `/blog/${slug}`,
      priority: "0.6",
      changefreq: "monthly",
      lastmod: fileLastModified(`blog/${slug}.html`),
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url><loc>${BASE}${entry.loc}</loc><lastmod>${entry.lastmod}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`).join("\n")}
</urlset>
`;
  const before = existsSync("sitemap.xml") ? await readFile("sitemap.xml", "utf8") : "";
  if (before !== xml) {
    await writeFile("sitemap.xml", xml);
    console.log("updated sitemap.xml");
    return 1;
  }
  return 0;
}

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

function proofSeedSql() {
  const rows = [...PROOF_RECORDS]
    .sort((left, right) => Number(left.sort_order) - Number(right.sort_order))
    .map((record) => {
      const { slug, title, seo = {}, ...payload } = record;
      return `  ('proof_card', ${sqlLiteral(slug)}, ${sqlLiteral(title)}, 'published', 'en', ${sqlLiteral(JSON.stringify(payload))}::jsonb, ${sqlLiteral(JSON.stringify(seo))}::jsonb)`;
    });

  return `-- Seed VertKleen customer-result and product-information cards as published CMS entries.
-- Generated from data/content/proof.json by npm run seo-inject. Idempotent.

insert into public.content_entries (type, slug, title, status, locale, payload, seo)
values
${rows.join(",\n")}
on conflict (type, slug, locale) do update
  set title = excluded.title, status = excluded.status, payload = excluded.payload,
      seo = excluded.seo, published_at = coalesce(public.content_entries.published_at, now()), updated_at = now();

update public.content_entries set published_at = coalesce(published_at, now())
  where type = 'proof_card' and status = 'published';
`;
}

async function writeProofSeed() {
  const file = "supabase/seed-proof-cards.sql";
  const sql = proofSeedSql();
  const before = existsSync(file) ? await readFile(file, "utf8") : "";
  if (before === sql) return 0;
  await writeFile(file, sql);
  console.log("updated", file);
  return 1;
}

let changed = 0;
const contentPageMeta = loadContentPageMeta();
const reviewsSnapshot = loadReviewsSnapshot();
// services.html hosts all SKUs on one page; category pages are static intent
// guides. Bake reviewed services into the hub as extra @graph nodes.
PUBLIC["services.html"].reviewJsonld = serviceReviewNodes(reviewsSnapshot);
for (const [file, meta] of Object.entries(PUBLIC)) {
  changed += await processPage(file, applyContentPageMeta(meta.loc, meta, contentPageMeta), false);
}
for (const file of PRIVATE) changed += await processPage(file, null, true);
for (const file of RELEASE_ONLY) changed += await processReleaseOnlyPage(file);
changed += await writeProductPages(reviewsSnapshot);
changed += await writeServiceCategoryPages();
changed += await writeProofSeed();
changed += await writeSitemap();

console.log(`\nseo-inject: ${changed} files changed`);
