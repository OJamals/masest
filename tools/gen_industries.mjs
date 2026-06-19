#!/usr/bin/env node
/* Generate per-industry landing pages into site/industries/<slug>.html
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
    h1: "HMIS 0-0-0 chemistry for oil &amp; gas.",
    sub: "Descale, derust, and degrease rigs, terminals, and pipeline assets with less acid-fume, solvent-storage, and hazmat-freight friction.",
    intro: "Drilling rigs, terminals, and pipeline maintenance run on acids and solvent degreasers that carry fume, burn, and freight risk. VertKleen supports the same descaling, rust removal, and degreasing jobs with HMIS 0-0-0 product options, so storage and shipping stay simpler.",
    products: ["hcr", "descaler", "crhd", "neutral"],
    proof: { img: "ddc-rust", caption: "20-year rust and scale cleared with HCR, verified by DDC Engineering." }
  },
  {
    slug: "marine", name: "Marine", icon: "ph-anchor",
    h1: "HMIS 0-0-0 chemistry for confined shipboard spaces.",
    sub: "Cruise, commercial vessels, docks, and offshore maintenance where acid fumes and corrosion spread quickly in tight spaces.",
    intro: "Hull, aluminum, glass, and deck maintenance traditionally lean on hydrofluoric and hydrochloric acid brighteners and solvent washes, a serious problem in confined shipboard air. VertKleen Torque and AlumiBrite support those restoration jobs without those acids, and MultiWash supports drone and pressure-wash cleaning on occupied vessels.",
    products: ["torque", "alumibrite", "multiwash", "crhd"],
    proof: { img: "marine", caption: "Yellowfin vessel trim, caulking, and glass cleared with VertKleen." }
  },
  {
    slug: "manufacturing", name: "Manufacturing", icon: "ph-factory",
    h1: "Heavy-duty cleaning, lower HazCom overhead.",
    sub: "Extrusion, processing, warehousing, and plant maintenance with strong cleaning power and asset protection.",
    intro: "Plant maintenance needs acid descaling, caustic CIP, and solvent degreasing, each one a HazCom and exposure burden. VertKleen replaces those steps with HMIS 0-0-0 chemistry options that reduce fume events, PPE load, and hazmat freight.",
    products: ["hcr", "cr", "crhd", "descaler"],
    proof: { img: "farm-rust", caption: "Heavy industrial rust and scale removed with HCR, no HCl handling." }
  },
  {
    slug: "food-beverage", name: "Food & Beverage", icon: "ph-beer-bottle",
    h1: "Clean food environments with HMIS 0-0-0 options.",
    sub: "Breweries, distilleries, wineries, processing floors, hood filters, and drains cleaned around staff and active food spaces.",
    intro: "Tanks, heat exchangers, and CIP/SIP lines usually need caustic and acid sequences that are hard on staff and effluent. In a Carib Brewery lab evaluation, VertKleen HCR matched conventional CIP acid cleaning at less than half the concentration and left no nitrogen or phosphorus in the effluent.",
    products: ["cr", "hcr", "crhd", "neutral"],
    proof: { img: "brewery", caption: "Brewery tanks and CIP cleaned with CR and HCR. See the lab results." }
  },
  {
    slug: "healthcare", name: "Healthcare", icon: "ph-hospital",
    h1: "Maintain occupied healthcare facilities with lower-hazard chemistry.",
    sub: "Clean, passivate, and maintain water systems with the building occupied while reducing shutdown and fume-event risk.",
    intro: "Hospitals and occupied campuses cannot plan around fume events or shut a wing down for descaling. VertKleen cleans, passivates, and treats water systems with HMIS 0-0-0 product options, so maintenance can be planned around patients, staff, and visitors in the building.",
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
    h1: "Procurement-ready HMIS 0-0-0 chemistry.",
    sub: "Federal, state, local, and public-facility maintenance with documentation buyers expect.",
    intro: "MASEST Consulting LLC is SAM.gov registered with CAGE 0B2Q3 and NAICS 424690 for federal, state, local, and public-facility procurement. VertKleen replaces hazardous acids, caustics, and biocides across defense and public assets while keeping HMIS 0-0-0 documentation, SDS, and compliance signals on hand.",
    products: ["hcr", "descaler", "crhd", "alumibrite"],
    proof: { img: "ddc-rust", caption: "Rust removed from defense-contractor equipment with HCR." }
  },
  {
    slug: "education", name: "Education", icon: "ph-graduation-cap",
    h1: "Clean campuses with everyone on site.",
    sub: "K-12 and university facilities cleaned and treated with students, faculty, and staff present.",
    intro: "Schools and universities maintain water systems, kitchens, and exteriors while occupied, so chemistry handling and documentation matter. VertKleen lets facilities teams clean and treat at HMIS 0-0-0 with campuses in use. Brevard County Schools proof sits behind the program.",
    products: ["cr", "hcr", "watersafe60", "lam3"],
    proof: { img: "grout-moss", caption: "Occupied-campus exterior and facility cleaning with VertKleen." }
  },
  {
    slug: "hvac-water", name: "HVAC / Water Treatment", icon: "ph-wind",
    h1: "Cooling tower programs with lower-hazard chemistry.",
    sub: "Inhibitor, biocide, passivation, and pH control with ASHRAE 188 documentation.",
    intro: "Cooling tower programs combine inhibitor, biocide, descaling acid, and pH control. VertKleen runs the full program with WaterSafe60 inhibitor, Purgo and DBNPA biocides, HCR passivation, and CR pH control, all with HMIS 0-0-0 documentation and ASHRAE 188 support.",
    products: ["watersafe60", "purgo", "hcr", "cr", "dbnpa"],
    proof: { img: "ac-coil", caption: "HVAC coils and water systems cleaned and treated, fin-safe." }
  },
  {
    slug: "plumbing", name: "Plumbing", icon: "ph-wrench",
    h1: "Descale lines and fixtures without hydrochloric acid.",
    sub: "Water lines, fixtures, water heaters, and drains cleared of scale and calcium without hydrochloric acid handling.",
    intro: "Calcium, scale, and rust in supply lines, fixtures, and water heaters are usually attacked with hydrochloric acid products or CLR. VertKleen Descaler clears the same buildup without hydrochloric acid handling and is fin- and metal-safe; HCR handles heavier rust and passivation for occupied-building plumbing work.",
    products: ["descaler", "hcr", "neutral"],
    proof: { img: "ac-coil", caption: "Scale and calcium cleared from coils and water-side surfaces with Descaler." }
  }
];

const NAV = [
  ["index.html", "MASEST"], ["products.html", "Products"], [null, "Use Cases"],
  ["industries.html", "Industries"], ["proof.html", "Field Results"],
  ["resources.html", "Resources"]
];

// Per-industry field gallery. Images live at img/industries/<slug>/g{1,2,3}.webp
// (generated by tools/gen_galleries.py from the case-study photo library).
// [alt, caption] per image — alt carries the full description, caption is the on-card line.
const GALLERY = {
  "oil-gas": [
    ["VertKleen HCR dissolving two decades of rust in a jar test", "Rust dissolved in an HCR jar test"],
    ["Measured HCR dose for a controlled descaling test", "Measured dose, controlled descale"],
    ["Rusted steel beside a cleaned test patch", "Cleaned patch vs. legacy acid"]
  ],
  "marine": [
    ["Yellowfin helm and console cleaned with VertKleen Torque", "Helm and console, salt-safe"],
    ["Hull and topsides washed dockside without acid brighteners", "Topsides washed dockside"],
    ["43-foot Yellowfin finished bow to transom", "Finished bow to transom"]
  ],
  "manufacturing": [
    ["Greasy intake assembly before VertKleen CRHD degreasing", "Greasy intake, pre-degrease"],
    ["Filter media cleared of grease with fibers intact", "Media cleared, fibers intact"],
    ["Degreased filter restored to clean media", "Restored to clean media"]
  ],
  "food-beverage": [
    ["Brewery fermenters cleaned with VertKleen CR and HCR", "Fermenters cleaned, CR + HCR"],
    ["Tank interior cleaned back to bright stainless", "Tank back to bright stainless"],
    ["Heat-exchanger plates descaled for CIP service", "Heat-exchanger plates descaled"]
  ],
  "healthcare": [
    ["Facility AC coil cleaned in place, fin-safe", "AC coil cleaned in place"],
    ["Tiled wet area cleared of scale without harsh acid", "Wet-area scale cleared"],
    ["Sill and fixtures left clean in an occupied building", "Fixtures clean, building occupied"]
  ],
  "construction": [
    ["Tiled deck mid-pass, treated half cleared of grime", "Deck mid-pass, treated half"],
    ["Paver patio cleaned of embedded algae and grime", "Pavers cleared of algae"],
    ["Algae-covered exterior wall before VertKleen CR", "Wall before VertKleen CR"]
  ],
  "military-government": [
    ["Two-decade rust and scale on equipment before treatment", "Equipment rust, pre-treatment"],
    ["Component cleared of rust with HCR and reduced acid-fume handling", "Cleared with HCR, reduced acid-fume handling"],
    ["Diamond-plate steel restored without hydrochloric acid handling", "Diamond plate, no HCl handling"]
  ],
  "education": [
    ["Campus stair and railing cleaned with everyone on site", "Stair and railing, campus open"],
    ["Exterior water feature cleared of scale and growth", "Water feature descaled"],
    ["Walkway tile cleaned of grime and biological staining", "Walkway tile cleaned"]
  ],
  "hvac-water": [
    ["Condenser unit cleaned in place during service", "Condenser cleaned in service"],
    ["Coil fins cleared of scale without bending the aluminum", "Fins cleared, not bent"],
    ["Aluminum condenser coil descaled on an occupied site", "Aluminum coil descaled"]
  ],
  "plumbing": [
    ["Glass and track heavy with calcium scale before Descaler", "Calcium scale, pre-Descaler"],
    ["Fixture track cleared of calcium without hydrochloric acid handling", "Track cleared, no HCl handling"],
    ["Floor drain cleared of scale and buildup", "Floor drain cleared"]
  ]
};

const enc = (s) => encodeURIComponent(s).replace(/'/g, "%27");

const INDUSTRY_DETAILS = {
  "oil-gas": ["Chemicals replaced", "Hydrochloric acid (muriatic acid), solvent degreasers, and aggressive rust removers used on rigs, terminals, pipeline parts, and tank-farm equipment.", "Bundle: HCR for rust and passivation, Descaler for mineral scale, CRHD for oily soils, Neutral for sensitive surfaces."],
  marine: ["Buyer objection", "Confined air, aluminum brightwork, glass, and dockside access make acid brighteners and solvent washes hard to manage.", "Bundle: Torque for wash-and-wax, AlumiBrite for aluminum, MultiWash for exterior cleaning, CRHD for machinery spaces."],
  manufacturing: ["Common replacements", "Acid descalers, caustic CIP cleaners, and solvent degreasers used across lines, floors, parts, and maintenance bays.", "Bundle: HCR for scale and rust, CR for alkaline cleaning, CRHD for heavy grease, Descaler for mineral deposits."],
  "food-beverage": ["Sector proof", "Brewery and distillery work centers on CR and HCR sequences for tanks, heat exchangers, protein soil, beer stone, and hood or drain cleaning.", "Bundle: CR for alkaline wash, HCR for acid wash, CRHD for grease, Neutral where sensitive surfaces or seals matter."],
  healthcare: ["Buyer objection", "Occupied facilities cannot trade maintenance needs for fume events, shutdowns, or uncontrolled chemical exposure.", "Bundle: WaterSafe60 and Purgo for water programs, HCR for passivation, CR for pH and alkaline cleaning."],
  construction: ["Common replacements", "Hydrochloric acid (muriatic acid), bleach, and caustic degreasers used for concrete cleanup, equipment, pavers, and exterior biological growth.", "Bundle: Descaler for concrete and calcium, HCR for rust, CRHD for equipment grease, LAM3 for exterior growth."],
  "military-government": ["Procurement signal", "Public buyers need CAGE, NAICS, SDS, certifications, and controlled documents before switching a chemistry standard.", "Bundle: HCR, Descaler, CRHD, and AlumiBrite cover rust, scale, grease, and aluminum restoration with documented routing."],
  education: ["Sector proof", "Campus buyers need cleaning and water-treatment options that work while students, faculty, and staff remain on site.", "Bundle: CR and HCR for facility cleaning, WaterSafe60 for water systems, LAM3 for exterior biological growth."],
  "hvac-water": ["Recommended replacement map", "Cooling tower programs replace inhibitor, oxidizing biocide, non-oxidizing biocide, acid clean, pH adjustment, and degreasing functions.", "Bundle: WaterSafe60, Purgo, DBNPA, HCR, CR, and Neutral for the complete tower chemistry rotation."],
  plumbing: ["Buyer objection", "Water lines, fixtures, heaters, and drains need scale removal without hydrochloric acid handling inside occupied buildings.", "Bundle: Descaler for calcium and scale, HCR for heavier rust and passivation, Neutral for sensitive equipment cleaning."]
};

function industryDetailBlock(ind) {
  const detail = INDUSTRY_DETAILS[ind.slug];
  if (!detail) return "";
  const [label, body, bundle] = detail;
  return `<section class="section section-slim">
    <div class="wrap ind-specific">
      <div class="section-head">
        <span class="eyebrow">${label}</span>
        <h2 class="headline">What ${ind.name} buyers replace first.</h2>
      </div>
      <div class="proof-callout">
        <p>${body}</p>
        <p>${bundle}</p>
      </div>
    </div>
  </section>`;
}

function industrySchema(ind, plain) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "MASEST Consulting LLC",
        url: "https://masest.co/",
        logo: "https://masest.co/img/masest-logo.png",
        brand: "VertKleen",
        description: "HMIS 0-0-0 industrial cleaning chemistry for lower-hazard handling.",
        areaServed: "Worldwide",
        contactPoint: { "@type": "ContactPoint", contactType: "sales", url: "https://masest.co/contact.html" }
      },
      {
        "@type": "WebPage",
        name: `${ind.name} VertKleen replacements`,
        url: `https://masest.co/industries/${ind.slug}.html`,
        description: ind.sub.replace(/&amp;/g, "&")
      },
      {
        "@type": "Service",
        name: `${ind.name} VertKleen replacement program`,
        provider: { "@type": "Organization", name: "MASEST Consulting LLC", url: "https://masest.co/" },
        serviceType: `Industrial cleaning chemistry replacement for ${plain}`,
        url: `https://masest.co/industries/${ind.slug}.html`,
        areaServed: "Worldwide"
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://masest.co/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: "https://masest.co/industries.html" },
          { "@type": "ListItem", position: 3, name: ind.name, item: `https://masest.co/industries/${ind.slug}.html` }
        ]
      }
    ]
  };
}

function ctaBlock(ind) {
  const q = (type) => `../contact.html?industry=${enc(ind.name)}&type=${type}`;
  return `
  <section class="block-dark">
    <div class="wrap">
      <div class="section-head center">
        <span class="eyebrow">Get started</span>
          <h2 class="headline">Plan a lower-hazard ${ind.name} program.</h2>
          <p class="subhead">Choose a quote, audit, or sample request. MASEST routes the request by industry, product, and volume.</p>
      </div>
      <div class="cta-grid">
        <a class="cta-tile" href="${q("quote")}"><i class="ph ph-tag" aria-hidden="true"></i><span class="cta-tile-t">Get a Quote</span><span class="cta-tile-s">Price by product and volume</span></a>
        <a class="cta-tile" href="${q("audit")}"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span class="cta-tile-t">Chemical Audit</span><span class="cta-tile-s">Map your legacy chemistry</span></a>
        <a class="cta-tile" href="${q("sample")}"><i class="ph ph-package" aria-hidden="true"></i><span class="cta-tile-t">Sample Kit</span><span class="cta-tile-s">Trial 3 to 5 products on site</span></a>
        <a class="cta-tile" href="${q("distributor")}"><i class="ph ph-handshake" aria-hidden="true"></i><span class="cta-tile-t">Distributor / Partner</span><span class="cta-tile-s">BSC, distributor, white-label</span></a>
      </div>
    </div>
  </section>`;
}

function galleryBlock(ind) {
  const shots = GALLERY[ind.slug];
  if (!shots) return "";
  const figs = shots.map(([alt, cap], i) => `
        <figure class="ind-shot">
          <img src="../img/industries/${ind.slug}/g${i + 1}.webp" alt="${alt.replace(/"/g, "&quot;")}" loading="lazy" width="900" height="675">
          <figcaption>${cap}</figcaption>
        </figure>`).join("");
  return `
  <section class="section section-slim ind-gallery-sec">
    <div class="wrap">
      <div class="section-head">
        <h2 class="headline">VertKleen on ${ind.name} sites.</h2>
        <p class="subhead">Real jobs pulled straight from the VertKleen field library.</p>
      </div>
      <div class="ind-gallery">${figs}
      </div>
    </div>
  </section>`;
}

function page(ind) {
  const nav = NAV.map(([href, label]) => {
    if (!href) return `    <span>${label}</span>`;
    const content = label === "MASEST" ? `<b>${label}</b>` : label;
    return `    <a href="../${href}"${href === "industries.html" ? ' aria-current="page"' : ""}>${content}</a>`;
  }).join("\n");
  const plain = ind.h1.replace(/&amp;/g, "&").replace(/<[^>]+>/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${ind.name} | MASEST VertKleen</title>
<meta name="description" content="${ind.sub.replace(/&amp;/g, "&").replace(/"/g, "&quot;")}">
<meta name="theme-color" content="#fafbfc">
<link rel="canonical" href="https://masest.co/industries/${ind.slug}.html">
<meta property="og:title" content="${ind.name} | MASEST VertKleen">
<meta property="og:description" content="${ind.sub.replace(/&amp;/g, "&").replace(/"/g, "&quot;")}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<meta property="og:url" content="https://masest.co/industries/${ind.slug}.html">
<meta property="og:image" content="https://masest.co/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=20260619a">
<link rel="stylesheet" href="../css/navigation.css?v=20260619a">
<link rel="stylesheet" href="../css/components.css?v=20260619b">
<script type="application/ld+json">${JSON.stringify(industrySchema(ind, plain))}</script>
</head>
<body class="site-soft-bg">
<a class="skip-link" href="#main">Skip to content</a>
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
        <h2 class="headline">How VertKleen fits ${ind.name} work.</h2>
        <p>${ind.intro}</p>
        <a class="btn btn-ink" href="../proof.html">See the proof</a>
      </div>
      <figure class="ind-intro-photo">
        <img src="../img/proof/cases/${ind.proof.img}.webp" alt="${ind.proof.caption.replace(/"/g, "&quot;")}" loading="lazy">
        <figcaption>${ind.proof.caption}</figcaption>
      </figure>
</div>
</section>

${industryDetailBlock(ind)}

<section class="section section-slim">
<div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Recommended</span>
        <h2 class="headline">VertKleen products for ${ind.name}.</h2>
        <p class="subhead">Replacement options for the legacy chemistry this work usually relies on.</p>
      </div>
      <div class="prod-grid prod-grid-rec" data-ind-products="${ind.products.join(" ")}"></div>
    </div>
  </section>
${galleryBlock(ind)}
${ctaBlock(ind)}
</main>

<script type="module" src="../js/main.js"></script>
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
