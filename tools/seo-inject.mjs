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
import { existsSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CATALOG_ORDER,
  PRODUCT_CATALOG_COPY,
  PRODUCTS,
  QUOTE_FIRST_IDS,
} from "../js/main/catalog-data.js";

const BASE = "https://masest.co";
const OG_IMAGE = `${BASE}/img/og-card.png`;
const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";
const PRODUCT_FALLBACK_IMAGE_URL = `${BASE}/${PRODUCT_FALLBACK_IMAGE}`;
const START = "<!-- seo:auto -->";
const END = "<!-- /seo:auto -->";

const PRODUCT_IDS = CATALOG_ORDER.filter((id) => PRODUCTS[id]);

// Editorial catalog id -> commerce/reviews sku. Reviews (and orders.order_items
// .product_sku, and data-sku on product.html) key on the commerce sku, not the
// editorial id — keep in sync with COMMERCE_ALIAS in product.html and
// COMMERCE_SKU_ALIASES in js/main/commerce-ui.js.
const COMMERCE_SKU_ALIAS = { crhd: "cr-hd" };
const commerceSku = (id) => COMMERCE_SKU_ALIAS[id] || id;

const ORG = {
  "@type": "Organization",
  name: "MASEST Consulting LLC",
  url: `${BASE}/`,
  logo: `${BASE}/img/masest-logo.png`,
  brand: "VertKleen",
  description: "HMIS 0-0-0 industrial cleaning chemistry for lower-hazard handling.",
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
  "newsletter.html": { loc: "/newsletter", priority: "0.5", changefreq: "monthly", jsonld: [ORG, { "@type": "WebPage", name: "Newsletter", url: `${BASE}/newsletter` }] },
  "privacy.html": { loc: "/privacy", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "Privacy", url: `${BASE}/privacy` }] },
  "terms.html": { loc: "/terms", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "Terms", url: `${BASE}/terms` }] },
  "eula.html": { loc: "/eula", priority: "0.3", changefreq: "yearly", jsonld: [ORG, { "@type": "WebPage", name: "End-User License Agreement", url: `${BASE}/eula` }] },
  "industries.html": { loc: "/industries", priority: "0.7", changefreq: "monthly", jsonld: [ORG] },
  "industries/oil-gas.html": { loc: "/industries/oil-gas", priority: "0.6", changefreq: "monthly" },
  "industries/marine.html": { loc: "/industries/marine", priority: "0.6", changefreq: "monthly" },
  "industries/manufacturing.html": { loc: "/industries/manufacturing", priority: "0.6", changefreq: "monthly" },
  "industries/distribution-cold-storage.html": { loc: "/industries/distribution-cold-storage", priority: "0.6", changefreq: "monthly" },
  "industries/food-beverage.html": { loc: "/industries/food-beverage", priority: "0.6", changefreq: "monthly" },
  "industries/healthcare.html": { loc: "/industries/healthcare", priority: "0.6", changefreq: "monthly" },
  "industries/construction.html": { loc: "/industries/construction", priority: "0.6", changefreq: "monthly" },
  "industries/military-government.html": { loc: "/industries/military-government", priority: "0.6", changefreq: "monthly" },
  "industries/education.html": { loc: "/industries/education", priority: "0.6", changefreq: "monthly" },
  "industries/hvac-water.html": { loc: "/industries/hvac-water", priority: "0.6", changefreq: "monthly" },
  "industries/plumbing.html": { loc: "/industries/plumbing", priority: "0.6", changefreq: "monthly" },
};

