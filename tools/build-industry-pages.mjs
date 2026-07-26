import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PRODUCTS } from "../js/main/catalog-data.js";
import {
  documentAllowedOnSurface,
  documentClaimLabel,
  documentDistribution,
  documentSurfaceMode,
} from "./public-document-policy.mjs";
import { STYLE_VERSION } from "./static-release.mjs";

const root = new URL("../", import.meta.url);
const registryPath = new URL("data/industry-applications.json", root);
const reviewPath = new URL("data/public-document-review.json", root);
const documentReview = JSON.parse(readFileSync(reviewPath, "utf8"));
const documentRevision = documentReview.document_control.revision;
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

function contactHref(industry, type = "audit", base = "../contact") {
  const message = [
    `Industry: ${industry.label}`,
    `Asset / substrate: ${industry.asset}`,
    `Soil / deposit: ${industry.soil}`,
    "Operating conditions: temperature, available dwell, agitation/flow, rinse water, shutdown window",
    `Materials: ${industry.materials}`,
    "Buying deadline: ",
  ].join("\n");
  const query = new URLSearchParams({
    industry: industry.label,
    type,
    message,
    wastewater_route: industry.wastewater,
    reopening_criteria: industry.verification,
  }).toString();
  return `${base}?${escapeHtml(query)}`;
}

function discoveryFilterCard(type, {
  id,
  label,
  detail,
  result_detail: resultDetail,
  cta_type: ctaType,
  cta_label: ctaLabel,
}) {
  return `<a class="route-card" href="?${type}=${escapeHtml(id)}#industry-discovery" role="button" data-industry-discovery-filter data-filter-type="${type}" data-filter-value="${escapeHtml(id)}" data-result-detail="${escapeHtml(resultDetail)}" data-cta-type="${escapeHtml(ctaType)}" data-cta-label="${escapeHtml(ctaLabel)}" aria-pressed="false">
          <span>${type === "role" ? "Buyer role" : "Job path"}</span>
          <strong>${escapeHtml(label)}</strong>
          <b>${escapeHtml(detail)}</b>
        </a>`;
}

function evidenceStatusLabel(industry) {
  const labels = {
    absent: "No field record",
    context_only: "Field context; verification incomplete",
    qualified: "Qualified field record",
  };
  const label = labels[industry.field_evidence?.status];
  if (!label) throw new Error(`${industry.slug}: unsupported field evidence status`);
  return label;
}

function renderDiscoveryProducts(industry) {
  const jobsByProduct = new Map();
  for (const [job, productIds] of Object.entries(industry.job_paths || {})) {
    for (const productId of productIds) {
      if (!jobsByProduct.has(productId)) jobsByProduct.set(productId, []);
      jobsByProduct.get(productId).push(job);
    }
  }

  const links = industry.products
    .filter((productId) => jobsByProduct.has(productId))
    .map((productId) => {
      const product = PRODUCTS[productId];
      if (!product) throw new Error(`${industry.slug}: unknown discovery product ${productId}`);
      return `<span data-industry-discovery-product data-job-paths="${escapeHtml(jobsByProduct.get(productId).join(" "))}"><a href="products/${escapeHtml(productId)}">${escapeHtml(product.name)}</a></span>`;
    })
    .join("");
  return `<span class="industry-discovery-products">${links}</span>`;
}

function renderDiscoveryCard(industry) {
  const jobIds = Object.keys(industry.job_paths || {});
  return `<article class="ind-scope-note industry-discovery-card" data-industry-discovery-card data-industry-slug="${escapeHtml(industry.slug)}" data-buyer-roles="${escapeHtml((industry.buyer_roles || []).join(" "))}" data-job-paths="${escapeHtml(jobIds.join(" "))}" hidden>
        <span class="eyebrow">${industry.kind === "supplemental" ? "Focused operation" : "Sector route"}</span>
        <h3><a href="industries/${escapeHtml(industry.slug)}">${escapeHtml(industry.label)}</a></h3>
        <p>${escapeHtml(industry.lead_task)}</p>
        <p class="industry-discovery-path" data-industry-discovery-path hidden></p>
        <dl>
          <div><dt>Starting chemistry</dt><dd>${renderDiscoveryProducts(industry)}</dd></div>
          <div><dt>Evidence status</dt><dd>${escapeHtml(evidenceStatusLabel(industry))}</dd></div>
        </dl>
        <div class="prod-actions">
          <a class="btn btn-secondary btn-sm" href="industries/${escapeHtml(industry.slug)}">Open route</a>
          <a class="btn btn-primary btn-sm" href="${contactHref(industry, "audit", "contact")}" data-industry-discovery-cta>Scope audit</a>
        </div>
      </article>`;
}

