/* MASEST / VertKleen shared JS (v2, taste-skill applied)
   Icons: Phosphor web family only. No emoji. No em-dashes in copy. */

const PRODUCTS = {
  hcr: {
    name: "VertKleen HCR",
    cat: "acid",
    replaces: "Replaces hydrochloric acid",
    hmis: "0-0-0",
    icon: "ph-flask",
 image: "img/products/hvac-hcr-studio.webp",
    tag: "Biodegradable acid replacement for descaling, rust removal, and passivation. No fumes, no burns, no hazmat handling.",
    desc: "A biodegradable, SynTec-powered acid replacement for descaling, rust removal, passivation, and acid cleaning. No fumes, no burns, no hazmat handling.",
    uses: [
      "Cooling tower fill and heat-exchanger descaling",
      "Rust removal: restored diamond-plated stainless steel stained for years",
      "Acid cleaning and passivation with the building occupied",
      "Concrete, equipment, and pipeline scale removal"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
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
    tag: "NSF/ANSI 60 caustic replacement and pH adjuster. High-pH cleaning power at a zero hazard rating.",
    desc: "An NSF/ANSI 60 caustic replacement and pH adjuster covering high-pH alkaline needs: degreasing, hood filters, floors, and pH control, all at a zero hazard rating.",
    uses: [
      "pH adjustment in water treatment programs",
      "Hood filters and floors at busy commercial kitchens",
      "High-pH alkaline cleaning without burn risk",
      "Caustic replacement across industrial CIP"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Safe on skin and eyes, non-fuming, non-corrosive"],
      ["ph-seal-check", "NSF/ANSI 60", "Certified for drinking-water system chemicals"],
      ["ph-atom", "SynTec powered", "Replaces sodium and potassium hydroxide"],
      ["ph-leaf", "Eco-friendly discharge", "Effortless wastewater discharge profile"]
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
      ["ph-shield-check", "HMIS 0-0-0", "Zero hazard, replaces flammable solvent degreasers"],
      ["ph-scales", "True pH 7", "Neutral chemistry, safe on any equipment and seals"],
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
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
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
    desc: "An NSF/ANSI 60 scale and corrosion inhibitor with no heavy metals: no zinc, no molybdate, no chromate. Equivalent asset protection at a zero hazard rating.",
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
      ["ph-buildings", "Occupied-site safe", "No evacuations, no fume exposure"],
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
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-gauge", "About 50% active", "Higher active strength than common 15% degreasers"],
      ["ph-seal-check", "OEM cleared", "Approved by Crown Forklift and Plug Power; meets Boeing and Airbus cleaning specs"],
      ["ph-truck", "Non-hazmat shipping", "No DOT hazmat freight, lower shipping cost"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet", "Case Study: Walmart Distribution Centers"]
  },
  descaler: {
    name: "VertKleen Descaler",
    cat: "acid",
    replaces: "Replaces muriatic acid, CLR, and Calci-Solve",
    hmis: "0-0-0",
    icon: "ph-snowflake",
 image: "img/products/descaler-studio.webp",
    tag: "Acid-free descaler for coils, towers, and plumbing. Fin-safe on aluminum and copper, with a fraction of the corrosion of conventional acids.",
    desc: "An acid-free descaler (marketed as CRS in the dealership channel) that clears calcium, rust, and scale from coils, cooling towers, plumbing, and fire pumps. Fin-safe on aluminum and copper, chloride-free, and safe to municipal drains.",
    uses: [
      "Aluminum and copper coil descaling, fin-safe",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Refrigeration systems: chloride-free, safe on the ammonia charge"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero hazard rating, no NFPA pictograms"],
      ["ph-trend-down", "Far less corrosion", "0.59 mpy versus hydrochloric at 609 mpy in VertKleen testing"],
      ["ph-snowflake", "Fin-safe and chloride-free", "Protects aluminum, copper, steel, and stainless"],
      ["ph-drop", "Municipal-drain safe", "No acid neutralization or special disposal"]
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
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
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
      ["ph-plant", "Plant and pet safe", "No harm to flora or fauna around the work area"],
      ["ph-timer", "Spray and walk away", "Keeps working up to a month; reapply about every six months"],
      ["ph-leaf", "100% biodegradable", "Non-skin-irritant in OECD 404 testing"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Data Sheet (TDS)", "Front and Back Label"]
  },
  crs: {
    name: "VertKleen CRS",
    cat: "acid",
    replaces: "Replaces muriatic acid for rust, scale, and calcium",
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
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
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
    desc: "A low-foam heavy-duty degreaser built for automatic scrubbers, parts washers, and recirculating wash systems where foam control matters, with the same zero-hazard handling as CR HD.",
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy soil and grease on equipment and floors"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
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
    tag: "Higher-concentration CR for demanding alkaline cleaning and water-treatment programs. Priced by quote.",
    desc: "A higher-concentration version of VertKleen CR for demanding alkaline cleaning and water-treatment work. Pricing and pack sizes are confirmed by quote.",
    uses: [
      "Concentrated alkaline cleaning programs",
      "Water-treatment dosing where strength matters",
      "High-pH cleaning at a zero hazard rating"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-drop-half", "Higher concentration", "More active cleaning per gallon than standard CR"],
      ["ph-atom", "SynTec powered", "Caustic-level performance without the hazard"]
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
    tag: "Specialty acid replacement for targeted descaling and water-side work. Priced by quote.",
    desc: "A specialty acid-replacement formulation for targeted descaling and water-side applications. Pricing and pack sizes are confirmed by quote.",
    uses: [
      "Specialty descaling and acid-cleaning jobs",
      "Water-side scale and mineral removal",
      "Applications needing a tuned acid-replacement profile"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-drop-half", "Acid replacement", "Targeted descaling without muriatic-acid handling"],
      ["ph-waves", "Water-side scale", "Calcium, rust, and mineral buildup"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
};

const CATALOG_ORDER = [
  "hcr", "descaler", "crs", "cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash",
  "watersafe60", "cr2", "sar", "purgo", "dbnpa", "lam3", "alumibrite", "torque"
];

// Catalog UI groupings (curated, not the raw `cat` field) — drive the category
// filter chips and grouping on the products page.
const CATALOG_GROUPS = [
  { key: "descale", label: "Rust & Scale", ids: ["hcr", "descaler", "crs"] },
  { key: "degrease", label: "Grease & Grime", ids: ["cr", "crhd", "cr-hd-low-foam", "neutral", "multiwash"] },
  { key: "water", label: "Water Treatment", ids: ["watersafe60", "cr2", "sar", "purgo", "dbnpa"] },
  { key: "exterior", label: "Exterior & Specialty", ids: ["lam3", "alumibrite", "torque"] }
];

// Automated replacement checker: the legacy chemical a buyer uses today, the job
// it does, and the VertKleen product ids that replace it. Single source of truth
// for the compact top-of-page matrix and the live catalog filter.
const REPLACEMENT_MAP = [
  { legacy: "Muriatic / hydrochloric acid", job: "Rust, scale & passivation", ids: ["hcr", "descaler", "crs"] },
  { legacy: "Caustic soda / sodium hydroxide", job: "pH adjustment & caustic cleaning", ids: ["cr"] },
  { legacy: "Simple Green / Zep / butyl degreasers", job: "Heavy-duty degreasing", ids: ["crhd"] },
  { legacy: "Caustic & solvent degreasers", job: "Degreasing sensitive surfaces", ids: ["neutral"] },
  { legacy: "CLR / Calci-Solve", job: "Coil & heat-transfer descaling", ids: ["descaler"] },
  { legacy: "General-purpose caustic cleaners", job: "Everyday facility washing", ids: ["multiwash"] },
  { legacy: "Phosphate / zinc / molybdate blends", job: "Scale & corrosion control", ids: ["watersafe60"] },
  { legacy: "Stabilized bromine / bleach", job: "Oxidizing biocide", ids: ["purgo"] },
  { legacy: "Glutaraldehyde 50%", job: "Non-oxidizing biocide", ids: ["dbnpa"] },
  { legacy: "Wet & Forget / bleach roof cleaners", job: "Exterior moss, algae & mold", ids: ["lam3"] },
  { legacy: "Hydrofluoric / HCl brighteners", job: "Aluminum brightening", ids: ["alumibrite"] },
  { legacy: "Separate wash, wax & bug removers", job: "Vehicle wash & wax", ids: ["torque"] }
];

const PRODUCT_CATALOG_COPY = {
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
    summary: "For teams that need caustic-level cleaning or pH adjustment with a zero-hazard handling profile.",
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
    summary: "A higher-concentration CR for demanding alkaline cleaning and water-treatment programs. Priced by quote.",
    fits: ["alkaline cleaning", "water treatment", "high-pH", "dosing"],
    proof: "Application notes on request"
  },
  sar: {
    job: "Specialty acid replacement",
    summary: "A tuned acid-replacement formulation for targeted descaling and water-side work. Priced by quote.",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "Application notes on request"
  }
};

const PRODUCT_GALLERY = {
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
function pageName() {
  return location.pathname.split("/").pop() || "index.html";
}
function renderChrome() {
  document.querySelector(".nojs-nav")?.setAttribute("hidden", "");
  const page = pageName();
  // Pages under /industries/ sit one level deep; prefix chrome links with the
  // right root so the shared nav/footer resolve from any directory depth.
  const root = /\/industries\//.test(location.pathname) ? "../" : "";
  const links = [
    { href: "products.html", label: "Products" },
    {
      key: "useCases",
      label: "Use Cases",
      children: [
        { href: "industries.html", label: "Industries" },
        { href: "proof.html", label: "Field Results" }
      ]
    },
    { href: "resources.html", label: "Resources" }
  ];
  const isActive = (href) => {
    if (page === href) return true;
    if (href === "products.html" && page === "product.html") return true;
    if (href === "industries.html" && /\/industries\//.test(location.pathname)) return true;
    return false;
  };
  const navItem = item => {
    if (!item.children) {
      return `<a href="${root}${item.href}"${isActive(item.href) ? ' class="active" aria-current="page"' : ""}>${item.label}</a>`;
    }
    const active = item.children.some(child => isActive(child.href));
    return `<details class="nav-group${active ? " active" : ""}">
      <summary${active ? ' class="active" aria-current="page"' : ""}>${item.label}</summary>
      <div class="nav-menu">
        ${item.children.map(child =>
          `<a href="${root}${child.href}"${isActive(child.href) ? ' class="active" aria-current="page"' : ""}>${child.label}</a>`).join("")}
      </div>
    </details>`;
  };
  const skip = document.createElement("a");
  skip.className = "skip-link";
  skip.href = "#main";
  skip.textContent = "Skip to content";
  const nav = document.createElement("header");
  // Start in the dark-glass treatment when this page opens on the dark story,
  // so the first paint matches the backdrop (no white-bar flash before onScroll).
  const story = document.getElementById("story");
  nav.className = story || document.body.dataset.nav === "dark" ? "nav over-dark" : "nav";
  nav.innerHTML = `
    <div class="nav-inner">
      <a class="nav-logo" href="${root}index.html"><img class="logo-image logo-ink" src="${root}img/masest-logo-ink.png" alt="MASEST"><img class="logo-image logo-grad" src="${root}img/masest-logo.png" alt="" aria-hidden="true"></a>
      <nav class="nav-links" id="navLinks">
        ${links.map(navItem).join("")}
      </nav>
      <div class="nav-actions">
        <a class="nav-account" href="${root}account.html"><span>Sign in</span></a>
        <a class="nav-cart" href="${root}cart.html" aria-label="Open cart"><i class="ph ph-shopping-cart-simple" aria-hidden="true"></i><b class="cart-count" data-cart-count hidden>0</b></a>
        <button class="nav-burger" id="navBurger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><span></span><span></span><span></span></button>
      </div>
    </div>`;
  document.body.prepend(nav);
  document.body.prepend(skip);
  const burger = document.getElementById("navBurger");
  const navLinks = document.getElementById("navLinks");
  const cartCount = nav.querySelector("[data-cart-count]");
  const updateCartCount = () => {
    let total = 0;
    try {
      const cart = JSON.parse(localStorage.getItem("masest_cart") || "{}");
      total = Object.values(cart).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
    } catch (err) {
      total = 0;
    }
    cartCount.textContent = String(total);
    cartCount.hidden = total === 0;
  };
  updateCartCount();
  window.addEventListener("storage", updateCartCount);
  document.addEventListener("cart:updated", updateCartCount);
  document.addEventListener("masest:cart", updateCartCount);
  // Account control: login button when logged out, account dropdown when signed in.
  import("/js/account-nav.js").then((m) => m.initAccountNav && m.initAccountNav({ nav, root })).catch(() => {});
  const syncNavCtaLabel = () => {
  };
  syncNavCtaLabel();
  window.addEventListener("resize", syncNavCtaLabel);
  const setMenuOpen = open => {
    navLinks.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
    burger.setAttribute("aria-label", open ? "Close menu" : "Menu");
  };
  burger.addEventListener("click", () => {
    setMenuOpen(!navLinks.classList.contains("open"));
  });
  const closeMenu = () => {
    setMenuOpen(false);
  };
  navLinks.querySelectorAll("a").forEach(a => a.addEventListener("click", closeMenu));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMenu();
  });

  // Elevate the nav once the page scrolls away from the top.
  const useDarkNav = document.body.dataset.nav === "dark";
  const onScroll = () => {
    nav.classList.toggle("scrolled", window.scrollY > 8);
    nav.classList.toggle("over-dark", useDarkNav || (story && story.getBoundingClientRect().bottom > 66));
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const foot = document.createElement("footer");
  foot.className = "reveal";
  foot.innerHTML = `
    <div class="wrap">
      <div class="foot-grid">
        <div>
          <a class="foot-logo-link" href="${root}index.html" aria-label="MASEST home"><img class="foot-logo" src="${root}img/masest-logo.png" alt="MASEST"></a>
          <div class="foot-brand">MASEST VertKleen&trade;</div>
          <p>Safe, powerful, environmentally friendly alternatives to hazardous chemicals. Family-owned on Florida's Space Coast, trusted in 50+ countries.</p>
          <div class="foot-kicker">Primary path</div>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Product Categories</div>
          <a href="${root}products.html#cat-descale">Rust &amp; Scale</a>
          <a href="${root}products.html#cat-degrease">Grease &amp; Grime</a>
          <a href="${root}products.html#cat-water">Water Treatment</a>
          <a href="${root}products.html#cat-exterior">Exterior &amp; Specialty</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Resources + SDS</div>
          <a href="${root}resources.html">Resources &amp; SDS</a>
          <a href="${root}programs.html">Programs &amp; Pricing</a>
          <a href="${root}proof.html">Proof &amp; Case Studies</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Company</div>
          <a href="${root}industries.html">Industries</a>
          <a href="${root}about.html">About Us</a>
          <a href="${root}contact.html">Contact</a>
        </div>
        <div>
          <div class="foot-title">Contact</div>
          <a href="mailto:matthew@masest.co">matthew@masest.co</a>
          <a href="tel:+18134063852">(813) 406-3852</a>
          <p style="margin-top:10px;font-size:.8rem;line-height:1.7">CAGE 0B2Q3<br>NAICS 424690<br>SAM.gov registered<br>Minority-owned (self-certified)</p>
        </div>
      </div>
      <div class="foot-news">
        <div class="foot-news-copy">
          <div class="foot-title">VertKleen Briefing</div>
          <p>Field results, new SDS-backed SKUs, and program offers. No spam &mdash; unsubscribe anytime.</p>
        </div>
        <form class="foot-news-form" id="footNews" novalidate>
          <input type="email" name="email" id="footNewsEmail" placeholder="you@company.com" aria-label="Email address" autocomplete="email" required>
          <input type="text" name="company" class="foot-news-gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button type="submit" class="btn btn-primary" id="footNewsBtn">Subscribe</button>
          <p class="foot-news-status" id="footNewsStatus" role="status" aria-live="polite"></p>
        </form>
      </div>
      <div class="foot-bottom">
        <span>&copy; ${new Date().getFullYear()} MASEST Consulting LLC. All rights reserved.</span>
        <span>VertKleen, SynTec and SynClean are trademarks of MASEST Consulting LLC.</span>
      </div>
    </div>`;
  document.body.append(foot);

  // Newsletter signup → Klaviyo (via window.MASEST.subscribeNewsletter from integrations.js).
  const news = foot.querySelector("#footNews");
  if (news) {
    news.addEventListener("submit", async e => {
      e.preventDefault();
      const email = foot.querySelector("#footNewsEmail").value.trim();
      const honey = foot.querySelector(".foot-news-gotcha").value;
      const btn = foot.querySelector("#footNewsBtn");
      const status = foot.querySelector("#footNewsStatus");
      if (honey) return; // bot trap
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        status.dataset.state = "err"; status.textContent = "Enter a valid email."; return;
      }
      btn.disabled = true; status.dataset.state = ""; status.textContent = "Subscribing…";
      try {
        if (!window.MASEST?.subscribeNewsletter) throw new Error("unavailable");
        await window.MASEST.subscribeNewsletter(email);
        status.dataset.state = "ok"; status.textContent = "Check your inbox to confirm."; news.reset();
      } catch (err) {
        status.dataset.state = "err"; status.textContent = "Could not subscribe. Try again later.";
      } finally {
        btn.disabled = false;
      }
    });
  }

  // Load public config + integrations (Crisp chat, newsletter helper) once per page.
  if (!window.__masestIntegrations) {
    window.__masestIntegrations = true;
    const cfg = document.createElement("script");
    cfg.src = `${root}js/config.js`;
    cfg.onload = () => {
      const mod = document.createElement("script");
      mod.type = "module";
      mod.src = `${root}js/integrations.js`;
      document.head.appendChild(mod);
    };
    document.head.appendChild(cfg);
  }
}

/* ---------- Scroll reveal (IntersectionObserver, reduced-motion safe) ---------- */
function initResponsiveTables() {
  document.querySelectorAll(".cmp-table").forEach(table => {
    const headers = Array.from(table.querySelectorAll("thead th")).map(th =>
      th.textContent.trim().replace(/\s+/g, " ")
    );
    if (!headers.length) return;

    table.querySelectorAll("tbody tr").forEach(row => {
      Array.from(row.children).forEach((cell, index) => {
        if (headers[index]) cell.dataset.label = headers[index];
      });
    });
    table.classList.add("responsive-labels");
  });
}

function initReveal() {
  const syncRevealFocus = (el, visible) => {
    const focusables = [];
    const selector = "a[href], button, input, select, textarea, [tabindex], .table-scroll";
    if (el.matches(selector)) focusables.push(el);
    focusables.push(...el.querySelectorAll(selector));
    focusables.forEach(focusable => {
      if (!focusable.dataset.revealTabindexSet) {
        focusable.dataset.revealTabindexSet = "1";
        focusable.dataset.revealTabindex = focusable.getAttribute("tabindex") || "";
      }
      if (visible) {
        if (focusable.dataset.revealTabindex) focusable.setAttribute("tabindex", focusable.dataset.revealTabindex);
        else focusable.removeAttribute("tabindex");
      } else {
        focusable.setAttribute("tabindex", "-1");
      }
    });
  };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach(el => {
      el.classList.add("in");
      syncRevealFocus(el, true);
    });
    return;
  }

  document.body.classList.add("reveal-ready");
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        syncRevealFocus(e.target, true);
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12 });

  document.querySelectorAll(".reveal").forEach(el => {
    if (el.dataset.revealObserved) return;
    el.dataset.revealObserved = "1";
    syncRevealFocus(el, el.classList.contains("in"));
    io.observe(el);
  });
}
function productCard(id, heroCard = false) {
  const p = PRODUCTS[id];
  const catalog = PRODUCT_CATALOG_COPY[id] || {};
 const badge = p.hmis === "0-0-0"
 ? '<span class="hmis-badge">HMIS 0-0-0</span>'
 : '<span class="hmis-badge note">LOW HAZARD</span>';
  const media = p.image
    ? `<a class="prod-media" href="product.html?id=${id}" aria-label="View ${p.name} details"><img src="${p.image}" alt="${p.name} product photo" loading="lazy"></a>`
    : "";
  const fitList = (catalog.fits || []).map((fit) => `<li>${fit}</li>`).join("");
  return `
  <div class="prod-card${heroCard ? " hero-card" : ""} reveal">
    ${media}
    <div class="prod-top"><i class="ph ${p.icon}" aria-hidden="true"></i>${badge}</div>
    <span class="catalog-type">${catalog.job || p.replaces}</span>
    <h3>${p.name}</h3>
      <p>${catalog.summary || p.tag}</p>
      ${fitList ? `<ul class="product-fit-list">${fitList}</ul>` : ""}
      <span class="product-proof-line">${catalog.proof || "Stats, studies, and documents on the detail page"}</span>
      <div class="prod-actions">
        <a class="btn btn-ink btn-sm" href="product.html?id=${id}">View Details</a>
        <span class="commerce-slot" data-commerce-action="${id}" data-commerce-size="button"></span>
      </div>
  </div>`;
}

/* ---------- Products shop: e-commerce grid + replacement checker ---------- */
// Whole-card link, e-commerce style. Used by the unified products grid.
const commerceState = {
  loaded: false,
  products: new Map(),
  promise: null
};

function isLocalStaticHomepage() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  const homePath = /(^|\/)(index\.html)?$/.test(location.pathname);
  return localHost && homePath && !window.MASEST_ENABLE_LOCAL_API;
}

function isLocalStaticCommerceSuppressed() {
  const localHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(location.hostname);
  const accountPath = /(^|\/)account\.html$/.test(location.pathname);
  return isLocalStaticHomepage() || (localHost && accountPath && !window.MASEST_ENABLE_LOCAL_API);
}

function fmtMoney(n, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "USD").toUpperCase(),
    maximumFractionDigits: Number(n) % 1 === 0 ? 0 : 2
  }).format(Number(n));
}

