#!/usr/bin/env node
/* Generate per-industry landing pages into site/industries/<slug>.html
   from a single data source. Re-runnable; overwrites. Pages are static HTML
   (real, indexable URLs); product cards are filled at runtime by
   initIndustryProducts() in js/main.js so they stay in sync with PRODUCTS{}.

   Run from anywhere:  node site/tools/gen_industries.mjs
*/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { STYLE_VERSION } from "./static-release.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "industries");
const { industries: INDUSTRY_APPLICATIONS } = JSON.parse(
  readFileSync(resolve(HERE, "..", "data", "industry-applications.json"), "utf8"),
);
const { assets: SITE_IMAGES } = JSON.parse(
  readFileSync(resolve(HERE, "..", "data", "content", "site-images.json"), "utf8"),
);
const INDUSTRY_APPLICATIONS_BY_SLUG = new Map(
  INDUSTRY_APPLICATIONS.map((industry) => [industry.slug, industry]),
);
const SITE_IMAGE_BY_PATH = new Map(SITE_IMAGES.map((asset) => [asset.public_url, asset]));

const INDUSTRIES = INDUSTRY_APPLICATIONS.map((application) => ({
  slug: application.slug,
  icon: application.icon,
  h1: application.headline,
  name: application.label,
  sub: application.marketing,
  intro: application.operating_outcome,
  products: [...application.products],
  ctaLabel: application.cta_label,
  ctaType: application.cta_type,
  primaryCta: application.kind === "supplemental" || application.hero_cta
    ? application.cta_label
    : "",
  primaryType: application.cta_type,
}));

const NAV = [
  ["", "MASEST"], ["products", "Products"], ["services", "Services"], [null, "Use Cases"],
  ["industries", "Industries"], ["proof", "Proof"],
  ["resources", "Resources"]
];

