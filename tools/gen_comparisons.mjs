#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
    description: "Compare VertKleen HCR against CLR for rust, scale, and calcium removal with current per-gallon math and field proof.",
    eyebrow: "Acid replacement comparison",
    h1: "VertKleen HCR vs CLR.",
    subhead: "Use this page when the buyer knows CLR but the job is industrial rust, scale, or calcium.",
    product: "VertKleen HCR",
    productHref: "../products/hcr",
    competitor: "CLR PRO MAX",
    vkMath: "$108.15 / 5 gal = $21.63/gal",
    marketMath: "$1,600-$1,800 / 55 gal = $29.09-$32.73/gal",
    priceNote: "VertKleen HCR uses the confirmed Website Price List; CLR PRO MAX comes from the launch-spec competitive matrix scaled to drum volume.",
    swapCurrent: "CLR / Calci-Solve",
    swapJob: "Rust, scale, calcium, and heat-transfer fouling",
    swapUse: "VertKleen HCR for heavy rust and scale; Descaler when the job is coil-specific line cleaning.",
    proofTitle: "DDC Engineering proof point",
    proof: "DDC Engineering materials document CLR failing on rust and scale before VertKleen HCR cleared the same class of problem for review.",
    image: "../img/proof/cases/ddc-rust.webp",
    imageAlt: "Rust removed from equipment with VertKleen HCR",
    ctaProduct: "VertKleen HCR vs CLR"
  },
  {
    slug: "hcr-vs-rydlyme",
    title: "HCR vs RYDLYME",
    description: "Compare VertKleen HCR against RYDLYME for descaling with per-gallon math, replacement fit, and proof.",
    eyebrow: "Green descaler comparison",
    h1: "HCR vs RYDLYME.",
    subhead: "For buyers already considering a safer descaler, the pricing story is direct.",
    product: "VertKleen HCR",
    productHref: "../products/hcr",
    competitor: "RYDLYME",
    vkMath: "$108.15 / 5 gal = $21.63/gal",
    marketMath: "$170-$243 / 5 gal = $34.00-$48.60/gal",
    priceNote: "RYDLYME pricing comes from the launch-spec competitive matrix; HCR pricing uses the confirmed Website Price List.",
    swapCurrent: "RYDLYME biodegradable descaler",
    swapJob: "Cooling tower, heat exchanger, and facility scale removal",
    swapUse: "VertKleen HCR for acid-replacement scale work with HMIS 0-0-0 handling.",
    proofTitle: "DDC Engineering proof point",
    proof: "DDC Engineering reviewed HCR on heavy HVAC rust and scale; the result gives buyers a documented lower-hazard replacement case.",
    image: "../img/proof/cases/farm-rust.webp",
    imageAlt: "Industrial rust and scale removed with VertKleen HCR",
    ctaProduct: "HCR vs RYDLYME"
  },
  {
    slug: "cr-hd-vs-simple-green",
    title: "CR HD vs Simple Green",
    description: "Compare VertKleen CR HD against Simple Green for heavy degreasing with active-strength and per-gallon economics.",
    eyebrow: "Degreaser comparison",
    h1: "CR HD vs Simple Green.",
    subhead: "When Simple Green is familiar but too light for industrial grease, CR HD is the heavy-duty replacement.",
    product: "VertKleen CR HD",
    productHref: "../products/crhd",
    competitor: "Simple Green Industrial",
    vkMath: "$53.03 / 5 gal = $10.61/gal",
    marketMath: "$66-$184 / 5 gal = $13.20-$36.80/gal",
    priceNote: "CR HD pricing uses the current Website Price List. Simple Green Industrial pricing comes from the launch-spec competitor matrix.",
    swapCurrent: "Simple Green / Zep / butyl degreasers",
    swapJob: "Heavy-duty degreasing",
    swapUse: "VertKleen CR HD for warehouse floors, forklifts, kitchens, drains, parts, and heavy oil.",
    proofTitle: "Walmart distribution-center proof point",
    proof: "Walmart distribution-center materials document CR HD replacing Simple Green for heavy degreasing across DC-8851, DC-7023, and DC-6099.",
    image: "../img/proof/cases/walmart-dc-crhd.webp",
    imageAlt: "Walmart distribution center CR HD degreasing proof",
    ctaProduct: "CR HD vs Simple Green"
  },
  {
    slug: "lam3-vs-wet-forget",
    title: "LAM3 vs Wet & Forget",
    description: "Compare VertKleen LAM3 against Wet & Forget for moss, algae, mold, mildew, and exterior stain removal.",
    eyebrow: "Exterior stain comparison",
    h1: "LAM3 vs Wet & Forget.",
    subhead: "For soft-wash, property, drone-cleaning, and exterior maintenance buyers comparing cost and bulk availability.",
    product: "VertKleen LAM3",
    productHref: "../products/lam3",
    competitor: "Wet & Forget",
    vkMath: "$111.03 / 5 gal = $22.21/gal",
    marketMath: "$34.00/gal",
    priceNote: "LAM3 pricing uses the confirmed Website Price List. Wet & Forget pricing comes from the Industries & Lead Gen tab.",
    swapCurrent: "Wet & Forget / bleach roof cleaners",
    swapJob: "Exterior moss, algae, mold, mildew, lichen, and stain removal",
    swapUse: "VertKleen LAM3 for spray-and-walk-away exterior biological staining.",
    proofTitle: "Soft-wash lead-gen proof point",
    proof: "The lead-gen tab positions LAM3 at $22.21/gal against Wet & Forget at $34/gal, with drum sizes Wet & Forget buyers cannot easily get.",
    image: "../img/proof/cases/grout-moss.webp",
    imageAlt: "Exterior grout and moss staining cleaned with VertKleen",
    ctaProduct: "LAM3 vs Wet & Forget"
  },
  {
    slug: "beer-line-cleaner-cost-comparison",
    title: "Beer line cleaner cost comparison",
    description: "Compare brewery CIP cleaner economics using VertKleen CR and HCR against beer-line cleaner pricing.",
    eyebrow: "Brewery CIP comparison",
    h1: "Beer line cleaner cost comparison.",
    subhead: "For breweries, distilleries, wineries, and food plants comparing CIP cleaning cost and proof.",
    product: "VertKleen CR + HCR",
    productHref: "../pricing-cip-food-beverage",
    competitor: "Micro Matic beer-line cleaner",
    vkMath: "CR: $55.05 / 2.5 gal = $22.02/gal; HCR: $61.80 / 2.5 gal = $24.72/gal",
    marketMath: "$38.85/gal",
    priceNote: "CR and HCR use the current CIP Food & Beverage pricing tab. Micro Matic pricing comes from the Industries & Lead Gen tab.",
    swapCurrent: "Caustic soda + brewing acid blends",
    swapJob: "Beer line, tank, mash tank, and heat-exchanger CIP/SIP",
    swapUse: "VertKleen CR for alkaline wash followed by VertKleen HCR for acid wash.",
    proofTitle: "Brewlando proof point",
    proof: "Brewlando Brewing trial notes say CR and HCR worked better than the traditional caustic-soda and acid blends at the same concentration and CIP time.",
    image: "../img/proof/cases/brewery.webp",
    imageAlt: "Brewery tank cleaned with VertKleen CR and HCR",
    ctaProduct: "beer line cleaner cost comparison"
  }
];

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
  const quoteHref = `../contact?type=quote&product=${encodeURIComponent(page.ctaProduct)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${html(page.title)} | MASEST VertKleen</title>
<meta name="description" content="${html(page.description)}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=20260706c">
<link rel="stylesheet" href="../css/navigation.css?v=20260706a">
<link rel="stylesheet" href="../css/components.css?v=20260619b">
<link rel="canonical" href="${BASE}/comparisons/${page.slug}">
<meta property="og:title" content="${html(page.title)} | MASEST VertKleen">
<meta property="og:description" content="${html(page.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<meta property="og:url" content="${BASE}/comparisons/${page.slug}">
<meta property="og:image" content="${BASE}/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify(schema(page))}</script>
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
          <a class="btn btn-primary" href="${quoteHref}">Request quote</a>
          <a class="btn btn-secondary" href="${page.productHref}">View ${html(page.product)}</a>
        </div>
      </div>
      <figure class="product-hero-media reveal">
        <img src="${page.image}" alt="${html(page.imageAlt)}" fetchpriority="high" decoding="async">
      </figure>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap product-static-grid">
      <article class="product-static-panel">
        <span class="eyebrow">Per-gallon price math</span>
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
        <span class="eyebrow">Proof point</span>
        <h2>${html(page.proofTitle)}</h2>
        <p>${html(page.proof)}</p>
        <a class="btn btn-ink" href="../proof">See proof library</a>
      </article>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Swap table row</span>
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
        <span class="eyebrow">Quote next</span>
        <h2 class="headline">Send the incumbent product and volume.</h2>
        <p class="subhead">MASEST will confirm the replacement, current pack pricing, freight path, and proof file before release.</p>
        <a class="btn btn-light" href="${quoteHref}">Request quote</a>
      </div>
    </div>
  </section>
</main>

<script type="module" src="../js/main.js?v=20260711f"></script>
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