function normalizeCommerceRow(row) {
  const parent = row?.products && typeof row.products === "object" ? row.products : row;
  const sku = String(parent?.sku || row?.sku || "").trim().toLowerCase();
  const rawVariants = row?.vsku
    ? [{
      vsku: row.vsku,
      label: row.label || "Each",
      gallons: row.gallons,
      price: row.price,
      currency: row.currency || parent?.currency,
      active: row.active,
      sort: row.sort || 0,
    }]
    : Array.isArray(row?.product_variants) && row.product_variants.length ? row.product_variants : [{
      vsku: row?.sku,
      label: "Each",
      gallons: row?.gallons || 0,
      price: row?.price,
      currency: row?.currency,
      active: row?.active,
      sort: 0,
    }];
  const variants = rawVariants
    .filter(v => v && v.active !== false && v.price != null && Number(v.price) > 0)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(v => ({
      vsku: v.vsku,
      label: v.label,
      gallons: Number(v.gallons) || 0,
      price: Number(v.price),
      currency: String(v.currency || parent?.currency || row?.currency || "usd").toUpperCase()
    }));
  return {
    sku,
    active: parent?.active !== false && row?.active !== false,
    mode: parent?.mode || row?.mode,
    image_url: parent?.image_url || row?.image_url || "",
    photo_alt: parent?.photo_alt || row?.photo_alt || "",
    variants,
    purchasable: !!(sku && parent?.active !== false && row?.active !== false && (parent?.mode || row?.mode) === "buy" && variants.length)
  };
}

