const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";

export const PRODUCTS = {
  hcr: {
    name: "VertKleen HCR",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid)",
    hmis: "0-0-0",
    icon: "ph-flask",
 image: "img/products/hvac-hcr-studio.webp",
    tag: "The acid-replacement route when rust, scale, calcium, passivation, or tower cleanup is still tied to hydrochloric acid.",
    desc: "A biodegradable, SynTech-powered acid replacement for descaling, rust removal, passivation, and acid cleaning. The Brevard field file is the blunt version: CLR sat for 36 hours; HCR cleared 20-year rust in 30 minutes.",
    uses: [
      "Cooling tower fill and heat-exchanger descaling",
      "Rust removal: restored diamond-plated stainless steel stained for years",
      "Acid cleaning and passivation with the building occupied",
      "Concrete, equipment, and pipeline scale removal"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-atom", "SynTech powered", "Patented technology matching mineral-acid performance"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, BOD, nitrates, and phosphates"],
      ["ph-truck", "Lower-friction shipping", "No DOT hazmat freight on the core line"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-hcr-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-hcr-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-hcr-label.pdf" },
      { label: "HCR & Descaler User Guide + Dilution Rates", file: "docs/sds/vertkleen-hcr-descaler-userguide.pdf" },
      { label: "Field Note: Pool Filter Cleaning", file: "docs/sds/vertkleen-hcr-pool-filter.pdf" },
      "Cooling Tower Case Study: Brevard County Schools"
    ]
  },
  cr: {
    name: "VertKleen CR",
    cat: "alkaline",
    replaces: "Replaces caustic soda and sodium hydroxide",
    hmis: "0-0-0",
    icon: "ph-drop-half",
 image: "img/products/hvac-cr-studio.webp",
    tag: "Caustic-level work for organics, drains, hoods, floors, pH control, and CIP alkaline wash, without making sodium hydroxide the default answer.",
    desc: "A caustic replacement and pH adjuster for high-pH alkaline work: degreasing, hood filters, floors, drains, pH control, and the CR/HCR brewery CIP sequence.",
    uses: [
      "pH adjustment in water treatment programs",
      "Hood filters and floors at busy commercial kitchens",
      "High-pH alkaline cleaning with lower-hazard handling",
      "Caustic replacement across industrial CIP"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Lower-hazard handling profile with broad material compatibility"],
      ["ph-seal-check", "Controlled docs", "NSF/ANSI 60 certificate status must be confirmed through document request"],
      ["ph-atom", "SynClean powered", "Replaces sodium and potassium hydroxide"],
      ["ph-leaf", "Discharge planning", "Wastewater path reviewed by site and label conditions"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-cr-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-cr-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-cr-label.pdf" },
      "NSF/ANSI 60 Certificate-Status Request"
    ]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Replaces caustic and solvent degreasers",
    hmis: "0-0-0",
 icon: "ph-drop",
 image: "img/products/neutral-studio.webp",
    tag: "Degreasing for surfaces, seals, finishes, and equipment owners that do not want caustic as the default answer.",
    desc: "A neutral pH-7 degreaser for broad facility cleaning where solvent odor, flammability, or aggressive caustic chemistry would complicate the job.",
    uses: [
      "Heavy equipment and machinery degreasing",
      "Marine, oil and gas, and aviation surfaces",
      "Sensitive metals and seals: non-corrosive",
      "Facility and fleet maintenance"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Lower-hazard handling profile replacing flammable solvent degreasers"],
      ["ph-scales", "True pH 7", "Neutral chemistry for sensitive equipment and seals"],
      ["ph-atom", "SynClean powered", "Patented degreasing technology"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC; discharge path remains site-reviewed"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-neutral-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-neutral-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-neutral-label.pdf" }
    ]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "alkaline",
    replaces: "Replaces general-purpose caustic cleaners",
    hmis: "0-0-0",
 icon: "ph-sparkle",
 image: "img/products/multiwash-studio.webp",
    tag: "One-bottle facility cleaner for wet zones, drains, concrete, glass, exteriors, and pressure washing while the building stays open.",
    desc: "A versatile multi-surface cleaner for facilities, drains, concrete, exterior washing, and occupied-campus maintenance, built around the broad-use MultiWash story in MASEST collateral.",
    uses: [
      "Concrete drains and hardscape cleaning",
      "Pressure-washing programs",
      "Facility, warehouse, and fulfillment-center maintenance",
      "Educational and healthcare environments"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-atom", "SynClean powered", "Patented cleaning technology"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, BOD, nitrates and phosphates"],
      ["ph-truck", "Lower-friction shipping", "Non-hazmat handling profile for the core line"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-multiwash-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-multiwash-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-multiwash-label.pdf" }
    ]
  },
  watersafe60: {
    name: "WaterSafe60",
    cat: "water",
    replaces: "Replaces phosphate, zinc, and molybdate blends",
    hmis: "0-0-0",
 icon: "ph-waves",
 image: "img/products/watersafe60-studio.webp",
    tag: "Scale and corrosion control for towers and loops without the phosphate, zinc, molybdate, or chromate baggage.",
    desc: "A quote-routed scale and corrosion inhibitor with no heavy metals: no zinc, no molybdate, no chromate. Built for water-treatment programs where asset protection and documentation both matter.",
    uses: [
      "Cooling tower scale and corrosion control",
      "Closed-loop and chilled-water systems",
      "ASHRAE 188 and Legionella risk-management programs",
      "Campus, hospital, and government facilities"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Replaces blends rated up to HMIS 2-0-0"],
      ["ph-seal-check", "Controlled docs", "NSF/ANSI 60 certificate status must be confirmed through document request"],
      ["ph-prohibit", "No heavy metals", "No chromate, zinc, or molybdate"],
      ["ph-clipboard-text", "Scoped documentation", "ASHRAE 188 program support by site scope"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/watersafe60-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/watersafe60-tds.pdf" },
      { label: "WaterSafe60 / CR User Guide (NSF 60)", file: "docs/sds/watersafe60-cr-nsf60-user-guide.pdf" },
      { label: "Titration / Sigma Test Data", file: "docs/sds/watersafe60-titration-test.pdf" },
      { label: "Cooling Tower Chemistry Brochure", file: "docs/sds/vertkleen-cooling-tower-brochure.pdf" },
      "NSF/ANSI 60 Certificate-Status Request"
    ]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Replaces bromine and sodium hypochlorite",
    hmis: "0-0-0",
 icon: "ph-shield-plus",
 image: "img/products/purgo-studio.webp",
    tag: "Minimum-risk antimicrobial and odor-control support where the claim needs to stay label-honest.",
    desc: "A FIFRA 25(b) minimum-risk antimicrobial and odor-control treatment used in occupied-site maintenance workflows. Purgo stays label-tied here: not sold as a registered disinfectant, not dressed up as one.",
    uses: [
      "Minimum-risk antimicrobial and odor-control support",
      "ASHRAE 188 documentation support when paired with testing and WMP scope",
      "Occupied-campus water treatment",
      "Minimum-risk antimicrobial cleaning workflows"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Lower-hazard handling profile versus bromine and bleach workflows"],
      ["ph-seal-check", "FIFRA 25(b)", "Minimum-risk classification"],
      ["ph-buildings", "Occupied-site fit", "Built for routine maintenance programs"],
      ["ph-clipboard-text", "Use with scope notes", "Exact use claims route through label and program documentation"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-purgo-sds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-purgo-label.pdf" },
      { label: "Purgo 101 Overview", file: "docs/sds/vertkleen-purgo-101.pdf" },
      { label: "Base Data Sheet", file: "docs/sds/vertkleen-purgo-base-data.pdf" },
      { label: "Bacterial Persistence Test", file: "docs/sds/vertkleen-purgo-bacterial-persistence-test.pdf" },
      { label: "Cooling Tower Chemistry Brochure", file: "docs/sds/vertkleen-cooling-tower-brochure.pdf" },
      "FIFRA 25(b) Documentation"
    ]
  },
  dbnpa: {
    name: "DBNPA Tablet",
    cat: "water",
    replaces: "Replaces glutaraldehyde 50%",
    hmis: "Low hazard",
 icon: "ph-pill",
 image: "img/products/dbnpa-studio.webp",
    tag: "Footnoted controlled-release non-oxidizing biocide component. One tablet per quarter.",
    desc: "Controlled-release tablets for non-oxidizing rotation, dosed at one tablet per quarter. DBNPA is a cooling-tower program component, not part of the canonical 20-parent ecommerce product roster; label, SDS, and registration proof route through document request.",
    uses: [
      "Quarterly non-oxidizing biocide rotation",
      "Cooling tower microbiological programs",
      "Low-dose, controlled-release dosing"
    ],
    specs: [
      ["ph-arrow-down", "Low dose", "One controlled-release tablet per quarter"],
      ["ph-seal-check", "Document-gated", "Registration and label files required before public claim"],
      ["ph-fire-simple", "Non-flammable", "Replaces glutaraldehyde rated HMIS 3-2-0"],
      ["ph-info", "Program note", "The program's one mild-hazard component. Every cataloged VertKleen product in the program is HMIS 0-0-0."]
    ],
    docs: ["Safety Data Sheet (SDS)", "Controlled Label / SDS Request"]
  },
  crhd: {
    name: "VertKleen CRHD",
    cat: "alkaline",
    replaces: "Replaces Simple Green, Zep, and solvent degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
 image: "img/products/crhd-studio.webp",
    tag: "For grease that laughs at light-duty cleaners: floors, forklifts, parts washers, kitchens, drains, engine bays, and warehouse equipment.",
    desc: "A high-detergency, low-foam alkaline degreaser at roughly 50% active strength. Walmart distribution-center collateral positions CRHD as a Simple Green replacement for forklifts, workshops, kitchens, floors, parts, and windows.",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Field-proven replacing Simple Green at Walmart distribution centers"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-gauge", "About 50% active", "Higher active strength than common 15% degreasers"],
      ["ph-seal-check", "Equipment files", "Crown Forklift, Plug Power, and aerospace-spec support files route through document request"],
      ["ph-truck", "Lower-friction shipping", "No DOT hazmat freight on the core line"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crhd-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-crhd-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-crhd-label.pdf" },
      { label: "Degreaser Comparison", file: "docs/sds/vertkleen-crhd-degreaser-comparison.pdf" },
      "Case Study: Walmart Distribution Centers"
    ]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid) products, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
 image: "img/products/descaler-studio.webp",
    tag: "Acid-style descaling for coils, towers, pumps, and refrigeration loops, minus the usual HCl drama.",
    desc: "A hydrochloric-acid-free descaler that clears calcium, rust, and scale from coils, cooling towers, plumbing, and fire pumps. Walmart refrigeration collateral reports up to 94% heat-transfer efficiency restored on plate heat exchangers.",
    uses: [
      "Aluminum and copper coil descaling",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Refrigeration systems: chloride-free protocol for ammonia systems"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "HMIS 0-0-0 profile with no NFPA pictograms"],
      ["ph-trend-down", "Far less corrosion", "0.59 mpy versus hydrochloric at 609 mpy in VertKleen testing"],
      ["ph-snowflake", "Metal compatibility", "Used with aluminum, copper, steel, and stainless protocols"],
      ["ph-drop", "Discharge planning", "Built to reduce acid-neutralization friction; confirm site rules"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-descaler-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-descaler-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-descaler-label.pdf" },
      { label: "HCR & Descaler User Guide + Dilution Rates", file: "docs/sds/vertkleen-hcr-descaler-userguide.pdf" },
      "Descaler vs Acids Corrosion Data",
      "Case Study: Walmart Refrigeration Systems"
    ]
  },
  alumibrite: {
    name: "VertKleen AlumiBrite",
    cat: "specialty",
    replaces: "Replaces hydrofluoric and hydrochloric aluminum brighteners",
    hmis: "0-0-0",
 icon: "ph-car",
 image: "img/products/alumibrite-studio.webp",
    tag: "Put the shine back without bringing hydrofluoric or hydrochloric acid into the bay.",
    desc: "A synthetic-acid aluminum brightener that restores wheels, trim, and marine aluminum without hydrofluoric or hydrochloric acid. Source docs report an Acid Brightening Index of 90.1 versus HCl at 86.3.",
    uses: [
      "Wheels, trim, and aluminum restoration",
      "Fleet, RV, and marine aluminum",
      "Detailing and dealership reconditioning",
      "Field-proven on a commercial tourist airboat"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "No hydrofluoric or hydrochloric acid"],
      ["ph-atom", "Synthetic acid", "SynTech brightening without the burn and fume risk"],
      ["ph-chart-line-up", "Brightening Index 90.1", "Outperformed hydrochloric acid at 86.3 in VertKleen testing"],
      ["ph-leaf", "Biodegradable", "Lower-impact discharge profile; confirm site rules"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  torque: {
    name: "VertKleen Torque",
    cat: "specialty",
    replaces: "Replaces separate wash, wax, and bug removers",
    hmis: "0-0-0",
 icon: "ph-sparkle",
 image: "img/products/torque-studio.webp",
    tag: "Vehicle wash and wax in one process for operators who do not want three bottles for one finish.",
    desc: "An all-in-one wash and wax that cleans and protects in a single step across vehicles, fleet, RV, and marine. The Yellowfin case file sums up the visual proof: grime line gone.",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Field-proven on a 43-foot Yellowfin vessel"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-sparkle", "Wash and wax in one", "Cleans and protects in a single pass"],
      ["ph-seal-check", "Finish-care support", "Product fit reviewed against finish-care requirements"],
      ["ph-leaf", "Biodegradable", "Low VOC; discharge path remains site-reviewed"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-torque-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-torque-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-torque-label.pdf" }
    ]
  },
  lam3: {
    name: "VertKleen LAM3",
    cat: "specialty",
    replaces: "Replaces Wet & Forget and bleach roof cleaners",
    hmis: "0-0-0",
 icon: "ph-house-line",
 image: "img/products/lam3-studio.webp",
    tag: "Spray-and-leave treatment for lichen, algae, moss, mold, and mildew stains where dwell time can do the work.",
    desc: "A neutral, spray-and-walk-away treatment that clears lichen, algae, moss, mold, and mildew from roofs, pavers, stucco, siding, and concrete without bleach; follow label directions around landscaping.",
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Pond and fountain algae",
      "Field-proven clearing mildew from a painted column over two weeks"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Neutral pH, no bleach, lower fume burden"],
      ["ph-plant", "Label-directed exterior use", "Follow label directions around landscaping and animals"],
      ["ph-timer", "Spray and walk away", "Keeps working up to a month; reapply about every six months"],
      ["ph-leaf", "Biodegradable stain remover", "Use SDS precautions for mild skin and eye irritation"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-lam3-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-lam3-tds.pdf" },
      { label: "Product Label (Front)", file: "docs/sds/vertkleen-lam3-label-front.pdf" },
      { label: "Product Label (Back)", file: "docs/sds/vertkleen-lam3-label-back.pdf" }
    ]
  },
  crs: {
    name: "VertKleen CRS",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid) for rust, scale, and calcium",
    hmis: "0-0-0",
 icon: "ph-wrench",
 image: "img/products/crs-studio.webp",
    tag: "A real source-label reference for calcium, rust, and scale, routed carefully until SKU ownership is confirmed.",
    desc: "CRS appears in source material as a descaler-family label for rust, calcium, scale, and water-side buildup. Public catalog routing keeps the ecommerce parent under VertKleen Descaler until SKU ownership is confirmed.",
    uses: [
      "Underbody and equipment rust removal",
      "HVAC coils and cooling towers",
      "Water lines, fixtures, and scale-prone plumbing",
      "Dealership and facility maintenance programs"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop-half", "HCl replacement", "Built for acid-cleaning jobs without muriatic-acid handling"],
      ["ph-waves", "Water-side scale", "Targets calcium, rust, and mineral buildup"],
      ["ph-leaf", "Dilution guide", "Use ratios align with the VertKleen dilution guide"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-crs-sds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-crs-label.pdf" },
      { label: "HCR & Descaler User Guide + Dilution Rates", file: "docs/sds/vertkleen-hcr-descaler-userguide.pdf" }
    ]
  },
  "cr-hd-low-foam": {
    name: "VertKleen CR HD Low Foam",
    cat: "alkaline",
    replaces: "Replaces solvent and butyl degreasers",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/crhd-studio.webp",
    tag: "CRHD muscle with the foam turned down for scrubbers, parts washers, and recirculating systems.",
    desc: "A low-foam heavy-duty degreaser built for automatic scrubbers, parts washers, and recirculating wash systems where foam control matters, with the same HMIS 0-0-0 handling profile as CRHD.",
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy soil and grease on equipment and floors"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop", "Low-foam formula", "Built for machine wash and recirculating systems"],
      ["ph-atom", "SynTech powered", "Heavy-duty degreasing without solvent odor"],
      ["ph-truck", "Lower-friction shipping", "No DOT hazmat freight on the core line"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  cr2: {
    name: "VertKleen CR2",
    cat: "alkaline",
    replaces: "Higher-concentration CR formulation",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/hvac-cr-studio.webp",
    tag: "The stronger CR-family route for accounts that already know the standard CR workflow.",
    desc: "A higher-concentration version of VertKleen CR for demanding alkaline cleaning and water-treatment work. Route through quote review until application notes and final SKU guidance are confirmed.",
    uses: [
      "Concentrated alkaline cleaning programs",
      "Water-treatment dosing where strength matters",
      "High-pH cleaning with an HMIS 0-0-0 profile"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop-half", "Higher concentration", "More active cleaning per gallon than standard CR"],
      ["ph-atom", "SynClean powered", "Caustic-level performance with HMIS 0-0-0 handling"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  sar: {
    name: "VertKleen SAR",
    cat: "acid",
    replaces: "Specialty acid replacement",
    hmis: "0-0-0",
    icon: "ph-wrench",
    image: "img/products/crs-studio.webp",
    tag: "A quote-reviewed specialty acid replacement for targeted descaling and water-side work.",
    desc: "A specialty acid-replacement formulation for targeted descaling and water-side applications. Route through quote review until application sheets and final SKU guidance are confirmed.",
    uses: [
      "Specialty descaling and acid-cleaning jobs",
      "Water-side scale and mineral removal",
      "Applications needing a tuned acid-replacement profile"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop-half", "Acid replacement", "Targeted descaling without muriatic-acid handling"],
      ["ph-waves", "Water-side scale", "Calcium, rust, and mineral buildup"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-sar-sds.pdf" },
      { label: "Technical Data Sheet (TDS)", file: "docs/sds/vertkleen-sar-tds.pdf" },
      { label: "Product Label", file: "docs/sds/vertkleen-sar-label.pdf" }
    ]
  },
pg100: {
    name: "PG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Propylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "Florida-sourced inhibited propylene glycol concentrate for closed-loop heat-transfer and freeze-protection programs.",
    desc: "An inhibited propylene glycol concentrate for commercial HVAC, hydronic, and process-loop freeze protection. The Brevard Schools price list emphasizes local Florida pickup, low freight, and short lead times.",
    uses: ["Closed-loop HVAC systems", "Hydronic freeze protection", "Process heat-transfer loops"],
    specs: [
      ["ph-drop", "Propylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  pg50: {
    name: "PG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% propylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "Premixed inhibited 50% propylene glycol for maintenance teams that do not want field mixing to become the job.",
    desc: "A ready-to-use inhibited 50% propylene glycol blend for HVAC and hydronic loop service. Scope confirms loop compatibility and supply path before rollout.",
    uses: ["Closed-loop HVAC systems", "Hydronic loop top-offs", "Facility freeze-protection maintenance"],
    specs: [
      ["ph-drop", "PG 50 blend", "Premixed propylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg100: {
    name: "EG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "Inhibited ethylene glycol concentrate for industrial heat-transfer loops that need corrosion protection and local supply.",
    desc: "An inhibited ethylene glycol concentrate for industrial loop fill, freeze protection, and heat-transfer programs. Application review confirms inhibitor and loop compatibility.",
    uses: ["Industrial heat-transfer loops", "Closed-loop freeze protection", "Process-loop maintenance"],
    specs: [
      ["ph-drop", "Ethylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg50: {
    name: "EG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "Premixed inhibited 50% ethylene glycol for industrial loop top-offs and freeze-protection maintenance.",
    desc: "A ready-to-use inhibited 50% ethylene glycol blend for industrial heat-transfer and freeze-protection loops.",
    uses: ["Industrial loop top-offs", "Closed-loop freeze protection", "Heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG 50 blend", "Premixed ethylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  egu96: {
    name: "EG uninhibited 96% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol uninhibited concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "Uninhibited 96% ethylene glycol concentrate when the inhibitor strategy is handled elsewhere.",
    desc: "An uninhibited 96% ethylene glycol concentrate for industrial heat-transfer loop programs where inhibitor strategy is handled separately.",
    uses: ["Utility loop service", "Industrial freeze protection", "Process heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG uninhibited", "Concentrated glycol for utility loops"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg5050: {
    name: "EG 50/50",
    cat: "glycol",
    replaces: "50% ethylene glycol pre-mix",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: PRODUCT_FALLBACK_IMAGE,
    tag: "50/50 ethylene glycol blend for quote-reviewed loop top-offs, maintenance, and supply planning.",
    desc: "A 50/50 ethylene glycol blend for closed-loop maintenance and top-off work where scope, fluid compatibility, and supply path are confirmed before purchase.",
    uses: ["Loop top-offs", "Routine freeze-protection maintenance", "Industrial heat-transfer service"],
    specs: [
      ["ph-drop", "EG 50/50", "Premixed ethylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Quote-reviewed", "Confirm pack size, loop chemistry, and freight path before purchase"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  }
};

export const CATALOG_ORDER = [
  "hcr", "descaler", "cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash",
  "watersafe60", "cr2", "sar", "purgo", "lam3", "alumibrite", "torque",
  "pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"
];

// Catalog UI groupings (curated, not the raw `cat` field) - drive the category
// filter chips and grouping on the products page.
export const CATALOG_GROUPS = [
  { key: "descale", label: "Rust & Scale", ids: ["hcr", "descaler"] },
  { key: "degrease", label: "Grease & Grime", ids: ["cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash"] },
  { key: "water", label: "Water Treatment", ids: ["watersafe60", "cr2", "sar", "purgo"] },
  { key: "exterior", label: "Exterior & Specialty", ids: ["lam3", "alumibrite", "torque"] },
  { key: "glycol", label: "Glycols", ids: ["pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"] }
];

export const QUOTE_FIRST_IDS = ["crs", "watersafe60", "cr2", "sar", "eg5050"];

// Automated replacement checker: the current chemical a buyer uses today, the job
// it does, and the VertKleen product ids that replace it. Single source of truth
// for the compact top-of-page matrix and the live catalog filter.
export const REPLACEMENT_MAP = [
  { current: "Muriatic / hydrochloric acid", job: "Rust, scale & passivation", ids: ["hcr", "descaler"] },
  { current: "Caustic soda / sodium hydroxide", job: "pH adjustment & caustic cleaning", ids: ["cr"] },
  { current: "Simple Green / Zep / butyl degreasers", job: "Heavy-duty degreasing", ids: ["crhd"] },
  { current: "Caustic & solvent degreasers", job: "Degreasing sensitive surfaces", ids: ["neutral"] },
  { current: "CLR / Calci-Solve", job: "Coil & heat-transfer descaling", ids: ["descaler"] },
  { current: "General-purpose caustic cleaners", job: "Everyday facility washing", ids: ["multiwash"] },
  { current: "Phosphate / zinc / molybdate blends", job: "Scale & corrosion control", ids: ["watersafe60"] },
  { current: "Stabilized bromine / bleach", job: "Oxidizing biocide", ids: ["purgo"] },
  { current: "Wet & Forget / bleach roof cleaners", job: "Exterior moss, algae & mold", ids: ["lam3"] },
  { current: "Hydrofluoric / HCl brighteners", job: "Aluminum brightening", ids: ["alumibrite"] },
  { current: "Separate wash, wax & bug removers", job: "Vehicle wash & wax", ids: ["torque"] }
];

export const PRODUCT_CATALOG_COPY = {
  hcr: {
    job: "Rust, scale, and heavy deposits",
    summary: "Use when rust staining, mineral scale, or passivation work needs industrial strength and a buyer file better than a muriatic-acid SDS.",
    fits: ["HVAC", "metal restoration", "concrete", "pipelines"],
    proof: "CLR-failed / HCR-cleared proof and cooling-tower notes"
  },
  descaler: {
    job: "Coils, towers, and heat-transfer equipment",
    summary: "A lower-corrosion descaling choice for aluminum fins, copper, steel, plumbing, fire pumps, and refrigeration equipment.",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "Corrosion table and Walmart refrigeration proof"
  },
  crs: {
    job: "Water-side scale and rust",
    summary: "For underbody rust, fixtures, coils, and water lines where metal compatibility matters as much as cleaning power.",
    fits: ["underbodies", "fixtures", "coils", "water lines"],
    proof: "User guide and application notes"
  },
  cr: {
    job: "High-pH cleaning and water-treatment support",
    summary: "For teams that need caustic-level cleaning, pH adjustment, or the alkaline step in a CR then HCR process.",
    fits: ["hoods", "floors", "CIP", "water treatment"],
    proof: "Controlled documentation and brewery trial notes"
  },
  crhd: {
    job: "Heavy grease and industrial soil",
    summary: "A high-active degreaser for floors, forklifts, drains, engine bays, kitchen buildup, and jobs where Simple Green is not enough.",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Walmart DC proof and support files"
  },
  neutral: {
    job: "Sensitive surfaces and seals",
    summary: "Choose this when grease needs to move but the surface, seal, metal, or finish needs a neutral chemistry profile.",
    fits: ["equipment", "marine", "aviation", "fleet"],
    proof: "SDS and technical application sheet"
  },
  multiwash: {
    job: "Everyday facility washing",
    summary: "A versatile cleaner for occupied buildings, concrete, drains, pressure washing, and routine maintenance work that touches the public.",
    fits: ["campuses", "concrete", "drains", "pressure washing"],
    proof: "Exterior wash photos and application notes"
  },
  watersafe60: {
    job: "Scale and corrosion control",
    summary: "For cooling towers and closed loops that need documented asset protection without heavy-metal inhibitor blends.",
    fits: ["cooling towers", "closed loops", "campuses", "hospitals"],
    proof: "Controlled documentation and program documents"
  },
  purgo: {
    job: "Minimum-risk antimicrobial support",
    summary: "For programs that need minimum-risk antimicrobial and odor-control support without presenting Purgo as a registered disinfectant.",
    fits: ["towers", "WMP support", "campuses", "general use"],
    proof: "FIFRA 25(b) and safety notes"
  },
  dbnpa: {
    job: "Quarterly tablet biocide",
    summary: "A controlled-release tablet for the non-oxidizing rotation in cooling-tower programs.",
    fits: ["quarterly dosing", "cooling towers", "low-dose programs"],
    proof: "Registration proof request"
  },
  lam3: {
    job: "Moss, algae, mold, and mildew",
    summary: "Spray and walk away on roofs, pavers, siding, stucco, concrete, ponds, and exterior walls; let dwell time do the long-tail cleaning work.",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Before-and-after exterior photos"
  },
  alumibrite: {
    job: "Aluminum brightening",
    summary: "Restore wheels, trim, RV, fleet, and marine aluminum without bringing HF/HCl brighteners into the bay.",
    fits: ["wheels", "trim", "RV", "marine"],
    proof: "Brightening index and field photo"
  },
  torque: {
    job: "Vehicle, fleet, RV, and marine wash",
    summary: "Clean and protect finishes in one wash-and-wax step for vehicles, fleets, RVs, and boats.",
    fits: ["vehicles", "fleets", "RVs", "boats"],
    proof: "Finish-care notes and field proof"
  },
  "cr-hd-low-foam": {
    job: "Machine wash and low-foam degreasing",
    summary: "The CRHD path for automatic scrubbers, parts washers, and recirculating systems where foam control matters.",
    fits: ["floor scrubbers", "parts washers", "recirculating wash", "heavy soil"],
    proof: "Application notes on request"
  },
  cr2: {
    job: "Concentrated alkaline cleaning",
    summary: "A higher-concentration CR-family SKU for accounts that already understand CR workflows; confirm application notes before rollout.",
    fits: ["alkaline cleaning", "water treatment", "high-pH", "dosing"],
    proof: "Application notes on request"
  },
  sar: {
    job: "Specialty acid replacement",
    summary: "A tuned acid-replacement SKU for targeted descaling and water-side work; route through quote review until application sheets are final.",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "Application notes on request"
  }
  ,
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
    summary: "Concentrated inhibited EG for industrial heat-transfer and freeze-protection loops where performance matters more than consumer positioning.",
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
    summary: "Premixed EG 50/50 blend for quote-reviewed loop top-offs and maintenance.",
    fits: ["loop top-offs", "routine maintenance", "freeze protection"],
    proof: "Pricing launch spec"
  }
};

export const PRODUCT_GALLERY = {
  hcr: [
    ["img/proof/cases/ddc-rust.webp", "Rusted HVAC component cleared with VertKleen HCR", "DDC rust and scale test"],
    ["img/proof/cases/farm-rust.webp", "Diamond-plate steel rust removed with VertKleen HCR", "Brevard HVAC farm rust removal"],
    ["img/proof/cases/brewery.webp", "Brewery tank and heat exchanger cleaned with VertKleen CR and HCR", "Brewery CIP trial"]
  ],
  cr: [
    ["img/proof/cases/brewery.webp", "Brewery tank and heat exchanger cleaned with VertKleen CR and HCR", "Brewery CIP trial"],
    ["img/proof/cases/hood.webp", "Commercial kitchen hood and range degreased with VertKleen CR", "Commercial hood cleaning"],
    ["img/before-after/cr-after.webp", "Exterior surface after VertKleen CR cleaning", "After cleaning"]
  ],
  crhd: [
    ["img/proof/walmart-dc-proof-enhanced.webp", "Walmart distribution center floor and equipment degreasing", "Distribution center degreasing"],
    ["img/proof/cases/kitchen.webp", "Commercial kitchen deep degreased with VertKleen CRHD", "Commercial kitchen cleaning"]
  ],
  descaler: [
    ["img/proof/cases/fire-pump.webp", "Fire-pump component descaled with VertKleen Descaler", "Fire protection system"],
    ["img/proof/cases/ac-coil.webp", "Residential AC coil cleaned with VertKleen Descaler", "AC coil cleaning"]
  ],
  multiwash: [
    ["img/proof/drone-wash-proof-enhanced.webp", "Occupied campus exterior cleaned by drone with VertKleen MultiWash", "Occupied campus wash"],
    ["img/before-after/drone.webp", "Before and after exterior drone cleaning", "Before and after"]
  ],
  lam3: [
    ["img/proof/cases/grout-moss.webp", "Exterior grout, grime, and algae cleared with VertKleen", "Exterior biogrowth cleaning"],
    ["img/before-after/moss-before.webp", "Exterior surface before treatment, covered in heavy moss", "Before treatment"],
    ["img/before-after/moss-after.webp", "Exterior surface after moss treatment", "After treatment"]
  ],
  alumibrite: [
    ["img/proof/cases/airboat.webp", "Commercial airboat aluminum restored with VertKleen AlumiBrite", "Airboat aluminum restoration"]
  ],
  torque: [
    ["img/proof/cases/marine.webp", "43-foot Yellowfin vessel washed and waxed with VertKleen Torque", "Vessel wash and wax"]
  ]
};

/* ---------- Nav / footer injection ---------- */
