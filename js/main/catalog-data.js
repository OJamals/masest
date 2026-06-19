export const PRODUCTS = {
  hcr: {
    name: "VertKleen HCR",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid)",
    hmis: "0-0-0",
    icon: "ph-flask",
 image: "img/products/hvac-hcr-studio.webp",
    tag: "Biodegradable acid replacement for descaling, rust removal, and passivation. Designed to reduce fuming, burn, and hazmat handling risk versus legacy acids.",
    desc: "A biodegradable, SynTec-powered acid replacement for descaling, rust removal, passivation, and acid cleaning. Designed to reduce fuming, burn, and hazmat handling risk versus legacy acids.",
    uses: [
      "Cooling tower fill and heat-exchanger descaling",
      "Rust removal: restored diamond-plated stainless steel stained for years",
      "Acid cleaning and passivation with the building occupied",
      "Concrete, equipment, and pipeline scale removal"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-atom", "SynTec powered", "Patented technology matching legacy acid performance"],
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, BOD, nitrates and phosphates"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "Cooling Tower Case Study: Brevard County Schools"]
  },
  cr: {
    name: "VertKleen CR",
    cat: "alkaline",
    replaces: "Replaces caustic soda and sodium hydroxide",
    hmis: "0-0-0",
    icon: "ph-drop-half",
 image: "img/products/hvac-cr-studio.webp",
    tag: "NSF/ANSI 60 caustic replacement and pH adjuster. High-pH cleaning power with an HMIS 0-0-0 profile.",
    desc: "An NSF/ANSI 60 caustic replacement and pH adjuster covering high-pH alkaline needs: degreasing, hood filters, floors, and pH control, with an HMIS 0-0-0 profile.",
    uses: [
      "pH adjustment in water treatment programs",
      "Hood filters and floors at busy commercial kitchens",
      "High-pH alkaline cleaning without burn risk",
      "Caustic replacement across industrial CIP"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Non-fuming handling profile with broad material compatibility"],
      ["ph-seal-check", "NSF/ANSI 60", "Certified for drinking-water system chemicals"],
      ["ph-atom", "SynTec powered", "Replaces sodium and potassium hydroxide"],
      ["ph-leaf", "Lower-impact discharge", "Simpler wastewater discharge profile"]
    ],
    docs: ["Safety Data Sheet (SDS)", "NSF/ANSI 60 Certification", "Technical Application Sheet"]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Replaces caustic and solvent degreasers",
    hmis: "0-0-0",
 icon: "ph-drop",
 image: "img/products/neutral-studio.webp",
    tag: "Neutral pH-7 degreaser with solvent-grade cutting power for sensitive surfaces and seals.",
    desc: "A neutral pH-7 degreaser with the cutting power expected from high-pH and solvent degreasers, without flammability, harsh fumes, or surface damage.",
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
      ["ph-leaf", "Biodegrades in under 10 days", "Low VOC, easy discharge"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  multiwash: {
    name: "VertKleen MultiWash",
    cat: "alkaline",
    replaces: "Replaces general-purpose caustic cleaners",
    hmis: "0-0-0",
 icon: "ph-sparkle",
 image: "img/products/multiwash-studio.webp",
    tag: "Multi-surface industrial cleaner for occupied facilities, drains, concrete, and pressure-washing programs.",
    desc: "A versatile multi-surface cleaner for facilities, drains, concrete, and pressure-washing applications, with a handling profile suited to occupied campuses.",
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
      ["ph-truck", "Non-hazmat shipping", "Lower freight cost worldwide"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  watersafe60: {
    name: "WaterSafe60",
    cat: "water",
    replaces: "Replaces phosphate, zinc, and molybdate blends",
    hmis: "0-0-0",
 icon: "ph-waves",
 image: "img/products/watersafe60-studio.webp",
    tag: "NSF/ANSI 60 scale and corrosion inhibitor with no heavy metals.",
    desc: "An NSF/ANSI 60 scale and corrosion inhibitor with no heavy metals: no zinc, no molybdate, no chromate. Equivalent asset protection with an HMIS 0-0-0 profile.",
    uses: [
      "Cooling tower scale and corrosion control",
      "Closed-loop and chilled-water systems",
      "ASHRAE 188 and Legionella risk-management programs",
      "Campus, hospital, and government facilities"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Replaces blends rated up to HMIS 2-0-0"],
      ["ph-seal-check", "NSF/ANSI 60", "Certified inhibitor chemistry"],
      ["ph-prohibit", "No heavy metals", "No chromate, zinc, or molybdate"],
      ["ph-clipboard-text", "Full documentation", "ASHRAE 188 program support"]
    ],
    docs: ["Safety Data Sheet (SDS)", "NSF/ANSI 60 Certification", "Cooling Tower Program Brochure"]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Replaces bromine and sodium hypochlorite",
    hmis: "0-0-0",
 icon: "ph-shield-plus",
 image: "img/products/purgo-studio.webp",
    tag: "FIFRA 25(b) minimum-risk oxidizing biocide for microbiological and Legionella-risk control.",
    desc: "A FIFRA 25(b) minimum-risk oxidizing biocide replacing stabilized bromine and bleach (HMIS 3-0-1) for microbiological and Legionella-risk control.",
    uses: [
      "Cooling tower microbiological control",
      "Legionella risk management (ASHRAE 188)",
      "Occupied-campus water treatment",
      "General-use: no restricted-use applicator license required"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Replaces bromine and bleach rated 3-0-1"],
      ["ph-seal-check", "FIFRA 25(b)", "Minimum-risk classification"],
      ["ph-buildings", "Occupied-site fit", "Built for routine water-treatment programs"],
      ["ph-certificate", "No license barrier", "General-use in Florida, no FDACS license needed"]
    ],
    docs: ["Safety Data Sheet (SDS)", "FIFRA 25(b) Documentation", "Cooling Tower Program Brochure"]
  },
  dbnpa: {
    name: "DBNPA Tablet",
    cat: "water",
    replaces: "Replaces glutaraldehyde 50%",
    hmis: "Low hazard",
 icon: "ph-pill",
 image: "img/products/dbnpa-studio.webp",
    tag: "Controlled-release non-oxidizing biocide. One tablet per quarter.",
    desc: "EPA-registered, general-use controlled-release tablets, dosed at one tablet per quarter, satisfying the non-oxidizing biocide rotation without flammable, toxic glutaraldehyde.",
    uses: [
      "Quarterly non-oxidizing biocide rotation",
      "Cooling tower microbiological programs",
      "Low-dose, controlled-release dosing"
    ],
    specs: [
      ["ph-arrow-down", "Low dose", "One controlled-release tablet per quarter"],
      ["ph-seal-check", "EPA-registered", "General-use classification"],
      ["ph-fire-simple", "Non-flammable", "Replaces glutaraldehyde rated HMIS 3-2-0"],
      ["ph-info", "Program note", "The program's one mild-hazard product. Every other VertKleen product is HMIS 0-0-0."]
    ],
    docs: ["Safety Data Sheet (SDS)", "EPA Registration Documentation"]
  },
  crhd: {
    name: "VertKleen CRHD",
    cat: "alkaline",
    replaces: "Replaces Simple Green, Zep, and solvent degreasers",
    hmis: "0-0-0",
    icon: "ph-spray-bottle",
 image: "img/products/crhd-studio.webp",
    tag: "High-detergency alkaline degreaser, about 50% active and low-foam, for floors, equipment, drains, and engine bays.",
    desc: "A high-detergency, low-foam alkaline degreaser at roughly 50% active strength, built to replace solvent and butyl degreasers on the heaviest grease without flammability or harsh fumes.",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Field-proven replacing Simple Green at Walmart distribution centers"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-gauge", "About 50% active", "Higher active strength than common 15% degreasers"],
      ["ph-seal-check", "OEM cleared", "Approved by Crown Forklift and Plug Power; meets Boeing and Airbus cleaning specs"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "Case Study: Walmart Distribution Centers"]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid) products, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
 image: "img/products/descaler-studio.webp",
    tag: "Acid-free descaler for coils, towers, and plumbing. Fin-safe on aluminum and copper, with a fraction of the corrosion of conventional acids.",
    desc: "An acid-free descaler (marketed as CRS in the dealership channel) that clears calcium, rust, and scale from coils, cooling towers, plumbing, and fire pumps. Fin-safe on aluminum and copper, chloride-free, and built for routine municipal-drain discharge.",
    uses: [
      "Aluminum and copper coil descaling, fin-safe",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Refrigeration systems: chloride-free, safe on the ammonia charge"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "HMIS 0-0-0 profile with no NFPA pictograms"],
      ["ph-trend-down", "Far less corrosion", "0.59 mpy versus hydrochloric at 609 mpy in VertKleen testing"],
      ["ph-snowflake", "Fin-safe and chloride-free", "Protects aluminum, copper, steel, and stainless"],
      ["ph-drop", "Municipal-drain discharge", "No acid neutralization or special disposal"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Descaler vs Acids Corrosion Data", "Case Study: Walmart Refrigeration Systems"]
  },
  alumibrite: {
    name: "VertKleen AlumiBrite",
    cat: "specialty",
    replaces: "Replaces hydrofluoric and hydrochloric aluminum brighteners",
    hmis: "0-0-0",
 icon: "ph-car",
 image: "img/products/alumibrite-studio.webp",
    tag: "Synthetic-acid aluminum brightener with no hydrofluoric or hydrochloric acid, for wheels, trim, and aluminum restoration.",
    desc: "A synthetic-acid aluminum brightener that restores wheels, trim, and marine aluminum without hydrofluoric or hydrochloric acid, the standard brighteners that burn skin and pit metal.",
    uses: [
      "Wheels, trim, and aluminum restoration",
      "Fleet, RV, and marine aluminum",
      "Detailing and dealership reconditioning",
      "Field-proven on a commercial tourist airboat"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "No hydrofluoric or hydrochloric acid"],
      ["ph-atom", "Synthetic acid", "SynTec brightening without the burn and fume risk"],
      ["ph-chart-line-up", "Brightening Index 90.1", "Outperformed hydrochloric acid at 86.3 in VertKleen testing"],
      ["ph-leaf", "Biodegradable", "Low-impact discharge profile"]
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
    tag: "All-in-one wash and wax for vehicles, fleet, RV, and marine, formulated to stay OEM warranty-safe.",
    desc: "An all-in-one wash and wax that cleans and protects in a single step across vehicles, fleet, RV, and marine, formulated to stay within OEM finish-care requirements.",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Field-proven on a 43-foot Yellowfin vessel"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-sparkle", "Wash and wax in one", "Cleans and protects in a single pass"],
      ["ph-seal-check", "OEM warranty-safe", "Formulated to meet finish-care requirements"],
      ["ph-leaf", "Biodegradable", "Low VOC, easy discharge"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  lam3: {
    name: "VertKleen LAM3",
    cat: "specialty",
    replaces: "Replaces Wet & Forget and bleach roof cleaners",
    hmis: "0-0-0",
 icon: "ph-house-line",
 image: "img/products/lam3-studio.webp",
    tag: "Spray-and-walk-away remover for lichen, algae, moss, mold, and mildew on roofs, pavers, stucco, and siding.",
    desc: "A neutral, spray-and-walk-away treatment that clears lichen, algae, moss, mold, and mildew from roofs, pavers, stucco, siding, and concrete, with no bleach and no harm to surrounding plants.",
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Pond and fountain algae",
      "Field-proven clearing mildew from a painted column over two weeks"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Neutral pH, no bleach, no fumes"],
      ["ph-plant", "Plant and pet compatible", "Use according to label around landscaping and animals"],
      ["ph-timer", "Spray and walk away", "Keeps working up to a month; reapply about every six months"],
      ["ph-leaf", "100% biodegradable", "Non-skin-irritant in OECD 404 testing"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Data Sheet (TDS)", "Front and Back Label"]
  },
  crs: {
    name: "VertKleen CRS",
    cat: "acid",
    replaces: "Replaces hydrochloric acid (muriatic acid) for rust, scale, and calcium",
    hmis: "0-0-0",
 icon: "ph-wrench",
 image: "img/products/crs-studio.webp",
    tag: "Non-corrosive HCl replacement for underbody rust removal, coils, cooling towers, and water-side scale.",
    desc: "A non-corrosive hydrochloric-acid replacement for rust, calcium, scale, and water-side buildup where metal safety matters.",
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
      ["ph-leaf", "Lower-impact discharge", "Use ratios align with the VertKleen dilution guide"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "HCR & Descaler Userguide"]
  },
  "cr-hd-low-foam": {
    name: "VertKleen CR HD Low Foam",
    cat: "alkaline",
    replaces: "Replaces solvent and butyl degreasers",
    hmis: "0-0-0",
    icon: "ph-drop-half",
    image: "img/products/crhd-studio.webp",
    tag: "Low-foam CR HD for automatic scrubbers, parts washers, and recirculating wash systems.",
    desc: "A low-foam heavy-duty degreaser built for automatic scrubbers, parts washers, and recirculating wash systems where foam control matters, with the same HMIS 0-0-0 handling as CR HD.",
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy soil and grease on equipment and floors"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop", "Low-foam formula", "Built for machine wash and recirculating systems"],
      ["ph-atom", "SynTec powered", "Heavy-duty degreasing without solvent odor"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
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
    tag: "Higher-concentration CR for demanding alkaline cleaning and water-treatment programs with published list pricing.",
    desc: "A higher-concentration version of VertKleen CR for demanding alkaline cleaning and water-treatment work. Small packs are priced online; drums route through freight review.",
    uses: [
      "Concentrated alkaline cleaning programs",
      "Water-treatment dosing where strength matters",
      "High-pH cleaning with an HMIS 0-0-0 profile"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "0 health, flammability, and reactivity rating"],
      ["ph-drop-half", "Higher concentration", "More active cleaning per gallon than standard CR"],
      ["ph-atom", "SynTec powered", "Caustic-level performance with HMIS 0-0-0 handling"]
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
    tag: "Specialty acid replacement for targeted descaling and water-side work with published list pricing.",
    desc: "A specialty acid-replacement formulation for targeted descaling and water-side applications. Small packs are priced online; drums route through freight review.",
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
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
pg100: {
    name: "VertKleen PG100",
    cat: "glycol",
    replaces: "Propylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Propylene glycol concentrate for closed-loop heat-transfer and freeze-protection programs.",
    desc: "A propylene glycol concentrate for commercial HVAC, hydronic, and process-loop freeze protection.",
    uses: ["Closed-loop HVAC systems", "Hydronic freeze protection", "Process heat-transfer loops"],
    specs: [
      ["ph-drop", "Propylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  pg50: {
    name: "VertKleen PG50",
    cat: "glycol",
    replaces: "50% propylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Premixed 50% propylene glycol blend for closed-loop freeze-protection maintenance.",
    desc: "A ready-to-use 50% propylene glycol blend for HVAC and hydronic loop service.",
    uses: ["Closed-loop HVAC systems", "Hydronic loop top-offs", "Facility freeze-protection maintenance"],
    specs: [
      ["ph-drop", "PG 50 blend", "Premixed propylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg100: {
    name: "VertKleen EG100",
    cat: "glycol",
    replaces: "Ethylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Ethylene glycol concentrate for industrial heat-transfer and freeze-protection loops.",
    desc: "An ethylene glycol concentrate for industrial loop fill, freeze protection, and heat-transfer programs.",
    uses: ["Industrial heat-transfer loops", "Closed-loop freeze protection", "Process-loop maintenance"],
    specs: [
      ["ph-drop", "Ethylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg50: {
    name: "VertKleen EG50",
    cat: "glycol",
    replaces: "50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Premixed 50% ethylene glycol blend for industrial loop maintenance.",
    desc: "A ready-to-use 50% ethylene glycol blend for industrial heat-transfer and freeze-protection loops.",
    uses: ["Industrial loop top-offs", "Closed-loop freeze protection", "Heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG 50 blend", "Premixed ethylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  egu96: {
    name: "VertKleen EGU96",
    cat: "glycol",
    replaces: "Ethylene glycol utility concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Utility-grade ethylene glycol concentrate for heat-transfer and freeze-protection programs.",
    desc: "A utility-grade ethylene glycol concentrate for industrial heat-transfer loop programs.",
    uses: ["Utility loop service", "Industrial freeze protection", "Process heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG utility", "Concentrated glycol for utility loops"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg5050: {
    name: "VertKleen EG50/50",
    cat: "glycol",
    replaces: "Economy 50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    tag: "Economy 50/50 ethylene glycol blend for routine loop top-offs and maintenance.",
    desc: "A 50/50 ethylene glycol blend for routine closed-loop maintenance and top-off work.",
    uses: ["Loop top-offs", "Routine freeze-protection maintenance", "Industrial heat-transfer service"],
    specs: [
      ["ph-drop", "EG 50/50", "Premixed ethylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums route through freight review"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  }
};

export const CATALOG_ORDER = [
  "hcr", "descaler", "cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash",
  "watersafe60", "cr2", "sar", "purgo", "lam3", "alumibrite", "torque",
  "pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"
];

// Catalog UI groupings (curated, not the raw `cat` field) — drive the category
// filter chips and grouping on the products page.
export const CATALOG_GROUPS = [
  { key: "descale", label: "Rust & Scale", ids: ["hcr", "descaler"] },
  { key: "degrease", label: "Grease & Grime", ids: ["cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash"] },
  { key: "water", label: "Water Treatment", ids: ["watersafe60", "cr2", "sar", "purgo"] },
  { key: "exterior", label: "Exterior & Specialty", ids: ["lam3", "alumibrite", "torque"] },
  { key: "glycol", label: "Glycols", ids: ["pg100", "pg50", "eg100", "eg50", "egu96", "eg5050"] }
];

// Automated replacement checker: the legacy chemical a buyer uses today, the job
// it does, and the VertKleen product ids that replace it. Single source of truth
// for the compact top-of-page matrix and the live catalog filter.
export const REPLACEMENT_MAP = [
  { legacy: "Muriatic / hydrochloric acid", job: "Rust, scale & passivation", ids: ["hcr", "descaler", "crs"] },
  { legacy: "Caustic soda / sodium hydroxide", job: "pH adjustment & caustic cleaning", ids: ["cr"] },
  { legacy: "Simple Green / Zep / butyl degreasers", job: "Heavy-duty degreasing", ids: ["crhd"] },
  { legacy: "Caustic & solvent degreasers", job: "Degreasing sensitive surfaces", ids: ["neutral"] },
  { legacy: "CLR / Calci-Solve", job: "Coil & heat-transfer descaling", ids: ["descaler"] },
  { legacy: "General-purpose caustic cleaners", job: "Everyday facility washing", ids: ["multiwash"] },
  { legacy: "Phosphate / zinc / molybdate blends", job: "Scale & corrosion control", ids: ["watersafe60"] },
  { legacy: "Stabilized bromine / bleach", job: "Oxidizing biocide", ids: ["purgo"] },
  { legacy: "Wet & Forget / bleach roof cleaners", job: "Exterior moss, algae & mold", ids: ["lam3"] },
  { legacy: "Hydrofluoric / HCl brighteners", job: "Aluminum brightening", ids: ["alumibrite"] },
  { legacy: "Separate wash, wax & bug removers", job: "Vehicle wash & wax", ids: ["torque"] }
];

export const PRODUCT_CATALOG_COPY = {
  hcr: {
    job: "Rust, scale, and heavy deposits",
    summary: "Use when rust staining, mineral scale, or passivation work needs industrial strength without harsh acid handling.",
    fits: ["HVAC", "metal restoration", "concrete", "pipelines"],
    proof: "Field photos and cooling-tower case notes"
  },
  descaler: {
    job: "Coils, towers, and heat-transfer equipment",
    summary: "A safer descaling choice for aluminum fins, copper, steel, plumbing, fire pumps, and refrigeration equipment.",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "Corrosion data and refrigeration-system proof"
  },
  crs: {
    job: "Water-side scale and rust",
    summary: "For underbody rust, fixtures, coils, and water lines where metal safety matters as much as cleaning power.",
    fits: ["underbodies", "fixtures", "coils", "water lines"],
    proof: "User guide and application notes"
  },
  cr: {
    job: "High-pH cleaning and water-treatment support",
    summary: "For teams that need caustic-level cleaning or pH adjustment with a HMIS 0-0-0 handling profile.",
    fits: ["hoods", "floors", "CIP", "water treatment"],
    proof: "NSF/ANSI 60 documentation and trial notes"
  },
  crhd: {
    job: "Heavy grease and industrial soil",
    summary: "A high-active degreaser for floors, forklifts, drains, engine bays, and kitchen buildup without solvent odor.",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Distribution-center and OEM-cleared proof"
  },
  neutral: {
    job: "Sensitive surfaces and seals",
    summary: "Choose this when grease needs to move but the surface, seal, metal, or finish cannot take harsh cleaners.",
    fits: ["equipment", "marine", "aviation", "fleet"],
    proof: "SDS and technical application sheet"
  },
  multiwash: {
    job: "Everyday facility washing",
    summary: "A versatile cleaner for occupied buildings, concrete, drains, pressure washing, and routine maintenance.",
    fits: ["campuses", "concrete", "drains", "pressure washing"],
    proof: "Exterior wash photos and application notes"
  },
  watersafe60: {
    job: "Scale and corrosion control",
    summary: "For cooling towers and closed loops that need documented asset protection without heavy-metal inhibitor blends.",
    fits: ["cooling towers", "closed loops", "campuses", "hospitals"],
    proof: "NSF/ANSI 60 and program documents"
  },
  purgo: {
    job: "Microbiological control",
    summary: "For water-treatment programs that need oxidizing control with easier occupied-site handling.",
    fits: ["towers", "Legionella plans", "campuses", "general use"],
    proof: "Program documents and safety notes"
  },
  dbnpa: {
    job: "Quarterly tablet biocide",
    summary: "A controlled-release tablet for the non-oxidizing rotation in cooling-tower programs.",
    fits: ["quarterly dosing", "cooling towers", "low-dose programs"],
    proof: "EPA registration documentation"
  },
  lam3: {
    job: "Moss, algae, mold, and mildew",
    summary: "Spray and walk away on roofs, pavers, siding, stucco, concrete, ponds, and exterior walls.",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Before-and-after exterior photos"
  },
  alumibrite: {
    job: "Aluminum brightening",
    summary: "Restore wheels, trim, RV, fleet, and marine aluminum without traditional brightener burn and fume risk.",
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
    summary: "The low-foam CR HD for automatic scrubbers, parts washers, and recirculating systems where foam control matters.",
    fits: ["floor scrubbers", "parts washers", "recirculating wash", "heavy soil"],
    proof: "Application notes on request"
  },
  cr2: {
    job: "Concentrated alkaline cleaning",
    summary: "A higher-concentration CR for demanding alkaline cleaning and water-treatment programs with published list pricing.",
    fits: ["alkaline cleaning", "water treatment", "high-pH", "dosing"],
    proof: "Application notes on request"
  },
  sar: {
    job: "Specialty acid replacement",
    summary: "A tuned acid-replacement formulation for targeted descaling and water-side work with published list pricing.",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "Application notes on request"
  }
  ,
  pg100: {
    job: "Propylene glycol concentrate",
    summary: "Concentrated PG for closed-loop heat-transfer and freeze-protection programs.",
    fits: ["HVAC loops", "hydronic systems", "freeze protection"],
    proof: "Pricing launch spec"
  },
  pg50: {
    job: "Premixed PG loop service",
    summary: "50% propylene glycol blend for routine top-offs and closed-loop maintenance.",
    fits: ["HVAC loops", "hydronic systems", "maintenance top-offs"],
    proof: "Pricing launch spec"
  },
  eg100: {
    job: "Ethylene glycol concentrate",
    summary: "Concentrated EG for industrial heat-transfer and freeze-protection loops.",
    fits: ["industrial loops", "process systems", "freeze protection"],
    proof: "Pricing launch spec"
  },
  eg50: {
    job: "Premixed EG loop service",
    summary: "50% ethylene glycol blend for routine industrial loop maintenance.",
    fits: ["industrial loops", "heat transfer", "maintenance top-offs"],
    proof: "Pricing launch spec"
  },
  egu96: {
    job: "Utility glycol concentrate",
    summary: "Utility-grade ethylene glycol concentrate for heat-transfer loop programs.",
    fits: ["utility loops", "industrial freeze protection", "process systems"],
    proof: "Pricing launch spec"
  },
  eg5050: {
    job: "Economy EG 50/50 blend",
    summary: "Premixed 50/50 ethylene glycol blend for routine top-offs and maintenance.",
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