async function loadCommerceCatalog() {
  if (commerceState.promise) return commerceState.promise;
  commerceState.promise = fetch("/api/products", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  })
    .then(async response => {
      if (!response.ok) throw new Error("catalog_unavailable");
      const payload = await response.json();
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      commerceState.products = rows
        .map(normalizeCommerceRow)
        .filter(row => row.sku)
        .reduce((map, row) => {
          const existing = map.get(row.sku);
          if (!existing) {
            map.set(row.sku, row);
            return map;
          }
          existing.active = existing.active && row.active;
      existing.mode = existing.mode || row.mode;
      existing.variants = existing.variants.concat(row.variants)
        .sort((a, b) => (a.gallons || 0) - (b.gallons || 0));
      if (!existing.image_url && row.image_url) existing.image_url = row.image_url;
      if (!existing.photo_alt && row.photo_alt) existing.photo_alt = row.photo_alt;
      existing.purchasable = existing.purchasable || row.purchasable;
          return map;
        }, new Map());
      commerceState.loaded = true;
      return commerceState.products;
    })
    .catch(() => {
      commerceState.loaded = true;
      commerceState.products = new Map();
      return commerceState.products;
    });
  return commerceState.promise;
}

function commerceActionHTML(id, variant = "chip") {
  const row = commerceState.products.get(String(id).toLowerCase());
  const p = PRODUCTS[id];
  if (!row?.purchasable || !row.variants.length) return "";
  const opts = row.variants
    .map((v, i) => `<option value="${v.vsku}"${i === 0 ? " selected" : ""}>${v.label} · ${fmtMoney(v.price, v.currency)}</option>`)
    .join("");
  const btnClass = variant === "button" ? "btn btn-secondary btn-sm" : "shop-card-add";
  const first = row.variants[0].vsku;
  return `<span class="commerce-buy" data-commerce-buy="${id}">`
    + `<select class="commerce-vol" aria-label="Volume for ${p?.name || id}">${opts}</select>`
    + `<button class="${btnClass}" type="button" data-cart-add="${first}" aria-label="Add ${p?.name || id} to cart">Add to cart</button>`
    + `</span>`;
}