// Generated task imagery. Each key is an exact route slug; do not reuse a
// scene on a merely related industry page.
const TASK_GALLERY = {
  "aviation-fbos-mro-airports": [
    ["Aircraft tug and ground-power unit undergoing a contained low-pressure wash after a wet chemical dwell", "Ground-support equipment wash after wet dwell"],
    ["Aviation maintenance components moving from greasy to clean in an aqueous parts washer", "Aviation components through a contained parts wash"],
    ["Ride-on auto-scrubber recovering wet hydraulic-fluid and tire-mark soil from an aircraft hangar floor", "Hangar floor degreasing with scrub-and-recovery"],
  ],
  "breweries-distilleries-wineries": [
    ["Fixed CIP spray ball rinsing krausen and beer-stone residue from a stainless fermenter", "Fermenter CIP from wet residue to clean stainless"],
    ["Brewery heat-exchanger tube sheet undergoing contained cleaning with a recirculation cart", "Brewery exchanger cleaning in progress"],
    ["Fixed CIP spray head moving from wet mash residue to clean stainless inside an empty lauter tun", "Mash-tun CIP from wet residue to clean stainless"],
  ],
  construction: [
    ["Technician rinsing wet-treated concrete residue from reusable steel formwork on a contained wash pad", "Wet dwell and rinse on reusable formwork"],
    ["Concrete-stained reusable form panels and tools staged on a contained construction wash pad", "Reusable forms staged for final cleaning"],
    ["Concrete-pump hopper moving from wet cement residue through rinse to clean metal over a lined washout", "Pump-hopper cleanout with captured wash water"],
  ],
  "data-centers": [
    ["Fouled plate heat exchanger opened beside a closed recirculating cleaning skid in a data-center mechanical room", "Fouled plates staged for a recirculating clean"],
    ["Isolated chilled-water pump and strainer skid connected for a contained closed-loop flush", "Cooling-loop flush connected and contained"],
  ],
  "distribution-cold-storage": [
    ["Low-foam floor scrubber recovering tire marks and oily soil in a refrigerated distribution aisle", "Low-foam auto-scrub and recovery"],
    ["Technician cleaning an isolated cold-storage evaporator coil over a recovery pan", "Evaporator-coil cleaning in progress"],
  ],
  "drone-cleaning-companies": [
    ["Tethered cleaning drone washing an inaccessible commercial glass facade with a connected low-pressure spray bar", "Tethered facade wash on inaccessible glass"],
    ["Tethered cleaning drone treating wet algae on an inaccessible steep residential roof", "Steep-roof treatment from wet dwell to clean"],
  ],
  education: [
    ["Cleaned campus stair and masonry walkway during controlled dry-down", "Campus stair wash completed for dry-down"],
    ["School hydronic heat exchanger connected to a contained recirculation cleaning cart", "Hydronic heat exchanger on a closed-loop clean"],
    ["Walk-behind auto-scrubber recovering wet soil and scuffs from an empty school gym floor", "School gym floor scrub and recovery", "schools-universities-01.webp"],
    ["Connected low-pressure rinse cleaning an isolated school air-handler coil over recovery", "School air-handler coil cleaning", "schools-universities-02.webp"],
  ],
  "fleet-trucking-car-washes": [
    ["Road-film-covered tractor moving through a fixed commercial wash arch toward a clean finish", "Fleet road-film removal through a fixed wash arch"],
    ["Truck wheel hubs and service parts moving from greasy to clean in an aqueous parts washer", "Fleet parts through a contained aqueous wash"],
    ["Empty refrigerated trailer interior moving from wet soil through low-pressure rinse to a clean lane", "Contained trailer-interior washout"],
  ],
  "food-beverage": [
    ["Clean-in-place spray ball rinsing the interior of a stainless beverage process tank", "CIP spray-ball coverage inside a process tank"],
    ["Food-process heat-exchanger plates showing mineral film beside cleaned stainless plates", "Fouled and cleaned heat-exchanger plates"],
    ["Mounted spray bar and rotary brush cleaning organic process film from an empty stainless food conveyor", "Food conveyor cleaning before sanitation", "food-processing-agriculture-01.webp"],
  ],
  agriculture: [
    ["Wet-treated organic residue being rinsed from an empty agricultural hopper and auger", "Agricultural hopper wash after wet dwell", "food-processing-agriculture-02.webp"],
    ["Dairy milking clusters and stainless lines connected to a contained CIP wash circuit", "Milking-equipment CIP before sanitation", "food-processing-agriculture-03.webp"],
  ],
  "golf-courses": [
    ["Commercial reel-mower components being washed on a contained golf maintenance pad", "Turf-equipment wash in progress"],
    ["Scaled golf-course irrigation valves and sprinkler parts staged beside cleaned components", "Irrigation parts staged from fouled to clean"],
    ["Electric golf cart exterior moving from wet turf soil through a protected low-pressure rinse", "Golf-cart exterior wash with protected electricals"],
    ["Rotary floor scrubber cleaning soap and mineral film from an empty locker-room shower", "Locker-room tile and grout cleaning", "golf-courses-sports-facilities-01.webp"],
    ["Connected surface cleaner removing wet-treated soil from a stadium concrete walkway", "Stadium walkway cleaning with recovery", "golf-courses-sports-facilities-02.webp"],
  ],
  healthcare: [
    ["Hospital mechanical-room heat exchanger connected to an isolated recirculation cleaning cart", "Water-side heat-exchanger clean in progress"],
    ["Ground-based technician using a connected low-pressure fan spray on an overhead hospital entrance canopy", "Low-pressure canopy wash from ground level"],
  ],
  "healthcare-senior-living": [
    ["Walk-behind scrubber recovering laundry soil from a senior-living service floor", "Commercial laundry floor cleaning and recovery"],
    ["Connected rotary brush cleaning mineral and soap film from an empty accessible shower", "Pre-disinfection shower cleaning"],
  ],
  "hotels-property-management": [
    ["Property-maintenance technician brushing mineral scale from resort pool waterline tile", "Mineral-scale removal at the pool waterline"],
    ["Hotel facade biological staining under a controlled low-pressure exterior wash", "Exterior staining under low-pressure wash"],
    ["Fixed internal rinse jets cleaning detergent and mineral film from a hotel commercial washer drum", "Commercial washer drum cleaning", "hotels-resorts-property-management-01.webp"],
    ["Hotel kitchen hood filters moving from wet greasy dwell through fixed rinse to clean", "Back-of-house hood-filter cleaning", "hotels-resorts-property-management-02.webp"],
  ],
  "hvac-water": [
    ["Fin-safe low-pressure cleaning on an isolated aluminum condenser coil", "Fin-safe condenser-coil cleaning"],
    ["Cooling-tower fill media undergoing contained cleaning during a shutdown", "Cooling-tower fill cleaning during shutdown"],
    ["Air-handler condensate pan moving from wet sludge through brush and recovery to clean metal", "Condensate-pan cleaning and recovery"],
  ],
  manufacturing: [
    ["Isolated stamping press bed after controlled degreasing during maintenance", "Stamping-press degreasing during isolation"],
    ["Machined parts completing a contained aqueous parts-wash cycle", "Aqueous parts-wash cycle complete"],
    ["Manufacturer-approved reusable filter elements shown at wet soak, gentle rinse, and clean air-dry stages", "Reusable industrial filter cleaning sequence"],
  ],
  marine: [
    ["Boat hull and waterline being washed on a contained boatyard service pad", "Hull and waterline wash on a contained pad"],
    ["Marine technician removing oily residue from a yacht bilge with absorbent recovery", "Bilge degreasing in progress"],
  ],
  "marine-marinas-boatyards": [
    ["Wet-treated oxidation and waterline film being rinsed from an aluminum workboat on a contained pad", "Aluminum workboat wash after wet dwell"],
    ["Outboard service components moving from wet oily residue to a clean dry finish", "Marine service parts from dwell to clean"],
  ],
  "mechanical-contractors-water-treatment": [
    ["Shell-and-tube heat-exchanger tube sheet connected to a contained recirculation cleaning cart", "Exchanger tube-sheet cleaning in progress"],
    ["Commercial boiler heat-exchanger core connected to an isolated closed-loop flush cart", "Boiler heat-exchanger closed-loop clean"],
  ],
  "military-government": [
    ["Public works fleet undercarriage undergoing a controlled wash with drain recovery", "Fleet undercarriage wash with recovery"],
    ["Rust-affected public works pump parts staged on a contained maintenance tray", "Pump parts staged for rust treatment"],
  ],
  "municipalities-water-utilities": [
    ["Utility technician agitating wet-treated mineral deposits on a removed pump impeller over containment", "Wet dwell and agitation on a pump impeller"],
    ["Utility technician removing mineral scale from an isolated gate valve on a service bench", "Valve scale removal in progress"],
    ["Removed lift-station pump and float components undergoing a contained above-ground rinse", "Lift-station equipment cleaning above ground"],
  ],
  "oil-gas": [
    ["Technician degreasing a de-inventoried and gas-free oilfield valve manifold over containment", "Gas-free valve-manifold degreasing"],
    ["Industrial heat-exchanger plates showing fouling beside cleaned metal during an isolated service clean", "Heat-exchanger plates from fouled to clean"],
    ["Wet hydrocarbon residue being rinsed from an isolated industrial pump skid over containment", "Industrial pump-skid clean after wet dwell", "oil-gas-industrial-plants-01.webp"],
    ["Fixed low-pressure manifold cleaning wet oily residue from an isolated fin-fan cooler coil", "Fin-fan cooler cleaning during shutdown", "oil-gas-industrial-plants-02.webp"],
  ],
  plumbing: [
    ["Tankless water heater connected to a compact closed-loop descaling flush pump", "Tankless-heater flush loop in service"],
    ["Removed pipe flanges shown at wet dwell, brush agitation, and clean dry stages", "Flange scale from wet dwell to clean finish"],
  ],
  "pressure-washing-soft-wash-contractors": [
    ["Contractor using a connected ground-based soft-wash pole on wet algae at a steep residential roof", "Steep-roof soft wash from ground level"],
    ["Connected surface cleaner moving from wet chemical dwell to a clean storefront walkway", "Storefront concrete cleaning with recovery"],
    ["Ground-based contractor moving wet siding soil through a gentle rinse to a clean facade", "Low-pressure siding wash with surface protection"],
  ],
  "restaurants-commercial-kitchens": [
    ["Commercial hood filters moving from wet grease dwell through fixed rinse to clean", "Hood-filter degreasing and rinse"],
    ["Wet softened grease being agitated from an empty commercial cookline during shutdown", "Cookline degreasing before rinse and sanitation"],
    ["Walk-behind auto-scrubber recovering wet grease from an empty commercial-kitchen tile floor", "Kitchen-floor degreasing before sanitation"],
  ],
  "solar-panel-cleaning": [
    ["Technician using a connected water-fed soft brush on utility-scale solar panels", "Water-fed soft-brush cleaning"],
    ["Autonomous soft-brush robot leaving a clean pass across dusty photovoltaic panels", "Automated soft-brush pass in progress"],
    ["Rail-guided soft-brush carriage cleaning a wet dusty section of utility-scale solar modules", "Rail-guided module-row cleaning", "solar-farms-panel-cleaning-01.webp"],
    ["Connected rail-mounted brush moving from wet spotted modules to a clean dry band", "Wet dwell and soft-brush pass on solar modules", "solar-farms-panel-cleaning-02.webp"],
  ],
  "warehousing-distribution-centers": [
    ["Connected surface cleaner moving from wet pallet grime to a clean loading-dock lane", "Loading-dock cleaning with recovery"],
    ["Wet greasy soil being rinsed from a protected electric forklift in a recovery wash bay", "Forklift maintenance-bay cleaning"],
  ],
};

