const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";

export const PRODUCTS = {
  hcr: {
    name: "VertKleen CIP HCR",
    cat: "acid",
    replaces: "Conventional brewery acid-cleaning and beer-stone programs",
    hmis: "0-0-0",
    icon: "ph-flask",
    image: "img/products/cip-hcr-studio.webp",
    application_image: "img/representative/applications/cip-cycle-skid-v1.webp",
    uses: [
      "Beer-stone removal in brewery CIP",
      "Tank, keg, and line acid-wash steps",
      "316 stainless and PVC cleaning workflows",
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
    replaces: "Compared with hydrochloric-acid HVAC descaling programs",
    hmis: "0-0-0",
    icon: "ph-factory",
    image: "img/products/hvac-hcr-studio.webp",
    application_image: "img/representative/applications/hvac-descaling-loop-v1.webp",
    uses: [
      "HVAC coils and water-side descaling",
      "Calcium, scale, and rust removal",
      "Stainless and gasket cleaning after compatibility testing",
      "Bulk HVAC and facility programs"
    ],
    docs: [
      "Bulk HCR Program Profile",
      "HCR SDS and technical package by request"
    ]
  },
  cr: {
    name: "VertKleen CIP CR",
    cat: "alkaline",
    replaces: "Compared with caustic-soda brewery CIP",
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
    replaces: "Compared with caustic and solvent degreasers",
    hmis: "0-0-0",
 icon: "ph-drop",
 image: "img/products/neutral-studio.webp",
    application_image: "img/representative/applications/neutral-material-test-patch-v1.webp",
    uses: [
      "Heavy equipment and machinery degreasing",
      "Marine, oil and gas, and aviation surfaces",
      "Sensitive metals and seals after a compatibility test",
      "Facility and fleet maintenance"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-neutral-sds.pdf" }
    ]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "alkaline",
    replaces: "Compared with general-purpose alkaline cleaners",
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
    replaces: "Evaluated against existing tower and closed-loop treatment programs",
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
    replaces: "Evaluated against existing oxidizing and non-oxidizing water-treatment programs",
    hmis: "0-0-0",
 icon: "ph-shield-plus",
    image: "img/products/purgo-studio.webp",
    application_image: "img/representative/applications/purgo-controlled-drain-maintenance-v1.webp",
    uses: [
      "Water-treatment and odor-control chemistry",
      "Organic-load control in towers, drains, and process water",
      "Occupied-campus water-treatment programs",
      "Dosed treatment with field testing and monitoring"
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
    replaces: "Evaluated against current warehouse and plant degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
    image: "img/products/crhd-studio.webp",
    application_image: "img/representative/applications/cr-hd-degreasing-trial-v1.webp",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Witnessed comparison against the site's current degreaser"
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crhd-sds.pdf" },
      { label: "Degreaser Comparison", file: "docs/sds/vertkleen-crhd-degreaser-comparison.pdf" },
      "Controlled Site-Trial Request"
    ]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Evaluated against hydrochloric-acid, CLR, and Calci-Solve programs",
    hmis: "0-0-0",
    icon: "ph-snowflake",
 image: "img/products/descaler-studio.webp",
    application_image: "img/representative/applications/hvac-descaling-loop-v1.webp",
    uses: [
      "Aluminum and copper coil descaling",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Isolated cooling and heat-transfer circuits after site and OEM review"
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
      "Documented commercial aluminum-restoration context"
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  torque: {
    name: "VertKleen Torque",
    cat: "specialty",
    replaces: "Evaluated against separate wash, wax, and bug-removal steps",
    hmis: "0-0-0",
    icon: "ph-sparkle",
    image: "img/products/torque-studio.webp",
    application_image: "img/representative/applications/torque-contained-fleet-wash-v1.webp",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Documented vessel-wash result"
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
    replaces: "Evaluated against solvent and butyl degreasers",
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
    replaces: "Evaluated against caustic drain-cleaning and degreasing programs",
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
    replaces: "Evaluated for specialty and blended-acid programs",
    hmis: "0-0-0",
    icon: "ph-wrench",
    image: "img/products/sar-studio.webp",
    application_image: "img/representative/applications/sar-application-engineering-v1.webp",
    uses: [
      "Specialty descaling and acid-cleaning jobs",
      "Water-side scale and mineral removal",
      "Applications needing a tuned descaling procedure"
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
    job: "Brewery CIP mineral cleaning",
    platform: "VertKleen mineral-removal chemistry",
    summary: "Controlled mineral removal for brewery acid-wash steps.",
    mechanism: "Controlled hydrogen-ion activity consumes carbonate scale (2 H+ + CaCO3 → Ca2+ + CO2 + H2O), while complexing, wetting, and inhibition keep the reaction focused on the deposit.",
    operator_advantage: "Target beer stone and mineral film in tanks, kegs, lines, and heat-transfer surfaces through a controlled CIP acid-wash step.",
    quote_cta: "Request a CIP mineral-cycle review",
    sample_cta: "Request a CIP HCR sample",
    fits: ["brewery CIP", "beer stone", "tanks and kegs", "heat-exchanger plates"],
    proof: "Brewery CIP, heat-exchanger, pool-filter, and rust-removal results",
    proof_slugs: ["brewery-cip-trials"]
  },
  "hcr-t16": {
    job: "Bulk HVAC descaling",
    platform: "VertKleen mineral-removal chemistry",
    summary: "Controlled mineral removal for repeated large-volume HVAC and facility work.",
    mechanism: "Controlled hydrogen-ion activity, complexing, wetting, and inhibition dissolve calcium, rust, and water-side scale through the same HCR mineral-removal pathway.",
    operator_advantage: "Tote economics, repeat dosing, fewer shutdown complications, and a simpler crew experience improve recurring descaling work.",
    quote_cta: "Request a bulk HVAC scale review",
    fits: ["HVAC coils", "water-side scale", "facility loops", "bulk programs"],
    proof: "HVAC HCR application and bulk-program scope",
    sample_cta: "Request an HVAC HCR sample"
  },
  descaler: {
    job: "Coils, towers, and heat-transfer equipment",
    platform: "VertKleen mineral-removal chemistry",
    summary: "Controlled mineral-removal chemistry for equipment that matters.",
    mechanism: "Controlled hydrogen-ion activity, wetting, and circulation convert mineral scale into rinsable material across coils, towers, plumbing, and heat-transfer equipment.",
    operator_advantage: "Restore flow and heat transfer with equipment-conscious action, lower fume burden, and a better technician experience.",
    quote_cta: "Request a deposit test",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "AC-coil, fire-pump, and water-side cleaning results",
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
    job: "Brewery CIP organic-soil cleaning",
    platform: "VertKleen soil-lift chemistry",
    summary: "High-pH cleaning for brewery alkaline-wash steps.",
    mechanism: "Alkalinity loosens fat, protein, and organic film; wetting and sequestration lift residue, control hard-water ions, and carry soil into a cleaner rinse.",
    operator_advantage: "Strong CIP cleaning with less caustic-workflow burden, a cleaner rinse, and faster return to production.",
    quote_cta: "Request a CIP soil-cycle review",
    sample_cta: "Request a CIP CR sample",
    fits: ["brewery CIP", "krausen", "tanks and kegs", "hot circulation"],
    proof: "Exact-product caustic-replacement record and concentration-specific application guidance",
    proof_slugs: ["brewery-cip-trials"]
  },
  crhd: {
    job: "Heavy grease and industrial soil",
    platform: "VertKleen soil-lift chemistry",
    summary: "Heavy-duty degreasing without the solvent-first experience.",
    mechanism: "Wetting penetrates greasy film; surfactants surround and lift hydrocarbon soil while sequestration controls hard-water ions and limits redeposition.",
    operator_advantage: "Lower odor and flammability burden, strong soil loading, fewer passes, and a cleaner rinse improve heavy industrial work.",
    quote_cta: "Request a wash benchmark",
    sample_cta: "Request a CR HD sample",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Distribution-center, commercial-kitchen, and filter-cleaning results",
    proof_slugs: ["commercial-kitchen-crhd", "distribution-center-assessment"]
  },
  neutral: {
    job: "Sensitive surfaces and seals",
    platform: "VertKleen soil-lift chemistry",
    summary: "Serious soil lift at a near-neutral pH.",
    mechanism: "Wetting lowers interfacial tension, sequestration controls hard-water ions, and surfactants lift oily soil into the wash so it rinses away.",
    operator_advantage: "A finish-, seal-, and occupied-space-friendly profile supports frequent cleaning without an acid or high-alkaline cycle.",
    quote_cta: "Request a material-fit test",
    sample_cta: "Request a Neutral sample",
    fits: ["equipment", "marine", "aviation", "fleet"],
    proof: "Neutral-pH application and material-use guidance"
  },
  multiwash: {
    job: "Everyday facility washing",
    platform: "VertKleen mixed-soil chemistry",
    summary: "One formulation for mixed soils that usually require several bottles.",
    mechanism: "Controlled mineral-soil action works beside grease and organic-soil dispersion, with Purgo support for odor-causing residue in wet zones.",
    operator_advantage: "Fewer products, simpler training, low-odor handling, and faster routine work streamline mixed facility cleaning.",
    quote_cta: "Request a mixed-soil trial",
    sample_cta: "Request a MultiWash sample",
    fits: ["campuses", "concrete", "drains", "pressure washing"],
    proof: "Campus drone-wash, gym, vehicle, and property-maintenance results"
  },
  watersafe60: {
    job: "Scale and corrosion control",
    platform: "VertKleen water-system chemistry",
    summary: "Controlled pH and scale chemistry for water systems.",
    mechanism: "Controlled pH movement and hydrogen-ion activity manage carbonate-scale pressure while the inhibitor package supports recurring system treatment.",
    operator_advantage: "Dose follows water chemistry, supporting stable operation, controlled scale response, and simpler water-program handling.",
    quote_cta: "Request a water-program review",
    fits: ["cooling towers", "closed loops", "campuses", "hospitals"],
    proof: "NSF/ANSI/CAN 60 product record, listed-use guidance, and titration data",
    sample_cta: "Request a WaterSafe60 sample"
  },
  purgo: {
    job: "Odor-source and organic-load control",
    platform: "VertKleen Purgo bio-active chemistry",
    summary: "Bio-active support for odor-causing organic residue in scoped water and drain programs.",
    mechanism: "Bio-active treatment works on odor-causing organic residue within the defined cleaning and monitoring program.",
    operator_advantage: "Define source, loading, dose, monitoring, and cleaning method before treating recurring odor.",
    quote_cta: "Request an odor-program assessment",
    fits: ["drains", "wet zones", "water programs", "odor-source maintenance"],
    proof: "Technical persistence data and application guidance",
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
    platform: "VertKleen exterior-care chemistry",
    summary: "Long-dwell exterior cleaning for scoped surface and stain conditions.",
    mechanism: "Extended wetting and dwell address adhered organic staining, mineral film, and biological residue on the selected test area.",
    operator_advantage: "Define substrate, stain, weather, adjacent materials, dwell, runoff path, and visual endpoint before scaling the work.",
    quote_cta: "Request an exterior-surface trial",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Exterior-surface application guidance and documented result summaries",
    proof_slugs: ["property-grout-moss"],
    sample_cta: "Request a LAM3 sample"
  },
  alumibrite: {
    job: "Aluminum brightening",
    platform: "VertKleen aluminum-care chemistry",
    summary: "Controlled aluminum brightening for a selected alloy and finish.",
    mechanism: "Controlled oxide and mineral removal combines wetting and inhibition within a confirmed aluminum test patch.",
    operator_advantage: "Define alloy, coating, oxidation, method, containment, and test-patch endpoint before scaling the work.",
    quote_cta: "Request an aluminum test-patch review",
    sample_cta: "Request an AlumiBrite sample",
    fits: ["wheels", "trim", "RV", "marine"],
    proof: "Aluminum-brightening test data and documented marine context",
    proof_slugs: ["airboat-alumibrite"]
  },
  torque: {
    job: "Vehicle, fleet, RV, and marine wash",
    platform: "VertKleen wash-and-finish chemistry",
    summary: "One wash step for scoped fleet, RV, and marine exterior programs.",
    mechanism: "Surfactants release road film, salt, grime, and bugs while finish-care components remain after rinse.",
    operator_advantage: "Define surface finish, soil, application method, containment, and appearance endpoint before the trial.",
    quote_cta: "Request a fleet or marine wash trial",
    fits: ["vehicles", "fleets", "RVs", "boats"],
    proof: "Documented vehicle and vessel-wash context",
    proof_slugs: ["airboat-alumibrite"],
    sample_cta: "Request a Torque sample"
  },
  "cr-hd-low-foam": {
    job: "Machine wash and low-foam degreasing",
    platform: "VertKleen low-foam soil-lift chemistry",
    summary: "Heavy soil removal that lets the machine do its work.",
    mechanism: "Wetting and soil lift surround greasy residue while controlled foam preserves agitation, pump efficiency, visibility, and recovery.",
    operator_advantage: "Fewer foam interruptions and faster rinsing keep scrubbers, parts washers, and recirculating systems productive.",
    quote_cta: "Request a machine-wash benchmark",
    fits: ["floor scrubbers", "parts washers", "recirculating wash", "heavy soil"],
    proof: "Low-foam equipment scope and application guidance",
    sample_cta: "Request a CR HD Low Foam sample"
  },
  cr2: {
    job: "HVAC drains and organic buildup",
    platform: "VertKleen concentrated soil-lift chemistry",
    summary: "Concentrated alkaline cleaning for HVAC drains, equipment, and facility maintenance.",
    mechanism: "High-pH soil release combines wetting, lift, and dispersion to loosen organic load and keep it moving toward rinse-out.",
    operator_advantage: "More cleaning capacity per delivered volume supports a smaller storage footprint and a simpler heavy-soil workflow.",
    quote_cta: "Request an HVAC CR application review",
    sample_cta: "Request an HVAC CR sample",
    fits: ["HVAC drains", "organic buildup", "coils", "facility maintenance"],
    proof: "60% sodium-hydroxide replacement record and concentration-specific guidance"
  },
  sar: {
    job: "Specialty rust and scale removal",
    platform: "VertKleen specialty mineral-removal chemistry",
    summary: "Tuned VertKleen chemistry for specialty mineral and oxide deposits.",
    mechanism: "A controlled reaction is tailored to the deposit and surface instead of depending on blunt mineral-acid strength.",
    operator_advantage: "Precision, asset care, application engineering, and predictable work planning improve specialty mineral removal.",
    quote_cta: "Request an engineered application review",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "VertKleen field results and specialty application guidance",
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
  const platform = copy.platform || "VertKleen program";
  const mechanism = copy.mechanism || copy.summary;
  const advantage = copy.operator_advantage
    || `Built around ${copy.fits.join(", ")} with a clear product and supply path.`;
  return [
    ["ph-atom", platform, copy.job],
    ["ph-gears", "How it works", mechanism],
    ["ph-trend-up", "Why buyers switch", advantage],
    ["ph-images", "Result record", copy.proof],
  ];
}

/* ---------- Nav / footer injection ---------- */