function bulkPriceHTML(id) {
  const row = commerceState.products.get(String(id).toLowerCase());
  const variant = row?.variants?.find(v => Number(v.gallons) === 55);
  if (!variant || !Number.isFinite(Number(variant.price))) return "";
  const perGallon = Number(variant.price) / 55;
  return `<span class="shop-card-bulk">${fmtMoney(perGallon, variant.currency)}/gal</span>`;
}

function commerceMediaFor(id) {
  const row = commerceState.products.get(String(id).toLowerCase());
  const p = PRODUCTS[id];
  return {
    src: row?.image_url || p?.image || "",
    alt: row?.photo_alt || (p ? `${p.name} product image` : "")
  };
}

function refreshCommerceMedia(root = document) {
  root.querySelectorAll(".shop-card[data-id]").forEach(card => {
    const media = commerceMediaFor(card.dataset.id);
    if (!media.src) return;
    const slot = card.querySelector(".shop-card-media");
    if (!slot) return;
    let img = slot.querySelector("img");
    if (!img) {
      slot.querySelector("i")?.remove();
      img = document.createElement("img");
      img.loading = "lazy";
      slot.insertBefore(img, slot.firstChild);
    }
    img.src = media.src;
    img.alt = media.alt;
  });
}

// Add the selected volume variant (or the button's default vsku) to the cart, with transient feedback.
async function addToCartFromButton(button) {
  const wrap = button.closest("[data-commerce-buy]");
  const select = wrap && wrap.querySelector(".commerce-vol");
  const vsku = (select && select.value) || button.dataset.cartAdd;
  if (!vsku) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "Adding...";
  try {
    const cart = await import("./cart.js");
    cart.add(vsku, 1);
    button.textContent = "Added";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 900);
  } catch (err) {
    button.textContent = "Try again";
    setTimeout(() => { button.textContent = label; button.disabled = false; }, 1200);
  }
}

