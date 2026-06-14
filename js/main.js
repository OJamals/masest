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
  crnsf60: {
    name: "VertKleen CR NSF 60",
    cat: "alkaline",
    replaces: "Replaces caustic soda in NSF/ANSI 60 water-treatment use",
    hmis: "0-0-0",
    icon: "ph-seal-check",
    tag: "NSF/ANSI 60 caustic replacement and pH adjuster for water-treatment programs.",
    desc: "The NSF/ANSI 60 water-treatment version of VertKleen CR, used where caustic replacement needs documented drinking-water-system chemistry.",
    uses: [
      "pH adjustment in water-treatment programs",
      "Cooling tower and closed-loop treatment support",
      "District, campus, and municipal facility programs",
      "Documentation-heavy procurement environments"
    ],
    specs: [
      ["ph-shield-check", "HMIS 0-0-0", "Zero health, flammability, and reactivity hazard rating"],
      ["ph-seal-check", "NSF/ANSI 60", "For water-treatment chemistry documentation"],
      ["ph-atom", "Caustic replacement", "Replaces sodium and potassium hydroxide functions"],
      ["ph-clipboard-text", "Program documentation", "Fits ASHRAE 188 and procurement documentation workflows"]
    ],
    docs: ["Safety Data Sheet (SDS)", "NSF/ANSI 60 Certification", "Cooling Tower Program Brochure"]
  },
  glycols: {
    name: "VertKleen Glycols",
    cat: "water",
    replaces: "Supplies inhibited PG and EG glycol programs",
    hmis: "Program item",
 icon: "ph-thermometer-cold",
 image: "img/products/glycols-studio.webp",
    tag: "Florida-sourced inhibited propylene and ethylene glycol for facility water loops and district programs.",
    desc: "A glycol supply program for inhibited PG and EG concentrates and ready-to-use blends, priced for local pickup and facility maintenance programs.",
    uses: [
      "Chilled-water and hydronic loop freeze protection",
      "School district and campus maintenance purchasing",
      "Propylene glycol and ethylene glycol supply",
      "Local pickup in Tampa, Lakeland, Cocoa, and Melbourne programs"
    ],
    specs: [
      ["ph-map-pin", "Florida sourced", "Supplied through Florida-based distributors with local pickup"],
      ["ph-currency-dollar", "Bid-ready list", "Brevard Schools list pricing source available"],
      ["ph-package", "Multiple packs", "5-gal pails and 55-gal drums"],
      ["ph-clipboard-text", "Program fit", "Pairs with cooling-tower and water-treatment scopes"]
    ],
    docs: ["Glycol Price List", "Technical Data Sheet (TDS)", "Program Quote Worksheet"]
  }
};

