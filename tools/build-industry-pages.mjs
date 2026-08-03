import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PRODUCTS } from "../js/main/catalog-data.js";
import {
  documentAllowedOnSurface,
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
    absent: "Ready for a side-by-side test",
    context_only: "Real-world result available",
    qualified: "Related real-world result available",
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
        <span class="eyebrow">${industry.kind === "supplemental" ? "Specialized job" : "Industry"}</span>
        <h3><a href="industries/${escapeHtml(industry.slug)}">${escapeHtml(industry.label)}</a></h3>
        <p>${escapeHtml(industry.marketing)}</p>
        <p class="industry-discovery-path" data-industry-discovery-path hidden></p>
        <dl>
          <div><dt>Products to start with</dt><dd>${renderDiscoveryProducts(industry)}</dd></div>
          <div><dt>Proof</dt><dd>${escapeHtml(evidenceStatusLabel(industry))}</dd></div>
        </dl>
        <div class="prod-actions">
          <a class="btn btn-secondary btn-sm" href="industries/${escapeHtml(industry.slug)}">See products and results</a>
          <a class="btn btn-primary btn-sm" href="${contactHref(industry, "audit", "contact")}" data-industry-discovery-cta>Plan my first test</a>
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
          <span class="eyebrow">Find your fit</span>
          <h2>Start with your team or cleaning job.</h2>
          <p class="subhead">Choose what you do or what you need to clean. We will show the best VertKleen starting products, relevant results, and a clear next step.</p>
          <p class="industry-discovery-status" data-industry-discovery-status aria-live="polite">Choose your role or cleaning job.</p>
          <button class="btn btn-ghost btn-sm" type="button" data-industry-discovery-clear hidden>Clear filters</button>
        </div>
        <div class="industry-discovery-controls">
          <div>
            <span class="eyebrow">Your role</span>
            <div class="route-grid">
              ${roleCards}
            </div>
          </div>
          <div>
            <span class="eyebrow">Cleaning job</span>
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
        <li><span>Start with</span><strong>${escapeHtml(industry.method)}</strong></li>
        <li><span>Products</span><strong>${renderProducts(industry)}</strong></li>
        <li><span>HMIS</span><strong>0-0-0 across every VertKleen product offered</strong></li>
        <li><a href="#applications-and-proof">See products, first-test plan, and results <span aria-hidden="true">↓</span></a></li>
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

function renderTrialBrief(industry) {
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
    return `<tr><th scope="row">${escapeHtml(material)}</th><td>Test a small, hidden area first and make sure the finish looks right.</td></tr>`;
  }).join("\n              ");
  return `
      <section class="ind-scope-note ind-trial-brief" data-industry-trial-brief aria-labelledby="industry-trial-brief-title">
        <div class="ind-trial-head">
          <div>
            <span class="eyebrow">Start with one job</span>
            <h3 id="industry-trial-brief-title">${escapeHtml(industry.label)}: let one real job decide.</h3>
            <p>Put VertKleen beside the cleaner you use today. Compare the finished result, time, water, and repeat work before making a wider switch.</p>
          </div>
          <span class="ind-trial-status">${escapeHtml(evidenceStatusLabel(industry))}</span>
        </div>
        <div class="ind-trial-grid">
          <div>
            <h4>Check the surface</h4>
            <div class="ind-trial-table-wrap">
              <table class="ind-trial-table">
                <caption>Surfaces and materials to check first</caption>
                <thead><tr><th scope="col">Surface or material</th><th scope="col">First check</th></tr></thead>
                <tbody>
              ${compatibilityRows}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h4>Run a fair side-by-side</h4>
            <ol class="ind-trial-steps">
              <li><h5>Choose one real job</h5><p>Clean ${escapeHtml(industry.asset)}. Target ${escapeHtml(industry.soil)}. Take a before photo and note how long the job usually takes.</p></li>
              <li><h5>Check the surface</h5><p>Start with a small, easy-to-compare area and make sure the finish looks right.</p></li>
              <li><h5>Clean both areas</h5><p>Use the same crew, tools, area size, and working time for VertKleen and the cleaner you use today.</p></li>
              <li><h5>Count the whole job</h5><p>Compare the finished surface, crew time, product, water, passes, downtime, and repeat work.</p></li>
            </ol>
          </div>
        </div>
        <aside class="ind-trial-action" aria-label="Side-by-side test next step">
          <strong>Let the result decide</strong>
          <p>Put VertKleen beside the current cleaner on one real job and compare the finish, time, water, and total cost.</p>
          <a class="btn btn-secondary" href="${contactHref(industry, "sample")}">Plan my first test</a>
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
        <span class="eyebrow">Built for your work</span>
        <h3>${escapeHtml(industry.buyer)}</h3>
        <p>This page focuses on the cleaning jobs, products, and results most useful to your operation.</p>
        <p class="ind-related">See the broader industry: <a href="./${escapeHtml(parent.slug)}">${escapeHtml(parent.label)}</a></p>
      </aside>`
    : children.length
      ? `
      <aside class="ind-scope-note" data-specialized-routes>
        <span class="eyebrow">Need a more specific fit?</span>
        <h3>Choose your operation.</h3>
        <p class="ind-related">${children.map((child) => (
          `<a href="./${escapeHtml(child.slug)}">${escapeHtml(child.label)}</a>`
        )).join(" · ")}</p>
      </aside>`
      : "";
  const caseSummary = industry.case_summary
    ? renderCaseSummary(industry)
    : "";
  const documentLinks = documents.map((document) => {
    const control = document.control;
    const metadata = `${control.document_id} · Rev ${documentRevision} · SKUs: ${control.skus.join(", ")}`;
    const common = `data-document-id="${escapeHtml(control.document_id)}" data-document-revision="${escapeHtml(documentRevision)}" data-document-skus="${escapeHtml(control.skus.join(" "))}" data-document-name="${escapeHtml(document.label)}"`;
    if (documentSurfaceMode(control, "industry") === "request") {
      return `<button class="doc-chip doc-request-button" type="button" data-document-request ${common} aria-label="Register to request ${escapeHtml(document.label)}"><span class="doc-title">${escapeHtml(document.label)}</span><span class="doc-control">${escapeHtml(metadata)}</span><span class="doc-request-state" data-document-request-label>Register to request</span></button>`;
    }
    return `<a class="doc-chip" href="../${escapeHtml(document.file)}" ${common} data-document-download target="_blank" rel="noopener" download><span class="doc-title">${escapeHtml(document.label)}</span><span class="doc-control">${escapeHtml(metadata)}</span></a>`;
  }).join("\n            ");

  return `<section class="section section-slim ind-applications" id="applications-and-proof" data-industry-applications-proof>
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Where VertKleen fits</span>
        <h2 class="headline">${escapeHtml(industry.lead_task)}</h2>
      </div>${related}${caseSummary}
      <dl class="ind-proof-grid">
        <div><dt>Cleaning job</dt><dd>${escapeHtml(industry.lead_task)}</dd></div>
        <div><dt>Equipment and surfaces</dt><dd>${escapeHtml(industry.asset)}</dd></div>
        <div><dt>What needs to come off</dt><dd>${escapeHtml(industry.soil)}</dd></div>
        <div><dt>Products to start with</dt><dd>${renderProducts(industry)}</dd></div>
        <div><dt>How to clean</dt><dd>${escapeHtml(industry.method)}</dd></div>
        <div><dt>What to compare</dt><dd>Finished result, crew time, product, water, passes, downtime, and repeat work.</dd></div>
      </dl>${renderTrialBrief(industry)}
      <div class="ind-proof-docs">
        <div>
          <span class="eyebrow">Product files</span>
          <h3>Get the SDS, TDS, and product records your team needs.</h3>
        </div>
        <div class="doc-lib-links">
          ${documentLinks}
        </div>
      </div>
    </div>
  </section>`;
}

function renderCaseSummary(industry) {
  const summary = industry.case_summary;
  if (
    !summary.label?.trim()
    || !summary.description?.trim()
    || !/^proof#[a-z0-9-]+$/.test(summary.href || "")
  ) {
    throw new Error(`${industry.slug}: incomplete case summary`);
  }
  return `
      <aside class="ind-scope-note ind-case-summary" data-industry-case-summary>
        <span class="eyebrow">Case result</span>
        <h3>${escapeHtml(summary.label)}</h3>
        <p>${escapeHtml(summary.description)}</p>
        <a class="proof-summary-link" href="../${escapeHtml(summary.href)}">Open case summary</a>
      </aside>`;
}

function renderCta(industry) {
  return `<section class="block-dark" data-industry-local-cta>
    <div class="wrap cta-band">
      <div class="section-head center">
        <span class="eyebrow">Start with one job</span>
        <h2 class="headline">See what VertKleen can do on your next ${escapeHtml(industry.label)} cleaning job.</h2>
      </div>
      <div class="hero-ctas">
        <a class="btn btn-light" href="${contactHref(industry, industry.cta_type)}" data-industry-primary-cta>${escapeHtml(industry.cta_label)}</a>
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