function refreshCommerceActions(root = document) {
  refreshCommerceMedia(root);
  root.querySelectorAll("[data-commerce-action]").forEach(slot => {
    const id = slot.dataset.commerceAction;
    slot.innerHTML = commerceActionHTML(id, slot.dataset.commerceSize || "chip");
  });
}

function catalogCard(id) {
  const p = PRODUCTS[id];
  if (!p) return "";
  const copy = PRODUCT_CATALOG_COPY[id] || {};
  const badge = p.hmis === "0-0-0"
    ? '<span class="hmis-badge">HMIS 0-0-0</span>'
    : '<span class="hmis-badge note">LOW HAZARD</span>';
  const mediaInfo = commerceMediaFor(id);
  const media = mediaInfo.src
    ? `<img src="${mediaInfo.src}" alt="${mediaInfo.alt}" loading="lazy">`
    : `<i class="ph ${p.icon}" aria-hidden="true"></i>`;
  return `
    <article class="shop-card" data-id="${id}">
      <a class="shop-card-link" href="product.html?id=${id}" aria-label="View details for ${p.name}">
        <span class="shop-card-media">${media}${badge}</span>
        <span class="shop-card-body">
          <span class="shop-card-type">${copy.job || "Industrial chemistry"}</span>
          <b class="shop-card-name">${p.name}</b>
          <span class="shop-card-replaces">${p.replaces}</span>
          <span class="shop-card-cta">View details <i class="ph ph-arrow-right" aria-hidden="true"></i></span>
        </span>
      </a>
        ${bulkPriceHTML(id)}
        <span class="shop-card-commerce" data-commerce-action="${id}"></span>
    </article>`;
}

function initCartButtons() {
  document.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button || button.closest("#shopGrid")) return;
    e.preventDefault();
    addToCartFromButton(button);
  });
}

function swapRow(row, i) {
  const names = row.ids.map((id) => PRODUCTS[id]?.name).filter(Boolean).join(", ");
  return `
    <button type="button" class="swap-row" data-row="${i}" aria-label="Show VertKleen swap for ${row.legacy}">
      <span class="swap-legacy"><em>Replace</em>${row.legacy}</span>
      <span class="swap-job"><em>For</em>${row.job}</span>
      <span class="swap-arrow" aria-hidden="true"><i class="ph ph-arrow-right"></i></span>
      <span class="swap-vk"><em>Use</em>${names}</span>
    </button>`;
}

