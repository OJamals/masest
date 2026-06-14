#!/usr/bin/env node
/* Generate per-vertical industry landing pages into site/industries/<slug>.html
   from a single data source. Re-runnable; overwrites. Pages are static HTML
   (real, indexable URLs); product cards are filled at runtime by
   initIndustryProducts() in js/main.js so they stay in sync with PRODUCTS{}.

   Run from anywhere:  node site/tools/gen_industries.mjs
*/
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "industries");

// Industry order matches the industries.html index (deck priority). Plumbing last.
const INDUSTRIES = [
  {
    slug: "oil-gas", name: "Oil & Gas", icon: "ph-gas-can",
    h1: "Zero-hazard chemistry for oil &amp; gas.",
    sub: "Descale, derust, and degrease rigs, terminals, and pipeline assets without acid fumes, solvent storage, or hazmat freight friction.",
    intro: "Drilling rigs, terminals, and pipeline maintenance run on harsh acids and solvent degreasers that carry fume, burn, and freight risk. VertKleen does the same descaling, rust removal, and degreasing at an HMIS 0-0-0 rating, so crews work safer and storage and shipping stay simple.",
    products: ["hcr", "descaler", "crhd", "neutral"],
    proof: { img: "ddc-rust", caption: "20-year rust and scale cleared with HCR, verified by DDC Engineering." }
  },
  {
    slug: "marine", name: "Marine", icon: "ph-anchor",
    h1: "Safe chemistry for confined shipboard spaces.",
    sub: "Cruise, commercial vessels, docks, and offshore maintenance where fumes and corrosion spread quickly in tight spaces.",
    intro: "Hull, aluminum, glass, and deck maintenance traditionally lean on hydrofluoric and hydrochloric acid brighteners and solvent washes, a serious problem in confined shipboard air. VertKleen Torque and AlumiBrite restore the same surfaces without those acids, and MultiWash supports drone and pressure-wash cleaning on occupied vessels.",
    products: ["torque", "alumibrite", "multiwash", "crhd"],
    proof: { img: "marine", caption: "Yellowfin vessel trim, caulking, and glass cleared with VertKleen." }
  },
  {
    slug: "manufacturing", name: "Manufacturing", icon: "ph-factory",
    h1: "Heavy-duty cleaning, lower HazCom overhead.",
    sub: "Extrusion, processing, warehousing, and plant maintenance with strong cleaning power and asset protection.",
    intro: "Plant maintenance needs acid descaling, caustic CIP, and solvent degreasing, each one a HazCom and exposure burden. VertKleen replaces the acid, the caustic, and the solvent with HMIS 0-0-0 chemistry that matches performance while cutting fume events, PPE load, and hazmat freight.",
    products: ["hcr", "cr", "crhd", "descaler"],
    proof: { img: "farm-rust", caption: "Heavy industrial rust and scale removed with HCR, no muriatic acid." }
  },
  {
    slug: "food-beverage", name: "Food & Beverage", icon: "ph-beer-bottle",
    h1: "Clean food environments, no harsh chemistry.",
    sub: "Breweries, distilleries, wineries, processing floors, hood filters, and drains cleaned around staff and active food spaces.",
    intro: "Tanks, heat exchangers, and CIP/SIP lines usually need caustic and acid sequences that are hard on staff and effluent. In a Carib Brewery lab evaluation, VertKleen HCR matched conventional CIP acid cleaning at less than half the concentration and left no nitrogen or phosphorus in the effluent.",
    products: ["cr", "hcr", "crhd", "neutral"],
    proof: { img: "brewery", caption: "Brewery tanks and CIP cleaned with CR and HCR. See the lab results." }
  },
  {
    slug: "healthcare", name: "Healthcare", icon: "ph-hospital",
    h1: "Maintain occupied healthcare facilities, safely.",
    sub: "Clean, passivate, and maintain water systems with the building occupied and without forcing shutdowns or fume events.",
    intro: "Hospitals and occupied campuses cannot evacuate for a fume event or shut a wing down for descaling. VertKleen cleans, passivates, and treats water systems at HMIS 0-0-0, so maintenance happens with patients, staff, and visitors in the building.",
    products: ["watersafe60", "purgo", "hcr", "cr"],
    proof: { img: "ac-coil", caption: "Residential and facility AC coils cleaned with Descaler, fin-safe on aluminum." }
  },
  {
    slug: "construction", name: "Construction", icon: "ph-crane",
    h1: "Site cleaning without the storage and exposure risk.",
    sub: "Concrete cleaning, equipment maintenance, rust removal, and site cleanup on active jobs.",
    intro: "Concrete, equipment, and exterior cleanup on active sites means acids and bleach in places people are working. VertKleen Descaler clears concrete scale and calcium, HCR removes rust, and LAM3 handles biological growth on exteriors, all with simpler storage and lighter exposure risk.",
    products: ["descaler", "hcr", "crhd", "lam3"],
    proof: { img: "grout-moss", caption: "Exterior grout, stucco, and painted surfaces cleared with CR and LAM3." }
  },
  {
    slug: "military-government", name: "Military / Government", icon: "ph-seal-check",
    h1: "Procurement-ready, zero-hazard chemistry.",
    sub: "Federal, state, local, and public-facility maintenance with documentation buyers expect.",
    intro: "MASEST Consulting LLC is SAM.gov registered with CAGE 0B2Q3 and NAICS 424690 for federal, state, local, and public-facility procurement. VertKleen replaces hazardous acids, caustics, and biocides across defense and public assets while keeping HMIS 0-0-0 documentation, SDS, and compliance signals on hand.",
    products: ["hcr", "descaler", "crhd", "alumibrite"],
    proof: { img: "ddc-rust", caption: "Rust removed from defense-contractor equipment with HCR." }
  },
  {
    slug: "education", name: "Education", icon: "ph-graduation-cap",
    h1: "Clean campuses with everyone on site.",
    sub: "K-12 and university facilities cleaned and treated with students, faculty, and staff present.",
    intro: "Schools and universities maintain water systems, kitchens, and exteriors while occupied, so hazardous chemistry is a liability. VertKleen lets facilities teams clean and treat at HMIS 0-0-0 with campuses in use. Brevard County Schools proof sits behind the program.",
    products: ["cr", "hcr", "watersafe60", "lam3"],
    proof: { img: "grout-moss", caption: "Occupied-campus exterior and facility cleaning with VertKleen." }
  },
  {
    slug: "hvac-water", name: "HVAC / Water Treatment", icon: "ph-wind",
    h1: "Cooling tower programs without the hazard.",
    sub: "Inhibitor, biocide, passivation, and pH control with ASHRAE 188 documentation.",
    intro: "Cooling tower programs combine inhibitor, biocide, descaling acid, and pH control. VertKleen runs the full program with WaterSafe60 inhibitor, Purgo and DBNPA biocides, HCR passivation, and CR pH control, all at a zero hazard rating and with ASHRAE 188 documentation.",
    products: ["watersafe60", "purgo", "hcr", "cr", "dbnpa"],
    proof: { img: "ac-coil", caption: "HVAC coils and water systems cleaned and treated, fin-safe." }
  },
  {
    slug: "plumbing", name: "Plumbing", icon: "ph-wrench",
    h1: "Descale lines and fixtures, acid-free.",
    sub: "Water lines, fixtures, water heaters, and drains cleared of scale and calcium without muriatic acid.",
    intro: "Calcium, scale, and rust in supply lines, fixtures, and water heaters are usually attacked with muriatic acid or CLR. VertKleen Descaler clears the same buildup acid-free and fin- and metal-safe, and HCR handles heavier rust and passivation, so plumbing work stays safe in occupied buildings.",
    products: ["descaler", "hcr", "neutral"],
    proof: { img: "ac-coil", caption: "Scale and calcium cleared from coils and water-side surfaces with Descaler." }
  }
];

