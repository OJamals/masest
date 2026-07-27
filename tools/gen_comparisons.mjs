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
    title: "VertKlean HCR vs CLR",
    description: "Compare industrial HCR descaling with CLR by deposit load, carbonate chemistry, circulation, crew burden, and completed-system cost.",
    eyebrow: "Acid replacement comparison",
    h1: "Industrial VertKlean descaling vs light-duty acid cleaning.",
    subhead: "Compare deposit load, circulation, concentration, equipment scale, crew burden, and completed-system cost.",
    product: "VertKlean HCR",
    productHref: "../products/hcr",
    competitor: "CLR PRO MAX",
    vkMath: "$108.15 / 5 gal = $21.63/gal",
    marketMath: "$1,600-$1,800 / 55 gal = $29.09-$32.73/gal",
    priceNote: "Use current pack pricing as one input; dose, cycle, labor, water, wastewater, and downtime determine completed-system cost.",
    swapCurrent: "CLR / Calci-Solve",
    swapJob: "Rust, scale, calcium, and heat-transfer fouling",
    swapUse: "VertKlean HCR for heavy rust and scale; Descaler when the job is coil-specific line cleaning.",
    proofTitle: "Recorded rust-and-scale result",
    proof: "The HCR field record shows controlled mineral-removal chemistry releasing heavy rust and scale from metal to produce a visibly cleaner surface.",
    image: "../img/proof/cases/ddc-rust.webp",
    imageAlt: "Rust removed from equipment with VertKlean HCR",
    ctaProduct: "VertKlean HCR vs CLR",
    ctaLabel: "Request an HCR deposit trial"
  },
  {
    slug: "hcr-vs-rydlyme",
    title: "HCR vs RYDLYME",
    description: "Compare HCR and RYDLYME by mechanism, dose, cycle, rinse, equipment impact, crew experience, shutdown time, and completed-system cost.",
    eyebrow: "Green descaler comparison",
    h1: "Same descaling job. Different operating burden.",
    subhead: "Compare mineral-removal mechanism, dose, cycle, rinse, equipment impact, crew experience, and shutdown cost.",
    product: "VertKlean HCR",
    productHref: "../products/hcr",
    competitor: "RYDLYME",
    vkMath: "$108.15 / 5 gal = $21.63/gal",
    marketMath: "$170-$243 / 5 gal = $34.00-$48.60/gal",
    priceNote: "Current pack prices start the comparison; circulation dose, cycle, rinse, labor, wastewater, and shutdown finish it.",
    swapCurrent: "RYDLYME biodegradable descaler",
    swapJob: "Cooling tower, heat exchanger, and facility scale removal",
    swapUse: "VertKlean HCR for controlled carbonate-scale and rust removal with wetting, complexing, and inhibition.",
    proofTitle: "Recorded HVAC result",
    proof: "The HCR field record shows controlled mineral removal releasing heavy rust and scale from HVAC metal to produce a visibly cleaner surface.",
    image: "../img/proof/cases/farm-rust-after.webp",
    imageAlt: "Industrial rust and scale removed with VertKlean HCR",
    ctaProduct: "HCR vs RYDLYME",
    ctaLabel: "Request a side-by-side trial"
  },
  {
    slug: "cr-hd-vs-simple-green",
    title: "CR HD vs Simple Green",
    description: "Compare VertKlean CR HD against Simple Green for heavy degreasing with active-strength and per-gallon economics.",
    eyebrow: "Degreaser comparison",
    h1: "Industrial hydrocarbon soil vs general-purpose cleaning.",
    subhead: "Compare soil loading, wetting and lift, foam fit, passes, rinse, labor, and completed-task cost.",
    product: "VertKlean CR HD",
    productHref: "../products/crhd",
    competitor: "Simple Green Industrial",
    vkMath: "$53.03 / 5 gal = $10.61/gal",
    marketMath: "$66-$184 / 5 gal = $13.20-$36.80/gal",
    priceNote: "Pack price matters; active dose, passes, rinse water, labor, wastewater, and downtime decide completed-task cost.",
    swapCurrent: "Simple Green / Zep / butyl degreasers",
    swapJob: "Heavy-duty degreasing",
    swapUse: "VertKlean CR HD for warehouse floors, forklifts, kitchens, drains, parts, and heavy oil.",
    proofTitle: "Build the comparison around your task",
    proof: "Send the current cleaner, soil load, dilution, passes, labor, water, downtime, and volume. MASEST will build a side-by-side benchmark with cost per completed task.",
    proofHref: "../contact?type=audit&product=CR%20HD%20vs%20Simple%20Green",
    proofCta: "Request task comparison",
    image: "../img/products/crhd-studio.webp",
    imageAlt: "VertKlean CR HD heavy degreaser container",
    ctaProduct: "CR HD vs Simple Green",
    ctaLabel: "Request a CRHD benchmark"
  },
  {
    slug: "lam3-vs-wet-forget",
    title: "LAM3 vs Wet & Forget",
    description: "Compare VertKlean LAM3 against Wet & Forget for moss, algae, mold, mildew, and exterior stain removal.",
    eyebrow: "Exterior stain comparison",
    h1: "Compare the finished area, labor, and maintenance cycle.",
    subhead: "Compare wetting, dwell, visible-stain result, coverage, surface experience, and cost per treated area.",
    product: "VertKlean LAM3",
    productHref: "../products/lam3",
    competitor: "Wet & Forget",
    vkMath: "$111.03 / 5 gal = $22.21/gal",
    marketMath: "$34.00/gal",
    priceNote: "Use pack price with coverage, application time, repeat visits, water, cleanup, and maintenance interval to compare finished-area cost.",
    swapCurrent: "Wet & Forget / bleach roof cleaners",
    swapJob: "Exterior moss, algae, mold, mildew, lichen, and stain removal",
    swapUse: "VertKlean LAM3 for spray-and-walk-away exterior biological staining.",
    proofTitle: "Recorded exterior result",
    proof: "Before-and-after property records show CR and LAM3 lifting embedded soil, biological buildup, and grout staining to leave visibly cleaner hardscape.",
    image: "../img/proof/cases/grout-moss.webp",
    imageAlt: "Exterior grout and moss staining cleaned with VertKlean",
    ctaProduct: "LAM3 vs Wet & Forget",
    ctaLabel: "Request exterior-treatment pricing"
  },
  {
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer line cleaner cost comparison",
    description: "Compare brewery CIP cleaner economics using VertKlean CR and HCR against beer-line cleaner pricing.",
    eyebrow: "Brewery CIP comparison",
    h1: "Two soil classes. Two targeted chemistries. One cleaner cycle.",
    subhead: "CR lifts organic soil; HCR removes beer stone and mineral scale. Compare the full CIP cycle, not one gallon.",
    product: "VertKlean CR + HCR",
    productHref: "../pricing-cip-food-beverage",
    competitor: "Micro Matic beer-line cleaner",
    vkMath: "CR: $55.05 / 2.5 gal = $22.02/gal; HCR: $61.80 / 2.5 gal = $24.72/gal",
    marketMath: "$38.85/gal",
    priceNote: "Compare chemistry dose with cycle time, rinses, labor, water, wastewater, downtime, and return-to-production.",
    swapCurrent: "Caustic soda + brewing acid blends",
    swapJob: "Beer line, tank, mash tank, and heat-exchanger CIP/SIP",
    swapUse: "VertKlean CR for alkaline wash followed by VertKlean HCR for acid wash.",
    proofTitle: "Recorded brewery cycle",
    proof: "Brewlando Brewing trial and laboratory records show CR and HCR replacing incumbent caustic-soda and acid blends across brewery CIP.",
    image: "../img/proof/cases/brewery.webp",
    imageAlt: "Brewery tank cleaned with VertKlean CR and HCR",
    ctaProduct: "beer line cleaner cost comparison",
    ctaLabel: "Request brewery-cycle pricing"
  }
];

