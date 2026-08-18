const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";

const CATALOG_IMAGE_DIMENSIONS = Object.freeze({
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
    application_image: "img/representative/applications/cip-cycle-skid-v1.webp",
    uses: [
      "Beer-stone removal in brewery CIP",
      "Tank, keg, and line acid-wash steps",
      "316 stainless and PVC brewery equipment",
      "Heat-exchanger plate descaling"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-hcr-sds.pdf" },
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
    application_image: "img/representative/applications/hvac-descaling-loop-v1.webp",
    uses: [
      "HVAC coils and water-side descaling",
      "Calcium, scale, and rust removal",
      "Stainless equipment, fittings, and gaskets",
      "Bulk HVAC and facility programs"
    ],
    docs: [
      "Bulk HCR Program Profile",
      "HCR Product Guide"
    ]
  },
  cr: {
    name: "VertKleen CIP CR",
    cat: "alkaline",
    replaces: "Caustic-soda brewery CIP",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/cip-cr-studio.webp",
    application_image: "img/representative/applications/cip-cycle-skid-v1.webp",
    uses: [
      "Brewery lines, kegs, and tanks",
      "Krausen and organic-soil removal",
      "Hot-circulation alkaline wash steps",
      "316 stainless and PVC CIP systems"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-cr-sds.pdf" }
    ]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Caustic and solvent degreasers",
    hmis: "0-0-0",
 icon: "ph-drop",
 image: "img/products/neutral-studio.webp",
    application_image: "img/representative/applications/neutral-material-test-patch-v1.webp",
    uses: [
      "Heavy equipment and machinery degreasing",
      "Marine, oil and gas, and aviation surfaces",
      "Sensitive metals, seals, and finished surfaces",
      "Facility and fleet maintenance"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-neutral-sds.pdf" }
    ]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "alkaline",
    replaces: "General-purpose alkaline cleaners",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    image: "img/products/multiwash-gym-studio.webp",
    application_image: "img/representative/applications/multiwash-facility-floor-v1.webp",
    uses: [
      "Concrete drains and hardscape cleaning",
      "Pressure-washing programs",
      "Facility, warehouse, and fulfillment-center maintenance",
      "Educational and healthcare environments"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-multiwash-sds.pdf" },
    ]
  },
  watersafe60: {
    name: "WaterSafe60",
    cat: "water",
    replaces: "Heavy-metal tower and closed-loop inhibitors",
    hmis: "0-0-0",
    icon: "ph-waves",
    image: "img/products/watersafe60-studio.webp",
    application_image: "img/representative/applications/watersafe60-water-program-v1.webp",
    uses: [
      "Cooling tower scale and corrosion control",
      "Closed-loop and chilled-water systems",
      "ASHRAE 188 and Legionella risk-management programs",
      "Campus, hospital, and government facilities"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/watersafe60-sds.pdf" },
      { label: "Titration / Sigma Test Data", file: "docs/sds/watersafe60-titration-test.pdf" }
    ]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Conventional odor-control and organic-buildup treatments",
    hmis: "0-0-0",
 icon: "ph-shield-plus",
    image: "img/products/purgo-studio.webp",
    application_image: "img/representative/applications/purgo-controlled-drain-maintenance-v1.webp",
    uses: [
      "Water-treatment and odor-control chemistry",
      "Organic-buildup control in towers, drains, and process water",
      "Occupied-campus water-treatment programs",
      "Recurring treatment backed by testing and monitoring"
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
      "Controlled-release dosing after technical review"
    ],
    docs: ["Safety Data Sheet (SDS)", "Controlled Label / SDS Request"]
  },
  crhd: {
    name: "VertKleen CR HD",
    cat: "alkaline",
    replaces: "Solvent, butyl, and general-purpose industrial degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
    image: "img/products/crhd-studio.webp",
    application_image: "img/representative/applications/cr-hd-degreasing-trial-v1.webp",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Side-by-side testing against the cleaner used today"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crhd-sds.pdf" },
      { label: "Degreaser Comparison", file: "docs/sds/vertkleen-crhd-degreaser-comparison.pdf" },
      "CR HD Job Test Guide"
    ]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Hydrochloric acid, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
 image: "img/products/descaler-studio.webp",
    application_image: "img/representative/applications/hvac-descaling-loop-v1.webp",
    uses: [
      "Aluminum and copper coil descaling",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Cooling and heat-transfer circuits"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-descaler-sds.pdf" },
      "Descaler vs Acids Corrosion Data"
    ]
  },
  alumibrite: {
    name: "VertKleen AlumiBrite",
    cat: "specialty",
    replaces: "Replaces hydrofluoric and hydrochloric aluminum brighteners",
    hmis: "0-0-0",
 icon: "ph-car",
 image: "img/products/alumibrite-studio.webp",
    application_image: "img/representative/applications/alumibrite-aluminum-test-patch-v1.webp",
    uses: [
      "Wheels, trim, and aluminum restoration",
      "Fleet, RV, and marine aluminum",
      "Detailing and dealership reconditioning",
      "Commercial aluminum cleaning and restoration"
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  torque: {
    name: "VertKleen Torque",
    cat: "specialty",
    replaces: "Separate wash, wax, and bug-removal steps",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    image: "img/products/torque-studio.webp",
    application_image: "img/representative/applications/torque-contained-fleet-wash-v1.webp",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Working boats and marine equipment"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-torque-sds.pdf" }
    ]
  },
  lam3: {
    name: "VertKleen LAM3",
    cat: "specialty",
    replaces: "Replaces Wet & Forget and bleach roof cleaners",
    hmis: "0-0-0",
 icon: "ph-house-line",
 image: "img/products/lam3-studio.webp",
    application_image: "img/representative/applications/lam3-exterior-surface-trial-v1.webp",
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Pond and fountain algae",
      "Field-proven clearing mildew from a painted column over two weeks"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-lam3-sds.pdf" }
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
    image: "img/products/crhd-studio.webp",
    application_image: "img/representative/applications/cr-hd-low-foam-machine-wash-v1.webp",
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy soil and grease on equipment and floors"
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  cr2: {
    name: "VertKleen HVAC CR",
    cat: "alkaline",
    replaces: "Caustic drain cleaners and heavy degreasers",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/hvac-cr-studio.webp",
    application_image: "img/representative/applications/hvac-cr-drain-maintenance-v1.webp",
    uses: [
      "HVAC and facility drain cleaning",
      "Grease and organic-buildup removal",
      "Coils, equipment, and general maintenance"
    ],
    docs: ["Safety Data Sheet (SDS)"]
  },
  sar: {
    name: "VertKleen SAR",
    cat: "acid",
    replaces: "Specialty and blended-acid cleaners",
    hmis: "0-0-0",
    icon: "ph-wrench",
    image: "img/products/sar-studio.webp",
    application_image: "img/representative/applications/sar-application-engineering-v1.webp",
    uses: [
      "Specialty descaling and acid-cleaning jobs",
      "Water-side scale and mineral removal",
      "Hard mineral deposits that need a better-matched cleaner"
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
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  pg50: {
    name: "PG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% propylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Closed-loop HVAC systems", "Hydronic loop top-offs", "Facility freeze-protection maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg100: {
    name: "EG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Industrial heat-transfer loops", "Closed-loop freeze protection", "Process-loop maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg50: {
    name: "EG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Industrial loop top-offs", "Closed-loop freeze protection", "Heat-transfer maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  egu96: {
    name: "EG uninhibited 96% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol uninhibited concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Utility loop service", "Industrial freeze protection", "Process heat-transfer maintenance"],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg5050: {
    name: "EG 50/50",
    cat: "glycol",
    replaces: "50% ethylene glycol pre-mix",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    uses: ["Loop top-offs", "Routine freeze-protection maintenance", "Industrial heat-transfer service"],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
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
  { key: "descale", label: "Descaling & Rust", ids: ["hcr", "hcr-t16", "descaler", "sar"] },
  { key: "degrease", label: "Degreasers", ids: ["cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash"] },
  { key: "water", label: "Water Treatment", ids: ["cr2", "purgo", "watersafe60"] },
  { key: "exterior", label: "Exterior & Marine", ids: ["lam3", "alumibrite", "torque"] }
];

export const QUOTE_FIRST_IDS = ["crs"];

export const PRODUCT_CATALOG_COPY = {
  hcr: {
    job: "Beer stone, scale, and rust in brewery CIP",
    platform: "VertKleen mineral cleaner",
    summary: "Remove beer stone, scale, and rust without bringing conventional mineral acid into the brewery.",
    mechanism: "HCR reacts with carbonate scale and rust, loosens buildup from the surface, and keeps it moving toward the rinse.",
    operator_advantage: "Clean tanks, kegs, lines, and heat exchangers with one repeatable mineral-cleaning step.",
    quote_cta: "Plan my brewery cleaning cycle",
    sample_cta: "Request a CIP HCR sample",
    fits: ["brewery CIP", "beer stone", "tanks and kegs", "heat-exchanger plates"],
    proof: "Up to 280× less corrosion than hydrochloric acid, backed by brewery and HVAC results",
    proof_slugs: ["brewery-cip-trials", "ddc-rust-test", "brevard-farm-hvac"]
  },
  "hcr-t16": {
    job: "Bulk HVAC descaling",
    platform: "Bulk VertKleen mineral cleaner",
    summary: "Bulk HCR for recurring scale and rust jobs across HVAC and facility equipment.",
    mechanism: "HCR breaks down calcium, rust, and water-side scale, then keeps the loosened minerals moving toward the rinse.",
    operator_advantage: "Tote supply lowers delivered cost and keeps repeat descaling jobs easier to plan and run.",
    quote_cta: "Price a bulk HVAC descaling job",
    fits: ["HVAC coils", "water-side scale", "facility loops", "bulk programs"],
    proof: "HVAC rust and scale results plus bulk-use guidance",
    sample_cta: "Request an HVAC HCR sample"
  },
  descaler: {
    job: "Coils, towers, and heat-transfer equipment",
    platform: "VertKleen scale remover",
    summary: "Break down stubborn scale in coils, towers, pumps, plumbing, and heat-transfer equipment.",
    mechanism: "Descaler wets hard mineral buildup, breaks it apart, and carries it out through circulation and rinse.",
    operator_advantage: "Bring back flow and heat transfer with less fume, easier handling, and a cleaner rinse than hydrochloric acid.",
    quote_cta: "Test my mineral deposit",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "Results from AC coils, fire-system components, and water-side equipment",
    proof_slugs: ["fire-pump-descaler", "residential-ac-coil"],
    sample_cta: "Request a Descaler sample"
  },
  crs: {
    job: "Water-side scale and rust",
    summary: "For underbody rust, fixtures, coils, and water lines where metal compatibility matters as much as cleaning power.",
    fits: ["underbodies", "fixtures", "coils", "water lines"],
    proof: "User guide and application notes"
  },
  cr: {
    job: "Yeast, protein, fat, and organic film in brewery CIP",
    platform: "VertKleen brewery cleaner",
    summary: "Cut through brewery organics without building the cycle around conventional caustic.",
    mechanism: "CR loosens fat, protein, yeast, and organic film, lifts the mess from the surface, and carries it into the rinse.",
    operator_advantage: "Get strong CIP cleaning, a cleaner rinse, and a faster return to production with HMIS 0-0-0 handling.",
    quote_cta: "Plan my brewery wash cycle",
    sample_cta: "Request a CIP CR sample",
    fits: ["brewery CIP", "krausen", "tanks and kegs", "hot circulation"],
    proof: "Direct caustic-replacement record plus brewery CIP results",
    proof_slugs: ["brewery-cip-trials"]
  },
  crhd: {
    job: "Heavy grease and industrial soil",
    platform: "VertKleen industrial degreaser",
    summary: "Heavy-duty degreasing without solvent fumes or flammability.",
    mechanism: "CR HD gets under grease and oil, lifts it from the surface, and keeps it suspended so it rinses away instead of settling back down.",
    operator_advantage: "Move through hard grease in fewer passes with lower odor, no flammability, and a cleaner rinse.",
    quote_cta: "Test CR HD on my toughest job",
    sample_cta: "Request a CR HD sample",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Results from Walmart distribution centers, commercial kitchens, and filter cleaning",
    proof_slugs: ["commercial-kitchen-crhd", "distribution-center-assessment"]
  },
  neutral: {
    job: "Sensitive surfaces and seals",
    platform: "Near-neutral VertKleen cleaner",
    summary: "Remove oil and grime at a near-neutral pH when finishes, seals, and frequent use matter.",
    mechanism: "Neutral spreads across oily film, lifts it from the surface, and holds it in the wash until rinse-out.",
    operator_advantage: "Clean sensitive equipment, vehicles, and occupied spaces without reaching for acid or high-alkaline chemistry.",
    quote_cta: "Test Neutral on my surface",
    sample_cta: "Request a Neutral sample",
    fits: ["equipment", "marine", "aviation", "fleet"],
    proof: "Near-neutral cleaning guidance across equipment, marine, aviation, and fleet work"
  },
  multiwash: {
    job: "Everyday facility washing",
    platform: "VertKleen all-purpose cleaner",
    summary: "One formulation for mixed soils that usually require several bottles.",
    mechanism: "MultiWash loosens everyday grime, light grease, mineral film, and wet-zone residue so one wash can cover more of the facility.",
    operator_advantage: "Stock fewer cleaners, simplify training, and move faster through daily cleaning with low odor and HMIS 0-0-0 handling.",
    quote_cta: "Try MultiWash on my facility",
    sample_cta: "Request a MultiWash sample",
    fits: ["campuses", "concrete", "drains", "pressure washing"],
    proof: "Results from drone washing, gyms, vehicles, and property maintenance"
  },
  watersafe60: {
    job: "Scale and corrosion control",
    platform: "VertKleen water treatment",
    summary: "Keep scale and corrosion under control without heavy-metal inhibitors.",
    mechanism: "WaterSafe60 helps manage pH and carbonate scale while its inhibitor package protects the system between service visits.",
    operator_advantage: "Give the water program one easier-to-handle product for stable operation, scale control, and corrosion protection.",
    quote_cta: "Build my water-treatment plan",
    fits: ["cooling towers", "closed loops", "campuses", "hospitals"],
    proof: "NSF/ANSI/CAN 60 certification, listed uses, and titration data",
    sample_cta: "Request a WaterSafe60 sample"
  },
  purgo: {
    job: "Organic buildup and recurring odor",
    platform: "VertKleen odor control",
    summary: "Target the organic buildup behind recurring odors in drains, wet areas, and water systems.",
    mechanism: "Purgo works on odor-causing organic residue instead of masking the smell with fragrance.",
    operator_advantage: "Treat the source, track the change, and build a routine that keeps the odor from coming back quickly.",
    quote_cta: "Find the source of my odor problem",
    fits: ["drains", "wet zones", "water programs", "odor-source maintenance"],
    proof: "Product persistence data and practical use guidance",
    sample_cta: "Request a Purgo sample"
  },
  dbnpa: {
    job: "Low-dose tower-treatment component",
    summary: "Controlled-release chemistry for quarterly dosing in cooling-tower programs.",
    fits: ["quarterly dosing", "cooling towers", "low-dose programs"],
    proof: "Cooling-tower program records"
  },
  lam3: {
    job: "Moss, algae, mold, and mildew",
    platform: "VertKleen exterior cleaner",
    summary: "Spray-and-walk-away cleaning for moss, algae, mold, mildew, and stubborn outdoor staining.",
    mechanism: "LAM3 stays wet longer so it can work into organic growth and staining instead of flashing dry on the surface.",
    operator_advantage: "Cover roofs, pavers, siding, and stucco with less scrubbing and more time for the cleaner to work.",
    quote_cta: "Test LAM3 on my exterior",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Before-and-after property results plus exterior-cleaning guidance",
    proof_slugs: ["property-grout-moss"],
    sample_cta: "Request a LAM3 sample"
  },
  alumibrite: {
    job: "Aluminum brightening",
    platform: "VertKleen aluminum cleaner",
    summary: "Restore dull, oxidized aluminum without hydrofluoric or hydrochloric acid.",
    mechanism: "AlumiBrite wets the surface, loosens oxide and mineral film, and brings back a cleaner, brighter finish.",
    operator_advantage: "Brighten wheels, trim, RVs, and marine aluminum with HMIS 0-0-0 handling and no HF/HCl chemistry.",
    quote_cta: "Test AlumiBrite on my aluminum",
    sample_cta: "Request an AlumiBrite sample",
    fits: ["wheels", "trim", "RV", "marine"],
    proof: "Aluminum-brightening data and a working-vessel restoration",
    proof_slugs: ["airboat-alumibrite"]
  },
  torque: {
    job: "Vehicle, fleet, RV, and marine wash",
    platform: "VertKleen wash and finish",
    summary: "Wash away road film, salt, grime, and bugs while leaving a clean, polished finish.",
    mechanism: "Surfactants release road film, salt, grime, and bugs while finish-care components remain after rinse.",
    operator_advantage: "Clean and finish vehicles, fleets, RVs, and boats in one step instead of washing and waxing separately.",
    quote_cta: "Try Torque on my vehicle or boat",
    fits: ["vehicles", "fleets", "RVs", "boats"],
    proof: "A working-vessel wash and finish result",
    proof_slugs: ["airboat-alumibrite"],
    sample_cta: "Request a Torque sample"
  },
  "cr-hd-low-foam": {
    job: "Machine wash and low-foam degreasing",
    platform: "VertKleen low-foam degreaser",
    summary: "Heavy soil removal that lets the machine do its work.",
    mechanism: "CR HD Low Foam lifts grease and oily residue while keeping foam down so pumps, scrubbers, and recovery systems keep moving.",
    operator_advantage: "Fewer foam interruptions and faster rinsing keep scrubbers, parts washers, and recirculating systems productive.",
    quote_cta: "Test it in my wash equipment",
    fits: ["floor scrubbers", "parts washers", "recirculating wash", "heavy soil"],
    proof: "Low-foam equipment guidance for scrubbers, parts washers, and recirculating wash",
    sample_cta: "Request a CR HD Low Foam sample"
  },
  cr2: {
    job: "HVAC drains and organic buildup",
    platform: "Concentrated VertKleen cleaner",
    summary: "Concentrated alkaline cleaning for HVAC drains, equipment, and hard facility buildup.",
    mechanism: "HVAC CR loosens organic buildup, lifts it from the surface, and keeps the released mess moving toward rinse-out.",
    operator_advantage: "Get more cleaning power per delivered gallon, use less storage space, and simplify recurring heavy-soil work.",
    quote_cta: "Plan my HVAC CR cleaning job",
    sample_cta: "Request an HVAC CR sample",
    fits: ["HVAC drains", "organic buildup", "coils", "facility maintenance"],
    proof: "Direct 60% sodium-hydroxide replacement record plus HVAC guidance"
  },
  sar: {
    job: "Specialty rust and scale removal",
    platform: "VertKleen specialty scale remover",
    summary: "A custom-fit VertKleen option for stubborn rust, scale, and mineral deposits.",
    mechanism: "SAR is matched to the deposit and surface so the cleaner can attack the buildup without relying on brute-force mineral acid.",
    operator_advantage: "Get a cleaner fit for the job, a clear starting method, and more predictable rust and scale removal.",
    quote_cta: "Match SAR to my deposit",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "VertKleen field results and specialty-cleaning guidance",
    sample_cta: "Request an SAR sample"
  },
  pg100: {
    job: "Inhibited propylene glycol concentrate",
    summary: "Concentrated inhibited PG for closed-loop heat-transfer and freeze-protection programs, with Florida-sourced supply in the Brevard Schools list.",
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
    ["ph-trend-up", "Why buyers switch", advantage],
    ["ph-images", "Real-world proof", copy.proof],
  ];
}

/* ---------- Nav / footer injection ---------- */
