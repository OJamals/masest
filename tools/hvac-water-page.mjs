import { readFileSync } from "node:fs";
import { PRODUCTS } from "../js/main/catalog-data.js";
import { industryProductGrid } from "./industry-product-grid.mjs";

export const waterGuides = JSON.parse(readFileSync(new URL("../data/hvac-water-guides.json", import.meta.url), "utf8"));
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const productLink = (id) => {
  const product = PRODUCTS[id];
  if (!product) throw new Error(`Unknown guide product: ${id}`);
  return `<a href="../products/${id}">${escapeHtml(product.name)}</a>`;
};
const requestHref = (task, type = "audit") => `../contact?type=${type}&amp;industry=HVAC%20%26%20Water%20Systems&amp;message=${encodeURIComponent(`Task: ${task}\nEquipment/materials:\nSystem volume:\nBuildup/water analysis:\nAvailable shutdown window:\nCurrent method:\nDesired result:`)}`;

export function renderWaterGuides() {
  return waterGuides.guides.map((guide) => `<details class="system-guide" id="${guide.id}">
    <summary><span><strong>${escapeHtml(guide.title)}</strong><small>${escapeHtml(guide.summary)}</small></span><span class="guide-toggle" aria-hidden="true">+</span></summary>
    <div class="system-guide-body">
      <p class="guide-products"><b>Product starting points:</b> ${guide.products.map(productLink).join(" · ")}</p>
      <h4>Before you start</h4><p>${escapeHtml(guide.prepare)}</p>
      ${guide.id === "recirculation" ? '<div class="circulation-route" aria-label="Temporary cleaning circuit: reservoir to pump to isolated asset to contained return"><span>Reservoir</span><b aria-hidden="true">→</b><span>Pump</span><b aria-hidden="true">→</b><span>Isolated asset</span><b aria-hidden="true">→</b><span>Contained return</span></div>' : ""}
      <ol>${guide.steps.map((step) => `<li><b>${escapeHtml(step.title)}</b><p>${escapeHtml(step.detail)}</p></li>`).join("")}</ol>
      <div class="guide-stop"><h4>Stop and reassess</h4><p>${escapeHtml(guide.stop)}</p></div>
      <h4>Record the result</h4><p>${escapeHtml(guide.record)}</p>
      <a class="btn btn-secondary" href="${requestHref(guide.title)}">Scope this method with MASEST</a>
    </div>
  </details>`).join("\n");
}

