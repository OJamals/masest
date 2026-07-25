import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PRODUCTS } from "../js/main/catalog-data.js";

const root = new URL("../", import.meta.url);
const registryPath = new URL("data/industry-applications.json", root);
const reviewPath = new URL("data/public-document-review.json", root);
const documentReview = JSON.parse(readFileSync(reviewPath, "utf8"));
const documentRevision = documentReview.document_control.revision;
const styleVersion = "20260724a";
const industrySlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const escapeHtml = (value) => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const marker = (name, content) => (
  `<!-- industry:${name}:start -->\n${content}\n<!-- industry:${name}:end -->`
);

function replaceMarker(html, name, content) {
  const start = `<!-- industry:${name}:start -->`;
  const end = `<!-- industry:${name}:end -->`;
  const startAt = html.indexOf(start);
  if (startAt === -1) return null;
  const endAt = html.indexOf(end, startAt);
  if (endAt === -1) throw new Error(`Missing ${end} marker`);
  return `${html.slice(0, startAt)}${marker(name, content)}${html.slice(endAt + end.length)}`;
}

export function renderIndustryRedirects(industries) {
  const currentSlugs = new Set();
  const retiredSlugs = new Set();
  const redirects = [];

  for (const { slug } of industries) {
    if (!industrySlugPattern.test(slug)) {
      throw new Error(`invalid current route ${slug}`);
    }
    if (currentSlugs.has(slug)) {
      throw new Error(`duplicate current route ${slug}`);
    }
    currentSlugs.add(slug);
  }

  for (const industry of industries) {
    for (const retiredSlug of industry.redirect_from || []) {
      if (!industrySlugPattern.test(retiredSlug)) {
        throw new Error(`${industry.slug}: invalid retired route ${retiredSlug}`);
      }
      if (currentSlugs.has(retiredSlug)) {
        throw new Error(`${industry.slug}: retired route is still current: ${retiredSlug}`);
      }
      if (retiredSlugs.has(retiredSlug)) {
        throw new Error(`${industry.slug}: duplicate retired route ${retiredSlug}`);
      }
      retiredSlugs.add(retiredSlug);
      redirects.push(
        `/industries/${retiredSlug} /industries/${industry.slug} 301`,
      );
    }
  }

  return redirects.sort().join("\n") + (redirects.length ? "\n" : "");
}

function contactHref(industry, type = "audit") {
  const message = [
    `Industry: ${industry.label}`,
    `Asset / substrate: ${industry.asset}`,
    `Soil / deposit: ${industry.soil}`,
    "Operating conditions: temperature, available dwell, agitation/flow, rinse water, shutdown window",
    `Materials: ${industry.materials}`,
    `Wastewater route: ${industry.wastewater}`,
    "Buying deadline: ",
  ].join("\n");
  const query = new URLSearchParams({
    industry: industry.label,
    type,
    message,
  }).toString();
  return `../contact?${escapeHtml(query)}`;
}

function renderHeroFacts(industry) {
  return `<ul class="ind-hero-facts" data-industry-hero-facts aria-label="Cleaning task summary">
        <li><span>Clean</span><strong>${escapeHtml(industry.asset)}</strong></li>
        <li><span>Remove</span><strong>${escapeHtml(industry.soil)}</strong></li>
        <li><span>Method</span><strong>${escapeHtml(industry.method)}</strong></li>
        <li><span>Boundary</span><strong>${escapeHtml(industry.boundary)}</strong></li>
        <li><a href="#applications-and-proof">Open task controls and documents <span aria-hidden="true">↓</span></a></li>
      </ul>`;
}