// Generated sample scenes normally belong to the root industry catalog.
// This one supplemental scene has no catalog card, so keep it on its exact route.
const SAMPLE_GALLERY = {
  "pressure-washing-soft-wash-contractors": [
    "Exterior-cleaning contractors preparing chemistry and tools for a controlled wash",
    "Exterior-cleaning chemistry and tool setup",
  ],
};

// Owner-confirmed public field media. Registry metadata keeps public context
// separate from qualified proof until method, endpoint, and limitations exist.
const FIELD_GALLERY_SLUGS = new Set([
  "oil-gas",
  "marine",
  "manufacturing",
  "food-beverage",
  "healthcare",
  "construction",
  "military-government",
  "education",
  "hvac-water",
  "plumbing",
]);

const enc = (s) => encodeURIComponent(s).replace(/'/g, "%27");
const htmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const htmlAttr = (s) => htmlText(s).replace(/"/g, "&quot;");

const LABEL_VARIANTS = {
  "fb-cip-cr": {
    market: "FB label",
    name: "VertKleen CIP CR",
    subtitle: "50% caustic soda replacement · brewery CIP",
    image: "cip-cr-studio.webp",
    productHref: "cr",
    directions: [
      ["Light / krausen soil", "0.5 L per 10 gal; circulate hot (>140°F), then rinse"],
      ["Moderate soil", "1 L per 10 gal; circulate, then rinse"],
      ["Severe soil", "1.5 L per 10 gal; circulate, then rinse with water"],
    ],
  },
  "fb-cip-hcr": {
    market: "FB label",
    name: "VertKleen CIP HCR",
    subtitle: "Synthetic acid · beer stone remover · brewery CIP",
    image: "cip-hcr-studio.webp",
    productHref: "hcr",
    directions: [
      ["Light beer stone", "0.5 L per 10 gal; circulate, then rinse"],
      ["Moderate", "1 L per 10 gal; circulate, then rinse"],
      ["Severe", "1.5 L per 10 gal; circulate, then rinse with water"],
    ],
  },
  "fb-crhd": {
    market: "FB label",
    name: "VertKleen CR HD",
    subtitle: "Heavy-duty kitchen & bar degreaser",
    image: "crhd-food-beverage-studio.webp",
    productHref: "crhd",
    directions: [
      ["Kitchen line — light grease", "Spray at 1:16, dwell 3–5 min, then wipe or rinse"],
      ["Bar mats, fryers & hoods", "Apply at 1:8, agitate, then rinse"],
      ["Stubborn / baked-on buildup", "Apply neat, dwell, then rinse"],
    ],
  },
  "fb-multiwash": {
    market: "FB label",
    name: "VertKleen MultiWash",
    subtitle: "Multi-surface cleaner · deodorizer",
    image: "multiwash-food-beverage-studio.webp",
    productHref: "multiwash",
    directions: [
      ["Bar tops, glass & tables", "Fill a 32 oz spray bottle at 1:16; mist and wipe"],
      ["Floors", "Dilute 1:32 in a mop bucket or auto-scrubber"],
      ["Restrooms & fixtures", "Spray at 1:16, let stand, then wipe"],
      ["Upholstery & booths", "Spray at 1:16, blot and air-dry"],
    ],
  },
  "pw-crhd": {
    market: "PW label",
    name: "VertKleen CR HD",
    subtitle: "Heavy-duty degreaser · fleet & concrete",
    image: "crhd-pressure-wash-studio.webp",
    productHref: "crhd",
    directions: [
      ["Fleet & equipment", "Apply at 1:20 via downstream injector or foam cannon; dwell, then rinse"],
      ["Concrete oil & grease", "Apply at 1:8, agitate and rinse"],
      ["Heavy / baked-on buildup", "Apply neat, dwell, then rinse"],
    ],
  },
  "pw-crs": {
    market: "PW label",
    name: "VertKleen CRS",
    subtitle: "Calcium, rust & scale · compatibility tested",
    image: "crs-studio.webp",
    productHref: "descaler",
    directions: [
      ["Rust & fertilizer stains", "Apply at 1:4, dwell 3–5 min, agitate, then rinse"],
      ["Battery / deep stains", "Apply at 1:2, dwell, then rinse"],
      ["Heavy scale & calcium", "Apply neat, dwell, then rinse"],
    ],
  },
  "pw-multiwash": {
    market: "PW label",
    name: "VertKleen MultiWash",
    subtitle: "Bleach / sodium hypochlorite replacement",
    image: "multiwash-pressure-wash-studio.webp",
    productHref: "multiwash",
    directions: [
      ["House wash / soft wash", "Apply through a downstream injector at 1:16; dwell, then low-pressure rinse"],
      ["Concrete & flatwork", "Apply at 1:8, agitate and rinse"],
      ["General surfaces", "Dilute 1:32, apply and rinse"],
    ],
  },
  "gym-multiwash": {
    market: "Gym label",
    name: "VertKleen MultiWash",
    subtitle: "Gym · fitness · studio & clinic cleaner",
    image: "multiwash-gym-studio.webp",
    productHref: "multiwash",
    directions: [
      ["Equipment, machines & mats", "Dilute 1:32; mist onto a cloth or surface and wipe. Do not soak electronics"],
      ["Floors & tile", "Dilute 5:1 in a mop bucket or auto-scrubber"],
      ["Glass & mirrors", "Dilute 4:1 and wipe streak-free"],
      ["Heavy soil & grout", "Dilute 2:1; apply, let stand, agitate and rinse"],
    ],
  },
  "gym-purgo": {
    market: "Gym label",
    name: "VertKleen Pūrgo",
    subtitle: "High-touch cleaner · deodorizer",
    image: "purgo-studio.webp",
    productHref: "purgo",
    directions: [
      ["High-touch odor", "Dilute 1:16; spray onto equipment, benches and rails; let stand, then wipe"],
      ["General surfaces", "Dilute 1:32; mist and wipe down — no rinse required"],
      ["Heavy fouling", "Dilute 1:5; apply, allow full contact time, then wipe"],
    ],
  },
};

const INDUSTRY_LABEL_VARIANTS = {
  "food-beverage": ["fb-cip-cr", "fb-cip-hcr", "fb-crhd", "fb-multiwash"],
  "breweries-distilleries-wineries": ["fb-cip-cr", "fb-cip-hcr"],
  "restaurants-commercial-kitchens": ["fb-crhd", "fb-multiwash"],
  "pressure-washing-soft-wash-contractors": ["pw-crhd", "pw-crs", "pw-multiwash"],
  "drone-cleaning-companies": ["pw-crhd", "pw-crs", "pw-multiwash"],
  "fleet-trucking-car-washes": ["pw-crhd", "pw-multiwash"],
  "golf-courses": ["gym-multiwash", "gym-purgo"],
};

function labelVariantCard(key) {
  const variant = LABEL_VARIANTS[key];
  if (!variant) throw new Error(`Missing label variant: ${key}`);
  const directions = variant.directions.map(([use, dilution]) =>
    `<li><strong>${htmlText(use)}:</strong>&nbsp; ${htmlText(dilution)}</li>`,
  ).join("");

  return `<article class="prod-card" data-label-variant="${key}">
        <img class="product-shot" src="../img/products/${variant.image}" alt="${htmlText(variant.name)} ${variant.market} jug" width="900" height="1200" loading="lazy">
        <span class="catalog-type">${variant.market}</span>
        <h3>${htmlText(variant.name)}</h3>
        <div class="replaces">${htmlText(variant.subtitle)}</div>
        <h4>Label dilution / concentration</h4>
        <ul class="product-fit-list" aria-label="${htmlText(variant.name)} label directions">${directions}</ul>
        <div class="prod-actions">
          <a class="btn btn-secondary" href="../products/${variant.productHref}">View base product</a>
          <a class="btn btn-primary" href="../contact?type=quote&amp;product=${enc(variant.name)}&amp;label=${enc(variant.market)}">Request this label</a>
        </div>
      </article>`;
}

function industryLabelVariantsBlock(ind) {
  const keys = INDUSTRY_LABEL_VARIANTS[ind.slug];
  if (!keys?.length) return "";
  const cards = keys.map(labelVariantCard).join("\n      ");

  return `\n<section class="section section-slim" data-industry-label-variants="${ind.slug}">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Industry label variants</span>
        <h2 class="headline">Use the label built for this work.</h2>
        <p class="subhead">Use the application-specific directions shown on each label. Open the base product for specs, documentation, and purchasing.</p>
      </div>
      <div class="prod-grid prod-grid-rec">
      ${cards}
      </div>
    </div>
  </section>`;
}

const INDUSTRY_DETAIL_SLUGS = new Set([
  "oil-gas", "marine", "manufacturing", "distribution-cold-storage",
  "food-beverage", "healthcare", "construction", "golf-courses",
  "military-government", "education", "municipalities-water-utilities",
  "hvac-water", "data-centers", "plumbing", "hotels-property-management",
  "solar-panel-cleaning",
]);

function industryDetailBlock(ind) {
  if (!INDUSTRY_DETAIL_SLUGS.has(ind.slug)) return "";
  return `<section class="section section-slim">
    <div class="wrap ind-specific">
      <div class="section-head">
        <h2 class="headline">What matters before you switch chemistry.</h2>
      </div>
      <div class="proof-callout">
        <p>Prove removal on the actual soil and surface before replacing the incumbent.</p>
        <p>Compare cost per completed job across labor, rinse water, wastewater handling, downtime, and return to service.</p>
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
        description: "VertKleen pairs industrial cleaning performance with HMIS 0-0-0 across every current product MASEST offers.",
        areaServed: "United States and international commercial accounts",
        contactPoint: { "@type": "ContactPoint", contactType: "sales", url: "https://masest.co/contact" }
      },
      {
        "@type": "WebPage",
        name: `${ind.name} VertKleen replacements`,
        url: `https://masest.co/industries/${ind.slug}`,
        description: ind.sub.replace(/&amp;/g, "&")
      },
      {
        "@type": "Service",
        name: `${ind.name} VertKleen replacement program`,
        provider: { "@type": "Organization", name: "MASEST Consulting LLC", url: "https://masest.co/" },
        serviceType: `${ind.name} industrial cleaning chemistry replacement`,
        url: `https://masest.co/industries/${ind.slug}`,
        areaServed: "United States and international commercial accounts"
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://masest.co/" },
          { "@type": "ListItem", position: 2, name: "Industries", item: "https://masest.co/industries" },
          { "@type": "ListItem", position: 3, name: ind.name, item: `https://masest.co/industries/${ind.slug}` }
        ]
      }
    ]
  };
}

