#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { STYLE_VERSION } from "./static-release.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "comparisons");
const BASE = "https://masest.co";

const html = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const pages = [
  {
    slug: "vertkleen-hcr-vs-clr",
    title: "VertKleen HCR vs CLR",
    seoTitle: "VertKleen HCR vs CLR: Industrial Descaling",
    description: "Compare industrial HCR descaling with CLR by deposit load, carbonate chemistry, circulation, crew burden, and completed-system cost.",
    eyebrow: "Acid replacement comparison",
    h1: "Industrial VertKleen descaling vs light-duty acid cleaning.",
    subhead: "Compare deposit load, circulation, concentration, equipment scale, crew burden, and completed-system cost.",
    product: "VertKleen HCR",
    productHref: "../products/hcr",
    competitor: "CLR PRO MAX",
    vkPrices: [{ vsku: "VK-HCR-5G", tier: "retail", gallons: 5 }],
    marketMath: "$1,600-$1,800 / 55 gal = $29.09-$32.73/gal",
    priceNote: "Use current pack pricing as one input; dose, cycle, labor, water, wastewater, and downtime determine completed-system cost.",
    swapCurrent: "CLR / Calci-Solve",
    swapJob: "Rust, scale, calcium, and heat-transfer fouling",
    swapUse: "VertKleen HCR for heavy rust and scale; Descaler when the job is coil-specific line cleaning.",
    proofTitle: "Recorded rust-and-scale result",
    proof: "The HCR field record shows controlled mineral-removal chemistry releasing heavy rust and scale from metal to produce a visibly cleaner surface.",
    image: "../img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp",
    imageAlt: "VertKleen HVAC HCR and CLR PRO MAX Industrial Descaler containers side by side",
    ctaProduct: "VertKleen HCR vs CLR",
    ctaLabel: "Request an HCR deposit trial",
    decision: "Choose from the actual deposit and system, not the label category. Light spot cleaning and an industrial circulation job impose different demands on concentration, wetting, deposit capacity, rinse volume, and shutdown time."
  },
  {
    slug: "hcr-vs-rydlyme",
    title: "HCR vs RYDLYME",
    seoTitle: "HCR vs RYDLYME: System-Cost Guide",
    description: "Compare HCR and RYDLYME by mechanism, dose, cycle, rinse, equipment impact, crew experience, shutdown time, and completed-system cost.",
    eyebrow: "Green descaler comparison",
    h1: "Same descaling job. Different operating burden.",
    subhead: "Compare mineral-removal mechanism, dose, cycle, rinse, equipment impact, crew experience, and shutdown cost.",
    product: "VertKleen HCR",
    productHref: "../products/hcr",
    competitor: "RYDLYME",
    vkPrices: [{ vsku: "VK-HCR-5G", tier: "retail", gallons: 5 }],
    marketMath: "$170-$243 / 5 gal = $34.00-$48.60/gal",
    priceNote: "Current pack prices start the comparison; circulation dose, cycle, rinse, labor, wastewater, and shutdown finish it.",
    swapCurrent: "RYDLYME biodegradable descaler",
    swapJob: "Cooling tower, heat exchanger, and facility scale removal",
    swapUse: "VertKleen HCR for controlled carbonate-scale and rust removal with wetting, complexing, and inhibition.",
    proofTitle: "Recorded HVAC result",
    proof: "The HCR field record shows controlled mineral removal releasing heavy rust and scale from HVAC metal to produce a visibly cleaner surface.",
    image: "../img/blog/comparisons/hcr-vs-rydlyme-split.webp",
    imageAlt: "VertKleen HVAC HCR and RYDLYME descaler containers side by side",
    ctaProduct: "HCR vs RYDLYME",
    ctaLabel: "Request a side-by-side trial",
    decision: "Hold system volume, deposit, metallurgy, temperature, circulation, and endpoint constant. Then compare how much chemistry, crew time, rinse water, and shutdown each completed system requires."
  },
  {
    slug: "cr-hd-vs-simple-green",
    title: "CR HD vs Simple Green",
    seoTitle: "CR HD vs Simple Green: Task-Cost Guide",
    description: "Compare VertKleen CR HD against Simple Green for heavy degreasing with active-strength and per-gallon economics.",
    eyebrow: "Degreaser comparison",
    h1: "Industrial hydrocarbon soil vs general-purpose cleaning.",
    subhead: "Compare soil loading, wetting and lift, foam fit, passes, rinse, labor, and completed-task cost.",
    product: "VertKleen CR HD",
    productHref: "../products/crhd",
    competitor: "Simple Green Industrial",
    vkPrices: [{ vsku: "VK-CRHD-5G", tier: "retail", gallons: 5 }],
    marketMath: "$66-$184 / 5 gal = $13.20-$36.80/gal",
    priceNote: "Pack price matters; active dose, passes, rinse water, labor, wastewater, and downtime decide completed-task cost.",
    swapCurrent: "Simple Green / Zep / butyl degreasers",
    swapJob: "Heavy-duty degreasing",
    swapUse: "VertKleen CR HD for warehouse floors, forklifts, kitchens, drains, parts, and heavy oil.",
    proofTitle: "Build the comparison around your task",
    proof: "Send the current cleaner, soil load, dilution, passes, labor, water, downtime, and volume. MASEST will build a side-by-side benchmark with cost per completed task.",
    proofHref: "../contact?type=audit&product=CR%20HD%20vs%20Simple%20Green",
    proofCta: "Request task comparison",
    image: "../img/comparisons/cr-hd-vs-simple-green-split.webp",
    imageAlt: "VertKleen CR HD and Simple Green Industrial cleaner containers side by side",
    ctaProduct: "CR HD vs Simple Green",
    ctaLabel: "Request a CRHD benchmark",
    decision: "Heavy hydrocarbon loading can exhaust a general-purpose wash before the surface is complete. Compare equal soil areas and record dilution, agitation, passes, rinse demand, labor, and visible residue."
  },
  {
    slug: "lam3-vs-wet-forget",
    title: "LAM3 vs Wet & Forget",
    seoTitle: "LAM3 vs Wet & Forget: Finished-Area Guide",
    description: "Compare VertKleen LAM3 against Wet & Forget for moss, algae, mold, mildew, and exterior stain removal.",
    eyebrow: "Exterior stain comparison",
    h1: "Compare the finished area, labor, and maintenance cycle.",
    subhead: "Compare wetting, dwell, visible-stain result, coverage, surface experience, and cost per treated area.",
    product: "VertKleen LAM3",
    productHref: "../products/lam3",
    competitor: "Wet & Forget",
    vkPrices: [{ vsku: "VK-LAM3-5G", tier: "retail", gallons: 5 }],
    marketMath: "$34.00/gal",
    priceNote: "Use pack price with coverage, application time, repeat visits, water, cleanup, and maintenance interval to compare finished-area cost.",
    swapCurrent: "Wet & Forget / bleach roof cleaners",
    swapJob: "Exterior moss, algae, mold, mildew, lichen, and stain removal",
    swapUse: "VertKleen LAM3 for spray-and-walk-away exterior biological staining.",
    proofTitle: "Recorded exterior result",
    proof: "Before-and-after property records show CR and LAM3 lifting embedded soil, biological buildup, and grout staining to leave visibly cleaner hardscape.",
    image: "../img/blog/comparisons/lam3-vs-wet-forget-split.webp",
    imageAlt: "VertKleen LAM3 and Wet and Forget Outdoor Concentrate containers side by side",
    ctaProduct: "LAM3 vs Wet & Forget",
    ctaLabel: "Request exterior-treatment pricing",
    decision: "Exterior programs should be judged by finished area, not concentrate price. Keep substrate, stain, weather, application method, dwell, runoff control, and inspection interval consistent."
  },
  {
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer line cleaner cost comparison",
    seoTitle: "VertKleen Brewery CIP: Full-Cycle Cost Guide",
    description: "Compare brewery CIP cleaner economics using VertKleen CR and HCR against beer-line cleaner pricing.",
    eyebrow: "Brewery CIP comparison",
    h1: "Two soil classes. Two targeted chemistries. One cleaner cycle.",
    subhead: "CR lifts organic soil; HCR removes beer stone and mineral scale. Compare the full CIP cycle, not one gallon.",
    product: "VertKleen CR + HCR",
    productHref: "../pricing-cip-food-beverage",
    competitor: "Micro Matic beer-line cleaner",
    vkPrices: [
      { label: "CR", vsku: "VK-CR-2.5G", tier: "hvac", gallons: 2.5 },
      { label: "HCR", vsku: "VK-HCR-2.5G", tier: "hvac", gallons: 2.5 },
    ],
    marketMath: "$38.85/gal",
    priceNote: "Compare chemistry dose with cycle time, rinses, labor, water, wastewater, downtime, and return-to-production.",
    swapCurrent: "Caustic soda + brewing acid blends",
    swapJob: "Beer line, tank, mash tank, and heat-exchanger CIP/SIP",
    swapUse: "VertKleen CR for alkaline wash followed by VertKleen HCR for acid wash.",
    proofTitle: "Recorded brewery cycle",
    proof: "Brewlando Brewing trial and laboratory records show CR and HCR replacing incumbent caustic-soda and acid blends across brewery CIP.",
    image: "../img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp",
    imageAlt: "VertKleen CIP CR and CIP HCR beside Micro Matic Alkaline Beer Line Cleaner",
    ctaProduct: "beer line cleaner cost comparison",
    ctaLabel: "Request brewery-cycle pricing",
    decision: "Organic soil and mineral beer stone are different cleaning jobs. Compare a complete alkaline and mineral-removal sequence with the incumbent cycle, using the same circuit, temperature, soil condition, rinse endpoint, and production-release requirement."
  }
];