function resolveDocuments(industry, reviewByPath) {
  const selected = [];
  const seen = new Set();
  const priorities = [
    /Safety Data Sheet/i,
    /Technical Data Sheet/i,
    /User Guide/i,
    /Product Label/i,
    /Titration|Test Data|Overview|Base Data|Brochure|Comparison|Field Note/i,
  ];

  for (const productId of industry.document_products) {
    const product = PRODUCTS[productId];
    if (!product) throw new Error(`${industry.slug}: unknown document product ${productId}`);
    const files = (product.docs || []).filter((document) => document?.file);
    files.sort((left, right) => {
      const rank = (document) => {
        const index = priorities.findIndex((pattern) => pattern.test(document.label));
        return index === -1 ? priorities.length : index;
      };
      return rank(left) - rank(right);
    });
    for (const document of files) {
      if (seen.has(document.file)) continue;
      selected.push({
        label: `${product.name} — ${document.label}`,
        file: document.file,
      });
      seen.add(document.file);
      if (selected.length >= 6) break;
    }
    if (selected.length >= 6) break;
  }

  for (const evidence of industry.evidence_files || []) {
    if (seen.has(evidence.file)) continue;
    selected.push(evidence);
    seen.add(evidence.file);
  }

  for (const document of selected) {
    const review = reviewByPath.get(document.file);
    if (!review) throw new Error(`${industry.slug}: unreviewed document ${document.file}`);
    if (review.status === "restricted") {
      throw new Error(`${industry.slug}: restricted document ${document.file}`);
    }
    if (!existsSync(new URL(document.file, root))) {
      throw new Error(`${industry.slug}: missing document ${document.file}`);
    }
  }
  return selected.map((document) => ({
    ...document,
    control: reviewByPath.get(document.file),
  }));
}

function renderProducts(industry) {
  return industry.products.map((productId) => {
    const product = PRODUCTS[productId];
    if (!product) throw new Error(`${industry.slug}: unknown product ${productId}`);
    const productPage = new URL(`products/${productId}.html`, root);
    return existsSync(productPage)
      ? `<a href="../products/${escapeHtml(productId)}">${escapeHtml(product.name)}</a>`
      : `<span>${escapeHtml(product.name)}</span>`;
  }).join(", ");
}

function renderApplications(industry, allIndustries, documents) {
  const parent = industry.parent
    ? allIndustries.find((candidate) => candidate.slug === industry.parent)
    : null;
  const related = parent
    ? `\n        <p class="ind-related">Broader program: <a href="./${escapeHtml(parent.slug)}">${escapeHtml(parent.label)}</a></p>`
    : "";
  const documentLinks = documents.map((document) => (
    `<a class="doc-chip" href="../${escapeHtml(document.file)}" data-document-id="${escapeHtml(document.control.document_id)}" data-document-revision="${escapeHtml(documentRevision)}" data-document-skus="${escapeHtml(document.control.skus.join(" "))}"><span class="doc-title">${escapeHtml(document.label)}</span><span class="doc-control">${escapeHtml(document.control.document_id)} · Rev ${escapeHtml(documentRevision)} · Distribution: Current · Claims: ${document.control.status === "claim_review_required" ? "Review required" : "No automated flags"} · SKUs: ${escapeHtml(document.control.skus.join(", "))}</span></a>`
  )).join("\n            ");

  return `<section class="section section-slim ind-applications" id="applications-and-proof" data-industry-applications-proof>
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Applications and proof</span>
        <h2 class="headline">${escapeHtml(industry.lead_task)}</h2>
        <p class="subhead">Task controls first. Product choice follows the asset, deposit, materials, operating window, and discharge route.</p>${related}
      </div>
      <dl class="ind-proof-grid">
        <div><dt>Task</dt><dd>${escapeHtml(industry.lead_task)}</dd></div>
        <div><dt>Asset / substrate</dt><dd>${escapeHtml(industry.asset)}</dd></div>
        <div><dt>Soil / deposit</dt><dd>${escapeHtml(industry.soil)}</dd></div>
        <div><dt>Starting chemistry</dt><dd>${renderProducts(industry)}</dd></div>
        <div><dt>Concentration</dt><dd>${escapeHtml(industry.concentration)}</dd></div>
        <div><dt>Process controls</dt><dd>${escapeHtml(industry.process)}</dd></div>
        <div><dt>Shutdown / containment</dt><dd>${escapeHtml(industry.boundary)}</dd></div>
        <div><dt>Verification endpoint</dt><dd>${escapeHtml(industry.verification)}</dd></div>
      </dl>
      <div class="ind-proof-docs">
        <div>
          <span class="eyebrow">Controlled downloads</span>
          <h3>Review the current safety and application file.</h3>
          <p>Confirm revision, product identity, material compatibility, and application scope before site approval.</p>
        </div>
        <div class="doc-lib-links">
          ${documentLinks}
        </div>
      </div>
      <aside class="ind-evidence-boundary" aria-label="Evidence boundary">
        <strong>Field-proof standard</strong>
        <p>No field result is presented as proof unless permission, date, asset/substrate, soil, product and concentration, procedure, before/after endpoint, result, and limitations are recorded. If no matching record exists, request a controlled trial.</p>
        <a class="btn btn-secondary" href="${contactHref(industry, "audit")}">Request compatibility review</a>
      </aside>
    </div>
  </section>`;
}