const IMAGE_DIMENSIONS = {
  "../img/proof/cases/ddc-rust.webp": [1200, 579],
  "../img/proof/cases/farm-rust-after.webp": [740, 967],
  "../img/products/crhd-studio.webp": [900, 1200],
  "../img/proof/cases/grout-moss.webp": [919, 690],
  "../img/proof/cases/brewery.webp": [1200, 900],
};

function schema(page) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: page.title,
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

function pageHtml(page) {
  const [imageWidth, imageHeight] = IMAGE_DIMENSIONS[page.image] || [1200, 900];
  const quoteHref = `../contact?type=quote&product=${encodeURIComponent(page.ctaProduct)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${html(page.title)} | MASEST VertKlean</title>
<meta name="description" content="${html(page.description)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=20260713a">
<link rel="stylesheet" href="../css/components.css?v=20260619b">
<meta property="og:title" content="${html(page.title)} | MASEST VertKlean">
<meta property="og:description" content="${html(page.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKlean">
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
              <tr><td class="job">${html(page.product)}</td><td>${html(page.vkMath)}</td><td><strong>${html(page.vkMath.match(/\$[0-9.,]+\/gal/)?.[0] || "See math")}</strong></td></tr>
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

<script type="module" src="../js/main.js?v=20260726a"></script>
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
