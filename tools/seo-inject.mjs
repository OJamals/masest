#!/usr/bin/env node
/**
 * Idempotent SEO/static-page injector.
 *
 * Writes canonical/OG/JSON-LD blocks into committed HTML, generates static
 * product detail pages, and regenerates sitemap.xml from final extensionless
 * public URLs. Cloudflare Pages serves these files directly.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import {
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

const PRODUCT_IDS = Object.keys(PRODUCTS);

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

function cleanPath(path) {
  if (path === "index.html") return "";
  if (path.endsWith("/index.html")) return path.slice(0, -"index.html".length);
  return path.replace(/\.html$/i, "");
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

function buildBlock(html, meta) {
  const title = pick(html, /<title>([^<]*)<\/title>/i) || "MASEST VertKleen";
  const desc = pick(html, /<meta\s+name="description"\s+content="([^"]*)"/i) || "";
  const url = `${BASE}${meta.loc}`;
  const hasOgTitle = /property="og:title"/.test(html);
  const hasOgDesc = /property="og:description"/.test(html);
  const lines = [START];
  lines.push(`<link rel="canonical" href="${url}">`);
  if (!hasOgTitle) lines.push(`<meta property="og:title" content="${attr(title)}">`);
  if (!hasOgDesc && desc) lines.push(`<meta property="og:description" content="${attr(desc)}">`);
  lines.push(`<meta property="og:url" content="${url}">`);
  lines.push(`<meta property="og:image" content="${OG_IMAGE}">`);
  lines.push('<meta name="twitter:card" content="summary_large_image">');
  if (meta.jsonld?.length) {
    const data = meta.jsonld.length === 1
      ? { "@context": "https://schema.org", ...meta.jsonld[0] }
      : { "@context": "https://schema.org", "@graph": meta.jsonld };
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

function productDescription(id, product) {
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const route = QUOTE_FIRST_IDS.includes(id)
    ? "Quote review required before purchase."
    : "Small-pack checkout available where stocked; bulk sizes route through quote review.";
  const parts = [copy.summary, product.desc, product.replaces, route].filter(Boolean);
  const sentence = parts.join(" ").replace(/\s+/g, " ").trim();
  if (sentence.length <= 155) return sentence;
  return `${sentence.slice(0, 152).replace(/\s+\S*$/, "")}...`;
}

function productSchema(id, product) {
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
            name: "Procurement route",
            value: QUOTE_FIRST_IDS.includes(id) ? "Quote review" : "Small-pack checkout and bulk quote review",
          },
        ].filter((item) => item.value),
      },
    ],
  };
}

function productPage(id, product) {
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const desc = productDescription(id, product);
  const img = product.image ? `../${product.image}` : `../${PRODUCT_FALLBACK_IMAGE}`;
  const uses = (product.uses || copy.fits || []).map((item) => `<li>${text(item)}</li>`).join("\n");
  const specs = (product.specs || [])
    .map((spec) => `<li><b>${text(spec[1] || spec[0])}</b><span>${text(spec[2] || "")}</span></li>`)
    .join("\n");
  const docs = (product.docs || [])
    .map((doc) => `<li>${text(doc)}</li>`)
    .join("\n");
  const procurement = QUOTE_FIRST_IDS.includes(id)
    ? "Quote review required before purchase."
    : "Small-pack checkout may be available; drums, totes, and program supply route through quote review.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${text(product.name)} | MASEST VertKleen</title>
<meta name="description" content="${attr(desc)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<meta property="og:title" content="${attr(product.name)} | MASEST VertKleen">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=20260623c">
<link rel="stylesheet" href="../css/navigation.css?v=20260619a">
<link rel="stylesheet" href="../css/components.css">
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/products/${id}">
<meta property="og:url" content="${BASE}/products/${id}">
<meta property="og:image" content="${product.image ? `${BASE}/${product.image}` : OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
${jsonLd(productSchema(id, product))}
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
  <a href="../proof">Field Results</a>
  <a href="../resources">Resources</a>
</nav>
</noscript>
<main id="main">
  <section class="hero product-detail-hero">
    <div class="wrap hero-grid">
      <div class="hero-copy reveal">
        <span class="eyebrow">VertKleen product</span>
        <h1 class="display">${text(product.name)}</h1>
        <p class="subhead">${text(desc)}</p>
        <div class="hero-actions">
          <a class="btn" href="../contact?type=quote&product=${encodeURIComponent(product.name)}">Request quote</a>
          <a class="btn btn-ghost" href="../products">All products</a>
        </div>
      </div>
      <figure class="product-hero-media reveal">
        <img src="${attr(img)}" alt="${attr(product.name)} product photo" fetchpriority="high" decoding="async">
      </figure>
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
        <span class="eyebrow">Buyer file</span>
        <h2>Why it survives review.</h2>
        <ul class="spec-list">${specs}</ul>
        ${docs ? `<h3>Controlled documents</h3><ul class="product-fit-list">${docs}</ul>` : ""}
      </article>
    </div>
  </section>
</main>
<script type="module" src="../js/main.js?v=20260619b"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

async function writeProductPages() {
  let changed = 0;
  await mkdir("products", { recursive: true });
  for (const id of PRODUCT_IDS) {
    const file = `products/${id}.html`;
    const html = productPage(id, PRODUCTS[id]);
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
for (const [file, meta] of Object.entries(PUBLIC)) changed += await processPage(file, meta, false);
for (const file of PRIVATE) changed += await processPage(file, null, true);
changed += await writeProductPages();
changed += await processProductFallback();
changed += await writeSitemap();

console.log(`\nseo-inject: ${changed} files changed`);
