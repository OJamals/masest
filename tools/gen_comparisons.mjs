#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENT_VERSION, MAIN_VERSION, NAVIGATION_VERSION, STYLE_VERSION } from "./static-release.mjs";

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
    seoTitle: "HCR vs CLR: Industrial Descaling",
    description: "Compare VertKleen HCR with CLR for rust, mineral scale, circulation cleaning, crew time, rinsing, and total job cost.",
    eyebrow: "Descaler comparison",
    h1: "VertKleen HCR vs CLR: which fits your descaling job?",
    subhead: "Compare the buildup, equipment, cleaning time, rinsing, handling, and total cost—not the jug price alone.",
    product: "VertKleen HCR",
    productHref: "../products/hcr-t16",
    competitor: "CLR PRO MAX",
    vkPrices: [{ vsku: "HCR-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$1,600-$1,800 / 55 gal = $29.09-$32.73/gal",
    priceNote: "Jug price is only the start. Mix, cleaning time, labor, water, repeat passes, and downtime decide what the whole job costs.",
    swapCurrent: "CLR / Calci-Solve",
    swapJob: "Rust, scale, calcium, and heat-transfer fouling",
    swapUse: "VertKleen HCR for heavy rust and scale; Descaler when the job is coil-specific line cleaning.",
    proofTitle: "See HCR on heavy rust and scale",
    proof: "A real HCR job shows heavy rust and mineral scale breaking free from metal and revealing a visibly cleaner surface.",
    image: "../img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp",
    imageAlt: "VertKleen HVAC HCR and CLR PRO MAX Industrial Descaler containers side by side",
    ctaProduct: "VertKleen HCR vs CLR",
    ctaLabel: "Try HCR on my buildup",
    decision: "A light spot and a scaled heat exchanger are very different jobs. Compare both products on the same buildup, surface, area, working time, and finished result."
  },
  {
    slug: "hcr-vs-rydlyme",
    title: "HCR vs RYDLYME",
    seoTitle: "HCR vs RYDLYME: System-Cost Guide",
    description: "Compare VertKleen HCR and RYDLYME by product use, cleaning time, rinsing, crew handling, downtime, and total descaling cost.",
    eyebrow: "Descaler comparison",
    h1: "VertKleen HCR vs RYDLYME on the same descaling job.",
    subhead: "Compare how much product, crew time, rinse water, and downtime each cleaner needs to deliver the result.",
    product: "VertKleen HCR",
    productHref: "../products/hcr-t16",
    competitor: "RYDLYME",
    vkPrices: [{ vsku: "HCR-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$170-$243 / 5 gal = $34.00-$48.60/gal",
    priceNote: "Current pack prices start the comparison; circulation dose, cycle, rinse, labor, wastewater, and shutdown finish it.",
    swapCurrent: "RYDLYME biodegradable descaler",
    swapJob: "Cooling tower, heat exchanger, and facility scale removal",
    swapUse: "VertKleen HCR for heavy mineral scale and rust in towers, heat exchangers, coils, and facility equipment.",
    proofTitle: "See HCR on HVAC metal",
    proof: "A real HVAC job shows HCR releasing heavy rust and scale and leaving the metal visibly cleaner.",
    image: "../img/blog/comparisons/hcr-vs-rydlyme-split.webp",
    imageAlt: "VertKleen HVAC HCR and RYDLYME descaler containers side by side",
    ctaProduct: "HCR vs RYDLYME",
    ctaLabel: "Plan a side-by-side test",
    decision: "Use the same equipment, buildup, temperature, circulation time, and finish target. Then compare product, crew time, rinse water, and downtime."
  },
  {
    slug: "cr-hd-vs-simple-green",
    title: "CR HD vs Simple Green",
    seoTitle: "CR HD vs Simple Green: Degreasers",
    description: "Compare VertKleen CR HD with Simple Green for heavy grease, repeat passes, rinsing, crew time, and total cleaning cost.",
    eyebrow: "Degreaser comparison",
    h1: "VertKleen CR HD vs Simple Green on heavy grease.",
    subhead: "Compare cleaning power, repeat passes, foam, rinsing, crew time, and what the finished job costs.",
    product: "VertKleen CR HD",
    productHref: "../products/crhd",
    competitor: "Simple Green Industrial",
    vkPrices: [{ vsku: "CRHD-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$66-$184 / 5 gal = $13.20-$36.80/gal",
    priceNote: "Pack price matters, but product use, repeat passes, water, labor, cleanup, and downtime decide the real cost.",
    swapCurrent: "Simple Green / Zep / butyl degreasers",
    swapJob: "Heavy-duty degreasing",
    swapUse: "VertKleen CR HD for warehouse floors, forklifts, kitchens, drains, parts, and heavy oil.",
    proofTitle: "Compare it on your hardest grease job",
    proof: "Tell us what you clean today, how much product and time it takes, and what a good finish looks like. We will help you set up a fair side-by-side test.",
    proofHref: "../contact?type=audit&product=CR%20HD%20vs%20Simple%20Green",
    proofCta: "Plan my comparison",
    image: "../img/comparisons/cr-hd-vs-simple-green-split.webp",
    imageAlt: "VertKleen CR HD and Simple Green Industrial cleaner containers side by side",
    ctaProduct: "CR HD vs Simple Green",
    ctaLabel: "Try CR HD on my grease job",
    decision: "A general cleaner may need repeat passes on heavy oil and grease. Clean equal areas, then compare product, brushing, passes, water, labor, and leftover film."
  },
  {
    slug: "lam3-vs-wet-forget",
    title: "LAM3 vs Wet & Forget",
    seoTitle: "LAM3 vs Wet & Forget: Finished-Area Guide",
    description: "Compare VertKleen LAM3 against Wet & Forget for moss, algae, mold, mildew, and exterior stain removal.",
    eyebrow: "Exterior stain comparison",
    h1: "Compare the finished area, labor, and maintenance cycle.",
    subhead: "Compare coverage, working time, visible stain removal, labor, repeat visits, and cost per finished area.",
    product: "VertKleen LAM3",
    productHref: "../products/lam3",
    competitor: "Wet & Forget",
    vkPrices: [{ vsku: "LAM3-25G", tier: "retail", gallons: 2.5 }],
    marketMath: "$34.00/gal",
    priceNote: "Compare pack price with coverage, application time, repeat visits, water, cleanup, and how long the result lasts.",
    swapCurrent: "Wet & Forget / bleach roof cleaners",
    swapJob: "Exterior moss, algae, mold, mildew, lichen, and stain removal",
    swapUse: "VertKleen LAM3 for spray-and-walk-away exterior biological staining.",
    proofTitle: "See a real exterior result",
    proof: "Before-and-after photos show CR and LAM3 lifting ground-in grime, outdoor growth, and dark grout stains from hardscape.",
    image: "../img/blog/comparisons/lam3-vs-wet-forget-split.webp",
    imageAlt: "VertKleen LAM3 and Wet and Forget Outdoor Concentrate containers side by side",
    ctaProduct: "LAM3 vs Wet & Forget",
    ctaLabel: "Price my exterior cleaning job",
    decision: "Judge the finished area, not the concentrate price. Use the same surface, stain, weather, application method, working time, and final inspection for both products."
  },
  {
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer line cleaner cost comparison",
    seoTitle: "Brewery CIP: Full-Cycle Cost Guide",
    description: "Compare a complete VertKleen CR and HCR brewery CIP cycle with beer-line cleaner pricing, labor, water, rinsing, and downtime.",
    eyebrow: "Brewery CIP comparison",
    h1: "Clean brewery organics first. Remove beer stone second.",
    subhead: "CR lifts yeast, protein, fat, and film. HCR removes beer stone, scale, and rust. Compare the full cleaning cycle, not one gallon.",
    product: "VertKleen CR + HCR",
    productHref: "../pricing-cip-food-beverage",
    competitor: "Micro Matic beer-line cleaner",
    vkPrices: [
      { label: "CR", vsku: "CRCIP-25G", tier: "retail", gallons: 2.5 },
      { label: "HCR", vsku: "HCRCIP-25G", tier: "retail", gallons: 2.5 },
    ],
    marketMath: "$38.85/gal",
    priceNote: "Compare product used with cycle time, rinses, labor, water, wastewater, downtime, and return-to-production.",
    swapCurrent: "Caustic soda + brewing acid blends",
    swapJob: "Beer line, tank, mash tank, and heat-exchanger CIP/SIP",
    swapUse: "VertKleen CR for alkaline wash followed by VertKleen HCR for acid wash.",
    proofTitle: "See the two-step brewery result",
    proof: "Brewlando Brewing field and lab results show CR and HCR replacing the caustic and acid steps in brewery CIP.",
    image: "../img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp",
    imageAlt: "VertKleen CIP CR and CIP HCR beside Micro Matic Alkaline Beer Line Cleaner",
    ctaProduct: "beer line cleaner cost comparison",
    ctaLabel: "Price my brewery cycle",
    decision: "Organic film and mineral beer stone need different cleaning steps. Compare the complete VertKleen cycle with your current process on the same circuit, temperature, buildup, rinse, and finish target."
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
<link rel="stylesheet" href="../css/navigation.css?v=${NAVIGATION_VERSION}">
<link rel="stylesheet" href="../css/components.css?v=${COMPONENT_VERSION}">
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
            <thead><tr><th scope="col">Product</th><th scope="col">Package price</th><th scope="col">Per gallon</th></tr></thead>
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
        <a class="btn btn-ink" href="${page.proofHref || "../proof"}">${html(page.proofCta || "See customer results")}</a>
      </article>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <h2 class="headline">Which product fits this job?</h2>
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
        <span class="eyebrow">Try them side by side</span>
        <h2 class="headline">Let one real cleaning job decide.</h2>
        <p class="subhead">${html(page.decision)}</p>
      </div>
      <div class="product-static-grid">
        <article class="product-static-panel">
          <h3>Keep the comparison fair</h3>
          <ol class="comparison-trial-list">
            <li><b>Take a before photo.</b> Note the surface, mess, cleaner, mix, tools, time, water, and downtime you use today.</li>
            <li><b>Agree on a good result.</b> Decide what clean looks like before either product touches the surface.</li>
            <li><b>Clean equal areas.</b> Give both products the same crew, tools, area, working time, and final check.</li>
            <li><b>Count the whole job.</b> Compare product, labor, water, repeat passes, downtime, and the finished result.</li>
          </ol>
        </article>
        <article class="product-static-panel">
          <h3>Before you start</h3>
          <p>Read the latest label and SDS for both cleaners. Try a small, hidden area first.</p>
          <p>Follow your workplace rules for PPE, ventilation, storage, surface care, and rinse water. Need help? MASEST can plan the first test with you.</p>
          <a class="btn btn-secondary" href="../resources">Get labels, SDS, and guides</a>
        </article>
      </div>
    </div>
  </section>

  <div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="comparisons/${page.slug}" data-cms-region="body"></div>

  <section class="block-dark">
    <div class="wrap">
      <div class="section-head center">
        <h2 class="headline">See what the whole job really costs.</h2>
        <p class="subhead">Send what you use now, how long the job takes, and what clean needs to look like. We will help you build a fair comparison.</p>
        <a class="btn btn-light" href="${quoteHref}">${html(page.ctaLabel)}</a>
      </div>
    </div>
  </section>
</main>

<script type="module" src="../js/main.js?v=${MAIN_VERSION}"></script>
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