export function renderIndustryDiscovery(industries, discovery) {
  const roleCards = discovery.roles.map((role) => discoveryFilterCard("role", role)).join("\n        ");
  const jobCards = discovery.jobs.map((job) => discoveryFilterCard("job", job)).join("\n        ");
  const resultCards = industries.map(renderDiscoveryCard).join("\n      ");

  return `<section class="section section-slim">
    <div class="wrap">
      <div class="industry-router buyer-router reveal" id="industry-discovery" data-industry-discovery>
        <div>
          <span class="eyebrow">Find your route</span>
          <h2>Start with your role or the job.</h2>
          <p class="subhead">Filter the existing industry library. Every match keeps the sector task, starting chemistry, evidence status, and scoped audit handoff together.</p>
          <p class="industry-discovery-status" data-industry-discovery-status aria-live="polite">Choose a buyer role or job path.</p>
          <button class="btn btn-ghost btn-sm" type="button" data-industry-discovery-clear hidden>Clear filters</button>
        </div>
        <div class="industry-discovery-controls">
          <div>
            <span class="eyebrow">Buyer role</span>
            <div class="route-grid">
              ${roleCards}
            </div>
          </div>
          <div>
            <span class="eyebrow">High-intent job</span>
            <div class="route-grid">
              ${jobCards}
            </div>
          </div>
        </div>
        <div class="industry-discovery-results" data-industry-discovery-results hidden>
          ${resultCards}
        </div>
      </div>
    </div>
  </section>`;
}