function renderCta(industry) {
  const tiles = [
    ["quote", "ph-tag", "Price this cleaning task", "Product, volume, freight"],
    ["audit", "ph-clipboard-text", "Review compatibility", "Materials, soil, operating limits"],
    ["sample", "ph-package", "Run a controlled trial", "Procedure, endpoint, acceptance"],
    ["distributor", "ph-handshake", "Set up supply", "Site, stocking, buying deadline"],
  ];
  const tileHtml = tiles.map(([type, icon, title, detail]) => (
    `<a class="cta-tile" href="${contactHref(industry, type)}"><i class="ph ${icon}" aria-hidden="true"></i><span class="cta-tile-t">${title}</span><span class="cta-tile-s">${detail}</span></a>`
  )).join("\n        ");

  return `<section class="block-dark" data-industry-local-cta>
    <div class="wrap">
      <div class="section-head center">
        <span class="eyebrow">Scope the job</span>
        <h2 class="headline">Bring us your ${escapeHtml(industry.label)} cleaning task.</h2>
        <p class="subhead">The request opens with asset, soil, operating conditions, materials, wastewater route, and buying deadline already prompted.</p>
      </div>
      <div class="cta-grid">
        ${tileHtml}
      </div>
    </div>
  </section>`;
}

export function renderIndustryPage(html, industry, allIndustries, reviewByPath) {
  const hero = renderHeroFacts(industry);
  const applications = renderApplications(
    industry,
    allIndustries,
    resolveDocuments(industry, reviewByPath),
  );
  const cta = renderCta(industry);

  html = html.replace(/css\/style\.css\?v=[^"']+/g, `css/style.css?v=${styleVersion}`);
  let output = replaceMarker(html, "hero-facts", hero);
  if (output === null) {
    const heroSubhead = /(<section class="hero-split">[\s\S]*?<p class="subhead">[\s\S]*?<\/p>)/;
    if (!heroSubhead.test(html)) throw new Error(`${industry.slug}: hero subhead not found`);
    output = html.replace(heroSubhead, `$1\n      ${marker("hero-facts", hero)}`);
  }

  const replacedApplications = replaceMarker(output, "applications", applications);
  if (replacedApplications === null) {
    const ctaAt = output.lastIndexOf('<section class="block-dark">');
    if (ctaAt === -1) throw new Error(`${industry.slug}: final CTA not found`);
    output = `${output.slice(0, ctaAt)}${marker("applications", applications)}\n\n  ${output.slice(ctaAt)}`;
  } else {
    output = replacedApplications;
  }

  const replacedCta = replaceMarker(output, "cta", cta);
  if (replacedCta !== null) return replacedCta;

  const ctaAt = output.lastIndexOf('<section class="block-dark">');
  if (ctaAt === -1) throw new Error(`${industry.slug}: final CTA not found after applications`);
  const ctaEnd = output.indexOf("</section>", ctaAt);
  if (ctaEnd === -1) throw new Error(`${industry.slug}: final CTA end not found`);
  return `${output.slice(0, ctaAt)}${marker("cta", cta)}${output.slice(ctaEnd + "</section>".length)}`;
}

export function buildIndustryPages() {
  const industries = JSON.parse(readFileSync(registryPath, "utf8"));
  const reviewByPath = new Map(documentReview.documents.map((document) => [document.path, document]));

  for (const industry of industries) {
    const file = new URL(`industries/${industry.slug}.html`, root);
    if (!existsSync(file)) throw new Error(`${industry.slug}: industry page missing`);
    const html = readFileSync(file, "utf8");
    const rendered = renderIndustryPage(html, industry, industries, reviewByPath);
    if (rendered !== html) writeFileSync(file, rendered);
  }
  return industries.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`build-industry-pages: rendered ${buildIndustryPages()} pages`);
}
