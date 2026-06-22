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
  slug: "oil-gas",
  name: "Oil & Gas",
  icon: "ph-gas-can",
  h1: "Clean rigs and terminals without making the chemical the main hazard.",
  sub: "Descale, derust, and degrease rigs, terminals, and pipeline assets while reducing acid-fume, solvent-storage, and hazmat-freight friction.",
  intro: "Drilling rigs, terminals, and pipeline maintenance often rely on acids and solvent degreasers that bring fume, burn, and freight risk. VertKleen maps descaling, rust-removal, and degreasing jobs to HMIS 0-0-0 product options so storage, handling, and shipping stay simpler.",
  products: ["hcr", "descaler", "crhd", "neutral"],
  proof: { img: "ddc-rust", caption: "20-year rust scale cleared HCR, verified by DDC Engineering." }
},
{
  slug: "marine",
  name: "Marine",
  icon: "ph-anchor",
  h1: "Marine cleaning where fumes have nowhere to go.",
  sub: "Cruise ships, commercial vessels, docks, and offshore maintenance bring confined air, soft metals, salt, and corrosion into one chemical decision.",
  intro: "Hull, aluminum, glass, and deck maintenance often lean on hydrofluoric or hydrochloric acid brighteners and solvent washes, a serious issue in confined shipboard air. VertKleen Torque and AlumiBrite support restoration jobs without acids; MultiWash supports drone pressure-wash cleaning on occupied vessels.",
  products: ["torque", "alumibrite", "multiwash", "crhd"],
  proof: { img: "marine", caption: "Yellowfin vessel trim, caulking, glass cleared VertKleen." }
},
{
  slug: "manufacturing",
  name: "Manufacturing",
  icon: "ph-factory",
  h1: "Get production back, not another HazCom meeting.",
  sub: "Extrusion, processing, warehousing, and plant maintenance with strong cleaning power and buyer-ready documentation.",
  intro: "Plant maintenance often needs acid descaling, caustic CIP, and solvent degreasing; each one adds HazCom and exposure burden. VertKleen maps those jobs to HMIS 0-0-0 chemistry options, reducing handling load and giving maintenance a cleaner file for technical review.",
  products: ["hcr", "cr", "crhd", "descaler"],
  proof: { img: "farm-rust", caption: "Heavy industrial rust scale removed HCR, no HCl handling." }
},
{
  slug: "distribution-cold-storage",
  name: "Distribution / Cold Storage",
  icon: "ph-warehouse",
  h1: "Cold-chain cleaning cannot wait for shutdown.",
  sub: "Perishable distribution centers, refrigerated bays, ammonia systems, forklifts, kitchens, drains, and coils with proof from Walmart DSC materials.",
  intro: "Cold-storage teams juggle mildew, freezer entries, ammonia coils, condenser lines, kitchen grease, forklifts, and pilot readiness without stopping the building. VertKleen maps the walkdown to Descaler, CRHD, MultiWash, Purgo, and CR so maintenance can route proof, SDS, and trial scope before the operations window disappears.",
  products: ["descaler", "crhd", "multiwash", "purgo"],
  proof: { img: "walmart-dc-crhd", caption: "Walmart distribution-center proof covers CRHD degreasing and Descaler refrigeration work." }
},
{
  slug: "food-beverage",
  name: "Food & Beverage",
  icon: "ph-beer-bottle",
  h1: "CIP proof beats a food-safe slogan.",
  sub: "Breweries, distilleries, wineries, processing floors, hood filters, and drains cleaned around staff and active food spaces.",
  intro: "Tanks, heat exchangers, and CIP/SIP lines usually depend on caustic-acid sequences that are hard on staff and effluent. Brewlando trial notes say CR and HCR worked better than traditional caustic-soda and acid blends at the same concentration and CIP time; the Carib lab table adds effluent data buyers can review.",
  products: ["cr", "hcr", "crhd", "neutral"],
  proof: { img: "brewery", caption: "Brewery tanks and CIP cleaned with CR and HCR. See lab results." }
},
{
  slug: "healthcare",
  name: "Healthcare",
  icon: "ph-hospital",
  h1: "Healthcare maintenance cannot become an event.",
  sub: "Clean, passivate, and maintain water systems while the building stays occupied and fume-event risk stays lower.",
  intro: "Hospitals and occupied campuses cannot plan around fume events or extended shutdowns. VertKleen cleans, passivates, and supports scoped water-system programs with HMIS 0-0-0 product options, so maintenance can be planned around patients, staff, and visitors still in the building.",
  products: ["watersafe60", "purgo", "hcr", "cr"],
  proof: { img: "ac-coil", caption: "Residential facility AC coils cleaned Descaler, aluminum-fin compatible." }
},
{
  slug: "construction",
  name: "Construction",
  icon: "ph-crane",
  h1: "Active jobs need chemistry that behaves.",
  sub: "Concrete cleaning, equipment maintenance, rust removal, and site cleanup on active jobs.",
  intro: "Concrete, equipment, and exterior cleanup on active sites often puts acids and bleach near working crews. VertKleen Descaler clears concrete scale and calcium, HCR removes rust, and LAM3 handles biological growth on exteriors with simpler storage and lighter exposure risk.",
  products: ["descaler", "hcr", "crhd", "lam3"],
  proof: { img: "grout-moss", caption: "Exterior grout, stucco, and painted surfaces cleared with CR and LAM3." }
},
{
  slug: "military-government",
  name: "Military / Government",
  icon: "ph-seal-check",
  h1: "Public buyers need more than a nice label.",
  sub: "Documentation federal, state, local, and public-facility maintenance buyers expect.",
  intro: "MASEST keeps SAM.gov, CAGE 0B2Q3, and NAICS 424690 procurement files ready for federal, state, local, and public-facility buyers. VertKleen maps hazardous acids, caustics, and water-treatment functions across public assets while keeping HMIS 0-0-0 documentation, SDS, and exception notes on hand.",
  products: ["hcr", "descaler", "crhd", "alumibrite"],
  proof: { img: "ddc-rust", caption: "Rust removed from defense-contractor equipment with HCR." }
},
{
  slug: "education",
  name: "Education",
  icon: "ph-graduation-cap",
  h1: "Campus work happens while campus happens.",
  sub: "K-12 and university facilities cleaned and treated while students, faculty, and staff remain on site.",
  intro: "Schools and universities maintain water systems, kitchens, and exteriors while occupied, so chemistry handling documentation matters. VertKleen supports HMIS 0-0-0 cleaning and treatment options for campuses in use. Brevard County Schools proof sits behind the program file.",
  products: ["cr", "hcr", "watersafe60", "lam3"],
  proof: { img: "grout-moss", caption: "Occupied-campus exterior facility cleaning with VertKleen." }
},
{
  slug: "hvac-water",
  name: "HVAC / Water Treatment",
  icon: "ph-wind",
  h1: "The tower program, translated into cleaner chemistry.",
  sub: "Inhibitor, antimicrobial support, passivation, pH control, and ASHRAE 188 support for cooling-tower programs.",
  intro: "Cooling-tower programs combine inhibitor, antimicrobial support, descaling acid, pH control, and sometimes non-oxidizing biocide. VertKleen keeps the public product roster on WaterSafe60, Purgo, HCR, and CR, while DBNPA stays footnoted as a low-hazard program component specified separately.",
  products: ["watersafe60", "purgo", "hcr", "cr"],
  proof: { img: "ac-coil", caption: "HVAC coils and water systems cleaned and treated with aluminum-fin compatibility reviewed." }
},
{
  slug: "plumbing",
  name: "Plumbing",
  icon: "ph-wrench",
  h1: "Scale removal should not bring muriatic acid inside.",
  sub: "Water lines, fixtures, water heaters, and drains cleared of scale and calcium without hydrochloric acid handling.",
  intro: "Calcium, scale, and rust in supply lines, fixtures, and water heaters are usually attacked with hydrochloric-acid products or CLR. VertKleen Descaler clears buildup without hydrochloric acid handling, with metal compatibility reviewed for occupied-building plumbing work; HCR handles heavier rust passivation.",
  products: ["descaler", "hcr", "neutral"],
  proof: { img: "ac-coil", caption: "Scale and calcium cleared from coils and water-side surfaces with Descaler." }
}
];