function ctaBlock(ind) {
  const q = (type) => `../contact?industry=${enc(ind.name)}&type=${type}`;
  return `
  <section class="block-dark">
    <div class="wrap cta-band">
      <div class="section-head center">
        <span class="eyebrow">Scope the job</span>
        <h2 class="headline">Plan the next ${ind.name} cleaning task.</h2>
      </div>
      <div class="hero-ctas">
        <a class="btn btn-light" href="${q(ind.ctaType)}" data-industry-primary-cta>${ind.ctaLabel}</a>
      </div>
    </div>
  </section>`;
}

function imageGalleryBlock(ind) {
  const application = INDUSTRY_APPLICATIONS_BY_SLUG.get(ind.slug);
  const evidence = application?.field_evidence;
  if (!evidence) throw new Error(`${ind.slug}: missing field evidence registry`);

  const tasks = TASK_GALLERY[ind.slug];
  const taskFigs = (tasks || []).map(([alt, caption, filename], index) => `
        <figure class="ind-shot ind-shot-wide" data-evidence-kind="generated">
          <img src="../img/industries/tasks/${filename || `${ind.slug}-${String(index + 1).padStart(2, "0")}.webp`}" alt="${alt.replace(/"/g, "&quot;")}" loading="lazy" decoding="async" width="1200" height="750">
          <figcaption><span class="ind-media-kind">Cleaning setup</span>${caption}</figcaption>
        </figure>`).join("");

  const sample = SAMPLE_GALLERY[ind.slug];
  const sampleFig = sample ? `
        <figure class="ind-shot ind-shot-wide" data-evidence-kind="generated">
          <img src="../img/industries/samples/${ind.slug}.webp" alt="${sample[0].replace(/"/g, "&quot;")}" loading="lazy" decoding="async" width="840" height="520">
          <figcaption><span class="ind-media-kind">Cleaning setup</span>${sample[1]}</figcaption>
        </figure>` : "";

  const shots = FIELD_GALLERY_SLUGS.has(ind.slug)
    ? [1, 2, 3].map((index) => {
      const path = `/img/industries/${ind.slug}/g${index}.webp`;
      const asset = SITE_IMAGE_BY_PATH.get(path);
      if (!asset) throw new Error(`${ind.slug}: missing canonical field image ${path}`);
      return asset;
    })
    : [];
  if (shots.length && evidence.status === "absent") {
    throw new Error(`${ind.slug}: field images cannot use absent evidence status`);
  }
  if (!shots.length && evidence.status !== "absent" && !application.case_summary) {
    throw new Error(`${ind.slug}: ${evidence.status} evidence has no field images`);
  }
  const fieldKind = evidence.status === "qualified" ? "field-proof" : "field-context";
  const fieldLabel = "Field result";
  const fieldFigs = shots.map((asset, i) => {
    if (!asset.alt?.trim() || !asset.width || !asset.height) {
      throw new Error(`${ind.slug}: incomplete canonical field image g${i + 1}`);
    }
    const alt = htmlAttr(asset.alt);
    return `
        <figure class="ind-shot" data-evidence-kind="${fieldKind}">
          <img src="..${asset.public_url}" alt="${alt}" loading="lazy" width="${asset.width}" height="${asset.height}">
          <figcaption><span class="ind-media-kind">${fieldLabel}</span>${alt}</figcaption>
        </figure>`;
  }).join("");
  const figs = `${taskFigs}${sampleFig}${fieldFigs}`;
  if (!figs) return "";

  return `
  <section class="section section-slim ind-gallery-sec" aria-label="${ind.name} image gallery">
    <div class="wrap">
      <div class="ind-gallery ind-image-gallery">${figs}
      </div>
    </div>
  </section>`;
}