const NAV = [
  ["index.html", "Home"], ["why-vertkleen.html", "Why VertKleen"],
  ["products.html", "Products"], ["programs.html", "Programs"],
  ["proof.html", "Proof"], ["industries.html", "Industries"],
  ["about.html", "About"], ["contact.html", "Contact"]
];

const enc = (s) => encodeURIComponent(s).replace(/'/g, "%27");

function ctaBlock(ind) {
  const q = (type) => `../contact.html?industry=${enc(ind.name)}&type=${type}`;
  return `
  <section class="block-dark">
    <div class="wrap">
      <div class="section-head center">
        <span class="eyebrow">Get started</span>
        <h2 class="headline">Take ${ind.name} to zero hazard.</h2>
        <p class="subhead">Pick the path that fits. Every request routes to the MASEST team by vertical, product, and volume.</p>
      </div>
      <div class="cta-grid">
        <a class="cta-tile" href="${q("quote")}"><i class="ph ph-tag" aria-hidden="true"></i><span class="cta-tile-t">Get a Quote</span><span class="cta-tile-s">Price by product and volume</span></a>
        <a class="cta-tile" href="${q("audit")}"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span class="cta-tile-t">Free Chemical Audit</span><span class="cta-tile-s">Map your legacy chemistry</span></a>
        <a class="cta-tile" href="${q("sample")}"><i class="ph ph-package" aria-hidden="true"></i><span class="cta-tile-t">Sample Kit</span><span class="cta-tile-s">Trial 3 to 5 products on site</span></a>
        <a class="cta-tile" href="${q("distributor")}"><i class="ph ph-handshake" aria-hidden="true"></i><span class="cta-tile-t">Distributor / Partner</span><span class="cta-tile-s">BSC, distributor, white-label</span></a>
      </div>
    </div>
  </section>`;
}

function page(ind) {
  const nav = NAV.map(([href, label]) =>
    `    <a href="../${href}"${href === "industries.html" ? ' aria-current="page"' : ""}>${label}</a>`).join("\n");
  const plain = ind.h1.replace(/&amp;/g, "&").replace(/<[^>]+>/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ind.name} | MASEST VertKleen</title>
<meta name="description" content="${ind.sub.replace(/&amp;/g, "&").replace(/"/g, "&quot;")}">
<meta name="theme-color" content="#fafbfc">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css">
</head>
<body>
<noscript>
  <nav class="nojs-nav" aria-label="Site">
