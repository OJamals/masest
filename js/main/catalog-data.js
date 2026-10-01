const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";

const CATALOG_IMAGE_DIMENSIONS = Object.freeze({
  "img/products/alumibrite-desktop-label-20261001.webp": [1087, 1447],
  "img/products/descaler-desktop-label-20261001.webp": [810, 1080],
  "img/products/neutral-desktop-label-20261001.webp": [1098, 1433],
  "img/products/lam3-desktop-label-20261001.webp": [810, 1080],
  "img/products/crhd-desktop-label-20261001.webp": [810, 1080],
  "img/products/multiwash-general-desktop-label-20261001.webp": [900, 1200],
  "img/products/multiwash-gym-desktop-label-20261001.webp": [1108, 1420],
  "img/products/multiwash-food-beverage-desktop-label-20261001.webp": [810, 1080],
  "img/products/multiwash-pressure-wash-desktop-label-20261001.webp": [810, 1080],
  "img/products/multiwash-general-studio-v2.webp": [1086, 1448],
  "img/products/neutral-identity-studio-v2.webp": [1098, 1433],
  "img/products/cr-hd-low-foam-identity-studio-v1.webp": [1091, 1442],
  "img/products/lam3-studio-v2.webp": [1092, 1441],
  "img/products/masest-poster-transparent.png": [1193, 610],
  "img/products/dbnpa-studio.webp": [900, 822],
  "img/products/crs-studio.webp": [899, 1200],
  "img/products/neutral-studio.webp": [919, 1200],
});

export function catalogImageDimensions(src) {
  const key = String(src || "").replace(/^\/+/, "");
  const [width, height] = CATALOG_IMAGE_DIMENSIONS[key] || [900, 1200];
  return { width, height };
}

export const PRODUCTS = {
  hcr: {
    name: "VertKleen CIP HCR",
    cat: "acid",
    replaces: "Conventional brewery acids and beer-stone cleaners",
    hmis: "0-0-0",
    icon: "ph-flask",
    image: "img/products/cip-hcr-studio.webp",
    uses: [
      "Beer stone and mineral scale in brewery CIP",
      "Tank, keg, and line mineral-wash steps",
      "Rust removal from heat-exchanger plates",
      "316 stainless and compatible brewery circuits"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-hcr-sds.pdf" },
      { label: "CIP Product Label", file: "docs/labels/cip/vertkleen-cip-hcr-label-6x8.pdf" },
      { label: "Field Note: Pool Filter Cleaning", file: "docs/sds/vertkleen-hcr-pool-filter.pdf" },
      "Cooling Tower Case Study: Brevard County Schools"
    ]
  },
  "hcr-t16": {
    name: "VertKleen HVAC HCR",
    cat: "acid",
    replaces: "Hydrochloric-acid HVAC descaling",
    hmis: "0-0-0",
    icon: "ph-factory",
    image: "img/products/hvac-hcr-studio.webp",
    uses: [
      "Calcium and mineral scale in HVAC equipment",
      "Rust on compatible metal plates and drain areas",
      "Isolated heat-exchanger and boiler cleaning",
      "Recurring facility descaling and maintenance"
    ],
    docs: [
      { label: "HVAC Product Label", file: "docs/labels/hvac/vertkleen-hvac-hcr-label-6x8.pdf" },
      "Bulk HCR Program Profile",
      "HCR Product Guide"
    ]
  },
  cr: {
    name: "VertKleen CIP CR",
    cat: "alkaline",
    replaces: "50% caustic soda in brewery CIP",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/cip-cr-studio.webp",
    uses: [
      "Brewery lines, kegs, and tanks",
      "Krausen, yeast, protein, and fat removal",
      "Hot-circulation alkaline wash cycles",
      "Mash tanks and heat exchangers"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-cr-sds.pdf" },
      { label: "CIP Product Label", file: "docs/labels/cip/vertkleen-cip-cr-label-6x8.pdf" }
    ]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Caustic and solvent degreasers",
    hmis: "0-0-0",
    icon: "ph-drop",
    image: "img/products/neutral-desktop-label-20261001.webp",
    image_alt: "VertKleen Neutral jug with the supplied product label",
    image_replaces: ["img/products/neutral-studio.webp", "img/products/neutral-identity-studio-v2.webp"],
    uses: [
      "Heavy equipment and machinery degreasing",
      "Painted equipment and finished surfaces",
      "Shop floors, vehicle washing, and parts cleaning",
      "Facility and fleet maintenance"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-neutral-sds.pdf" }
    ]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "specialty",
    replaces: "Separate everyday cleaning products",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    image: "img/products/multiwash-gym-desktop-label-20261001.webp",
    image_alt: "VertKleen MultiWash jug with the supplied Gym package label",
    image_caption: "MultiWash Gym package shown. Follow your package directions.",
    image_replaces: ["img/products/multiwash-general-desktop-label-20261001.webp", "img/products/multiwash-general-studio-v2.webp", "img/products/multiwash-gym-studio.webp", "img/products/multiwash-pressure-wash-studio.webp", "img/products/multiwash-food-beverage-studio.webp"],
    uses: [
      "Floors, tile, grout, and everyday facility surfaces",
      "Gym equipment and shared spaces",
      "Exterior walls, concrete, and pressure-washing programs",
      "Marine decks, vinyl, glass, and routine grime"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-multiwash-sds.pdf" },
      { label: "General Product Label", file: "docs/labels/general/vertkleen-multiwash-label-6x8.pdf" },
    ]
  },
  watersafe60: {
    name: "WaterSafe60",
    cat: "water",
    replaces: "Harsh mineral acids in water treatment",
    hmis: "0-0-0",
    icon: "ph-waves",
    image: "img/products/watersafe60-studio.webp",
    uses: [
      "Potable-water pH adjustment",
      "Metered corrosion and scale control",
      "Offline pipe and equipment descaling",
      "Well cleaning, drilling, and rehabilitation"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/watersafe60-sds.pdf" },
      { label: "Product Label", file: "docs/labels/general/vertkleen-watersafe60-label-4x5.pdf" },
      { label: "Titration / Sigma Test Data", file: "docs/sds/watersafe60-titration-test.pdf" }
    ]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Conventional surface cleaners and odor-control treatments",
    hmis: "0-0-0",
    icon: "ph-shield-plus",
    image: "img/products/purgo-studio.webp",
    application_title: "Facility cleaning & drain care",
    application_caption: "Surface cleaning and odor control for locker rooms, restrooms, and maintenance areas.",
    uses: [
      "Facility surfaces: floors, counters, sinks, and waste containers",
      "Gyms, locker rooms, restrooms, and fleet interiors",
      "Odor-causing bacteria control on food- and non-food-contact surfaces",
      "Drains, cooling towers, and water-system odor and fouling control"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-purgo-sds.pdf" },
      { label: "Bacterial Persistence Test", file: "docs/sds/vertkleen-purgo-bacterial-persistence-test.pdf" },
      "Treatment Program Data Package"
    ]
  },
  dbnpa: {
    name: "DBNPA Tablet",
    cat: "water",
    replaces: "Replaces glutaraldehyde 50%",
    hmis: "Low hazard",
 icon: "ph-pill",
 image: "img/products/dbnpa-studio.webp",
    uses: [
      "Site-engineered tower treatment",
      "Documented cooling-tower programs",
      "Quarterly tower treatment with product support"
    ],
    docs: ["Safety Data Sheet (SDS)", "Label / SDS Request"]
  },
  crhd: {
    name: "VertKleen CR HD",
    cat: "alkaline",
    replaces: "Solvent, butyl, and general-purpose industrial degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
    image: "img/products/crhd-desktop-label-20261001.webp",
    image_alt: "VertKleen CR HD jug with the supplied product label",
    image_replaces: ["img/products/crhd-studio.webp"],
    uses: [
      "Greasy kitchen hoods, stainless equipment, and floors",
      "Forklifts, workshop parts, and heavy equipment",
      "Petroleum oils, hydraulic fluid, and shop grime",
      "Animal fats, vegetable oils, and protein residues"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crhd-sds.pdf" },
      { label: "General Product Label", file: "docs/labels/general/vertkleen-crhd-label-6x8.pdf" },
      "CR HD Job Test Guide"
    ]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Hydrochloric acid, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
    image: "img/products/descaler-desktop-label-20261001.webp",
    image_alt: "VertKleen HVAC Descaler jug with the supplied product label",
    image_replaces: ["img/products/descaler-studio.webp"],
    uses: [
      "Calcium and lime on copper and aluminum coils",
      "Mineral scale in heat exchangers and cooling towers",
      "Pump cavities, valves, and water-side components",
      "Plumbing and isolated circulation loops"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-descaler-sds.pdf" },
      { label: "HVAC Product Label", file: "docs/labels/hvac/vertkleen-hvac-descaler-label-6x8.pdf" },
      "Descaler vs Acids Corrosion Data"
    ]
  },
  alumibrite: {
    name: "VertKleen AlumiBrite",
    cat: "specialty",
    replaces: "Hydrofluoric and hydrochloric aluminum brighteners",
    hmis: "0-0-0",
 icon: "ph-car",
    image: "img/products/alumibrite-desktop-label-20261001.webp",
    image_alt: "VertKleen AlumiBrite jug with the supplied product label",
    image_replaces: ["img/products/alumibrite-studio.webp"],
    application_image: "img/representative/applications/alumibrite-aluminum-test-patch-v1.webp",
    application_title: "Bring back the aluminum finish",
    application_caption: "Start with a small test patch, rinse, and compare the dry finish before restoring the whole surface.",
    uses: [
      "Dull, oxidized aluminum wheels and trim",
      "Truck tanks, trailers, and fleet equipment",
      "RV aluminum and dealership reconditioning",
      "Marine rails, pontoons, and aluminum hardware"
    ],
    docs: [
      "Safety Data Sheet (SDS)",
      "Product Application Guide"
    ]
  },
  torque: {
    name: "VertKleen Torque",
    cat: "specialty",
    replaces: "Separate wash, wax, and bug-removal steps",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    image: "img/products/torque-studio.webp",
    application_image: "img/representative/applications/torque-contained-fleet-wash-v1.webp",
    application_title: "One wash. A clean, protected finish.",
    application_caption: "Built for regular fleet washing: lift road grime, brush where needed, and rinse to distribute the wax and anti-stick finish.",
    uses: [
      "Trucks, buses, and fleets: road film, diesel soot, and winter salts",
      "Cars and RVs: bug residue, grease, and everyday grime",
      "Boats and marine exteriors: wash and wax in one step",
      "Dealerships and detailing bays: hand, bucket-and-brush, or foam application"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-torque-sds.pdf" },
      { label: "General Product Label", file: "docs/labels/general/vertkleen-torque-label-4x5.pdf" }
    ]
  },
  lam3: {
    name: "VertKleen LAM3",
    cat: "specialty",
    replaces: "Bleach and quat-based exterior cleaners",
    hmis: "0-0-0",
    icon: "ph-house-line",
    image: "img/products/lam3-desktop-label-20261001.webp",
    image_alt: "VertKleen LAM3 jug with the supplied exterior-cleaning label",
    image_replaces: ["img/products/lam3-studio.webp", "img/products/lam3-studio-v2.webp"],
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Decks, fences, brick, and exterior tile",
      "Spray-and-leave exterior stain maintenance"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-lam3-sds.pdf" },
      { label: "General Product Label", file: "docs/labels/general/vertkleen-lam3-label-6x8.pdf" }
    ]
  },
  crs: {
    name: "VertKleen CRS",
    cat: "acid",
    replaces: "Evaluated for rust, scale, and calcium-cleaning programs",
    hmis: "0-0-0",
 icon: "ph-wrench",
 image: "img/products/crs-studio.webp",
    uses: [
      "Underbody and equipment rust removal",
      "HVAC coils and cooling towers",
      "Water lines, fixtures, and scale-prone plumbing",
      "Dealership and facility maintenance programs"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crs-sds.pdf" },
    ]
  },
  "cr-hd-low-foam": {
    name: "VertKleen CR HD Low Foam",
    cat: "alkaline",
    replaces: "Solvent and butyl degreasers",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/crhd-desktop-label-20261001.webp",
    image_alt: "Supplied VertKleen CR HD family jug; Low Foam package label not pictured",
    image_caption: "CR HD family jug shown. Follow directions supplied with your Low Foam package.",
    image_replaces: ["img/products/crhd-studio.webp", "img/products/cr-hd-low-foam-identity-studio-v1.webp"],
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy grease and grime on equipment and floors"
    ],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  cr2: {
    name: "VertKleen HVAC CR",
    cat: "alkaline",
    replaces: "60% caustic soda for cleaning and degreasing",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/hvac-cr-studio.webp",
    uses: [
      "HVAC condensate drains and pans",
      "Grease and organic-buildup removal",
      "Facility drains and compatible equipment",
      "Recurring drain and degreasing maintenance"
    ],
    docs: [
      { label: "HVAC Product Label", file: "docs/labels/hvac/vertkleen-hvac-cr-label-6x8.pdf" },
      "Safety Data Sheet (SDS)"
    ]
  },
  sar: {
    name: "VertKleen SAR",
    cat: "acid",
    replaces: "Sulfuric acid for pH reduction",
    hmis: "0-0-0",
    icon: "ph-wrench",
    image: "img/products/sar-studio.webp",
    uses: [
      "Process-water pH reduction",
      "Sulfuric acid replacement in water-treatment programs",
      "pH adjustment for industrial process liquids",
      "Metered chemical-feed and batch-treatment systems"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-sar-sds.pdf" },
    ]
  },