function primaryCtaBlock(ind) {
  if (!ind.primaryCta) return "";
  const href = `../contact?industry=${enc(ind.name)}&type=${enc(ind.primaryType || "quote")}`;
  return `
      <div class="hero-actions">
        <a class="btn btn-primary" href="${href}">${ind.primaryCta}</a>
        <a class="btn btn-secondary" href="../products">View products</a>
      </div>`;
}

function page(ind) {
  const nav = NAV.map(([href, label]) => {
    if (href === null) return `    <span>${label}</span>`;
    const content = label === "MASEST" ? `<b>${label}</b>` : label;
    return `    <a href="../${href}"${href === "industries" ? ' aria-current="page"' : ""}>${content}</a>`;
  }).join("\n");
  const plain = ind.h1.replace(/&amp;/g, "&").replace(/<[^>]+>/g, "");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${htmlText(ind.name)} | MASEST VertKleen</title>
<meta name="description" content="${ind.sub.replace(/&amp;/g, "&").replace(/"/g, "&quot;")}">
<meta name="theme-color" content="#fafbfc">
<meta property="og:title" content="${htmlText(ind.name)} | MASEST VertKleen">
<meta property="og:description" content="${ind.sub.replace(/&amp;/g, "&").replace(/"/g, "&quot;")}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MASEST VertKleen">
<link rel="icon" type="image/png" href="../img/favicon-enhanced.png?v=20260617c">
<link rel="stylesheet" href="../vendor/phosphor/style.css">
<link rel="stylesheet" href="../css/style.css?v=${STYLE_VERSION}">
<link rel="stylesheet" href="../css/navigation.css?v=20260713a">
<link rel="stylesheet" href="../css/components.css?v=20260619b">
<script type="application/ld+json">${JSON.stringify(industrySchema(ind, plain))}</script>
<!-- seo:auto -->
<link rel="canonical" href="https://masest.co/industries/${ind.slug}">
<meta property="og:url" content="https://masest.co/industries/${ind.slug}">
<meta property="og:image" content="https://masest.co/img/og-card.png">
<meta name="twitter:card" content="summary_large_image">
<!-- /seo:auto -->
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
      <span class="eyebrow"><a href="../industries">Industries</a> &rsaquo; ${ind.name}</span>
      <h1 class="display">${ind.h1}</h1>
      <p class="subhead">${ind.sub}</p>${primaryCtaBlock(ind)}
    </div>
  </section>

  <section class="section section-slim">
    <div class="wrap ind-intro-copy">
      <span class="ind-icon"><i class="ph ${ind.icon}" aria-hidden="true"></i></span>
      <h2 class="headline">Cleaning chemistry for ${ind.name}.</h2>
      <p>${ind.intro}</p>
      <a class="btn btn-ink" href="../proof">See VertKleen results</a>
    </div>
  </section>

${industryDetailBlock(ind)}${imageGalleryBlock(ind)}

<section class="section section-slim">
<div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Recommended</span>
        <h2 class="headline">VertKleen products for ${ind.name}.</h2>
          <p class="subhead">Match the formula to the soil, surface, and cleaning process.</p>
      </div>
      <div class="prod-grid prod-grid-rec" data-ind-products="${ind.products.join(" ")}"></div>
    </div>
  </section>${industryLabelVariantsBlock(ind)}
<div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="industries/${ind.slug}" data-cms-region="body"></div>
${ctaBlock(ind)}
</main>

<script type="module" src="../js/main.js?v=20260807d"></script>
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