function initShop() {
  const grid = document.getElementById("shopGrid");
  if (!grid) return;
  const matrix = document.getElementById("swapMatrix");
  const result = document.getElementById("swapResult");
  const chipsBox = document.getElementById("shopChips");
  const sortSel = document.getElementById("shopSort");
  const countEl = document.getElementById("shopCount");
  const emptyEl = document.getElementById("shopEmpty");

  grid.addEventListener("click", e => {
    const button = e.target.closest("[data-cart-add]");
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    addToCartFromButton(button);
  });

  const groupOf = (id) => (CATALOG_GROUPS.find((g) => g.ids.includes(id)) || {}).key || "";
  const state = { group: "all", match: null, sort: "featured" };

  const chips = [{ key: "all", label: "All products" }, ...CATALOG_GROUPS.map((g) => ({ key: g.key, label: g.label }))];
  chipsBox.innerHTML = chips
    .map((c) => `<button type="button" class="shop-chip${c.key === "all" ? " active" : ""}" data-group="${c.key}" aria-pressed="${c.key === "all"}">${c.label}</button>`)
    .join("");

  if (matrix) {
    matrix.innerHTML =
      `<div class="swap-head" aria-hidden="true"><span>Replace this</span><span>For this job</span><span></span><span>Use this VertKleen</span></div>` +
      REPLACEMENT_MAP.map(swapRow).join("");
  }

  const syncChips = () => {
    chipsBox.querySelectorAll(".shop-chip").forEach((b) => {
      const on = b.dataset.group === state.group;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  };

  const visibleIds = () => {
    let ids = state.sort === "az"
      ? [...CATALOG_ORDER].sort((a, b) => PRODUCTS[a].name.localeCompare(PRODUCTS[b].name))
      : [...CATALOG_ORDER];
    if (state.group !== "all") ids = ids.filter((id) => groupOf(id) === state.group);
    if (state.match) ids = ids.filter((id) => state.match.includes(id));
    return ids;
  };

  const apply = () => {
    const ids = visibleIds();
    grid.innerHTML = ids.map(catalogCard).join("");
    refreshCommerceActions(grid);
    if (countEl) countEl.textContent = `Showing ${ids.length} of ${CATALOG_ORDER.length}`;
    if (emptyEl) emptyEl.hidden = ids.length > 0;
  };

  const reset = () => {
    state.group = "all";
    state.match = null;
    state.sort = "featured";
    if (sortSel) sortSel.value = "featured";
    if (result) result.hidden = true;
    matrix?.querySelectorAll(".swap-row.active").forEach((r) => r.classList.remove("active"));
    syncChips();
    apply();
  };

  chipsBox.addEventListener("click", (e) => {
    const btn = e.target.closest(".shop-chip");
    if (!btn) return;
    state.group = btn.dataset.group;
    syncChips();
    apply();
  });

  sortSel?.addEventListener("change", () => {
    state.sort = sortSel.value;
    apply();
  });

  if (matrix && result) {
    matrix.addEventListener("click", (e) => {
      const row = e.target.closest(".swap-row");
      if (!row) return;
      const data = REPLACEMENT_MAP[+row.dataset.row];
      state.match = data.ids;
      state.group = "all";
      matrix.querySelectorAll(".swap-row").forEach((r) => r.classList.toggle("active", r === row));
      syncChips();
      const links = data.ids.map((id) => `<a href="product.html?id=${id}">${PRODUCTS[id].name}</a>`).join(" · ");
      result.innerHTML =
        `<span class="swap-result-q"><em>Replace</em>${data.legacy}</span>` +
        `<i class="ph ph-arrow-right" aria-hidden="true"></i>` +
        `<span class="swap-result-a"><em>Switch to</em>${links}</span>` +
        `<button type="button" class="swap-clear" id="swapClear">Clear</button>`;
      result.hidden = false;
      apply();
      document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
    });
  }

  result?.addEventListener("click", (e) => {
    if (e.target.closest("#swapClear")) reset();
  });

  emptyEl?.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") reset();
  });

  // Deep link: products.html#cat-water preselects a category (footer + home cards).
  const catHash = (location.hash.match(/^#cat-(.+)$/) || [])[1];
  if (catHash && CATALOG_GROUPS.some((g) => g.key === catHash)) {
    state.group = catHash;
    syncChips();
  }

  apply();
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(apply);

  if (catHash) document.getElementById("catalog")?.scrollIntoView({ behavior: smoothPref(), block: "start" });
}

const SERVICE_CATEGORY_COPY = {
  "Lab Testing — Water Analysis": {
    icon: "ph-drop",
    note: "Water chemistry, tower, closed-loop, pretreatment, and wastewater analysis."
  },
  "Lab Testing — Biological": {
    icon: "ph-test-tube",
    note: "Biological counts, Legionella PCR, and mold/air-quality lab work."
  },
  "Lab Testing — Materials": {
    icon: "ph-magnifying-glass",
    note: "Deposit, corrosion, particle, resin, and material identification."
  },
  "Bid Support": {
    icon: "ph-file-text",
    note: "Specification creation, review, and buyer-side bid interview support."
  },
  "Consulting Services": {
    icon: "ph-compass-tool",
    note: "General consulting, EHSS, investigation, training, and program support."
  },
  "Field Services": {
    icon: "ph-hard-hat",
    note: "On-site sample collection and billable field service time."
  },
  "Water Management Plan": {
    icon: "ph-clipboard-text",
    note: "ASHRAE 188 risk assessment, plan writing, audits, and recertification."
  },
  "Service Packages": {
    icon: "ph-package",
    note: "Bundled sampling, water-management setup, quarterly audit, and recertification packages."
  }
};

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[ch]));
}

function initServiceCatalog() {
  const root = document.querySelector("[data-service-catalog]");
  if (!root) return;

  fetch("data/catalog.seed.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("catalog_seed_unavailable");
      return response.json();
    })
    .then((catalog) => {
      const rows = [
        ...(Array.isArray(catalog?.services) ? catalog.services : []),
        ...(Array.isArray(catalog?.service_packages) ? catalog.service_packages : [])
      ].filter((item) => item?.active !== false);

      const groups = rows.reduce((map, item) => {
        const key = item.category || "Services";
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
        return map;
      }, new Map());

      root.innerHTML = [...groups.entries()].map(([category, items]) => {
        const copy = SERVICE_CATEGORY_COPY[category] || { icon: "ph-briefcase", note: "Quote-confirmed technical service." };
        const sorted = items.slice().sort((a, b) => Number(a.public_price || 0) - Number(b.public_price || 0));
        const minimum = sorted.find((item) => Number.isFinite(Number(item.public_price)));
        const priceText = minimum ? `From ${fmtMoney(Number(minimum.public_price), "USD")}` : "Quoted";
        const preview = sorted.slice(0, 4).map((item) => `
          <li>
            <span>${htmlEscape(item.name)}</span>
            <b>${Number.isFinite(Number(item.public_price)) ? fmtMoney(Number(item.public_price), "USD") : "Quote"}</b>
          </li>
        `).join("");

        return `
          <article class="service-category">
            <div class="service-category-head">
              <i class="ph ${copy.icon}" aria-hidden="true"></i>
              <div>
                <h3>${htmlEscape(category)}</h3>
                <p>${htmlEscape(copy.note)}</p>
              </div>
            </div>
            <div class="service-category-meta">
              <span>${items.length} line ${items.length === 1 ? "item" : "items"}</span>
              <strong>${priceText}</strong>
            </div>
            <ul>${preview}</ul>
          </article>
        `;
      }).join("");
    })
    .catch(() => {
      root.innerHTML = '<p class="muted">Service pricing is available by quote. Contact MASEST for the latest workbook-backed scope.</p>';
    });
}