const CATALOG_ORDER = [
  "hcr", "descaler", "crs", "cr", "crhd", "neutral", "multiwash",
  "watersafe60", "crnsf60", "purgo", "dbnpa", "glycols", "lam3", "alumibrite", "torque"
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
  crnsf60: {
    job: "Water-treatment pH adjustment",
    summary: "A documented caustic replacement for NSF/ANSI 60 water-treatment programs and procurement-heavy facilities.",
    fits: ["pH adjustment", "cooling towers", "municipal", "campuses"],
    proof: "NSF/ANSI 60 certificate and program documents"
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
  glycols: {
    job: "Freeze-protection programs",
    summary: "Florida-sourced inhibited propylene and ethylene glycol for hydronic loops and district maintenance.",
    fits: ["hydronic loops", "schools", "healthcare", "local pickup"],
    proof: "Price list and quote worksheet"
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
    ["products.html", "Products"],
    ["programs.html", "Programs"],
    ["proof.html", "Proof"],
    ["industries.html", "Industries"]
  ];
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
        ${links.map(([href, label]) =>
          `<a href="${root}${href}"${page === href ? ' class="active"' : ""}>${label}</a>`).join("")}
      </nav>
      <div style="display:flex;align-items:center;gap:12px">
        <a class="nav-cta" href="${root}contact.html">Request a Quote</a>
        <button class="nav-burger" id="navBurger" aria-label="Menu" aria-expanded="false" aria-controls="navLinks"><span></span><span></span><span></span></button>
      </div>
    </div>`;
  document.body.prepend(nav);
  document.body.prepend(skip);
  const burger = document.getElementById("navBurger");
  const navLinks = document.getElementById("navLinks");
  const navCta = nav.querySelector(".nav-cta");
  const syncNavCtaLabel = () => {
    navCta.textContent = window.matchMedia("(max-width: 360px)").matches ? "Quote" : "Request a Quote";
  };
  syncNavCtaLabel();
  window.addEventListener("resize", syncNavCtaLabel);
  const setMenuOpen = open => {
    navLinks.classList.toggle("open", open);
    document.body.classList.toggle("nav-open", open);
    burger.setAttribute("aria-expanded", open ? "true" : "false");
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
          <a class="btn btn-primary foot-quote" href="${root}contact.html?type=quote">Quote</a>
        </div>
        <div class="foot-secondary">
          <div class="foot-title">Product Categories</div>
          <a href="${root}products.html#descale">Rust &amp; Scale</a>
          <a href="${root}products.html#degrease">Grease &amp; Grime</a>
          <a href="${root}products.html#water">Water Treatment</a>
          <a href="${root}products.html#exterior">Exterior &amp; Specialty</a>
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
      <div class="foot-bottom">
        <span>&copy; ${new Date().getFullYear()} MASEST Consulting LLC. All rights reserved.</span>
        <span>VertKleen, SynTec and SynClean are trademarks of MASEST Consulting LLC.</span>
      </div>
    </div>`;
  document.body.append(foot);
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
        <a class="btn btn-ink btn-sm" href="product.html?id=${id}">Pictures, Stats, Proof</a>
      </div>
  </div>`;
}

function productShelfCard(id) {
  const p = PRODUCTS[id];
  const catalog = PRODUCT_CATALOG_COPY[id] || {};
  if (!p) return "";
  const media = p.image
    ? `<img src="${p.image}" alt="${p.name} product photo" loading="lazy">`
    : `<i class="ph ${p.icon}" aria-hidden="true"></i>`;
  return `
    <a class="catalog-shelf-card" href="product.html?id=${id}">
      <span class="catalog-shelf-media">${media}</span>
      <span class="catalog-shelf-copy">
        <b>${p.name}</b>
        <em>${catalog.job || p.replaces}</em>
      </span>
    </a>`;
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
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Accept": "application/json" },
    body: data
  });
  if (!res.ok) throw new Error("Request failed");
  return { fallbackOnly: false };
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
    if (submit) submit.disabled = true;
    submitRequest(form, data).then((result) => {
      form.style.display = "none";
      const ok = document.getElementById("formSuccess");
      const title = document.getElementById("formSuccessTitle");
      const copy = document.getElementById("formSuccessCopy");
      const mail = document.getElementById("mailtoFallback");
      const accepted = !result.fallbackOnly;
      if (title) title.textContent = accepted ? "Request received." : "Almost there: send the request.";
      if (copy) {
        copy.innerHTML = accepted
          ? "MASEST has received your request. A sales or technical contact will review the details and follow up directly."
          : 'Use the prepared email link below, then hit send in your email app. If your device blocks email links, email <a href="mailto:matthew@masest.co" style="font-weight:700;color:var(--accent-ink)">matthew@masest.co</a> or call <a href="tel:+18134063852" style="font-weight:700;color:var(--accent-ink)">(813) 406-3852</a>.';
      }
      if (mail) mail.style.display = accepted ? "none" : "";
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
      const edit = document.getElementById("formEdit");
      if (edit) edit.onclick = () => {
        ok.style.display = "none";
        form.style.display = "";
        if (submit) submit.disabled = false;
        form.querySelector("input, select, textarea").focus();
      };
    }).catch(() => {
      if (submit) submit.disabled = false;
      alert("We could not send this request automatically. Please use the prepared email link below.");
      const ok = document.getElementById("formSuccess");
      ok.style.display = "block";
      ok.scrollIntoView({ behavior: smoothPref(), block: "center" });
    });
  });
}

function initIndustryProducts() {
  document.querySelectorAll("[data-ind-products]").forEach((box) => {
    const ids = (box.dataset.indProducts || "").split(/\s+/).filter((id) => PRODUCTS[id]);
    if (!ids.length) return;
    box.innerHTML = ids.map((id) => productCard(id)).join("");
    // Industry pages live one level deep; rewrite product/quote links to resolve from /industries/.
    box.querySelectorAll("a[href]").forEach((a) => {
      const h = a.getAttribute("href");
      if (h && !/^(https?:|mailto:|tel:|#|\.\.\/|\/)/.test(h)) a.setAttribute("href", "../" + h);
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
    '<figure class="lb-fig"><img class="lb-img" alt=""><figcaption class="lb-cap"></figcaption></figure>';
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

function initRailControls() {
  document.querySelectorAll("[data-rail-prev], [data-rail-next]").forEach((button) => {
    const targetId = button.dataset.railPrev || button.dataset.railNext;
    const rail = document.getElementById(targetId);
    if (!rail) return;
    const dir = button.dataset.railNext ? 1 : -1;
    button.addEventListener("click", () => {
      const first = rail.firstElementChild;
      const step = first ? first.getBoundingClientRect().width + 16 : rail.clientWidth * 0.8;
      rail.scrollBy({ left: dir * step, behavior: smoothPref() });
      rail.focus({ preventScroll: true });
    });
  });
}

function initCatalogJumps() {
  const offset = () => {
    const nav = document.querySelector(".site-header");
    return (nav?.getBoundingClientRect().height || 64) + 24;
  };

  document.querySelectorAll(".catalog-jumpbar a[href^='#']").forEach((link) => {
    link.addEventListener("click", (event) => {
      const target = document.querySelector(link.getAttribute("href"));
      if (!target) return;
      event.preventDefault();
      window.scrollTo({
        top: target.getBoundingClientRect().top + window.scrollY - offset(),
        behavior: smoothPref()
      });
      history.replaceState(null, "", link.getAttribute("href"));
    });
  });
}

function initProductDisclosures() {
  document.querySelectorAll(".matrix-disclosure").forEach((details) => {
    const action = details.querySelector("summary strong");
    if (!action) return;
    const sync = () => {
      action.textContent = details.open ? "Close matrix" : "Open matrix";
    };
    details.addEventListener("toggle", sync);
    sync();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  initQuoteForm();
  initIndustryProducts();
  initBeforeAfter();
  initProofFilters();
  initResponsiveTables();
  initReveal();
  initLightbox();
  initRailControls();
  initCatalogJumps();
  initProductDisclosures();
});