pg100: {
    name: "PG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Propylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Closed-loop HVAC systems", "Hydronic freeze protection", "Process heat-transfer loops"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  pg50: {
    name: "PG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% propylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Closed-loop HVAC systems", "Hydronic loop top-offs", "Facility freeze-protection maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  eg100: {
    name: "EG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Industrial heat-transfer loops", "Closed-loop freeze protection", "Process-loop maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  eg50: {
    name: "EG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Industrial loop top-offs", "Closed-loop freeze protection", "Heat-transfer maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  egu96: {
    name: "EG uninhibited 96% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol uninhibited concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Utility loop service", "Industrial freeze protection", "Process heat-transfer maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  },
  eg5050: {
    name: "EG 50/50",
    cat: "glycol",
    replaces: "50% ethylene glycol pre-mix",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Loop top-offs", "Routine freeze-protection maintenance", "Industrial heat-transfer service"],
    docs: ["Safety Data Sheet (SDS)", "Product Application Guide"]
  }
};

export const CATALOG_ORDER = [
  "cr", "cr2", "hcr", "hcr-t16", "descaler", "crhd", "cr-hd-low-foam",
  "neutral", "multiwash", "lam3", "purgo", "alumibrite", "torque", "sar",
  "watersafe60"
];

// Catalog UI groupings (curated, not the raw `cat` field) - drive the category
// filter chips and grouping on the products page.
export const CATALOG_GROUPS = [
  { key: "descale", label: "Descaling & Rust", ids: ["hcr", "hcr-t16", "descaler"] },
  { key: "degrease", label: "Degreasers", ids: ["cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash"] },
  { key: "water", label: "Water Treatment", ids: ["cr2", "purgo", "sar", "watersafe60"] },
  { key: "exterior", label: "Exterior & Fleet", ids: ["lam3", "alumibrite", "torque"] }
];

export const QUOTE_FIRST_IDS = ["crs"];

export const PRODUCT_CATALOG_COPY = {
  hcr: {
    job: "Beer stone, scale, and rust in brewery CIP",
    platform: "Synthetic-acid brewery cleaner",
    summary: "Remove beer stone, mineral scale, and rust from brewery tanks, kegs, lines, and heat exchangers with a non-fuming synthetic-acid cleaner.",
    meta_description: "VertKleen CIP HCR removes beer stone, scale, and rust. Non-fuming brewery cleaner with label dosing, real trial results, and HMIS 0-0-0 handling.",
    mechanism: "HCR breaks down mineral deposits so circulation reaches the buildup and a water rinse carries it out of the system.",
    operator_advantage: "Replace conventional brewery acid blends with strong mineral cleaning, zero VOCs, and non-DOT shipping.",
    quote_cta: "Plan my brewery cleaning cycle",
    sample_cta: "Try a free CIP HCR sample",
    fits: ["brewery CIP", "beer stone", "tanks and kegs", "heat-exchanger plates"],
    proof: "Carib laboratory comparison, Brewlando CIP trial, and documented rust-removal results",
    proof_cta: "See brewery cleaning results",
    proof_slugs: ["brewery-cip-trials", "ddc-rust-test", "brevard-farm-hvac"],
    featured_result: "brewery-cip-trials",
    featured_result_copy: {
      heading: "A proven pair for brewery buildup.",
      intro: "At Brewlando, HCR followed the CR organic wash: 5 L in 55 gal of water at 160–170°F, circulated for 30 minutes, then rinsed and drained. The report documents a clean tank after removal of residue and beer stone.",
      related_product: "cr",
      related_label: "Start the organic-soil wash with CIP CR"
    },
    performance_comparison: {
      heading: "Mineral-dissolving power, measured.",
      intro: "The HCR technical sheet compares calcium-carbonate removal against hydrochloric acid under the same bench-test conditions.",
      caption: "Calcium carbonate dissolved after 8 hours at 100°F",
      columns: ["Test solution", "Cube dissolved"],
      rows: [["HCR, undiluted", "100%"], ["HCR at 50%", "97%"], ["HCR at 33%", "54%"], ["Hydrochloric acid at 15%", "87%"], ["Hydrochloric acid at 7.5%", "46%"]],
      note: "Each solution received a one-inch calcium-carbonate cube. Results describe this mineral benchmark; use the CIP label and your equipment's cleaning endpoint to set the brewery cycle.",
      source_label: "Request HCR technical data and benchmark details",
      source_url: "../contact?type=quote&product=VertKleen%20CIP%20HCR&message=Please%20send%20VertKleen%20CIP%20HCR%20technical%20data%20and%20the%20calcium-carbonate%20benchmark%20details.#quoteForm"
    },
    dilution_guide: {
      heading: "Match the dose to the mineral load.",
      intro: "The CIP HCR label sets three starting doses for beer-stone cleaning. Circulate through the equipment, then rinse with water.",
      column_labels: ["Mineral buildup", "Product per 10 gal"],
      rows: [["Light beer stone", "0.5 L"], ["Moderate", "1 L"], ["Severe", "1.5 L"]],
      note: "Choose circulation time and temperature for your equipment and cleaning endpoint. The label does not prescribe a fixed cycle time; the Brewlando trial below shows one working brewery example."
    },
    application_guide: {
      heading: "The mineral-cleaning step in your CIP cycle.",
      steps: [
        ["Remove organic soil first", "Use CIP CR for yeast, protein, fat, and organic film. Rinse that wash out before starting the HCR mineral-cleaning step."],
        ["Charge and circulate", "Add HCR at the label dose for the buildup. Confirm that the pump, seals, piping, and heat exchanger suit the solution and wash temperature."],
        ["Inspect and rinse", "Check the tank, fittings, and heat-transfer surfaces for remaining deposits. Rinse with water and drain the circuit after cleaning."],
        ["Verify return to production", "Complete your brewery's sanitation and release procedure. Record the dose, temperature, circulation time, rinse endpoint, and inspection result."]
      ]
    },
    manufacturer_reference: {
      heading: "Carib Brewery: rust removal on a heat-exchanger plate.",
      body: "Carib's December 2023 laboratory report compared an HCR sample measured at 7% with its incumbent CIP acid sample measured at 15%. Both were applied as supplied to sections of the same rusted plate, with mechanical cleaning. HCR removed the rust completely; the incumbent acid did not, despite more scrubbing. The report recommended an industrial trial.",
      source_label: "Read the Carib Brewery laboratory report (PDF)",
      source_url: "../docs/carib-brewery-lab-report.pdf"
    },
    technical_profile: {
      heading: "Strong mineral cleaning. Easier brewery handling.",
      intro: "VertKleen HCR uses synthetic-acid chemistry. Its technical sheet documents cleaning, handling, and transport characteristics for the concentrate.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero product rating for the mineral-cleaning stage."],
        ["Non-fuming · zero VOCs", "Synthetic-acid cleaning without conventional acid fumes or volatile organic compounds."],
        ["Non-DOT regulated", "Common-carrier shipping without conventional acid's hazardous-material classification."],
        ["Biodegradable", "The HCR technical sheet reports 100% biodegradability."],
        ["Water rinse", "Circulate to remove the deposits, then rinse and drain as directed on the CIP label."]
      ],
      source_label: "Request HCR technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20CIP%20HCR&message=Please%20send%20VertKleen%20CIP%20HCR%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan your first HCR cycle",
      intro: "Bring the mineral buildup, equipment materials, current acid recipe, and rinse requirements. MASEST can help plan a side-by-side brewery trial.",
      record: "Compare the finished surface and full cycle cost, including chemical, heat, water, labor, and downtime.",
      items: [
        ["Match the deposit", "HCR handles beer stone, scale, and rust. Pair with CR when organic soils need a separate wash."],
        ["Check the circuit", "The CIP label identifies 316 stainless and PVC for neat use. The HCR technical sheet excludes aluminum piping and fittings; confirm other materials for the working solution."],
        ["Keep CIP controls", "Follow the latest label, SDS, and site rules for PPE, hot liquids, isolation, and rinse-water collection."],
        ["Scale the supply", "Start with a sample or small pack, then price drums, totes, and recurring brewery delivery."]
      ]
    }
  },
  "hcr-t16": {
    job: "Calcium, mineral scale, and rust in HVAC equipment",
    platform: "Synthetic-acid HVAC cleaner",
    summary: "Remove calcium, scale, and rust from HVAC equipment with a non-fuming hydrochloric-acid replacement.",
    meta_description: "VertKleen HVAC HCR removes calcium, scale, and rust. See real HVAC results, label dilutions, and isolated-system cleaning guidance. HMIS 0-0-0.",
    mechanism: "HCR breaks down mineral deposits and releases rust so application or circulation reaches the buildup and a water rinse carries it away.",
    operator_advantage: "Tackle difficult deposits with zero VOCs, HMIS 0-0-0 handling, and non-DOT shipping. Start with a small pack and scale to recurring facility supply.",
    quote_cta: "Plan my HVAC descaling job",
    fits: ["mineral scale", "HVAC rust", "heat exchangers", "isolated cleaning loops"],
    proof: "Brevard HVAC field results with original before-and-after photographs",
    sample_cta: "Try a free HVAC HCR sample",
    proof_cta: "See the HVAC before & after",
    proof_slugs: ["brevard-farm-hvac"],
    featured_result: "brevard-farm-hvac",
    featured_result_copy: {
      heading: "Stubborn HVAC rust. A visible difference.",
      intro: "At a Brevard County School District site, HCR was sprayed onto a rusted stainless diamond plate and drain area, left for 30 minutes, then rinsed with a garden hose. The field report records cleaning without scrubbing after the crew's earlier CLR attempts had failed. The photos show that exposed-surface restoration.",
      related_product: "cr2",
      related_label: "Grease or organic buildup? Explore HVAC CR"
    },
    dilution_guide: {
      heading: "Label dilutions for surface cleaning.",
      intro: "Use the HVAC HCR package directions for the severity of the surface deposit. Apply the solution, allow contact time, and rinse.",
      column_labels: ["Label soil level", "Dilution / contact time"],
      rows: [["Light", "10:1 · dwell 10–15 min"], ["Moderate", "5:1 · dwell, then rinse"], ["Severe", "2:1 · dwell 20 min"]],
      note: "The label gives no fixed dwell time for moderate soil. These application directions are separate from the volume, concentration, and circulation time needed for an isolated heat exchanger or boiler."
    },
    application_modes: [
      {
        heading: "Exposed surfaces and accessible deposits",
        intro: "For rusted plates, drain areas, and compatible equipment surfaces, work directly on the buildup.",
        facts: [
          ["Prepare", "Isolate equipment, protect electrical components, remove loose debris, and check a small area."],
          ["Apply", "Choose the label dilution for the deposit and allow the specified contact time. Use light agitation when the job needs it."],
          ["Rinse and inspect", "Collect the wash water, rinse away loosened deposits, and check the surface before returning equipment to use."]
        ]
      },
      {
        heading: "Isolated heat exchangers and boilers",
        intro: "Plan a contained cleaning circuit around the equipment's volume, mineral load, and wetted materials.",
        facts: [
          ["Measure the job", "Record the circuit volume, scale type, operating history, pump capacity, seals, and metal grades."],
          ["Set the cleaning program", "Isolate, drain, and flush the equipment. MASEST can help establish the HCR concentration, circulation time, and monitoring plan."],
          ["Flush and return to service", "Drain the spent solution through the site's wastewater procedure, flush thoroughly, and confirm the equipment's return-to-service criteria."]
        ]
      }
    ],
    manufacturer_reference: {
      heading: "The chemistry behind the clean.",
      body: "HCR uses synthetic-acid chemistry to remove mineral deposits with a non-fuming handling profile. The HCR technical sheet documents its mineral-dissolving performance, zero VOCs, and non-DOT transport. Choose the working method for the equipment and deposit.",
      source_label: "Request HCR technical data",
      source_url: "../contact?type=quote&product=VertKleen%20HVAC%20HCR&message=Please%20send%20HCR%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Built for recurring maintenance.",
      intro: "Practical handling and supply advantages from the HCR technical data and HVAC label.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero product rating for routine maintenance handling."],
        ["Non-fuming · zero VOCs", "Mineral-cleaning power without conventional hydrochloric-acid fumes."],
        ["Non-DOT regulated", "Common-carrier transport for simpler chemical supply."],
        ["Small packs through bulk", "Buy a trial quantity, then request drum, tote, or scheduled-delivery pricing."]
      ],
      source_label: "Request HVAC HCR technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20HVAC%20HCR&message=Please%20send%20VertKleen%20HVAC%20HCR%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan the job before the shutdown",
      intro: "Send photos of the deposit, the equipment model, circuit volume, and wetted materials. We can help match the cleaning method and supply quantity.",
      record: "Compare deposit removal, flow, rinse water, labor, and total downtime across the complete job.",
      items: [
        ["Match the deposit", "Use HCR for calcium, scale, and rust. Choose HVAC CR for grease and organic buildup."],
        ["Check the materials", "The HVAC label identifies 316 stainless and PVC for neat use. The HCR technical sheet excludes aluminum piping and fittings; confirm coils, coatings, and gaskets for the working solution."],
        ["Keep the circuit controlled", "Follow the latest label, SDS, equipment instructions, and site rules for isolation, PPE, and rinse-water handling."],
        ["Choose the right water program", "For potable-water treatment, ask us to match the application to the appropriate certified product and use limits."]
      ]
    }
  },
  descaler: {
    job: "Calcium, lime, and scale in coils, pumps, and heat exchangers",
    platform: "Synthetic-acid descaler with detergents",
    summary: "Clear calcium, lime, and mineral scale from coils, pumps, and heat exchangers with a non-fuming muriatic-acid replacement.",
    meta_description: "VertKleen Descaler removes calcium, lime, and scale from coils, pumps, and heat exchangers. See label dilutions and field results. HMIS 0-0-0.",
    mechanism: "Synthetic-acid chemistry works with detergents to wet deposits, release buildup, and carry it away through circulation and rinsing.",
    operator_advantage: "Put equipment cleaning on a simpler footing: zero VOCs, HMIS 0-0-0, and non-DOT-regulated shipping, with small packs ready for your first job.",
    quote_cta: "Test my mineral buildup",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "Residential AC coil cleaning and a fire-pump service report documenting restored flow and pressure",
    proof_slugs: ["fire-pump-descaler", "residential-ac-coil"],
    proof_cta: "See the fire-pump result",
    featured_result: "fire-pump-descaler",
    featured_result_media: false,
    featured_result_copy: {
      heading: "A scaled fire pump. Flow and pressure restored.",
      intro: "At a distribution center in Cocoa, Florida, technicians treated a rusted, scale-covered solenoid for 30 minutes, cleaned it, and restarted the pump. Low flow led them to a second blockage inside the pump cavity. Under Siemens and MASEST technical direction, they soaked that cavity for 24 hours, rinsed, and reassembled it. A 30-minute operational test then confirmed proper flow and pressure. This service report shows why the cleaning cycle should match the component and buildup.",
      related_product: "watersafe60",
      related_label: "Working on a potable-water system? Explore WaterSafe60"
    },
    sample_cta: "Try a free Descaler sample",
    performance_comparison: {
      heading: "Change the cleaner. Simplify the job.",
      intro: "Descaler brings a different handling profile to mineral cleaning, with diluted-use guidance for copper and aluminum and no DOT hazardous-material classification.",
      caption: "Conventional hydrochloric acid and VertKleen Descaler",
      columns: ["Hydrochloric-acid profile", "VertKleen Descaler"],
      rows: [
        ["Highly corrosive to most metals", "Copper and aluminum compatible at label dilution"],
        ["Pungent acid odor", "Non-fuming · zero VOCs"],
        ["Hydrochloric-acid solution listed as UN 1789", "Non-DOT-regulated transport per the SDS"]
      ],
      note: "Hydrochloric-acid properties are documented by CDC/NIOSH. Descaler properties come from its label, technical sheet, and SDS. Match the dilution and cleaning conditions to your equipment.",
      source_label: "See the CDC/NIOSH hydrochloric-acid reference",
      source_url: "https://www.cdc.gov/niosh/npg/npgd0332.html"
    },
    application_modes: [
      {
        heading: "Copper and aluminum coils",
        intro: "Remove mineral deposits from heat-transfer surfaces while working to the coil's material, coating, and cleaning requirements.",
        facts: [
          ["Check the coil", "The HVAC label lists copper and aluminum compatibility at dilution. Confirm the coil coating and equipment maker's cleaning instructions before treatment."],
          ["Reach the buildup", "Open the service access, protect electrical components, and use the application method suited to the deposit. Keep rinse pressure gentle on delicate fins."],
          ["Rinse and inspect", "Rinse loosened deposits away with water. Inspect the fins and drainage path before returning the equipment to service."]
        ]
      },
      {
        heading: "Pumps, heat exchangers, and water-side circuits",
        intro: "Bring the cleaner to the scale through an isolated circulation loop or a planned component soak.",
        facts: [
          ["Plan the cleaning volume", "Share system volume, deposit photos, metals, seals, operating history, and the current cleaner. MASEST can help set the starting concentration and cleaning endpoint."],
          ["Isolate and clean", "Drain the circuit and establish compatible circulation equipment, or remove accessible components for treatment. Monitor the solution and progress during cleaning."],
          ["Flush and verify", "Drain spent solution, flush with fresh water, and verify the rinse and operating condition. Fire-protection equipment returns to service through the responsible service technician."]
        ]
      }
    ],
    dilution_guide: {
      heading: "Three label dilutions. One clear rinse step.",
      intro: "Use the HVAC Descaler package directions for the level of buildup. Each cleaning level calls for circulation followed by a water rinse.",
      column_labels: ["Buildup", "Label dilution"],
      rows: [["Light / regular cleaning", "20:1"], ["Moderate cleaning", "3:1"], ["Severe buildup / scale", "1:1"]],
      note: "These are the ratios printed on the HVAC label. Set contact time, temperature, and the rinse endpoint for the equipment and deposits; the label does not prescribe a fixed circulation time. Ask MASEST to confirm the mix for your system volume."
    },
    manufacturer_reference: {
      heading: "A cleaner coil in coastal Florida.",
      body: "A residential AC unit near Boca Raton beach had collected calcium scale and debris after about two years without coil cleaning. The supplied field report documents Descaler treatment and photographs the cleaned fin surfaces. For recurring service, record the coil condition and cleaning result so the next visit starts with a clear baseline.",
      source_label: "Read the residential AC coil result",
      source_url: "../proof#residential-ac-coil"
    },
    technical_profile: {
      heading: "Mineral cleaning with easier handling.",
      intro: "Descaler combines synthetic-acid chemistry with detergents for a wash that reaches deposits and rinses away with water.",
      facts: [
        ["Non-fuming · zero VOCs", "Clean scale without the pungent fumes associated with conventional muriatic-acid cleaning."],
        ["HMIS 0-0-0", "The product's zero ratings for health, flammability, and physical hazard simplify routine handling and storage."],
        ["Non-DOT-regulated shipping", "Order small packs, drums, or totes without this product being classified as hazardous material for DOT transport."],
        ["Biodegradable · phosphate-free", "A biodegradable formula with no phosphates, supported by the product technical sheet."]
      ],
      source_label: "Request Descaler technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20Descaler&message=Please%20send%20VertKleen%20Descaler%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan the first clean",
      intro: "Start with the deposit, equipment materials, and cleaning volume. A small test gives your crew a repeatable starting point.",
      record: "Record the concentration, contact time, temperature, circulation method, rinse endpoint, and result for the next maintenance visit.",
      items: [
        ["Match the materials", "Check metals, coil coatings, gaskets, hoses, and fittings. Follow the HVAC label's diluted-use guidance for copper and aluminum."],
        ["Prepare the work area", "Isolate equipment, protect controls, and use the PPE and ventilation specified for the task and latest SDS."],
        ["Plan the rinse", "Collect spent solution and loosened deposits for the site's disposal route. Keep runoff out of storm drains."],
        ["Build a maintenance plan", "Send deposit photos, system volume, and equipment details with your inquiry. MASEST can match the cleaning method and pack size to the job."]
      ]
    }
  },
  crs: {
    job: "Water-side scale and rust",
    summary: "For underbody rust, fixtures, coils, and water lines where metal compatibility matters as much as cleaning power.",
    fits: ["underbodies", "fixtures", "coils", "water lines"],
    proof: "User guide and application notes"
  },
  cr: {
    job: "Yeast, protein, fat, and organic film in brewery CIP",
    platform: "VertKleen caustic replacement",
    summary: "Clear krausen, yeast, protein, and fat from brewery tanks, kegs, and lines with a 50% caustic soda replacement.",
    mechanism: "CR lifts organic soils into the wash solution so circulation and a water rinse carry them out of the system.",
    operator_advantage: "Keep the cleaning power. Simplify the rinse with no separate neutralizing step, zero VOCs, and HMIS 0-0-0 handling.",
    quote_cta: "Plan my brewery wash cycle",
    sample_cta: "Try a free CIP CR sample",
    fits: ["brewery CIP", "krausen", "tanks and kegs", "hot circulation"],
    proof: "Brewlando field trial and Carib Brewery laboratory results",
    proof_cta: "See brewery cleaning results",
    proof_slugs: ["brewery-cip-trials"],
    featured_result: "brewery-cip-trials",
    featured_result_copy: {
      heading: "Real brewery equipment. A complete cleaning cycle.",
      intro: "CR handles yeast, protein, fat, and organic film. HCR follows when beer stone, scale, or rust needs a mineral-cleaning step. These brewery results show the pair at work.",
      related_product: "hcr",
      related_label: "Complete the cycle with CIP HCR"
    },
    dilution_guide: {
      heading: "Match the dose to the soil.",
      intro: "Start with the CIP CR label directions for your soil load. Measure the product, circulate through the equipment, then rinse with water.",
      column_labels: ["Soil load", "Product per 10 gal"],
      rows: [["Light / krausen soil", "0.5 L"], ["Moderate soil", "1 L"], ["Severe soil", "1.5 L"]],
      note: "For light / krausen soil, the label specifies hot circulation above 140°F. Set circulation time and temperature for your equipment and cleaning endpoint; confirm the cycle with your brewery's verification procedure."
    },
    manufacturer_reference: {
      heading: "Brewlando: a 25-minute CR wash.",
      body: "After roughly 10 days without CIP cleaning, the mash tank carried a heavy residue ring and bottom deposits. The trial mixed 5 L of CR into 55 gal of water at 160–170°F and circulated through the tank and heat exchanger for 25 minutes. The brewmaster judged the tank very clean. A separate 30-minute HCR step followed before the final rinse.",
      source_label: "Read the Brewlando trial report (PDF)",
      source_url: "../docs/brewery-cip-trial-brewlando.pdf"
    },
    application_guide: {
      heading: "Build a repeatable brewery wash.",
      steps: [
        ["Set up the circuit", "Drain product and remove loose solids. Check the tank, pump, seals, hoses, and heat exchanger for the planned wash temperature and chemistry."],
        ["Dose and circulate", "Choose the label dose for the soil load. Circulate to wet the full cleaning surface, including the return loop and difficult deposits."],
        ["Rinse and inspect", "Rinse with water and verify soil removal. CR needs no separate acid-neutralizing step; use HCR separately when mineral deposits need removal."],
        ["Verify before production", "Complete your brewery's sanitation and release procedure. Record concentration, temperature, circulation time, rinse endpoint, and the verification result for the next cycle."]
      ]
    },
    technical_profile: {
      heading: "Strong alkaline cleaning. Easier daily handling.",
      intro: "The manufacturer's CR technical data describes a high-pH wash that contains no conventional hydroxides and supports a simpler chemical-handling and rinse routine.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero handling profile, with reduced risk of severe conventional-caustic burns."],
        ["Zero VOCs", "Non-flammable chemistry without solvent emissions."],
        ["Water rinse", "No separate neutralizing chemical required after the CR wash."],
        ["Non-DOT regulated", "Ships without the hazardous-material classification of conventional caustic."],
        ["Readily biodegradable", "Manufacturer data reports 100% biodegradation in less than 10 days."]
      ],
      source_label: "Request CR technical data",
      source_url: "../contact?type=quote&product=VertKleen%20CIP%20CR&message=Please%20send%20CR%20technical%20data.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan your first CR cycle",
      intro: "Bring your current wash recipe, soil load, and equipment details. MASEST can help set up a trial that measures cleaning, rinsing, and total cycle cost.",
      record: "Compare chemical use, water, heat, labor, and downtime across the complete cycle.",
      items: [
        ["Match the product", "Use CIP CR directions for this brewery SKU and the latest label and SDS."],
        ["Check wetted materials", "Confirm pumps, seals, piping, and fittings. The CR technical sheet excludes aluminum piping and fittings."],
        ["Keep hot-CIP controls", "Follow your site's PPE, isolation, hot-liquid handling, and wastewater procedures."],
        ["Plan supply", "Start with a sample or small pack, then price drums, totes, and recurring brewery supply."]
      ]
    }
  },
  crhd: {
    job: "Heavy grease, petroleum oils, and food fats",
    platform: "High-detergency, high-foam degreaser",
    summary: "Lift heavy grease, hydraulic oil, and food fats from kitchens, floors, and equipment with a high-foam industrial concentrate.",
    meta_description: "VertKleen CR HD cuts grease, oil, and food fats without butyl solvents. See real kitchen results, label dilutions, and high-foam cleaning guidance.",
    mechanism: "Detergents and wetting agents reach under grease and lift it from the surface. The non-emulsifying formula leaves removed oils intact for collection and separation.",
    operator_advantage: "One concentrate covers daily cleaning and tough degreasing, with no butyl solvents, zero VOCs, non-flammability, and HMIS 0-0-0.",
    quote_cta: "Test CR HD on my toughest job",
    sample_cta: "Try a free CR HD sample",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Fort Lauderdale kitchen before-and-after photos and a three-distribution-center customer assessment",
    proof_slugs: ["commercial-kitchen-crhd", "distribution-center-assessment"],
    proof_cta: "See the kitchen before & after",
    featured_result: "commercial-kitchen-crhd",
    featured_result_copy: {
      heading: "A cleaner kitchen after three weeks of buildup.",
      intro: "A busy Fort Lauderdale kitchen had gone three weeks without a thorough clean of its stainless cooking equipment. The field report shows CR HD removing greasy buildup from the equipment surrounds and backsplash. These original photographs show the surfaces before and after cleaning.",
      related_product: "cr-hd-low-foam",
      related_label: "Need less foam in your machine? Explore CR HD Low Foam"
    },
    application_modes: [
      {
        heading: "Choose the foam for the job.",
        intro: "HD means high detergency. This formulation produces ample foam for applied cleaning and agitation.",
        facts: [
          ["CR HD: kitchens, parts, and equipment", "Use the high-foam concentrate where crews apply, brush, and rinse grease from accessible surfaces."],
          ["Low Foam: foam-sensitive wash systems", "For an automatic scrubber, parts washer, or recirculating system that requires foam control, choose CR HD Low Foam and match the chemistry to the machine's instructions."],
          ["Hot or cold water", "CR HD works with either. Set water temperature for the surface, soil, and equipment rather than assuming more heat is always needed."]
        ]
      }
    ],
    dilution_guide: {
      heading: "Four cleaning jobs. One concentrate.",
      intro: "Start with the general CR HD label directions. Increase cleaning strength for heavier grease, then rinse the loosened soil away.",
      column_labels: ["Cleaning job", "Label dilution / method"],
      rows: [["Floors", "40:1 · mop or spray, then rinse"], ["General cleaning", "30:1 · apply, brush, and rinse"], ["Degreasing", "10:1 · brush, then rinse"], ["Heavy degreasing", "3:1 · brush, then rinse"]],
      note: "Finish with fresh water. Choose contact time for the actual soil and surface; the label does not set a universal dwell time. MASEST can help confirm the mix for your sprayer or wash equipment."
    },
    application_guide: {
      heading: "Apply. Agitate. Rinse clean.",
      steps: [
        ["Prepare the surface", "Remove loose debris and protect controls, electrical connections, and adjacent materials. Test the selected dilution on the finish."],
        ["Wet the grease", "Apply CR HD at the label dilution for the job. Give the solution contact with the buildup while keeping the work area wet."],
        ["Brush and rinse", "Agitate stubborn grease, rinse with fresh water, and collect the removed oils and washwater through your site's recovery process."],
        ["Inspect the finished job", "Check for remaining film and repeat where needed. On food-contact surfaces, rinse with potable water and complete the kitchen's separate sanitation procedure."]
      ]
    },
    manufacturer_reference: {
      heading: "The chemistry behind CR HD.",
      body: "The manufacturer's technical sheet describes a solvent-free, non-butyl cleaner that lifts petroleum oils, animal and vegetable fats, and protein soils. Its high-detergency formulation includes wetting agents and corrosion inhibitors, with separate Low Foam and Neutral options for different equipment and surfaces.",
      source_label: "Request CR HD technical data",
      source_url: "../contact?type=quote&product=VertKleen%20CR%20HD&message=Please%20send%20CR%20HD%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Strong cleaning. Simpler routine handling.",
      intro: "Stock one concentrate for a broad range of facility jobs, from everyday floor cleaning to heavy grease removal.",
      facts: [
        ["Non-butyl · solvent-free", "Degreasing chemistry that lifts oil and grease without butyl solvents."],
        ["Zero VOCs · non-flammable", "A water-soluble cleaner with a mild soapy odor and HMIS 0-0-0."],
        ["Non-DOT-regulated shipping", "Small packs, drums, and totes without hazardous-material transport classification for this product."],
        ["Biodegradable · phosphate-free", "Product technical data reports a biodegradable formula with no phosphates."]
      ],
      source_label: "Request CR HD technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20CR%20HD&message=Please%20send%20VertKleen%20CR%20HD%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Make the first trial count",
      intro: "Compare CR HD with your current cleaner on the same soil and surface, using each product's directions.",
      record: "Record concentrate used, dilution, contact time, brushing, rinse water, repeat passes, and the finished result. Price the complete job, including crew time and rework.",
      items: [
        ["Check the finish", "Confirm the material, coating, seals, and equipment maker's cleaning requirements before a full application."],
        ["Match the foam", "Use the high-foam formulation for applied cleaning. Select Low Foam when the wash system requires it."],
        ["Plan recovery", "Capture used solution and removed grease for the site's disposal process. Keep washwater out of storm drains."],
        ["Scale the supply", "Start with a small pack or sample. Share the trial result and monthly demand for drum, tote, or recurring-supply pricing."]
      ]
    }
  },
  neutral: {
    job: "Grease removal with near-neutral chemistry",
    hero_summary: {
      eyebrow: "Near-neutral industrial cleaner",
      body: "Grease-cutting detergency for equipment, vehicles, and floors.",
      facts: [["pH 7.5", "Manufacturer's Neutral technical reference"], ["Solvent-free", "Non-butyl cleaning chemistry"], ["Zero VOCs", "Non-flammable concentrate"]]
    },
    platform: "Near-neutral industrial degreaser",
    summary: "Lift oil, grease, and stubborn grime from equipment, vehicles, and floors with a concentrated, near-neutral cleaner.",
    meta_description: "VertKleen Neutral lifts oil and grease with near-neutral, solvent-free chemistry. Explore equipment and floor cleaning, application guidance, and the SDS.",
    mechanism: "Wetting agents reach beneath grease and lift it from the surface. The non-emulsifying formula leaves removed oils intact for collection and separation.",
    operator_advantage: "Bring industrial degreasing to a near-neutral cleaning program, with no butyl solvents, zero VOCs, and a non-flammable formula.",
    quote_cta: "Test Neutral on my surface",
    sample_cta: "Try a free Neutral sample",
    fits: ["equipment", "finished surfaces", "shop floors", "vehicle washing"],
    proof: "Manufacturer's technical data and the product-specific VertKleen Neutral SDS",
    application_modes: [
      {
        heading: "Industrial grease removal. Near-neutral chemistry.",
        intro: "Choose Neutral when your cleaning program calls for strong detergency at a near-neutral pH. Match the dilution and method to the finish and the soil.",
        facts: [
          ["Equipment and parts", "Lift oily film, hydraulic-fluid deposits, and grease from compatible machinery and parts. Apply by spray, sponge, or brush, then rinse away the loosened soil."],
          ["Floors and vehicle washing", "Use one concentrate across shop floors, vehicle exteriors, and recurring facility cleaning. Mop or spray accessible areas, agitate as needed, and recover the washwater."],
          ["Painted and finished surfaces", "Build the cleaning method around the coating. Test a small area at the working dilution and inspect after rinsing before treating the full surface."]
        ]
      },
      {
        heading: "Match the cleaner to the wash system.",
        intro: "The manufacturer lists its neutral cleaner for hot- or cold-water cleaning, including parts washers, rotary cleaners, and steam-cleaning equipment.",
        facts: [
          ["Near-neutral formulation", "The manufacturer's technical sheet reports pH 7.5 for the neutral cleaner. This is the near-neutral choice within the product family."],
          ["Foam-sensitive equipment", "Choose CR HD Low Foam when the machine specifically requires a low-foaming detergent. Neutral's defining feature is its near-neutral pH."],
          ["Job-specific dilution", "Share the surface, coating, grease load, and application equipment. MASEST can confirm the mix against the directions supplied with your Neutral package."]
        ]
      }
    ],
    application_guide: {
      heading: "Apply. Brush. Rinse clean.",
      steps: [
        ["Prepare and test", "Remove loose debris and excess oil. Protect electrical connections, and test the chosen dilution on the material and finish."],
        ["Mix for the job", "Use the directions supplied with your Neutral package. Confirm the dilution before filling a wash tank or setting an automatic dispenser."],
        ["Work the grease loose", "Spray, sponge, brush, or mop the solution onto the surface. Agitate the buildup and give the cleaner contact with the soil."],
        ["Rinse and inspect", "Rinse with fresh water and collect the removed soil. Inspect the finish and repeat where needed. Record the settings that produce a clean result."]
      ]
    },
    manufacturer_reference: {
      heading: "The chemistry behind VertKleen Neutral.",
      body: "The manufacturer's technical sheet describes a concentrated, neutral-pH degreaser for petroleum oils, animal and vegetable fats, and general grime. Detergents, wetting agents, and corrosion inhibitors support its cleaning action without butyl solvents.",
      source_label: "Request Neutral technical data",
      source_url: "../contact?type=quote&product=VertKleen%20Neutral&message=Please%20send%20Neutral%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "A practical concentrate for recurring cleaning.",
      intro: "Choose the pack size for your maintenance program, from a first trial to drums and totes for routine supply.",
      facts: [
        ["Near-neutral pH", "The manufacturer reports pH 7.5 for the neutral cleaner, with cleaning power supplied by its detergent system."],
        ["Non-butyl · solvent-free", "Removes greasy soil without solvent-based degreasing chemistry."],
        ["Zero VOCs · non-flammable", "Manufacturer-reported properties, with a mild soapy odor and HMIS 0-0-0 in the VertKleen product record."],
        ["Non-DOT-regulated · biodegradable", "The VertKleen SDS lists non-regulated transport; manufacturer data reports a 100% biodegradable, phosphate-free formula."]
      ],
      source_label: "Request Neutral dilution guidance and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20Neutral&message=Please%20send%20VertKleen%20Neutral%20dilution%20guidance%2C%20package%20directions%2C%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Make the trial useful",
      intro: "Test Neutral on a recurring grease job, using the same surface and soil when comparing it with your current cleaner.",
      record: "Record dilution, concentrate used, contact time, brushing, rinsing, repeat passes, and the finished surface. Compare the complete cost of the cleaning job.",
      items: [
        ["Check the coating and seals", "Follow the equipment maker's cleaning requirements and inspect the test area. Near-neutral pH does not replace a material compatibility check."],
        ["Handle the concentrate well", "Avoid eye contact and prolonged skin contact. The VertKleen SDS identifies mild skin and eye irritation; rinse splashes promptly and follow its handling directions."],
        ["Recover the washwater", "Collect used solution and removed oils through the site's recovery process. Keep dirty washwater out of storm drains."],
        ["Build the supply plan", "Share the trial result and monthly usage for pack, drum, tote, or recurring-supply pricing."]
      ]
    }
  },
  multiwash: {
    job: "Everyday grime, greasy film, and odors",
    platform: "Concentrated multi-surface cleaner",
    summary: "Clean everyday grime, greasy film, and mineral residue across facility surfaces and exterior wash jobs with one versatile concentrate.",
    meta_description: "VertKleen MultiWash cleans and deodorizes facility surfaces and exterior wash jobs. See general-label dilutions, application methods, and technical data.",
    mechanism: "MultiWash combines mineral-cleaning, degreasing, and odor-control chemistry to loosen mixed soils, lift greasy residue, and control odors in one cleaning program.",
    operator_advantage: "Cover more routine jobs with a non-caustic, solvent-free formula and HMIS 0-0-0 handling.",
    hero_summary: {
      eyebrow: "Clean and deodorize",
      body: "One concentrate for indoor surfaces and exterior wash programs.",
      facts: [["Mixed soils", "Grime, greasy film, and mineral residue"], ["Non-caustic", "Solvent-free cleaning formula"], ["HMIS 0-0-0", "Non-DOT-regulated transport"]]
    },
    quote_cta: "Try MultiWash on my facility",
    sample_cta: "Try a free MultiWash sample",
    fits: ["facility surfaces", "tile and grout", "gym equipment", "exterior washing"],
    proof: "General MultiWash package directions and manufacturer technical data",
    application_modes: [
      {
        heading: "One cleaner for everyday work.",
        intro: "Build the method around the surface and the package directions, from a gym floor to a building exterior.",
        facts: [
          ["Facility surfaces", "Clean floors, tile, grout, and shared equipment using a cloth, mop, brush, or compatible cleaning machine. Protect electronics and check the finish before a full application."],
          ["Exterior wash programs", "Apply to compatible concrete, walls, and hardscape with a sprayer, brush, or foam equipment. Set pressure for the surface and collect the runoff."],
          ["Marine maintenance", "The marine presentation covers decks, vinyl, glass, and routine vessel grime. Match the method to the boat material and the supplied marine directions."]
        ]
      }
    ],
    dilution_guide: {
      heading: "Choose strength by soil and odor.",
      intro: "The general MultiWash label gives three levels. Gym and marine packages have their own application directions; use the label supplied with your order.",
      column_labels: ["General cleaning condition", "General-label dilution"],
      rows: [["Light soil / mild odor", "10:1"], ["Moderate soil / odor", "5:1"], ["Severe soil / odor", "2:1"]],
      note: "Ratios are shown as printed on the linked general label. Confirm the water-and-concentrate recipe before filling a machine or setting an injector."
    },
    application_guide: {
      heading: "Apply evenly. Work the soil. Rinse clean.",
      steps: [
        ["Prepare the job", "Remove loose debris, protect nearby items, and test the working dilution on a small area. Identify the package label and the equipment you will use."],
        ["Apply the solution", "Use a cloth, mop, brush, sprayer, or compatible foam applicator. Wet the dirty surface evenly without soaking electrical components."],
        ["Give it time to work", "Follow the package's contact-time directions and agitate stubborn areas. Keep the application from drying on the surface during active cleaning."],
        ["Rinse and recover", "Rinse away loosened residue and recover the dirty solution. Inspect the finish, then record dilution, contact time, passes, and product used."]
      ]
    },
    manufacturer_reference: {
      heading: "Three cleaning technologies in one formula.",
      body: "Manufacturer technical data describes the MultiWash cleaning platform: mineral cleaning for scale, degreasing for oily residue, and odor control for facility maintenance. The result is a concentrated multi-surface cleaner for indoor and outdoor maintenance.",
      source_label: "Request MultiWash technical data",
      source_url: "../contact?type=quote&product=VertKleen%20MultiWash&message=Please%20send%20MultiWash%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Simplify the routine cleaning shelf.",
      intro: "Match one concentrate to several recurring tasks, then compare the product and labor used per finished job.",
      facts: [
        ["Non-caustic · non-solvent", "A multi-surface cleaning alternative to separate caustic and solvent products."],
        ["Zero VOCs · non-flammable", "Manufacturer-reported formula properties for routine maintenance programs."],
        ["Non-DOT-regulated", "The VertKleen MultiWash SDS lists non-regulated hazardous-material transport status."],
        ["Biodegradable formula", "Collect used washwater according to the soil it contains and the site's recovery process."]
      ],
      source_label: "Request MultiWash application guidance and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20MultiWash&message=Please%20send%20VertKleen%20MultiWash%20application%20guidance%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Put the concentrate to work",
      intro: "Start with a representative section of the surface and the same recurring soil you need to remove.",
      record: "Record the dilution, dwell time, agitation, rinse water, and finish. Use the successful method to plan pack sizes and repeat supply.",
      items: [["Match the label", "General, gym, and marine directions serve different jobs. Confirm the correct recipe for the package and task."], ["Protect the finish", "Check materials, coatings, seals, and equipment requirements. Avoid eye contact and prolonged skin contact; follow the SDS."], ["Plan recovery", "Keep washwater out of storm drains and capture removed oils and solids through the site's existing process."], ["Scale a proven method", "Send your trial result and monthly demand for drum, tote, or recurring-supply pricing."]]
    }
  },
  watersafe60: {
    job: "Potable-water pH, scale, and corrosion control",
    platform: "NSF/ANSI/CAN 60 water treatment",
    summary: "Control pH and mineral buildup with NSF/ANSI/CAN 60 certified water-treatment chemistry.",
    meta_description: "WaterSafe60: NSF/ANSI/CAN 60 certified pH, scale, and corrosion treatment. Plan metered dosing, offline descaling, and well rehabilitation.",
    mechanism: "Synthetic-acid chemistry lowers pH and dissolves mineral deposits. Metered treatment supports scale and corrosion control; isolated cleaning treats heavier deposits in pipes, equipment, and wells.",
    operator_advantage: "One non-fuming, non-DOT-regulated product supports routine treatment and planned cleaning, with a defined method for each job.",
    quote_cta: "Build my water-treatment plan",
    fits: ["potable water", "pH control", "pipe cleaning", "well rehabilitation"],
    proof: "NSF/ANSI/CAN 60 certification, listed uses, and titration data",
    sample_cta: "Request a WaterSafe60 trial sample",
    certification: {
      heading: "NSF/ANSI/CAN 60 certified.",
      intro: "Watersafe 60 is listed for drinking-water treatment and offline water-system maintenance under NSF/ANSI/CAN 60.",
      facts: [
        ["Metered treatment", "Listed for corrosion and scale control, descaling, and pH adjustment. Maximum use level: 80 mg/L."],
        ["Offline applications", "Listed for descaling, drilling fluid, pipe cleaning, well cleaning, well drilling, and well rehabilitation. Flush the product out before returning the system to drinking-water service."]
      ],
      source_label: "Request WaterSafe60 certification documentation",
      source_url: "../contact?type=quote&product=WaterSafe60&message=Please%20send%20WaterSafe60%20certification%20documentation.#quoteForm"
    },
    application_modes: [
      {
        heading: "Metered treatment. Controlled at the pump.",
        intro: "Set the feed rate from water quality, treatment demand, and the target result.",
        facts: [
          ["Scale and corrosion control", "The technical sheet gives 2–10 mg/L for normal or below-normal hardness. Start low, inspect the system, and adjust within the listed maximum."],
          ["pH adjustment", "Bench-titrate a representative sample. Use upstream and downstream pH measurements to verify the response at the injection point."],
          ["80 mg/L maximum", "This is the NSF maximum use level for the listed treatment functions, not a default operating dose."]
        ]
      },
      {
        heading: "Offline cleaning. Isolate, treat, and flush.",
        intro: "Use a dedicated cleaning cycle for pipe deposits, fouled equipment, and well rehabilitation.",
        facts: [
          ["Separate the cleaning circuit", "Shut off or disconnect the section being treated. Select the cleaning concentration for the deposit load and application using the product directions."],
          ["Give the treatment time to work", "The technical sheet specifies at least 30 minutes for offline pipe cleaning, descaling, and well rehabilitation. Match the full procedure to the equipment and condition."],
          ["Restore water service", "Drain or purge the treated system and flush with fresh water. Verify that pH has returned to normal before reconnecting to drinking-water service."]
        ]
      }
    ],
    manufacturer_reference: {
      heading: "Titrate your water. Dial in the dose.",
      body: "The published Sigma sample report starts at pH 8 and shows estimated additions for several target pH levels. It illustrates why the starting water matters. Establish your own treatment demand while staying within the applicable use limit.",
      source_label: "Read the WaterSafe60 titration study (PDF)",
      source_url: "../docs/sds/watersafe60-titration-test.pdf"
    },
    technical_profile: {
      heading: "Practical chemistry for water-system teams.",
      intro: "Technical characteristics from the WaterSafe60 product documentation.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero ratings for health, flammability, and reactivity."],
        ["Non-fuming", "A mild-odor alternative to harsh mineral-acid treatment."],
        ["Non-DOT regulated", "Not regulated as a hazardous material for transportation."],
        ["No VOCs or phosphates", "Fully water-soluble treatment chemistry."],
        ["100% biodegradable", "Biodegradability reported in the product technical data."]
      ],
      source_label: "Request WaterSafe60 technical data and the latest SDS",
      source_url: "../contact?type=quote&product=WaterSafe60&message=Please%20send%20WaterSafe60%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan your water program",
      intro: "Start with the water analysis, treatment objective, system materials, and operating volume or flow.",
      record: "Record starting pH, alkalinity, hardness, temperature, product dose, and the measured result. For offline work, include isolation, contact time, flushing, and return-to-service checks.",
      items: [
        ["Choose the application", "Separate continuous treatment from an isolated cleaning or well-service job."],
        ["Match the feed hardware", "The label specifies 316 stainless steel, polypropylene, or Schedule 80 PVC. Do not use aluminum piping or fittings."],
        ["Confirm the operating plan", "Follow the product label, SDS, and the NSF use conditions for the selected application."],
        ["Size the supply", "Share system volume, flow, and expected demand for a drum, tote, or recurring-supply quote."]
      ]
    }
  },
  purgo: {
    job: "Surface cleaning and odor control",
    platform: "VertKleen antimicrobial surface care",
    summary: "Clean hard surfaces and control odor-causing bacteria in facilities, gyms, locker rooms, and fleet interiors.",
    meta_description: "Purgo concentrate cleans hard surfaces and controls odor-causing bacteria in facilities, gyms, locker rooms, and fleet interiors.",
    mechanism: "Purgo targets odor-causing bacteria with a colorless, non-staining formula for everyday surface care.",
    operator_advantage: "Concentrated value for daily surface care and dedicated water-system maintenance.",
    quote_cta: "Plan my Purgo cleaning program",
    fits: ["facility surfaces", "gyms and locker rooms", "fleet interiors", "drains and water systems"],
    proof: "Product documentation, laboratory reports, and application guidance",
    sample_cta: "Request a free Purgo sample",
    application_modes: [
      {
        heading: "Put odor control where people use the space.",
        intro: "Choose the application for the job, from daily surface care to a dedicated water-system maintenance program.",
        facts: [["Facility surfaces", "Clean compatible floors, counters, sinks, waste containers, and shared hard surfaces in gyms, locker rooms, restrooms, and commercial facilities."], ["Fleet interiors", "Make hard-surface cleaning and odor control part of the turnaround routine for buses, service vehicles, and commercial fleets. Protect electronics and test trim materials."], ["Drains and water systems", "Plan odor and fouling control around the system volume, operating conditions, and application-specific dose. Keep this separate from the surface-cleaning recipe."]]
      },
      {
        heading: "Apply it to fit your cleaning routine.",
        intro: "The manufacturer's technical data lists spray-and-wipe, spray-and-leave, and fogging applications for Purgo. Match the method to the space and the product directions.",
        facts: [["Spray and wipe", "Use the surface-care directions for the material and cleaning task, then wipe away the loosened residue."], ["Spray and leave", "Choose this method where the package directions specify a leave-on application and contact time."], ["Commercial fogging", "Share the equipment, room volume, ventilation, and occupancy schedule with MASEST to plan an application protocol."]]
      }
    ],
    application_guide: {
      heading: "Build a repeatable surface-care program.",
      steps: [["Choose the task", "Identify the surface, odor source, and application method. Use the directions for the exact Purgo package and job."], ["Mix for the application", "Confirm the concentrate-and-water recipe before setting a dispenser or filling a sprayer. Surface and water-system applications use different dosing methods."], ["Apply and finish", "Follow the specified coverage, contact time, wiping, and rinse instructions. Food-contact areas need the applicable finishing directions."], ["Review the routine", "Record product use, labor, odor recurrence, and the finished surface. Use those results to plan replenishment and recurring supply."]]
    },
    manufacturer_reference: {
      heading: "The chemistry behind Purgo surface care.",
      body: "The manufacturer describes Purgo as a colorless, non-staining multi-surface cleaner for odor-causing bacteria and everyday hard-surface care. Its technical sheet separates surface-cleaning uses from cooling-tower and other water-system applications.",
      source_label: "Request Purgo technical data",
      source_url: "../contact?type=quote&product=Purgo&message=Please%20send%20Purgo%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Make each gallon work across your routine.",
      intro: "Start with the application and working dilution, then compare product use and crew time per cleaned area.",
      facts: [["Colorless · non-staining", "Manufacturer-described formula for compatible hard surfaces and everyday odor control."], ["Zero VOCs · non-flammable", "Properties reported in the manufacturer's Purgo technical sheet."], ["Concentrated supply", "Small packs for trials and daily use, with drums and totes available through a tailored quote."], ["Product evidence", "Review the linked bacterial persistence report alongside the directions for your application."]],
      source_label: "Request Purgo application guidance and product documents",
      source_url: "../contact?type=quote&product=Purgo&message=Please%20send%20Purgo%20application%20guidance%2C%20dilution%20instructions%2C%20and%20product%20documents.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Set up the right cleaning routine",
      intro: "Start with a representative surface or odor problem and record what a successful result looks like.",
      record: "Keep the product directions, working dilution, application method, contact time, and finishing steps together for the crew.",
      items: [["Test the material", "Check an inconspicuous area before treating the full surface, especially trim, fabrics, and finished equipment."], ["Match the method", "Confirm equipment and space-specific directions before a fogging program. Use surface directions for surface care and a separate dosing plan for water systems."], ["Inspect the result", "Track the finished surface and odor recurrence under normal use to set the cleaning frequency."], ["Plan repeat supply", "Share product use and cleaning frequency for pack, drum, tote, or recurring-supply pricing."]]
    }
  },
  dbnpa: {
    job: "Low-dose tower-treatment component",
    summary: "Quarterly treatment for cooling-tower programs.",
    fits: ["quarterly dosing", "cooling towers", "low-dose programs"],
    proof: "Cooling-tower program details"
  },
  lam3: {
    job: "Outdoor growth and weathered staining",
    platform: "VertKleen exterior cleaner",
    summary: "Clear lichen, algae, moss, mold, and mildew staining from roofs, siding, decks, and pavers with spray-and-leave exterior cleaning.",
    meta_description: "VertKleen LAM3 removes outdoor growth and staining without bleach, quats, or peroxide. See real concrete photos, label dilutions, and spray-and-leave guidance.",
    mechanism: "LAM3 combines mineral-cleaning and exterior stain-removal chemistry to work on outdoor growth and staining after application. Choose spray-and-leave cleaning or brush and rinse for a more immediate finish.",
    operator_advantage: "Treat compatible exterior surfaces without bleach, quats, or peroxide, with a low-pressure method that lets the cleaner do the work.",
    hero_summary: {
      eyebrow: "Exterior stain removal",
      body: "Choose the cleaning method for the surface and your finish schedule.",
      facts: [["Spray and leave", "Low-pressure exterior application"], ["Bleach-free", "Also free of quats and peroxide"], ["Two methods", "Leave to work, or brush and rinse"]]
    },
    quote_cta: "Test LAM3 on my exterior",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Original LAM3 concrete before-and-after photographs and manufacturer application guidance",
    proof_slugs: ["lam3-concrete-cleaning"],
    proof_cta: "See the concrete before & after",
    featured_result: "lam3-concrete-cleaning",
    featured_result_copy: {
      heading: "See the change on stained concrete.",
      intro: "These supplied LAM3 field photographs show the same concrete edge before and after cleaning. Dark buildup is visibly reduced. Use a trial on your own surface to set the method and inspection schedule.",
      related_product: "multiwash",
      related_label: "Need routine wash-and-rinse cleaning? Explore MultiWash"
    },
    sample_cta: "Try a free LAM3 sample",
    application_modes: [{
      heading: "Choose your finish schedule.",
      intro: "LAM3 offers two ways to handle outdoor staining, depending on how soon the surface needs to be ready.",
      facts: [["Spray and leave", "Apply at low pressure and leave the treatment to work. Manufacturer data reports visible change beginning in one to two weeks; conditions and buildup affect the result."], ["Brush and rinse", "For a more immediate clean, apply, agitate the stained area, and rinse. Check the result and repeat where needed."], ["Maintain the finish", "Inspect treated areas over time and reapply when stains return. Record the weather, dilution, surface, and progress photographs."]]
    }],
    dilution_guide: {
      heading: "Mix for light or heavy staining.",
      intro: "Use the general LAM3 label for exterior stain treatment. Set the application method for the material and condition.",
      column_labels: ["Exterior stain level", "General-label dilution"],
      rows: [["Light stains", "10:1"], ["Heavy stains", "5:1"]],
      note: "Ratios are reproduced as printed on the linked label. MASEST can confirm the water-and-product recipe for your sprayer. Allow the treated area time to develop a visible result."
    },
    application_guide: {
      heading: "A simple exterior treatment plan.",
      steps: [["Inspect and prepare", "Identify the surface and coating, remove loose debris, and test a small area. Plan access, weather, nearby planting, and runoff."], ["Apply at low pressure", "Mix according to the package directions and wet the stained area evenly with a low-pressure sprayer or brush."], ["Use the chosen method", "Leave the treatment in place for gradual cleaning, or brush and rinse for the wash-and-rinse method. Follow the package directions for reapplication."], ["Track the finish", "Photograph the same area before treatment and during follow-up. Schedule maintenance around when staining returns rather than promising one timetable for every property."]]
    },
    manufacturer_reference: {
      heading: "LAM3 exterior-cleaning technology.",
      body: "Manufacturer technical data describes LAM3 as a lichen, algae, moss, mold, and mildew stain remover. The technical sheet covers wood, stucco, brick, concrete, pavers, siding, tile, and roofing, with both leave-on and brush-and-rinse methods.",
      source_label: "Request LAM3 technical data",
      source_url: "../contact?type=quote&product=VertKleen%20LAM3&message=Please%20send%20LAM3%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Exterior cleaning without bleach or quats.",
      intro: "A concentrated option for property-maintenance routes, from small exterior areas to recurring commercial work.",
      facts: [["Bleach · quat · peroxide free", "Manufacturer-listed formulation features for exterior stain removal."], ["Zero VOCs · non-flammable", "A water-soluble product with a mild detergent odor."], ["HMIS 0-0-0", "Triple-zero handling profile reported in manufacturer data."], ["Non-DOT-regulated · biodegradable", "Manufacturer technical data reports non-regulated transport and a biodegradable formula."]],
      source_label: "Request LAM3 application guidance and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20LAM3&message=Please%20send%20VertKleen%20LAM3%20application%20guidance%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Plan the whole property",
      intro: "Choose the method and follow-up date before starting, especially where access equipment or return visits affect the job cost.",
      record: "Compare concentrate, application labor, access, rinse work, repeat visits, and area reaching the desired finish.",
      items: [["Check the surface", "Test the coating or material at the working dilution and follow the roof or surface manufacturer's cleaning guidance."], ["Control application", "Use stable access and appropriate spray equipment. Manage drift, foot traffic, and nearby plants during application."], ["Keep uses separate", "Ask for application-specific guidance for ponds or fountains; the exterior stain-removal mix is not a water-treatment dose."], ["Maintain the result", "Inspect treated surfaces and reapply as staining returns. Keep the package directions and SDS with the crew."]]
    }
  },
  alumibrite: {
    job: "Restoring dull, oxidized aluminum",
    platform: "Aluminum cleaner & brightener",
    summary: "Bring dull aluminum back to a clean, bright finish on trucks, trailers, RVs, and boats.",
    meta_description: "Restore dull, oxidized aluminum with AlumiBrite. Synthetic-acid cleaning without HF or HCl for truck tanks, trailers, wheels, and marine aluminum.",
    mechanism: "Synthetic-acid chemistry and detergents lift oxidation and embedded grime, revealing the metal’s natural brightness without etching it to create the finish.",
    operator_advantage: "Synthetic-acid cleaning without HF, HCl, or a separate neutralizing step.",
    quote_cta: "Test AlumiBrite on my aluminum",
    sample_cta: "Request a free AlumiBrite sample",
    fits: ["truck tanks", "trailers", "wheels", "marine aluminum"],
    proof: "Manufacturer brightening comparison and a documented AlumiBrite + Torque vessel restoration",
    proof_slugs: ["airboat-alumibrite"],
    featured_result: "airboat-alumibrite",
    featured_result_copy: {
      heading: "See the restoration on a working vessel.",
      intro: "AlumiBrite restored the aluminum; Torque followed with wash and finish care.",
      related_product: "torque",
      related_label: "Explore Torque for routine wash and finish care"
    },
    featured_result_images: [
      "img/proof/story/airboat-panel-before-aligned-202609.webp",
      "img/proof/story/airboat-panel-after-aligned-202609.webp"
    ],
    brightening_comparison: {
      heading: "Strong brightening. No hydrofluoric acid.",
      intro: "In the manufacturer comparison, Alumi-Brite scored close to hydrofluoric acid and above hydrochloric acid for aluminum brightening.",
      rows: [["Alumi-Brite", "90.1"], ["Hydrofluoric acid (HF)", "92.5"], ["Hydrochloric acid (HCl)", "86.3"]],
      note: "Manufacturer-reported scores, not percentages. Test: 200 g of 5% active solution on 5 sq. in. of corroded 7075-Y6 aluminum, 3 minutes at 70°F. These are comparison conditions, not mixing or dwell-time directions.",
      source_label: "Request AlumiBrite technical data and comparison",
      source_url: "../contact?type=quote&product=VertKleen%20AlumiBrite&message=Please%20send%20AlumiBrite%20technical%20data%20and%20comparison.#quoteForm"
    },
    technical_profile: {
      heading: "Built for the wash bay.",
      facts: [
        ["HMIS 0-0-0", "Manufacturer data reports zero ratings for health, flammability, and reactivity."],
        ["Non-DOT regulated", "Manufacturer transportation classification: non-hazardous for shipping."],
        ["No VOCs or phosphates", "Water-soluble chemistry with a mild soapy odor."],
        ["100% biodegradable", "Reported in the manufacturer's biodegradation study summary."],
        ["Non-skin-irritant test result", "Manufacturer data reports this classification from modified Draize testing under OECD 404."],
        ["Paint and glass compatibility", "Useful around truck bodies and cab glass; check the condition of specialty finishes with a test patch."]
      ],
      source_label: "Request AlumiBrite technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20AlumiBrite&message=Please%20send%20AlumiBrite%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    },
    application_guide: {
      heading: "A brighter finish starts with a test patch.",
      steps: [
        ["Match the finish", "Identify bare, polished, anodized, or coated aluminum. Test a small hidden area and compare it after rinsing and drying."],
        ["Apply at the label dilution", "Spray or brush evenly using the directions for your package and surface. Match contact time and agitation to those directions."],
        ["Rinse and inspect", "Rinse thoroughly, then check the dry result before expanding the job. No separate neutralizing step is needed."],
        ["Keep the finish looking good", "Use AlumiBrite for aluminum restoration, then choose Torque for routine vehicle and boat washing."]
      ]
    }
  },
  torque: {
    job: "One-step vehicle and marine wash & wax",
    platform: "Vehicle wash & wax",
    summary: "Lift road film, diesel soot, salt, and bugs. Leave a glossy wax finish in the same wash.",
    meta_description: "Torque concentrated wash and wax removes road film, diesel soot, salt, and bugs from vehicles and boats, leaving a glossy, anti-stick finish.",
    mechanism: "VertKleen cleaning chemistry lift road film, grease, diesel soot, salt, and bug residue. Rinsing distributes polymerized natural bean wax and the anti-stick coating across the clean surface.",
    operator_advantage: "One concentrate cleans and finishes trucks, buses, RVs, and boats, with an anti-stick coating that helps keep grime from clinging between washes.",
    quote_cta: "Try Torque on my vehicle or boat",
    fits: ["vehicles", "fleets", "RVs", "boats"],
    proof: "A documented Torque vessel wash and finish",
    proof_slugs: ["yellowfin-torque-wash"],
    featured_result: "yellowfin-torque-wash",
    featured_result_copy: {
      heading: "A clean hull. A glossy finish.",
      intro: "See the finish from a documented Torque vessel wash.",
      related_product: "alumibrite",
      related_label: "Restoring oxidized aluminum? Explore AlumiBrite"
    },
    sample_cta: "Try a free Torque sample",
    dilution_guide: {
      heading: "Match the concentrate to the job.",
      intro: "Four label dilutions cover regular upkeep through severe soil. Choose the strength for the vehicle’s condition.",
      rows: [["New or reconditioned vehicles", "20:1"], ["Moderate soil", "15:1"], ["Heavy soil", "10:1"], ["Severe soil", "5:1"]],
      note: "Dilutions shown on the VertKleen Torque general label. Follow your package directions for mixing and application."
    },
    application_guide: {
      heading: "Apply. Brush. Rinse to finish.",
      steps: [
        ["Choose your wash method", "Apply the label dilution by hand, bucket and brush, or a foaming applicator. Work across the areas carrying dirt, grease, salt, and bug residue."],
        ["Brush where needed", "Agitate stubborn deposits and heavily soiled areas to help release the film from the surface."],
        ["Rinse well", "A thorough water rinse carries away loosened grime and distributes the wax and anti-stick coating. The finish is part of the wash."]
      ]
    },
    manufacturer_reference: {
      heading: "Fleet experience behind the finish.",
      body: "Manufacturer data identifies Torque as the wash behind Blue Bird’s Bird Bath bus wash and reports paint-safety testing by PPG, Blue Bird’s coatings manufacturer.",
      source_label: "Request Torque fleet and paint-testing documentation",
      source_url: "../contact?type=quote&product=VertKleen%20Torque&message=Please%20send%20Torque%20fleet%20and%20paint-testing%20documentation.#quoteForm"
    },
    technical_profile: {
      heading: "Strong cleaning. Easier fleet care.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero ratings for health, flammability, and reactivity, reported in manufacturer data."],
        ["Non-corrosive; non-DOT regulated", "Heavy-duty cleaning without DOT hazardous-material shipping classification."],
        ["No VOCs or phosphates", "Water-soluble concentrate with a mild soapy odor."],
        ["100% biodegradable", "Biodegradability reported in the manufacturer's technical data."],
        ["Built for winter road film", "Removes road salt, calcium deposits, and magnesium chloride, as well as grease and diesel soot."],
        ["Vehicle-material compatibility", "Manufacturer data lists glass, aluminum, chrome, stainless steel, rubber, and plastic."]
      ],
      source_label: "Request Torque technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20Torque&message=Please%20send%20Torque%20technical%20data%20and%20the%20latest%20SDS.#quoteForm"
    }
  },
  "cr-hd-low-foam": {
    job: "Machine wash and low-foam degreasing",
    platform: "VertKleen low-foam degreaser",
    summary: "Cut heavy grease and hydraulic oil with a low-foam concentrate built for parts washers, wash cabinets, and floor-cleaning equipment.",
    meta_description: "VertKleen CR HD Low Foam cuts grease and hydraulic oil in parts washers, wash cabinets, and scrubbers. See LF dilution guidance and technical data.",
    mechanism: "Wetting agents reach beneath oily buildup and lift it from the surface. The non-emulsifying formula leaves removed oils intact for collection and separation.",
    operator_advantage: "Get strong degreasing with controlled foam, no butyl solvents, zero VOCs, and non-flammability. Works with warm or cold water.",
    quote_cta: "Test it in my wash equipment",
    fits: ["parts washers", "wash cabinets", "floor scrubbers", "hydraulic oil"],
    proof: "Manufacturer's Low Foam technical data, low-foam machine applications, and soil-specific dilution examples",
    sample_cta: "Try a free CR HD Low Foam sample",
    application_modes: [
      {
        heading: "Heavy grease removal. Foam suited to the machine.",
        intro: "Choose Low Foam when the wash equipment needs detergency without the ample foam of standard CR HD.",
        facts: [
          ["Parts washers and wash cabinets", "Lift grease and oily deposits from compatible parts. Manufacturer technical data specifically identifies the LF formulation for these machine applications."],
          ["Automatic and rotary floor cleaning", "Cut oily shop-floor soil with a low-foam cleaner, then recover the dirty solution. Match the pad, dilution, and water flow to the floor and machine."],
          ["Warm or cold water", "Choose the temperature your equipment and parts allow. The technical sheet also lists steam cleaners, rotary cleaners, and carpet-cleaning equipment."]
        ]
      }
    ],
    dilution_guide: {
      heading: "Match the dilution to the soil.",
      intro: "The manufacturer's Low Foam technical sheet gives two starting examples. Use the Low Foam package directions to set the final mix for your machine.",
      column_labels: ["Cleaning job", "LF technical-sheet dilution"],
      caption: "CR HD Low Foam: manufacturer technical-sheet dilution examples",
      rows: [["Caked-on hydraulic fluid or grease", "10:1"], ["Floors, vehicles, and carpets", "30:1"]],
      note: "Ratios are reproduced as printed in the LF technical sheet. Confirm the water-and-concentrate recipe with MASEST before filling a tank or setting an automatic dispenser."
    },
    application_guide: {
      heading: "Set up a repeatable machine-cleaning cycle.",
      steps: [
        ["Match the equipment", "Share the machine model, tank capacity, operating temperature, surface, and grease load. Check the equipment maker's cleaner requirements and test the material and finish."],
        ["Prepare the wash", "Remove loose solids and excess oil. Mix Low Foam to its package directions and the agreed machine setting; keep the tank within its working fill level."],
        ["Clean and recover", "Run the wash or scrub cycle, inspect the result, and rinse as the part, floor, and equipment require. Collect removed grease and dirty solution through the machine's recovery process."],
        ["Record the result", "Log concentrate used, tank volume, temperature, cycle time, foam, repeat passes, and the finished surface. Use the successful settings for the next comparable job."]
      ]
    },
    manufacturer_reference: {
      heading: "The chemistry behind VertKleen Low Foam.",
      body: "The manufacturer's LF technical sheet describes a non-butyl, non-solvent, low-foaming cleaner for petroleum oils, animal and vegetable fats, and protein soils. Its non-emulsifying action lifts grease for removal, with wetting agents and corrosion inhibitors supporting industrial cleaning.",
      source_label: "Request Low Foam technical data",
      source_url: "../contact?type=quote&product=VertKleen%20CR%20HD%20Low%20Foam&message=Please%20send%20Low%20Foam%20technical%20data.#quoteForm"
    },
    technical_profile: {
      heading: "Less foam. Simpler routine handling.",
      intro: "A concentrated machine cleaner with HMIS 0-0-0 and a mild soapy odor.",
      facts: [
        ["Non-butyl · solvent-free", "Cuts grease without butyl or solvent-based degreasing chemistry."],
        ["Zero VOCs · non-flammable", "The LF technical sheet reports no VOCs and a non-flammable formula."],
        ["Non-DOT-regulated shipping", "Manufacturer technical data lists LF as non-regulated for DOT, TDG, IMO, IATA, and IMDG transport."],
        ["100% biodegradable · phosphate-free", "Manufacturer-reported formula properties. Collect used washwater and the grease it removes through your site's recovery process."]
      ],
      source_label: "Request Low Foam technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20CR%20HD%20Low%20Foam&message=Please%20send%20VertKleen%20CR%20HD%20Low%20Foam%20package%20directions%2C%20technical%20data%2C%20and%20the%20latest%20SDS.#quoteForm"
    },
    handling_guide: {
      eyebrow: "Prove the value in your equipment",
      intro: "Test Low Foam against your current cleaner on the same parts or floor area, using each product's directions.",
      record: "Compare concentrate use, cycle time, foam-related interruptions, repeat passes, and the finished result. Those measurements show the cost of a clean job.",
      items: [
        ["Use the LF directions", "Standard CR HD and Low Foam have different foam profiles. Use the label supplied with your Low Foam package."],
        ["Check materials and settings", "Confirm coatings, seals, metals, operating temperature, and detergent requirements before filling the machine."],
        ["Manage the recovered soil", "Remove collected oils and solids and maintain the wash system as its manufacturer directs. Keep used washwater out of storm drains."],
        ["Scale from a successful trial", "Start with a sample or small pack. Share your results and monthly usage for drum, tote, and recurring-supply pricing."]
      ]
    }
  },
  cr2: {
    job: "Grease and organic buildup in HVAC and facility drains",
    platform: "Concentrated caustic replacement",
    summary: "Clear grease and organic buildup from HVAC drains, pans, and facility equipment with a concentrated 60% caustic soda replacement.",
    meta_description: "VertKleen HVAC CR removes grease and organic buildup in HVAC drains and pans. 60% caustic replacement, HMIS 0-0-0, with label dilution and rinse guidance.",
    mechanism: "HVAC CR loosens greasy deposits and organic residue so contact time, agitation, and rinsing carry the buildup away.",
    operator_advantage: "Match the dilution to the job, rinse away the residue, and simplify recurring maintenance with HMIS 0-0-0 chemistry and non-DOT shipping.",
    quote_cta: "Plan my HVAC CR cleaning job",
    sample_cta: "Try a free HVAC CR sample",
    fits: ["HVAC drains", "condensate pans", "grease and organic buildup", "facility maintenance"],
    proof: "CR² manufacturer label, 60% caustic-replacement record, and HVAC application directions",
    proof_cta: "See the caustic replacement record",
    proof_heading: "Caustic replacement",
    proof_badge: "Product record",
    dilution_guide: {
      heading: "Choose the strength for the buildup.",
      intro: "Use the HVAC CR label's soil-based ratios. Apply to the cleaning area, allow contact time, then rinse away the loosened residue.",
      column_labels: ["Soil / odor level", "Label dilution"],
      rows: [["Light soil / mild odor", "10:1 · dwell 10–15 min"], ["Moderate soil / odor", "5:1 · dwell, then rinse"], ["Severe soil / odor", "2:1 · dwell 20 min"]],
      note: "Every label method finishes with rinsing. Confirm the mix for your package and application; the moderate-soil direction does not specify a fixed dwell time."
    },
    application_guide: {
      heading: "A practical drain and degreasing routine.",
      steps: [
        ["Prepare the work area", "Isolate the equipment, protect electrical components, and remove accessible loose debris. Identify the drain path and collect wash water through the site's normal wastewater procedure."],
        ["Match dilution to soil", "Use the light, moderate, or severe label direction. Check a small area and confirm that the diluted solution suits the pan, drain, seals, and fittings."],
        ["Apply and allow contact", "Wet the buildup and follow the label's dwell time. Agitate accessible greasy surfaces as needed to release stubborn deposits."],
        ["Rinse and verify flow", "Rinse thoroughly, remove loosened residue, and confirm drainage before returning the equipment to service. Record the mix, dwell time, and result for the next maintenance visit."]
      ]
    },
    manufacturer_reference: {
      heading: "CR²: the 60% caustic replacement.",
      body: "HVAC CR is the CR² formulation in the VertKleen range. The manufacturer identifies CR² as a replacement for 60% sodium hydroxide. That describes its caustic-replacement role; use the HVAC label ratios for cleaning. For process-water pH adjustment, send us the starting pH, target, and water analysis so the dose can be set for your system.",
      source_label: "See the manufacturer's CR² product information",
      source_url: "https://www.phlexapeel.com/products"
    },
    technical_profile: {
      heading: "Concentrated cleaning. Simpler handling.",
      intro: "The HVAC label and CR² manufacturer documentation put practical handling benefits alongside cleaning performance.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero product rating for routine facility maintenance."],
        ["Non-DOT regulated", "CR²'s manufacturer label identifies non-regulated transport for simpler shipping."],
        ["Biodegrades in under 10 days", "The HVAC CR label reports biodegradation in less than 10 days."],
        ["One concentrate, three label ratios", "Adjust the cleaning solution for light, moderate, or severe buildup."]
      ],
      source_label: "Read the manufacturer CR² label (PDF)",
      source_url: "https://www.phlexapeel.com/s/pHlex-CR2-Label.pdf"
    },
    handling_guide: {
      eyebrow: "Plan the first application",
      intro: "Tell us what is blocking the drain or coating the equipment, which materials it contacts, and how the system is cleaned today.",
      record: "MASEST can help choose the starting mix and compare chemical use, labor, rinsing, and repeat-maintenance cost.",
      items: [
        ["Match the buildup", "Use HVAC CR for grease and organic residue. Ask for a mineral-cleaning product when scale or rust is the main problem."],
        ["Check the materials", "Confirm compatibility before treating aluminum, coated coils, seals, or mixed-metal assemblies; use equipment-specific guidance."],
        ["Use the correct directions", "Follow the HVAC CR package label, latest SDS, and site PPE requirements. Keep cleaner away from electrical components."],
        ["Choose your supply", "Trial a small pack, then request drum, tote, or recurring-maintenance pricing."]
      ]
    }
  },
  sar: {
    job: "Sulfuric acid replacement for pH control",
    platform: "Synthetic sulfuric acid replacement",
    summary: "Lower process-water pH with a non-fuming sulfuric acid replacement.",
    meta_description: "VertKleen SAR replaces sulfuric acid for process-water pH reduction. Non-fuming, non-DOT regulated chemistry with application-specific dosing support.",
    mechanism: "SAR lowers the pH of process liquids as it is added and mixed. A bench titration establishes how much your fluid needs to reach its target pH, then guides the working feed rate.",
    operator_advantage: "Strong pH reduction with almost no heat released during water dilution and non-DOT shipping for simpler procurement.",
    quote_cta: "Plan my SAR dosing program",
    fits: ["pH reduction", "process water", "sulfuric replacement", "chemical feed"],
    proof: "SAR technical data, product-label directions, and dosing support",
    sample_cta: "Request a SAR trial sample",
    handling_guide: {
      eyebrow: "Before you dose",
      intro: "Review the SAR label and SDS with the team responsible for your treatment system.",
      record: "Record fluid volume or flow, starting and target pH, temperature, SAR dose, and the measured endpoint so repeat treatment starts from verified settings.",
      items: [
        ["Establish demand", "Use a representative fluid sample and a calibrated pH meter to plan the dose."],
        ["Check the feed system", "Confirm compatible pumps, tanks, lines, and fittings before starting treatment."],
        ["Follow site procedures", "Use the handling and eye-protection practices specified by the SDS and your workplace."],
        ["Plan the supply", "Share the trial result and expected throughput for a drum, tote, or ongoing supply quote."]
      ]
    },
    application_guide: {
      heading: "Dose to target. Verify the result.",
      steps: [
        ["Define the process", "Start with the liquid being treated, current and target pH, temperature, and batch volume or flow rate. Include the sulfuric acid concentration and feed rate you use today."],
        ["Bench-titrate your fluid", "Test a representative sample to establish the SAR dose needed for the target pH. Use that measured demand to plan the batch addition or metering rate."],
        ["Match the feed hardware", "The SAR label recommends 316 stainless steel, polypropylene, or Schedule 80 PVC. Do not use aluminum fittings or piping. Confirm tanks, hoses, seals, and connections for the application."],
        ["Add, mix, and measure", "Add SAR to the process liquid, mix, and check pH as you approach the target. Confirm the result before adopting the treatment rate for routine operation."]
      ]
    },
    manufacturer_reference: {
      heading: "Titration strength comparable to 40% sulfuric acid.",
      body: "The SAR technical sheet reports equivalent titration strength to a 40% sulfuric acid solution, with almost no heat released when mixed with water. Set the working dose from your fluid’s measured demand and target pH.",
      source_label: "Request SAR technical data and dosing support",
      source_url: "../contact?type=quote&product=VertKleen%20SAR&message=Please%20send%20SAR%20technical%20data%20and%20help%20plan%20a%20pH-control%20trial.#quoteForm"
    },
    technical_profile: {
      heading: "Built for practical pH-control programs.",
      intro: "Product characteristics from the SAR technical data and supplied label.",
      facts: [
        ["HMIS 0-0-0", "Triple-zero ratings for health, flammability, and reactivity."],
        ["Non-fuming", "Low-pH treatment chemistry without the fuming associated with conventional acid handling."],
        ["Non-DOT regulated", "Ships by common carrier without DOT hazardous-material classification."],
        ["No VOCs or phosphates", "Water-soluble formula with a mild odor."],
        ["100% biodegradable", "Biodegradability reported in the SAR technical data."],
        ["Bench trial through bulk supply", "Start with an application trial, then size the supply around your measured treatment demand."]
      ],
      source_label: "Request SAR technical data and the latest SDS",
      source_url: "../contact?type=quote&product=VertKleen%20SAR&message=Please%20send%20the%20SAR%20technical%20data%20sheet%20and%20latest%20SDS.#quoteForm"
    }
  },
  pg100: {
    job: "Inhibited propylene glycol concentrate",
    summary: "Concentrated inhibited PG for closed-loop heat transfer and freeze protection, quoted by pack size and delivery location.",
    fits: ["HVAC loops", "hydronic systems", "freeze protection"],
    proof: "Pricing launch spec"
  },
  pg50: {
    job: "Inhibited PG 50% loop service",
    summary: "Ready-to-use inhibited PG for routine top-offs and closed-loop maintenance without field-mix guesswork.",
    fits: ["HVAC loops", "hydronic systems", "maintenance top-offs"],
    proof: "Pricing launch spec"
  },
  eg100: {
    job: "Inhibited ethylene glycol concentrate",
    summary: "Concentrated inhibited EG for industrial heat-transfer and freeze-protection loops where loop performance is the priority.",
    fits: ["industrial loops", "process systems", "freeze protection"],
    proof: "Pricing launch spec"
  },
  eg50: {
    job: "Inhibited EG 50% loop service",
    summary: "Ready-to-use inhibited EG for routine industrial loop maintenance and top-offs.",
    fits: ["industrial loops", "heat transfer", "maintenance top-offs"],
    proof: "Pricing launch spec"
  },
  egu96: {
    job: "Uninhibited EG concentrate",
    summary: "Uninhibited 96% ethylene glycol concentrate for heat-transfer loop programs.",
    fits: ["utility loops", "industrial freeze protection", "process systems"],
    proof: "Pricing launch spec"
  },
  eg5050: {
    job: "EG 50/50 blend",
    summary: "Premixed EG 50/50 blend for loop top-offs and maintenance, quoted to order.",
    fits: ["loop top-offs", "routine maintenance", "freeze protection"],
    proof: "Pricing launch spec"
  }
};

export function productHighlights(id) {
  const product = PRODUCTS[id];
  const copy = PRODUCT_CATALOG_COPY[id];
  if (!product || !copy) return [];
  const mechanism = copy.mechanism || copy.summary;
  const advantage = copy.operator_advantage
    || `Built around ${copy.fits.join(", ")} with a clear product and supply path.`;
  return [
    ["ph-atom", "Best for", copy.job],
    ["ph-gears", "How it works", mechanism],
    ["ph-trend-up", "Why customers switch", advantage],
    ["ph-images", "Results and support", copy.proof],
  ];
}

/* ---------- Nav / footer injection ---------- */