/* ---------- Before/after slider (drag, keyboard, reduced-motion safe) ----------
   Markup: <div class="ba" data-ba> with .ba-after img, .ba-before > img,
   an input[type=range].ba-range, and a .ba-handle. The range drives reveal. */
function initBeforeAfter() {
  document.querySelectorAll("[data-ba]").forEach(ba => {
    const range = ba.querySelector(".ba-range");
    const handle = ba.querySelector(".ba-handle");
    if (!range) return;
    const apply = () => {
      const v = range.value;
      ba.style.setProperty("--pos", v + "%");
      if (handle) handle.style.left = v + "%";
      range.setAttribute("aria-valuenow", v);
    };
    range.addEventListener("input", apply);
    apply();
  });
}

/* ---------- Quote form ----------
   No backend yet: submission opens a prefilled email to the sales
   team (mailto handoff) and says so honestly. The form stays
   recoverable: an Edit button returns the user to their answers. */
const SALES_EMAIL = "matthew@masest.co";

function smoothPref() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

async function submitRequest(form, data) {
  const endpoint = form.dataset.endpoint;
  if (!endpoint) return { fallbackOnly: true };
  // Abort a hung endpoint so the user is never stranded on a disabled button.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Accept": "application/json" },
      body: data,
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error("Request failed");
    return { fallbackOnly: false };
  } finally {
    clearTimeout(timer);
  }
}

function initProofFilters() {
  const filters = [...document.querySelectorAll("[data-proof-filter]")];
  const cards = [...document.querySelectorAll("[data-proof-card]")];
  if (!filters.length || !cards.length) return;

  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const kind = filter.dataset.proofFilter;
      filters.forEach((item) => {
        const active = item === filter;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", active ? "true" : "false");
      });
      cards.forEach((card) => {
        const visible = kind === "all" || card.dataset.proofKind === kind;
        card.hidden = !visible;
      });
    });
  });
}