export function renderIndustryHub(html, industries, discovery) {
  const rendered = replaceMarker(html, "discovery", renderIndustryDiscovery(industries, discovery));
  if (rendered === null) throw new Error("industries hub: discovery marker missing");
  return rendered;
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
    const files = (product.docs || []).filter((document) => {
      if (!document?.file) return false;
      const review = reviewByPath.get(document.file);
      if (!review) throw new Error(`${industry.slug}: unreviewed document ${document.file}`);
      return documentAllowedOnSurface(review, "industry");
    });
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
    const review = reviewByPath.get(evidence.file);
    if (!review) throw new Error(`${industry.slug}: unreviewed document ${evidence.file}`);
    if (!documentAllowedOnSurface(review, "industry")) continue;
    if (seen.has(evidence.file)) continue;
    selected.push(evidence);
    seen.add(evidence.file);
  }

  for (const document of selected) {
    const review = reviewByPath.get(document.file);
    if (!review) throw new Error(`${industry.slug}: unreviewed document ${document.file}`);
    if (!documentAllowedOnSurface(review, "industry")) {
      throw new Error(`${industry.slug}: unavailable industry document ${document.file}`);
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

function renderTrialBrief(industry, documents) {
  const brief = industry.trial_brief;
  if (!brief) return "";
  if (
    !brief.title?.trim()
    || !brief.objective?.trim()
    || !Array.isArray(brief.compatibility_checks)
    || brief.compatibility_checks.length === 0
  ) {
    throw new Error(`${industry.slug}: incomplete controlled-trial brief`);
  }

  const compatibilityRows = brief.compatibility_checks.map(({ material, gate }) => {
    if (!material?.trim() || !gate?.trim()) {
      throw new Error(`${industry.slug}: incomplete compatibility check`);
    }
    return `<tr><th scope="row">${escapeHtml(material)}</th><td>${escapeHtml(gate)}</td></tr>`;
  }).join("\n              ");
  const referenceTitles = [...new Set(documents
    .filter(({ control }) => control.status === "reference_only")
    .map(({ control }) => control.title))];
  const referenceBoundary = referenceTitles.length
    ? `${referenceTitles.join(" and ")} remain controlled references. Flagged statements in these files do not substantiate public copy, including safety, certification, efficacy, compatibility, food-contact, antimicrobial, regulatory, or customer-outcome claims.`
    : "No controlled reference is being used to substantiate this planning brief.";

  return `
      <section class="ind-scope-note ind-trial-brief" data-industry-trial-brief aria-labelledby="industry-trial-brief-title">
        <div class="ind-trial-head">
          <div>
            <span class="eyebrow">Controlled-trial plan</span>
            <h3 id="industry-trial-brief-title">${escapeHtml(brief.title)}</h3>
            <p>${escapeHtml(brief.objective)}</p>
          </div>
          <span class="ind-trial-status">Planning asset · ${escapeHtml(evidenceStatusLabel(industry))}</span>
        </div>
        <div class="ind-trial-grid">
          <div>
            <h4>Material compatibility gate</h4>
            <div class="ind-trial-table-wrap">
              <table class="ind-trial-table">
                <caption>Materials to approve before the trial</caption>
                <thead><tr><th scope="col">Material</th><th scope="col">Required gate</th></tr></thead>
                <tbody>
              ${compatibilityRows}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4>Witnessed method</h4>
            <ol class="ind-trial-steps">
              <li><h5>Scope and baseline</h5><p>Asset / substrate: ${escapeHtml(industry.asset)}. Soil / deposit: ${escapeHtml(industry.soil)}. Record current dissatisfaction, operating window, and acceptance endpoint before testing.</p></li>
              <li><h5>Compatibility gate</h5><p>Materials in scope: ${escapeHtml(industry.materials)}. ${escapeHtml(industry.boundary)}</p></li>
              <li><h5>Witnessed method</h5><p>${escapeHtml(industry.method)}. ${escapeHtml(industry.concentration)} ${escapeHtml(industry.process)}</p></li>
              <li><h5>Release and record</h5><p>${escapeHtml(industry.verification)} ${escapeHtml(industry.wastewater)} Record the result and limitations.</p></li>
            </ol>
          </div>
        </div>
        <aside class="ind-evidence-boundary ind-trial-boundary" aria-label="Controlled-trial evidence boundary">
          <strong>Evidence status</strong>
          <p>${escapeHtml(evidenceStatusLabel(industry))}. This is a planning brief, not field proof. ${escapeHtml(referenceBoundary)}</p>
          <a class="btn btn-secondary" href="${contactHref(industry, "sample")}">Scope this trial</a>
        </aside>
      </section>`;
}

function renderApplications(industry, allIndustries, documents) {
  const parent = industry.parent
    ? allIndustries.find((candidate) => candidate.slug === industry.parent)
    : null;
  const children = allIndustries.filter((candidate) => candidate.parent === industry.slug);
  const related = parent
    ? `
      <aside class="ind-scope-note" data-supplemental-scope>
        <span class="eyebrow">Focused buyer route</span>
        <h3>${escapeHtml(industry.buyer)}</h3>
        <dl>
          <div><dt>Distinct scope</dt><dd>${escapeHtml(industry.distinct_scope)}</dd></div>
          <div><dt>Search intent</dt><dd>${escapeHtml(industry.search_intent)}</dd></div>
        </dl>
        <p class="ind-related">Broader program: <a href="./${escapeHtml(parent.slug)}">${escapeHtml(parent.label)}</a></p>
      </aside>`
    : children.length
      ? `
      <aside class="ind-scope-note" data-specialized-routes>
        <span class="eyebrow">Specific operation?</span>
        <h3>Open the route built for your team.</h3>
        <p class="ind-related">${children.map((child) => (
          `<a href="./${escapeHtml(child.slug)}">${escapeHtml(child.label)}</a>`
        )).join(" · ")}</p>
      </aside>`
      : "";
  const documentLinks = documents.map((document) => {
    const control = document.control;
    const distribution = documentDistribution(control) === "request_only" ? "Request only" : "Current";
    const metadata = `${control.document_id} · Rev ${documentRevision} · Distribution: ${distribution} · Claims: ${documentClaimLabel(control.status)} · SKUs: ${control.skus.join(", ")}`;
    const common = `data-document-id="${escapeHtml(control.document_id)}" data-document-revision="${escapeHtml(documentRevision)}" data-document-skus="${escapeHtml(control.skus.join(" "))}" data-document-name="${escapeHtml(document.label)}"`;
    if (documentSurfaceMode(control, "industry") === "request") {
      return `<button class="doc-chip doc-request-button" type="button" data-document-request ${common} aria-label="Register to request ${escapeHtml(document.label)}"><span class="doc-title">${escapeHtml(document.label)}</span><span class="doc-control">${escapeHtml(metadata)}</span><span class="doc-request-state" data-document-request-label>Register to request</span></button>`;
    }
    return `<a class="doc-chip" href="../${escapeHtml(document.file)}" ${common} data-document-download target="_blank" rel="noopener" download><span class="doc-title">${escapeHtml(document.label)}</span><span class="doc-control">${escapeHtml(metadata)}</span></a>`;
  }).join("\n            ");

  return `<section class="section section-slim ind-applications" id="applications-and-proof" data-industry-applications-proof>
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Applications and verification</span>
        <h2 class="headline">${escapeHtml(industry.lead_task)}</h2>
        <p class="subhead">Task controls first. Product choice follows the asset, deposit, materials, operating window, and discharge route.</p>
      </div>${related}
      <dl class="ind-proof-grid">
        <div><dt>Task</dt><dd>${escapeHtml(industry.lead_task)}</dd></div>
        <div><dt>Asset / substrate</dt><dd>${escapeHtml(industry.asset)}</dd></div>
        <div><dt>Soil / deposit</dt><dd>${escapeHtml(industry.soil)}</dd></div>
        <div><dt>Starting chemistry</dt><dd>${renderProducts(industry)}</dd></div>
        <div><dt>Concentration</dt><dd>${escapeHtml(industry.concentration)}</dd></div>
        <div><dt>Process controls</dt><dd>${escapeHtml(industry.process)}</dd></div>
        <div><dt>Shutdown / containment</dt><dd>${escapeHtml(industry.boundary)}</dd></div>
        <div><dt>Verification endpoint</dt><dd>${escapeHtml(industry.verification)}</dd></div>
      </dl>${renderTrialBrief(industry, documents)}
      <div class="ind-proof-docs">
        <div>
          <span class="eyebrow">Controlled technical files</span>
          <h3>Request SDS/TDS access or open the current public application file.</h3>
          <p>Registered users can request safety and technical sheets for staff review. Confirm revision, product identity, material compatibility, and application scope before site approval.</p>
        </div>
        <div class="doc-lib-links">
          ${documentLinks}
        </div>
      </div>
      <aside class="ind-evidence-boundary" aria-label="Evidence boundary">
        <strong>Field evidence standard</strong>
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
  const productMounts = html.match(/data-ind-products="[^"]*"/g) || [];
  if (productMounts.length !== 1) {
    throw new Error(`${industry.slug}: expected one recommended-product mount`);
  }

  html = html.replace(/css\/style\.css\?v=[^"']+/g, `css/style.css?v=${STYLE_VERSION}`);
  html = html.replace(
    /data-ind-products="[^"]*"/,
    `data-ind-products="${escapeHtml(industry.products.join(" "))}"`,
  );
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
  const { discovery, industries } = JSON.parse(readFileSync(registryPath, "utf8"));
  const reviewByPath = new Map(documentReview.documents.map((document) => [document.path, document]));

  for (const industry of industries) {
    const file = new URL(`industries/${industry.slug}.html`, root);
    if (!existsSync(file)) throw new Error(`${industry.slug}: industry page missing`);
    const html = readFileSync(file, "utf8");
    const rendered = renderIndustryPage(html, industry, industries, reviewByPath);
    if (rendered !== html) writeFileSync(file, rendered);
  }

  const hubPath = new URL("industries.html", root);
  const hub = readFileSync(hubPath, "utf8");
  const renderedHub = renderIndustryHub(hub, industries, discovery);
  if (renderedHub !== hub) writeFileSync(hubPath, renderedHub);

  return industries.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`build-industry-pages: rendered ${buildIndustryPages()} pages`);
}
