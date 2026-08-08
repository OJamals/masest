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
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  documentSurfaceMode,
} from "./public-document-policy.mjs";
import { STYLE_VERSION } from "./static-release.mjs";

const CATALOG_SEED = JSON.parse(readFileSync(new URL("../data/catalog.seed.json", import.meta.url), "utf8"));
const SPECIALIZED_CONTENT = specializedContentDeliveries();
const BLOG_DELIVERY = SPECIALIZED_CONTENT.find(({ generator }) => generator === "blog_pages");
const PAGE_META_DELIVERY = SPECIALIZED_CONTENT.find(({ generator }) => generator === "page_metadata");
if (!BLOG_DELIVERY || !PAGE_META_DELIVERY) throw new Error("specialized_content_delivery_missing");
const BLOG_SNAPSHOT = JSON.parse(readFileSync(
  new URL(`../data/content/${BLOG_DELIVERY.file}`, import.meta.url),
  "utf8",
));
const INDUSTRY_SLUGS = JSON.parse(
  readFileSync(new URL("../data/industry-applications.json", import.meta.url), "utf8"),
).industries.map((industry) => industry.slug);
const PROOF_RECORDS = JSON.parse(
  readFileSync(new URL("../data/content/proof.json", import.meta.url), "utf8"),
).proof_cards;
const SITE_IMAGE_DIMENSIONS = new Map(
  JSON.parse(readFileSync(new URL("../data/content/site-images.json", import.meta.url), "utf8")).assets
    .map((asset) => [asset.public_url, { width: asset.width, height: asset.height, alt: asset.alt }]),
);
const BLOG_POST_SLUGS = (BLOG_SNAPSHOT[BLOG_DELIVERY.key] || []).map((post) => post.slug).filter(Boolean);
const DOCUMENT_REVIEW = JSON.parse(readFileSync(new URL("../data/public-document-review.json", import.meta.url), "utf8"));
const DOCUMENTS = new Map(DOCUMENT_REVIEW.documents.map((document) => [document.path, document]));
const AUTHORITY_RECORDS = DOCUMENT_REVIEW.documents.flatMap((document) => document.authority_records || []);
const PROOF_RECORDS_BY_SLUG = new Map(PROOF_RECORDS.map((record) => [record.slug, record]));
const DOCUMENT_REVISION = DOCUMENT_REVIEW.document_control.revision;
const DOCUMENT_SKU_LABELS = new Map([
  ["VK-HCR", "VertKleen CIP HCR"],
  ["VK-CR", "VertKleen CIP CR"],
  ["VK-CRHD", "VertKleen CR HD"],
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

// Editorial catalog id -> commerce/reviews sku. Reviews and order items key on
// the commerce sku, not the editorial id. Keep this aligned with commerce-ui.
const COMMERCE_SKU_ALIAS = { crhd: "cr-hd" };
const commerceSku = (id) => COMMERCE_SKU_ALIAS[id] || id;

const CATALOG_PRODUCTS_BY_SLUG = new Map(
  CATALOG_SEED.products.map((product) => [product.slug, product]),
);

const ORG = {
  "@type": "Organization",
  name: "MASEST Consulting LLC",
  url: `${BASE}/`,
  logo: `${BASE}/img/masest-logo.png`,
  brand: "VertKleen",
  description: "VertKleen pairs industrial cleaning performance with HMIS 0-0-0 across every current product MASEST offers.",
  areaServed: "United States and international commercial accounts",
  contactPoint: { "@type": "ContactPoint", contactType: "sales", url: `${BASE}/contact` },
};

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
  "account.html",
  "admin.html",
  "business.html",
  "cart.html",
  "dashboard.html",
  "order-confirmed.html",
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
  return `${document.document_id} · Rev ${DOCUMENT_REVISION} · SKUs: ${document.skus.join(", ")}`;
}

function documentAnalyticsName(document) {
  return document.title
    .replace("Safety Data Sheet", "SDS")
    .replace("Technical Data Sheet", "TDS");
}

function documentLibrary() {
  const groups = new Map([...DOCUMENT_SKU_LABELS].map(([sku, label]) => [sku, { label, documents: [] }]));
  for (const document of DOCUMENT_REVIEW.documents.filter(
    (entry) => documentAllowedOnSurface(entry, "resource"),
  )) {
    const group = groups.get(document.skus[0]);
    if (!group) throw new Error(`Unknown primary document SKU: ${document.skus[0]}`);
    group.documents.push(document);
  }

  return [...groups.entries()].map(([sku, group]) => {
    const documents = group.documents
      .sort((left, right) => left.title.localeCompare(right.title))
      .map((document) => {
        const common = `data-document-id="${attr(document.document_id)}" data-document-revision="${attr(DOCUMENT_REVISION)}" data-document-skus="${attr(document.skus.join(" "))}" data-document-name="${attr(documentAnalyticsName(document))}"`;
        if (documentSurfaceMode(document, "resource") === "request") {
          return `          <button class="doc-chip doc-request-button" type="button" data-document-request ${common} aria-label="Register to request ${attr(document.title)}"><span class="doc-title">${text(document.title)}</span><span class="doc-control">${text(documentControl(document))}</span><span class="doc-request-state" data-document-request-label>Register to request</span></button>`;
        }
        return `          <a class="doc-chip" href="${attr(document.path)}" ${common} data-document-download target="_blank" rel="noopener" download aria-label="Download ${attr(document.title)} (PDF)"><span class="doc-title">${text(document.title)}</span><span class="doc-control">${text(documentControl(document))}</span></a>`;
      })
      .join("\n");
    return `        <div class="doc-lib-item" data-document-sku="${attr(sku)}">
          <div class="doc-lib-head"><b>${text(group.label)}</b><span>${attr(sku)} · ${group.documents.length} current ${group.documents.length === 1 ? "file" : "files"}</span></div>
          <div class="doc-lib-links">
${documents}
          </div>
        </div>`;
  }).join("\n");
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
      provider: { "@type": "Organization", name: "MASEST Consulting LLC", url: `${BASE}/` },
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
  html = stripOld(html);
  if (file === "resources.html") html = injectDocumentLibrary(html);
  if (file === "proof.html") html = injectProofRecords(html);
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

// Retain DBNPA as a legacy quote-only ID for old records. It is discontinued,
// excluded from CATALOG_ORDER, and has no public product route.
const QUOTE_ONLY_IDS = new Set([...QUOTE_FIRST_IDS, "dbnpa"]);

function terminate(part) {
  const trimmed = String(part).trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function productRouteCopy(id) {
  return QUOTE_ONLY_IDS.has(id)
    ? "Quoted before purchase."
    : "Small packs are available online; drums and totes are quoted to fit the job.";
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
        category: "Industrial cleaning chemistry",
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
            name: "Procurement",
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
      `<li class="doc-file"><a href="../proof#${attr(record.slug)}"><span class="doc-file-copy">${text(record.title)}<span class="doc-control">${text(record.record_label)}</span></span><span class="doc-pill">Proof</span></a></li>`
    ))
    .join("\n");
  // The hero asks for the purchase decision while the evidence for its strongest claim sits
  // a full screen below. This jumps to that block rather than off-site, so proof is reachable
  // from the claim without spending the buyer's place on the page.
  const heroProof = proofRecords.length
    ? `
        <a class="product-hero-proof" href="#records"><i class="ph ph-seal-check" aria-hidden="true"></i>See ${proofRecords.length} field result${proofRecords.length === 1 ? "" : "s"}</a>`
    : "";
  const docs = (product.docs || [])
    .flatMap((doc) => {
      if (doc && typeof doc === "object" && doc.file) {
        const document = currentDocument(doc.file, "product");
        if (!document) return [];
        const common = `data-document-id="${attr(document.document_id)}" data-document-revision="${attr(DOCUMENT_REVISION)}" data-document-skus="${attr(document.skus.join(" "))}" data-document-name="${attr(documentAnalyticsName(document))}"`;
        if (documentSurfaceMode(document, "product") === "request") {
          return [`<li class="doc-file doc-request"><button type="button" data-document-request ${common} aria-label="Register to request ${attr(document.title)}"><span class="doc-file-copy">${text(doc.label)}<span class="doc-control">${text(documentControl(document))}</span></span><span class="doc-pill doc-pill-req" data-document-request-label>Register to request</span></button></li>`];
        }
        return [`<li class="doc-file"><a href="../${attr(doc.file)}" ${common} data-document-download target="_blank" rel="noopener" download><span class="doc-file-copy">${text(doc.label)}<span class="doc-control">${text(documentControl(document))}</span></span><span class="doc-pill">PDF</span></a></li>`];
      }
      const label = doc && typeof doc === "object" ? doc.label : doc;
      const href = `../contact?type=technical&product=${encodeURIComponent(product.name)}&doc=${encodeURIComponent(label)}`;
      return [`<li class="doc-file doc-request"><a href="${attr(href)}">${text(label)}<span class="doc-pill doc-pill-req">Request</span></a></li>`];
    })
    .join("\n");
  const backingSections = [
    proofLinks && `<h3 id="records">Records and results</h3><ul class="product-fit-list">${proofLinks}</ul>`,
    docs && `<h3>Documents</h3><ul class="product-fit-list">${docs}</ul>`,
  ].filter(Boolean).join("\n        ");
  const procurement = QUOTE_ONLY_IDS.has(id)
    ? "Quoted before purchase."
    : "Buy small packs online or ask us to price drums, totes, and recurring supply.";
  const replacement = String(product.replaces || "Industrial chemistry")
    .replace(/^(?:Replaces|Compared with|Evaluated against|Evaluated for)\s+/i, "");
  const supply = QUOTE_ONLY_IDS.has(id) ? "Quoted to fit" : "Small packs in stock";
  const eyebrow = id === "dbnpa" ? "Program component" : "VertKleen product";
  const quoteButtonClass = QUOTE_ONLY_IDS.has(id) ? "btn-primary" : "btn-secondary";

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
<link rel="stylesheet" href="../css/navigation.css?v=20260713a">
<link rel="stylesheet" href="../css/components.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/products/${id}">
<meta property="og:url" content="${BASE}/products/${id}">
<meta property="og:image" content="${product.image ? `${BASE}/${product.image}` : OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd(productSchema(id, product, reviewsSnapshot))}
<!-- /seo:auto -->
</head>
<body class="site-soft-bg product-detail-page">
<a class="skip-link" href="#main">Skip to content</a>
<noscript>
<nav class="nojs-nav" aria-label="Site">
  <a href="../"><b>MASEST</b></a>
  <a href="../products">Products</a>
  <a href="../services">Services</a>
  <span>Use Cases</span>
  <a href="../industries">Industries</a>
  <a href="../proof">Proof</a>
  <a href="../resources">Resources</a>
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
          <span><b>Alternative to</b>${text(replacement)}</span>
          <span><b>Supply</b>${text(supply)}</span>
        </div>${heroProof}${QUOTE_ONLY_IDS.has(id) ? "" : `
        <!-- Hydrated by js/main.js (refreshCommerceActions): live price + volume select
             incl. bulk drum/tote sizes, Add-to-cart or quote-swap. Static fallback stays
             the "Request a quote" CTA below (data-quote-fallback="off" keeps this empty
             when the catalog API is unavailable). -->
        <div class="product-hero-buy">
          <span class="shop-card-price" data-commerce-price="${id}" hidden></span>
          <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button" data-quote-fallback="off"></span>
        </div>`}
        <p class="subhead">${text(heroDesc)}</p>
        <div class="hero-actions">
          <a class="btn ${quoteButtonClass}" href="../contact?type=quote&product=${encodeURIComponent(product.name)}#quoteForm">${text(copy.quote_cta || "Request a quote")}</a>
          <a class="btn btn-ghost" href="../contact?type=sample&product=${encodeURIComponent(product.name)}#quoteForm">${text(copy.sample_cta || "Request free sample")}</a>
        </div>
        <a class="product-back-link" href="../products">All products</a>
      </div>
      ${heroMedia}
    </div>
  </section>
  <section class="section product-static-section">
    <div class="wrap product-static-grid">${applicationMedia ? `
      ${applicationMedia}` : ""}
      <article class="product-static-panel">
        <h2>Alternative to ${text(replacement)}</h2>
        <p>${text(procurement)}</p>
        <ul class="product-fit-list">${uses}</ul>
      </article>
      <article class="product-static-panel">
        <h2>Why teams make the switch.</h2>
        <ul class="spec-list">${specs}</ul>${backingSections ? `
        ${backingSections}` : ""}
      </article>
    </div>
  </section>
  <section class="section-slim product-handling-section" aria-labelledby="product-handling-${id}">
    <div class="wrap">
      <article class="product-static-panel product-handling-panel">
        <div>
          <span class="eyebrow">HMIS 0-0-0</span>
          <h2 id="product-handling-${id}">Serious cleaning power. A much easier workday.</h2>
          <p>Every VertKleen product MASEST offers is HMIS 0-0-0 and ships non-hazmat. Crews get industrial cleaning power with simpler freight, storage, training, and day-to-day handling.</p>
        </div>
        <ul class="product-handling-list">
          <li><b>HMIS 0-0-0</b><span>Zero for health, flammability, and physical hazard.</span></li>
          <li><b>Non-hazmat shipping</b><span>Simpler freight without hazmat requirements.</span></li>
          <li><b>Standard ventilation</b><span>No special ventilation or area clearance for routine cleaning.</span></li>
          <li><b>One linewide standard</b><span>Every VertKleen product we offer carries the same 0-0-0 profile.</span></li>
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
<script type="module" src="../js/main.js?v=20260807i"></script>
<script type="module" src="../js/reviews.js?v=20260711w"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

async function writeProductPages(reviewsSnapshot) {
  let changed = 0;
  await mkdir("products", { recursive: true });
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

let changed = 0;
const contentPageMeta = loadContentPageMeta();
const reviewsSnapshot = loadReviewsSnapshot();
// services.html hosts all SKUs on one page (no per-service static page exists,
// unlike products/<id>.html) — bake reviewed services in as extra @graph nodes.
PUBLIC["services.html"].reviewJsonld = serviceReviewNodes(reviewsSnapshot);
for (const [file, meta] of Object.entries(PUBLIC)) {
  changed += await processPage(file, applyContentPageMeta(meta.loc, meta, contentPageMeta), false);
}
for (const file of PRIVATE) changed += await processPage(file, null, true);
changed += await writeProductPages(reviewsSnapshot);
changed += await writeSitemap();

console.log(`\nseo-inject: ${changed} files changed`);