function initQuoteForm() {
  const form = document.getElementById("quoteForm");
  if (!form) return;
  const params = new URLSearchParams(location.search);

  // Prefill from URL params (?product=, ?doc=)
  const pre = params.get("product");
  if (pre) {
    const sel = form.querySelector('[name="product"]');
    if (sel) [...sel.options].forEach(o => { if (o.value === pre || o.text === pre) sel.value = o.value || o.text; });
  }
  const doc = params.get("doc");
  if (doc) {
    const msg = form.querySelector('[name="message"]');
    const type = form.querySelector('[name="type"]');
    if (msg && !msg.value) msg.value = "Please send the " + doc + (pre ? " for " + pre : "") + ".";
    if (type) type.value = "technical";
  }
  const messageParam = params.get("message");
  if (messageParam) {
    const msg = form.querySelector('[name="message"]');
    if (msg && !msg.value) msg.value = messageParam;
  }
  const emailParam = params.get("email");
  if (emailParam) {
    const email = form.querySelector('#fEmail[name="email"]');
    if (email && !email.value) email.value = emailParam;
  }
  const indParam = params.get("industry");
  if (indParam) {
    const isel = form.querySelector('[name="industry"]');
    if (isel) [...isel.options].forEach(o => { if (o.value === indParam || o.text === indParam) isel.value = o.value || o.text; });
  }

  // ── Adaptive request type: the chooser swaps which field set is required/shown ──
  const typeInput = form.querySelector('[name="type"]');
  const groups = [...form.querySelectorAll("[data-intent-group]")];
  const choices = [...form.querySelectorAll(".cta-choice")];
  const INTENTS = ["quote", "audit", "sample", "distributor"];
  function applyIntent(intent) {
    if (!INTENTS.includes(intent)) intent = "quote";
    if (typeInput) typeInput.value = intent;
    choices.forEach(b => {
      const on = b.dataset.intent === intent;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    groups.forEach(g => {
      const on = g.dataset.intentGroup === intent;
      g.hidden = !on;
      g.querySelectorAll("[data-req]").forEach(el => { el.required = on; if (!on) setErr(el, ""); });
    });
  }
  choices.forEach(b => b.addEventListener("click", () => applyIntent(b.dataset.intent)));
  // Initial intent: a chooser type (?type or a prior set value) wins; otherwise default to quote
  // while preserving non-chooser types (technical/government) on the hidden input.
  const reqType = params.get("type") || (typeInput ? typeInput.value : "");
  if (INTENTS.includes(reqType)) applyIntent(reqType);
  else { applyIntent("quote"); if (typeInput && reqType) typeInput.value = reqType; }

  // Inline validation: per-field messages instead of browser bubbles only
  form.setAttribute("novalidate", "");
  function setErr(el, text) {
    const field = el.closest(".field");
    if (!field) return;
    let err = field.querySelector(".field-err");
    if (!text) { if (err) err.remove(); el.removeAttribute("aria-invalid"); return; }
    if (!err) {
      err = document.createElement("span");
      err.className = "field-err";
      err.id = el.id + "Err";
      field.append(err);
    }
    err.textContent = text;
    el.setAttribute("aria-invalid", "true");
    el.setAttribute("aria-describedby", err.id);
  }
  function validate() {
    let firstBad = null;
    form.querySelectorAll("input, select, textarea").forEach(el => {
      if (el.closest("[data-intent-group][hidden]")) { setErr(el, ""); return; }
      let text = "";
      if (el.required && !el.value.trim()) text = "This field is required.";
      else if (el.type === "email" && el.value && !el.checkValidity()) text = "Enter a valid email address.";
      setErr(el, text);
      if (text && !firstBad) firstBad = el;
    });
    const sampleGroup = form.querySelector('[data-intent-group="sample"]');
    if (sampleGroup && !sampleGroup.hidden) {
      const picks = sampleGroup.querySelectorAll('input[name="samples"]:checked').length;
      const hint = document.getElementById("sampleHint");
      const okPicks = picks >= 3 && picks <= 5;
      if (hint) {
        hint.textContent = okPicks ? "3 to 5 products selected." : "Select 3 to 5 products (you have " + picks + ").";
        hint.classList.toggle("err", !okPicks);
      }
      if (!okPicks && !firstBad) firstBad = sampleGroup.querySelector('input[name="samples"]');
    }
    return firstBad;
  }
  form.addEventListener("input", e => setErr(e.target, ""));

  form.addEventListener("submit", e => {
    e.preventDefault();
    const bad = validate();
    if (bad) { bad.focus(); bad.scrollIntoView({ behavior: smoothPref(), block: "center" }); return; }

    const data = new FormData(form);
    const labels = {
      name: "Name", company: "Company", email: "Email", phone: "Phone", type: "Request type",
      product: "Product", industry: "Industry", volume: "Volume", location: "Location",
      timeline: "Timeline", system: "System / asset", audit_timeframe: "Preferred timeframe",
      samples: "Sample products", ship_to: "Ship-to address", company_type: "Company type",
      territory: "Territory / region", message: "Notes"
    };
    const lines = [];
    for (const [k, v] of data.entries()) if (String(v).trim()) lines.push((labels[k] || k) + ": " + v);
    const reqLabel = (data.get("type") || "quote").replace(/^./, c => c.toUpperCase());
    const subject = reqLabel + " request: " + (data.get("product") || data.get("industry") || "VertKleen") + " (" + (data.get("company") || data.get("name")) + ")";
    const mailto = "mailto:" + SALES_EMAIL +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(lines.join("\n"));
    const fallback = document.getElementById("mailtoFallback");
    if (fallback) fallback.href = mailto;

    const submit = form.querySelector('[type="submit"]');
    const submitLabel = submit ? submit.textContent : "";
    if (submit) { submit.disabled = true; submit.textContent = "Sending…"; }

    // One outcome panel for every ending. accepted=true → the endpoint took it;
    // accepted=false → no endpoint or the request failed/timed out, so the
    // prepared email is the real path. No alert, no form-plus-panel double view.
    const showOutcome = (accepted) => {
      form.style.display = "none";
      const ok = document.getElementById("formSuccess");
      const title = document.getElementById("formSuccessTitle");
      const copy = document.getElementById("formSuccessCopy");
      const mail = document.getElementById("mailtoFallback");
      if (title) title.textContent = accepted ? "Request received." : "Almost there: send the request.";
      if (copy) {
        copy.innerHTML = accepted
          ? "MASEST has received your request. A sales or technical contact will review the details and follow up directly."
          : 'We couldn’t submit automatically. Use the prepared email link below, then hit send in your email app. If your device blocks email links, email <a href="mailto:matthew@masest.co" style="font-weight:700;color:var(--accent-ink)">matthew@masest.co</a> or call <a href="tel:+18134063852" style="font-weight:700;color:var(--accent-ink)">(813) 406-3852</a>.';
      }
      if (mail) mail.hidden = accepted;
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
      if (title) title.focus();
      const edit = document.getElementById("formEdit");
      if (edit) edit.onclick = () => {
        ok.style.display = "none";
        form.style.display = "";
        if (submit) { submit.disabled = false; submit.textContent = submitLabel; }
        form.querySelector("input, select, textarea").focus();
      };
    };

    submitRequest(form, data)
      .then((result) => showOutcome(!result.fallbackOnly))
      .catch(() => showOutcome(false));
  });
}

function initIndustryProducts() {
  document.querySelectorAll("[data-ind-products]").forEach((box) => {
    const ids = (box.dataset.indProducts || "").split(/\s+/).filter((id) => PRODUCTS[id]);
    if (!ids.length) return;
    box.innerHTML = ids.map((id) => productCard(id)).join("");
    // Industry pages live one level deep; rewrite relative product assets and
    // links to resolve from /industries/.
    box.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (h && !/^(https?:|mailto:|tel:|#|\.\.\/|\/)/.test(h)) a.setAttribute("href", "../" + h);
    });
    box.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      if (src && !/^(https?:|data:|#|\.\.\/|\/)/.test(src)) img.setAttribute("src", "../" + src);
    });
  });
}

// Click any content photo to view it full-size. Document previews (.doc-link) open their
// PDF instead, and before/after sliders ([data-ba]) keep their drag behavior — both excluded.
function initLightbox() {
  const ZOOM_SCOPE = ".proof-card, .case-card, .ind-gallery, figure.photo";
  const dlg = document.createElement("dialog");
  dlg.id = "lightbox";
  dlg.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close">×</button>' +
    '<figure class="lb-fig"><img class="lb-img" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt=""><figcaption class="lb-cap"></figcaption></figure>';
  document.body.appendChild(dlg);
  const lbImg = dlg.querySelector(".lb-img");
  const lbCap = dlg.querySelector(".lb-cap");
  const close = () => { if (dlg.open) dlg.close(); };

  document.addEventListener("click", (e) => {
    const img = e.target.closest("img");
    if (!img || !img.closest(ZOOM_SCOPE)) return;
    if (img.closest(".doc-link, [data-ba]")) return; // docs open PDF; sliders drag
    e.preventDefault();
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || "";
    lbCap.textContent = img.alt || "";
    if (typeof dlg.showModal === "function") dlg.showModal();
  });

  dlg.querySelector(".lb-close").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); }); // backdrop
  dlg.addEventListener("close", () => { lbImg.removeAttribute("src"); });
}

function initImageFallbacks() {
  const frameSelector = ".catalog-shelf-media, .product-media-card, .proof-card figure, .case-card figure, .ind-gallery figure, figure.photo, .proof-thumb, .row-thumb";
  const labelFor = (img) => {
    const figcaption = img.closest("figure")?.querySelector("figcaption")?.textContent?.trim();
    return figcaption || img.getAttribute("alt") || "Visual reference pending";
  };
  const showFallback = (img) => {
    const frame = img.closest(frameSelector);
    if (!frame || frame.classList.contains("media-fallback")) return;
    frame.classList.add("media-fallback");
    img.hidden = true;
    const label = document.createElement("span");
    label.className = "media-fallback-label";
    label.textContent = labelFor(img);
    frame.appendChild(label);
  };
  document.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => showFallback(img), { once: true });
    if (img.complete && img.naturalWidth === 0) showFallback(img);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initIndustryProducts();
  initImageFallbacks();
  initBeforeAfter();
  initProofFilters();
  initResponsiveTables();
  initReveal();
  initLightbox();
  initCartButtons();
  if (!isLocalStaticCommerceSuppressed()) loadCommerceCatalog().then(() => refreshCommerceActions(document));
  initShop();
  initServiceCatalog();
});