export function renderHvacWaterHub(industry, gallery = "") {
  return `<section class="page-hero page-hero-scene">
    <div class="wrap page-hero-scene-grid"><div class="page-hero-scene-copy">
      <span class="eyebrow">HVAC &amp; Water Systems</span>
      <h1 class="display">Clean equipment. Keep water systems running.</h1>
      <p class="subhead">${escapeHtml(industry.sub)}</p>
      <div class="hero-ctas"><a class="btn btn-primary" data-system-primary-cta href="${requestHref("HVAC or water-system support")}">Plan my system work</a><a class="btn btn-ghost" href="#how-to">Read the how-tos</a></div>
    </div><figure class="page-hero-scene-media"><img src="../img/site/scenes/water-treatment-program.webp" alt="Cooling-tower monitoring and water-treatment equipment" width="1200" height="800" fetchpriority="high" decoding="async"></figure></div>
  </section>
  <nav class="system-jumps wrap" aria-label="On this page"><a href="#choose-job">Choose a job</a><a href="#how-to">How-tos</a><a href="#products-for-this-industry">Products</a><a href="#water-treatment">Service levels</a><a href="#system-support">Technical support</a></nav>
  <section class="section-slim" id="choose-job"><div class="wrap">
    <div class="section-head"><span class="eyebrow">Start with the job</span><h2 class="headline">Three jobs. Three different methods.</h2></div>
    <div class="system-job-grid">
      <article><span class="eyebrow">01 · Surface cleaning</span><h3>Coils, pans, and drains</h3><p>Match grease and organic soils to HVAC CR; review HVAC HCR for compatible mineral deposits.</p><a href="#surface-cleaning">Surface-cleaning steps →</a></article>
      <article><span class="eyebrow">02 · Planned cleanout</span><h3>Scale in an isolated system</h3><p>Review HVAC HCR or Descaler for exchangers and water-side loops. Confirm materials, volume, circulation, and rinse acceptance first.</p><a href="#recirculation">Recirculation and descaling steps →</a></article>
      <article><span class="eyebrow">03 · Ongoing treatment</span><h3>Scale and corrosion control</h3><p>Build WaterSafe60 feed and monitoring around actual water chemistry and a site-specific treatment plan.</p><a href="#ongoing-treatment">Treatment setup steps →</a></article>
    </div>
  </div></section>
  <section class="section-slim" id="how-to"><div class="wrap">
    <div class="section-head u-measure"><span class="eyebrow">Field preparation</span><h2 class="headline">A practical sequence for each job.</h2><p>Use these planning steps with the current supplied label, SDS, equipment instructions, and approved site method. Confirm concentration, temperature, contact time, and acceptance limits before chemical work.</p></div>
    ${renderWaterGuides()}
    <p class="system-source-links">Further guidance: ${waterGuides.sources.map((s) => `<a href="${escapeHtml(s.url)}">${escapeHtml(s.label)}</a>`).join(" · ")}.</p>
  </div></section>
  <section class="section-slim"><div class="wrap"><details class="resource-disclosure system-technical">
    <summary><span><strong>Technical scope, documents, and field examples</strong></span><b>Review details</b></summary>
    <div class="resource-disclosure-body"><!-- industry:applications:start --><!-- industry:applications:end -->${gallery}</div>
  </details></div></section>
  <section class="section-slim" id="products-for-this-industry"><div class="wrap">
    <div class="section-head"><span class="eyebrow">Choose the product after the method</span><h2 class="headline">Products for HVAC and water-system work.</h2><p>Match the product to the buildup, materials, and approved method. Review application guidance and current documents before selecting it.</p></div>
    ${industryProductGrid(industry.products)}
    <p class="system-related"><a href="../pricing-hvac-facilities">HVAC pack pricing</a> · <a href="../resources">Labels and document requests</a> · <a href="../programs#heat-transfer-fluids">Glycol supply support</a></p>
  </div></section>
  <section class="section-slim" id="water-treatment"><div class="wrap">
    <div class="section-head u-measure"><span class="eyebrow">Water-treatment programs</span><h2 class="headline">Compare the scope, then price your site.</h2><p>Four service levels cover different visit and support needs. Product selection and dose depend on the water analysis, system, and approved treatment plan.</p></div>
    <div class="system-plan-grid" data-water-programs></div>
    <p data-water-program-status role="status">Request current service levels and a site-specific quote.</p>
    <p>Final scope, price, equipment ownership, renewal, response coverage, and exclusions are confirmed in your proposal.</p>
    <a class="btn btn-primary" href="${requestHref("Water-treatment service-level comparison", "program")}">Scope my water-treatment program</a>
  </div></section>
  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="industries/hvac-water" data-cms-region="body"></div>
  <section class="section-slim" id="system-support"><div class="wrap">
    <div class="section-head"><span class="eyebrow">When the job needs more than a product</span><h2 class="headline">Bring the system details. Leave with a clear next step.</h2></div>
    <div class="system-job-grid">
<article><h3>Water analysis and plan support</h3><p>Choose testing, field review, or water-management services to define chemistry and acceptance criteria.</p><a href="../services#service-lab-testing-water-analysis">Testing &amp; Technical Services →</a></article>
      <article><h3>Contractor setup and handoff</h3><p>Plan temporary circulation equipment, method documentation, rinse acceptance, commissioning, and owner handoff.</p><a href="mechanical-contractors-water-treatment">Contractor workflow →</a></article>
      <article><h3>Supply and crew training</h3><p>Coordinate pilot, approved work instructions, pack sizes, replenishment, and training across crews and sites.</p><a href="../programs">Chemical Programs →</a></article>
    </div>
  </div></section>`;
}