const IMAGE_DIMENSIONS = {
  "../img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp": [1448, 1086],
  "../img/blog/comparisons/hcr-vs-rydlyme-split.webp": [1448, 1086],
  "../img/comparisons/cr-hd-vs-simple-green-split.webp": [1086, 1448],
  "../img/blog/comparisons/lam3-vs-wet-forget-split.webp": [1448, 1086],
  "../img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp": [1448, 1086],
};

function schema(page) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: page.seoTitle,
        url: `${BASE}/comparisons/${page.slug}`,
        description: page.description
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${BASE}/` },
          { "@type": "ListItem", position: 2, name: "Comparisons", item: `${BASE}/comparisons/${page.slug}` },
          { "@type": "ListItem", position: 3, name: page.title, item: `${BASE}/comparisons/${page.slug}` }
        ]
      }
    ]
  };
}

function priceBinding({ vsku, tier }, field) {
  return `<span data-price-vsku="${html(vsku)}" data-price-tier="${html(tier)}" data-price-field="${field}"></span>`;
}

function vertKleenMath(page) {
  return page.vkPrices.map((price) => {
    const prefix = price.label ? `${html(price.label)}: ` : "";
    return `${prefix}${priceBinding(price, "unit")} / ${html(price.gallons)} gal = ${priceBinding(price, "per_gallon")}`;
  }).join("; ");
}

function pageHtml(page) {
  const [imageWidth, imageHeight] = IMAGE_DIMENSIONS[page.image] || [1200, 900];
  const quoteHref = `../contact?type=quote&product=${encodeURIComponent(page.ctaProduct)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${html(page.seoTitle)} | MASEST VertKleen</title>
<meta name="description" content="${html(page.description)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=20260713a">
<link rel="stylesheet" href="../css/components.css?v=20260619b">
<meta property="og:title" content="${html(page.seoTitle)} | MASEST VertKleen">
<meta property="og:description" content="${html(page.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<script type="application/ld+json">${JSON.stringify(schema(page))}</script>
<!-- seo:auto -->
<link rel="canonical" href="${BASE}/comparisons/${page.slug}">
<meta property="og:url" content="${BASE}/comparisons/${page.slug}">
<meta property="og:image" content="${BASE}/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<!-- /seo:auto -->
</head>
<body class="site-soft-bg comparison-page">
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
        <span class="eyebrow">${html(page.eyebrow)}</span>
        <h1 class="display">${html(page.h1)}</h1>
        <p class="subhead">${html(page.subhead)}</p>
        <div class="hero-actions">
          <a class="btn btn-primary" href="${quoteHref}">${html(page.ctaLabel)}</a>
          <a class="btn btn-secondary" href="${page.productHref}">View ${html(page.product)}</a>
        </div>
      </div>
      <figure class="product-hero-media reveal">
        <img src="${page.image}" alt="${html(page.imageAlt)}" width="${imageWidth}" height="${imageHeight}" fetchpriority="high" decoding="async">
      </figure>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap product-static-grid">
      <article class="product-static-panel">
        <h2>${html(page.product)} vs ${html(page.competitor)}</h2>
        <div class="table-scroll">
          <table class="cmp-table">
            <thead><tr><th scope="col">Line</th><th scope="col">Pack math</th><th scope="col">Per gallon</th></tr></thead>
            <tbody>
              <tr><td class="job">${html(page.product)}</td><td>${vertKleenMath(page)}</td><td><strong>${priceBinding(page.vkPrices[0], "per_gallon")}</strong></td></tr>
              <tr><td class="job">${html(page.competitor)}</td><td>${html(page.marketMath)}</td><td><strong>${html(page.marketMath.match(/\$[0-9.,]+(?:-\$[0-9.,]+)?\/gal/)?.[0] || page.marketMath)}</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p class="product-data-note">${html(page.priceNote)}</p>
      </article>

      <article class="product-static-panel">
        <h2>${html(page.proofTitle)}</h2>
        <p>${html(page.proof)}</p>
        <a class="btn btn-ink" href="${page.proofHref || "../proof"}">${html(page.proofCta || "See proof library")}</a>
      </article>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <h2 class="headline">How this maps inside the product finder.</h2>
      </div>
      <div class="table-scroll">
        <table class="cmp-table comparison-swap-table">
          <thead><tr><th scope="col">Replace</th><th scope="col">For</th><th scope="col">Use</th></tr></thead>
          <tbody>
            <tr><td class="job">${html(page.swapCurrent)}</td><td>${html(page.swapJob)}</td><td><strong>${html(page.swapUse)}</strong></td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Controlled comparison</span>
        <h2 class="headline">Run one fair side-by-side.</h2>
        <p class="subhead">${html(page.decision)}</p>
      </div>
      <div class="product-static-grid">
        <article class="product-static-panel">
          <h3>Hold the job constant</h3>
          <ol class="comparison-trial-list">
            <li><b>Document the baseline.</b> Record asset, substrate, soil or deposit, current product, concentration, temperature, contact time, agitation, passes, rinse water, crew time, and shutdown.</li>
            <li><b>Define the endpoint.</b> Agree on visible residue, flow or heat-transfer recovery, rinse condition, surface condition, and return-to-service requirement before either product is applied.</li>
            <li><b>Test equal areas or circuits.</b> Use the current label, the exact VertKleen product directions, the same operating window, and the same inspection method.</li>
            <li><b>Price the completed result.</b> Add chemistry, labor, water, wastewater handling, equipment time, repeat passes, and production interruption.</li>
          </ol>
        </article>
        <article class="product-static-panel">
          <h3>VertKleen operating profile</h3>
          <p>Current VertKleen documentation records HMIS 0-0-0 and shipping without hazardous-material freight requirements. Routine use does not require special ventilation or area clearance.</p>
          <p>Eye or skin contact may be mildly irritating; documentation records no chemical-burn or permanent-damage risk. Use the current product label and SDS for the exact SKU, concentration, task, and site procedure.</p>
          <a class="btn btn-secondary" href="../resources">Review methods and product files</a>
        </article>
      </div>
    </div>
  </section>

  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="comparisons/${page.slug}" data-cms-region="body"></div>

  <section class="block-dark">
    <div class="wrap">
      <div class="section-head center">
        <h2 class="headline">Compare the whole completed task.</h2>
        <p class="subhead">Send current chemistry, dose, cycle, labor, water, wastewater, downtime, and finished result.</p>
        <a class="btn btn-light" href="${quoteHref}">${html(page.ctaLabel)}</a>
      </div>
    </div>
  </section>
</main>

<script type="module" src="../js/main.js?v=20260730a"></script>
<script src="../js/track.js" defer></script>
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
for (const page of pages) {
  writeFileSync(resolve(OUT, `${page.slug}.html`), pageHtml(page), "utf8");
  console.log(`wrote comparisons/${page.slug}.html`);
}
console.log(`OK ${pages.length} comparison pages -> ${OUT}`);