Object.assign(PUBLIC, Object.fromEntries([
  ["pricing-hvac-facilities.html", "/pricing-hvac-facilities", "0.7"],
  ["pricing-cip-food-beverage.html", "/pricing-cip-food-beverage", "0.7"],
  ["industries/data-centers.html", "/industries/data-centers", "0.6"],
  ["industries/golf-courses.html", "/industries/golf-courses", "0.6"],
  ["industries/solar-panel-cleaning.html", "/industries/solar-panel-cleaning", "0.6"],
  ["industries/municipalities-water-utilities.html", "/industries/municipalities-water-utilities", "0.6"],
  ["industries/hotels-property-management.html", "/industries/hotels-property-management", "0.6"],
  ["industries/schools-universities.html", "/industries/schools-universities", "0.6"],
  ["industries/mechanical-contractors-water-treatment.html", "/industries/mechanical-contractors-water-treatment", "0.6"],
  ["industries/breweries-distilleries-wineries.html", "/industries/breweries-distilleries-wineries", "0.6"],
  ["industries/restaurants-commercial-kitchens.html", "/industries/restaurants-commercial-kitchens", "0.6"],
  ["industries/warehousing-distribution-centers.html", "/industries/warehousing-distribution-centers", "0.6"],
  ["industries/hotels-resorts-property-management.html", "/industries/hotels-resorts-property-management", "0.6"],
  ["industries/pressure-washing-soft-wash-contractors.html", "/industries/pressure-washing-soft-wash-contractors", "0.6"],
  ["industries/drone-cleaning-companies.html", "/industries/drone-cleaning-companies", "0.6"],
  ["industries/marine-marinas-boatyards.html", "/industries/marine-marinas-boatyards", "0.6"],
  ["industries/aviation-fbos-mro-airports.html", "/industries/aviation-fbos-mro-airports", "0.6"],
  ["industries/golf-courses-sports-facilities.html", "/industries/golf-courses-sports-facilities", "0.6"],
  ["industries/healthcare-senior-living.html", "/industries/healthcare-senior-living", "0.6"],
  ["industries/fleet-trucking-car-washes.html", "/industries/fleet-trucking-car-washes", "0.6"],
  ["industries/oil-gas-industrial-plants.html", "/industries/oil-gas-industrial-plants", "0.6"],
  ["industries/food-processing-agriculture.html", "/industries/food-processing-agriculture", "0.6"],
  ["industries/solar-farms-panel-cleaning.html", "/industries/solar-farms-panel-cleaning", "0.6"],
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

const PRODUCT_FALLBACK = "product.html";

const attr = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;");

const text = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

const pick = (html, re) => html.match(re)?.[1]?.trim() || "";

function loadContentPageMeta() {
  const file = "data/content/page-meta.json";
  if (!existsSync(file)) return new Map();
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(parsed.page_meta) ? parsed.page_meta : [];
  const out = new Map();
  for (const row of rows) {
    for (const key of [row.page, row.slug]) {
      const normalized = pageMetaKey(key);
      if (normalized || normalized === "") out.set(normalized, row);
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

function pageMetaKey(value) {
  const raw = String(value || "").trim().replace(/^\/+/, "");
  if (!raw) return "";
  return cleanPath(raw);
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
  const override = contentPageMeta.get(pageMetaKey(file));
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
  html = stripOld(html);
  if (isPrivate) {
    if (!/name="robots"/.test(html)) {
      html = html.replace(/(<meta name="viewport"[^>]*>)/i, '$1\n<meta name="robots" content="noindex">');
    }
  } else {
    html = normalizePublicUrls(html);
    html = applyContentHtmlMeta(html, meta.content);
    html = html.replace(/<\/head>/i, `${buildBlock(html, meta)}\n</head>`);
  }
  if (html !== before) {
    await writeFile(file, html);
    return 1;
  }
  return 0;
}

async function processProductFallback() {
  let html = await readFile(PRODUCT_FALLBACK, "utf8");
  const before = html;
  html = normalizePublicUrls(html);
  if (html !== before) {
    await writeFile(PRODUCT_FALLBACK, html);
    return 1;
  }
  return 0;
}

// DBNPA is a program component with no stocked small packs; static-page route
// copy treats it as quote-only even though runtime buy logic keys on QUOTE_FIRST_IDS.
const QUOTE_ONLY_IDS = new Set([...QUOTE_FIRST_IDS, "dbnpa"]);

function terminate(part) {
  const trimmed = String(part).trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function productRouteCopy(id) {
  return QUOTE_ONLY_IDS.has(id)
    ? "Quoted before purchase."
    : "Small packs ship from stock where available; drums and totes are quoted.";
}

function productDescription(id, product) {
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  // Bare `replaces` values ("50% ethylene glycol pre-mix") are spec labels, not
  // sentences — only full "Replaces …" statements read correctly in prose.
  const replaces = /^Replaces\b/i.test(product.replaces || "") ? product.replaces : "";
  const parts = [copy.summary, product.desc, replaces, productRouteCopy(id)].filter(Boolean).map(terminate);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function productMetaDescription(id, product) {
  const sentence = productDescription(id, product);
  if (sentence.length <= 155) return sentence;
  return `${sentence.slice(0, 152).replace(/\s+\S*$/, "")}...`;
}

function productSchema(id, product, reviewsSnapshot) {
  const aggregateRating = aggregateRatingNode("product", commerceSku(id), reviewsSnapshot);
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
        brand: { "@type": "Brand", name: "VertKleen" },
        manufacturer: { "@type": "Organization", name: "MASEST Consulting LLC", url: `${BASE}/` },
        category: "Industrial cleaning chemistry",
        description: productDescription(id, product),
        url: `${BASE}/products/${id}`,
        image: product.image ? `${BASE}/${product.image}` : PRODUCT_FALLBACK_IMAGE_URL,
        additionalProperty: [
          { "@type": "PropertyValue", name: "HMIS rating", value: product.hmis },
          { "@type": "PropertyValue", name: "Replaces", value: product.replaces },
          {
            "@type": "PropertyValue",
            name: "Procurement",
            value: QUOTE_ONLY_IDS.has(id) ? "Quoted before purchase" : "Small packs in stock; bulk quoted",
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
  // The brand poster is a placeholder, not a product photo (mirrors product.html +
  // catalog-card suppression) — swap the hero figure for the shared icon tile.
  const hasPhoto = product.image && !/masest-poster-transparent/.test(product.image);
  const heroMedia = hasPhoto
    ? `<figure class="product-hero-media reveal">
        <img src="${attr(img)}" alt="${attr(product.name)} product photo" fetchpriority="high" decoding="async">
      </figure>`
    : `<figure class="product-hero-media media-fallback reveal">
        <span class="media-fallback-label">${text(product.name)}</span>
      </figure>`;
  const uses = (product.uses || copy.fits || []).map((item) => `<li>${text(item)}</li>`).join("\n");
  const specs = (product.specs || [])
    .map((spec) => `<li><b>${text(spec[1] || spec[0])}</b><span>${text(spec[2] || "")}</span></li>`)
    .join("\n");
  const docs = (product.docs || [])
    .map((doc) => {
      if (doc && typeof doc === "object" && doc.file) {
        return `<li class="doc-file"><a href="../${attr(doc.file)}" target="_blank" rel="noopener" download>${text(doc.label)}<span class="doc-pill">PDF</span></a></li>`;
      }
      const label = doc && typeof doc === "object" ? doc.label : doc;
      const href = `../contact?type=technical&product=${encodeURIComponent(product.name)}&doc=${encodeURIComponent(label)}`;
      return `<li class="doc-file doc-request"><a href="${attr(href)}">${text(label)}<span class="doc-pill doc-pill-req">Request</span></a></li>`;
    })
    .join("\n");
  const procurement = QUOTE_ONLY_IDS.has(id)
    ? "Quoted before purchase."
    : "Small packs ship from stock where available; drums, totes, and program supply are quoted.";
  const eyebrow = id === "dbnpa" ? "Program component" : "VertKleen product";

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
<link rel="stylesheet" href="../css/style.css?v=20260708c">
<link rel="stylesheet" href="../css/navigation.css?v=20260706a">
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
        <p class="subhead">${text(heroDesc)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="../contact?type=quote&product=${encodeURIComponent(product.name)}">Request a quote</a>
          <a class="btn btn-secondary" href="../contact?type=sample&product=${encodeURIComponent(product.name)}">Request free sample</a>
          <a class="btn btn-ghost" href="../products">All products</a>
        </div>${QUOTE_ONLY_IDS.has(id) ? "" : `
        <!-- Hydrated by js/main.js (refreshCommerceActions): live price + volume select
             incl. bulk drum/tote sizes, Add-to-cart or quote-swap. Static fallback stays
             the "Request a quote" CTA above (data-quote-fallback="off" keeps this empty
             when the catalog API is unavailable). -->
        <div class="product-hero-buy" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:16px">
          <span class="shop-card-price" data-commerce-price="${id}" hidden></span>
          <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button" data-quote-fallback="off"></span>
        </div>`}
      </div>
      ${heroMedia}
    </div>
  </section>
  <section class="section product-static-section">
    <div class="wrap product-static-grid">
      <article class="product-static-panel">
        <span class="eyebrow">Replacement target</span>
        <h2>${text(product.replaces || "Industrial chemistry replacement")}</h2>
        <p>${text(procurement)}</p>
        <ul class="product-fit-list">${uses}</ul>
      </article>
      <article class="product-static-panel">
        <span class="eyebrow">The case for it</span>
        <h2>Why it survives review.</h2>
        <ul class="spec-list">${specs}</ul>
        ${docs ? `<h3>Documents</h3><ul class="product-fit-list">${docs}</ul>` : ""}
      </article>
    </div>
  </section>
</main>
<script type="module" src="../js/main.js?v=20260710d"></script>
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

async function writeSitemap() {
  const entries = [
    ...Object.values(PUBLIC),
    ...PRODUCT_IDS.map((id) => ({ loc: `/products/${id}`, priority: "0.7", changefreq: "monthly" })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url><loc>${BASE}${entry.loc}</loc><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`).join("\n")}
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
  changed += await processPage(file, applyContentPageMeta(file, meta, contentPageMeta), false);
}
for (const file of PRIVATE) changed += await processPage(file, null, true);
changed += await writeProductPages(reviewsSnapshot);
changed += await processProductFallback();
changed += await writeSitemap();

console.log(`\nseo-inject: ${changed} files changed`);