const NAV = [
  ["index.html", "MASEST"], ["products.html", "Products"], ["services.html", "Services"], [null, "Use Cases"],
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
    ["Yellowfin helm and console cleaned with VertKleen Torque", "Helm and console cleaned"],
    ["Hull and topsides washed dockside without acid brighteners", "Topsides washed dockside"],
    ["43-foot Yellowfin finished bow to transom", "Finished bow to transom"]
  ],
  "manufacturing": [
    ["Greasy intake assembly before VertKleen CRHD degreasing", "Greasy intake, pre-degrease"],
    ["Filter media cleared of grease with fibers intact", "Media cleared, fibers intact"],
    ["Degreased filter restored to clean media", "Restored to clean media"]
  ],
  "distribution-cold-storage": [
    ["Walmart distribution center CRHD degreasing proof", "CRHD degreasing proof"],
    ["Walmart perishable distribution center on-site assessment", "Perishable DSC assessment"],
    ["Walmart refrigeration descaling results table", "Refrigeration results"]
  ],
  "food-beverage": [
    ["Brewery fermenters cleaned with VertKleen CR and HCR", "Fermenters cleaned, CR + HCR"],
    ["Tank interior cleaned back to bright stainless", "Tank back to bright stainless"],
    ["Heat-exchanger plates descaled for CIP service", "Heat-exchanger plates descaled"]
  ],
  "healthcare": [
    ["Facility AC coil cleaned in place with aluminum-fin compatibility reviewed", "AC coil cleaned in place"],
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

const PROOF_IMAGE_DIMS = {
  "ac-coil": [839, 471],
  brewery: [1200, 900],
  "ddc-rust": [1200, 579],
  "farm-rust": [740, 967],
  "grout-moss": [919, 690],
  marine: [1175, 1125],
  "walmart-dc-crhd": [708, 513],
};

const enc = (s) => encodeURIComponent(s).replace(/'/g, "%27");

const INDUSTRY_DETAILS = {
  "oil-gas": ["Chemicals replaced", "Hydrochloric acid (muriatic acid), solvent degreasers, and aggressive rust removers used on rigs, terminals, pipeline parts, and tank-farm equipment.", "Bundle: HCR for rust and passivation, Descaler for mineral scale, CRHD for oily soils, Neutral for sensitive surfaces."],
  marine: ["Buyer objection", "Confined air, aluminum brightwork, glass, and dockside access make acid brighteners and solvent washes hard to manage.", "Bundle: Torque for wash-and-wax, AlumiBrite for aluminum, MultiWash for exterior cleaning, CRHD for machinery spaces."],
  manufacturing: ["Common replacements", "Acid descalers, caustic CIP cleaners, and solvent degreasers used across lines, floors, parts, and maintenance bays.", "Bundle: HCR for scale and rust, CR for alkaline cleaning, CRHD for heavy grease, Descaler for mineral deposits."],
  "distribution-cold-storage": ["Walkdown sequence", "Walmart perishable DSC materials check banana-room mildew, refrigerated hard-to-reach areas, ammonia coil scale, condenser and drain-line buildup, kitchen grease, and pilot readiness.", "Bundle: Descaler for ammonia coils and heat-transfer circuits, CRHD for fryer, hood, floor, forklift and parts degreasing, MultiWash and Purgo for spot mildew and odor-control support."],
  "food-beverage": ["Sector proof", "Brewery and distillery work centers on CR and HCR sequences for tanks, heat exchangers, protein soil, beer stone, and hood or drain cleaning.", "Bundle: CR for alkaline wash, HCR for acid wash, CRHD for grease, Neutral where sensitive surfaces or seals matter."],
  healthcare: ["Buyer objection", "Occupied facilities cannot trade maintenance needs for fume events, shutdowns, or uncontrolled chemical exposure.", "Bundle: WaterSafe60 and Purgo for scoped water-program support, HCR for passivation, CR for pH and alkaline cleaning."],
  construction: ["Common replacements", "Hydrochloric acid (muriatic acid), bleach, and caustic degreasers used for concrete cleanup, equipment, pavers, and exterior biological growth.", "Bundle: Descaler for concrete and calcium, HCR for rust, CRHD for equipment grease, LAM3 for exterior growth."],
  "military-government": ["Procurement signal", "Public buyers need CAGE, NAICS, SDS, procurement files, and controlled documents before switching a chemistry standard.", "Bundle: HCR, Descaler, CRHD, and AlumiBrite cover rust, scale, grease, and aluminum restoration with documented routing."],
  education: ["Sector proof", "Campus buyers need cleaning and water-treatment options that work while students, faculty, and staff remain on site.", "Bundle: CR and HCR for facility cleaning, WaterSafe60 for water systems, LAM3 for exterior biological growth."],
  "hvac-water": ["Recommended replacement map", "Cooling tower programs replace inhibitor, oxidizing antimicrobial support, non-oxidizing biocide, acid clean, pH adjustment, and degreasing functions.", "Bundle: WaterSafe60, Purgo, HCR, CR, and Neutral, with DBNPA footnoted separately when the non-oxidizing rotation is specified."],
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
        <h2 class="headline">What ${ind.name} buyers need documented first.</h2>
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
        areaServed: "United States and international commercial accounts",
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
        serviceType: `${ind.name} industrial cleaning chemistry replacement`,
        url: `https://masest.co/industries/${ind.slug}.html`,
        areaServed: "United States and international commercial accounts"
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
        <span class="eyebrow">Next move</span>
          <h2 class="headline">Put the current chemical on the table.</h2>
          <p class="subhead">Send the legacy product, surface, soil, volume, and buying deadline. MASEST routes the replacement, proof, sample, or partner path from there.</p>
      </div>
      <div class="cta-grid">
        <a class="cta-tile" href="${q("quote")}"><i class="ph ph-tag" aria-hidden="true"></i><span class="cta-tile-t">Price the replacement</span><span class="cta-tile-s">Product, volume, freight path</span></a>
        <a class="cta-tile" href="${q("audit")}"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span class="cta-tile-t">Map the current drum</span><span class="cta-tile-s">Legacy chemical to VertKleen fit</span></a>
        <a class="cta-tile" href="${q("sample")}"><i class="ph ph-package" aria-hidden="true"></i><span class="cta-tile-t">Run a site trial</span><span class="cta-tile-s">Trial 3 to 5 products on site</span></a>
        <a class="cta-tile" href="${q("distributor")}"><i class="ph ph-handshake" aria-hidden="true"></i><span class="cta-tile-t">Build a route</span><span class="cta-tile-s">BSC, distributor, white-label</span></a>
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
        <h2 class="headline">Field proof from ${ind.name} sites.</h2>
        <p class="subhead">Documented work from the VertKleen field library.</p>
      </div>
      <div class="ind-gallery">${figs}
      </div>
    </div>
  </section>`;
}

function proofImageDimsAttr(img) {
  const [width, height] = PROOF_IMAGE_DIMS[img] || [1200, 900];
  return `width="${width}" height="${height}"`;
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
<link rel="stylesheet" href="../css/style.css?v=20260622a">
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
        <h2 class="headline">Why VertKleen fits ${ind.name}.</h2>
        <p>${ind.intro}</p>
        <a class="btn btn-ink" href="../proof.html">See the proof</a>
      </div>
      <figure class="ind-intro-photo">
        <img src="../img/proof/cases/${ind.proof.img}.webp" alt="${ind.proof.caption.replace(/"/g, "&quot;")}" loading="lazy" ${proofImageDimsAttr(ind.proof.img)}>
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
        <p class="subhead">Replacement options for the legacy chemistry this work usually relies on first.</p>
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