${nav}
  </nav>
</noscript>

<main id="main">
  <section class="hero-split">
    <div class="wrap">
      <span class="eyebrow"><a href="../industries.html">Industries</a> / ${ind.name}</span>
      <h1 class="display">${ind.h1}</h1>
      <p class="subhead">${ind.sub}</p>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap ind-intro">
      <div class="ind-intro-copy">
        <span class="ind-icon"><i class="ph ${ind.icon}" aria-hidden="true"></i></span>
        <h2 class="headline">Where VertKleen fits in ${ind.name}.</h2>
        <p>${ind.intro}</p>
        <a class="btn btn-ink" href="../proof.html">See the proof</a>
      </div>
      <figure class="ind-intro-photo">
        <img src="../img/proof/cases/${ind.proof.img}.webp" alt="${ind.proof.caption.replace(/"/g, "&quot;")}" loading="lazy">
        <figcaption>${ind.proof.caption}</figcaption>
      </figure>
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Recommended</span>
        <h2 class="headline">VertKleen products for ${ind.name}.</h2>
        <p class="subhead">Drop-in replacements for the hazardous chemistry this work usually relies on.</p>
      </div>
      <div class="prod-grid" data-ind-products="${ind.products.join(" ")}"></div>
    </div>
  </section>
${ctaBlock(ind)}
</main>

<script src="../js/main.js"></script>
</body>
</html>
`;
}

mkdirSync(OUT, { recursive: true });
let n = 0;
for (const ind of INDUSTRIES) {
  writeFileSync(resolve(OUT, `${ind.slug}.html`), page(ind), "utf8");
  n++;
  console.log(`  wrote industries/${ind.slug}.html  (${ind.products.length} products)`);
}
console.log(`OK ${n} industry pages -> ${OUT}`);
