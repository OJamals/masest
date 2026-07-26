const PRODUCT_FALLBACK_IMAGE = "img/products/masest-poster-transparent.png";

export const PRODUCTS = {
  hcr: {
    name: "VertKleen CIP HCR",
    cat: "acid",
    replaces: "Compared with brewery acid-cleaning and beer-stone programs",
    hmis: "0-0-0",
    icon: "ph-flask",
    image: "img/products/cip-hcr-studio.webp",
    tag: "Synthetic-acid beer-stone removal for brewery CIP without making mineral acid the default answer.",
    desc: "A synthetic-acid CIP step for beer stone, brewery tanks, lines, and heat exchangers. Confirm vapor controls, materials, and use conditions from the current SDS and approved procedure.",
    uses: [
      "Beer-stone removal in brewery CIP",
      "Tank, keg, and line acid-wash steps",
      "316 stainless and PVC cleaning workflows",
      "Heat-exchanger plate descaling"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-atom", "Controlled acid step", "Confirm concentration, dwell, and compatibility in a witnessed trial"],
      ["ph-leaf", "Wastewater planning", "Validate pH, loading, and discharge limits for the site"],
      ["ph-truck", "Freight review", "Confirm current transport classification before shipment"]
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
    tag: "Synthetic-acid option for calcium, scale, and rust in HVAC and water-side maintenance.",
    desc: "A synthetic-acid option for HVAC descaling, calcium, scale, and rust removal. Confirm vapor controls and use conditions from the current SDS; bulk procurement routes through freight review.",
    uses: [
      "HVAC coils and water-side descaling",
      "Calcium, scale, and rust removal",
      "Stainless and gasket cleaning after compatibility testing",
      "Bulk HVAC and facility programs"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-truck", "Tote freight", "Bulk orders route through quote review before release"],
      ["ph-clipboard-text", "Program pricing", "Built for procurement teams buying at committed volume"],
      ["ph-buildings", "Account fit", "Best for facilities, contractors, and multi-site programs"]
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
    tag: "Controlled alkaline brewery CIP for lines, kegs, tanks, krausen, and organic soil.",
    desc: "An alkaline step for brewery CIP. Set concentration, temperature, circulation, rinse, and release criteria through the current SDS and a witnessed site trial.",
    uses: [
      "Brewery lines, kegs, and tanks",
      "Krausen and organic-soil removal",
      "Hot-circulation alkaline wash steps",
      "316 stainless and PVC CIP systems"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and material compatibility before use"],
      ["ph-seal-check", "Controlled docs", "NSF/ANSI 60 certificate status must be confirmed through document request"],
      ["ph-atom", "Controlled alkaline step", "Compare against the current caustic process in a witnessed trial"],
      ["ph-leaf", "Discharge planning", "Wastewater path reviewed by site and label conditions"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-cr-sds.pdf" },
      "NSF/ANSI 60 Certificate-Status Request"
    ]
  },
  neutral: {
    name: "VertKleen Neutral",
    cat: "alkaline",
    replaces: "Compared with caustic and solvent degreasers",
    hmis: "0-0-0",
 icon: "ph-drop",
 image: "img/products/neutral-studio.webp",
    tag: "Degreasing for surfaces, seals, finishes, and equipment owners that do not want caustic as the default answer.",
    desc: "A neutral pH-7 degreaser for broad facility cleaning where solvent odor, flammability, or aggressive caustic chemistry would complicate the job.",
    uses: [
      "Heavy equipment and machinery degreasing",
      "Marine, oil and gas, and aviation surfaces",
      "Sensitive metals and seals after a compatibility test",
      "Facility and fleet maintenance"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-scales", "True pH 7", "Neutral chemistry for sensitive equipment and seals"],
      ["ph-atom", "Controlled degreasing", "Confirm dilution, dwell, agitation, and endpoint in a site trial"],
      ["ph-leaf", "Wastewater planning", "Confirm the discharge path and site limits before release"]
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
    tag: "Facility cleaner for wet zones, drains, concrete, glass, exteriors, and pressure-washing programs.",
    desc: "A multi-surface cleaner for facilities, drains, concrete, and exterior washing. Occupied-site use requires the current SDS and an approved work-area plan.",
    uses: [
      "Concrete drains and hardscape cleaning",
      "Pressure-washing programs",
      "Facility, warehouse, and fulfillment-center maintenance",
      "Educational and healthcare environments"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-atom", "Controlled cleaning", "Confirm dilution, dwell, agitation, and endpoint in a site trial"],
      ["ph-leaf", "Wastewater planning", "Confirm pH, loading, and discharge limits before release"],
      ["ph-truck", "Freight review", "Confirm current transport classification before shipment"]
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
    tag: "Water-treatment candidate for towers and closed loops, subject to site engineering and regulatory review.",
    desc: "A water-treatment program component. Exact composition, scale or corrosion performance, potable-water use, and certification claims require current technical and regulatory records.",
    uses: [
      "Cooling tower scale and corrosion control",
      "Closed-loop and chilled-water systems",
      "ASHRAE 188 and Legionella risk-management programs",
      "Campus, hospital, and government facilities"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review each program component and task control before use"],
      ["ph-seal-check", "Controlled docs", "NSF/ANSI 60 certificate status must be confirmed through document request"],
      ["ph-prohibit", "Composition review", "Confirm formulation and prohibited constituents from approved technical records"],
      ["ph-clipboard-text", "Documentation by site", "Integrate only through the site's water-management program"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/watersafe60-sds.pdf" },
      { label: "Titration / Sigma Test Data", file: "docs/sds/watersafe60-titration-test.pdf" },
      "NSF/ANSI 60 Certificate-Status Request"
    ]
  },
  purgo: {
    name: "Purgo",
    cat: "water",
    replaces: "Evaluated against existing oxidizing and non-oxidizing water-treatment programs",
    hmis: "0-0-0",
 icon: "ph-shield-plus",
    image: "img/products/purgo-studio.webp",
    tag: "Water-treatment and odor-control candidate with regulatory claims held behind approved records.",
    desc: "A water-treatment and odor-control program component. Exact antimicrobial, minimum-risk, and occupied-site use claims require an approved label and regulatory file.",
    uses: [
      "Water-treatment and odor-control evaluation",
      "ASHRAE 188 documentation support when paired with testing and a water management program",
      "Occupied-campus water treatment",
      "Claim-controlled cleaning workflows"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-seal-check", "Claim boundary", "Do not assert antimicrobial efficacy or exemption without approved records"],
      ["ph-buildings", "Occupied-site fit", "Built for routine maintenance programs"],
      ["ph-clipboard-text", "Confirm against docs", "Exact use claims confirmed against the label and program documentation"]
    ],
    docs: [
      { label: "Safety Data Sheet (SDS)", file: "docs/sds/vertkleen-purgo-sds.pdf" },
      { label: "Bacterial Persistence Test", file: "docs/sds/vertkleen-purgo-bacterial-persistence-test.pdf" },
      "Regulatory Status Documentation"
    ]
  },
  dbnpa: {
    name: "DBNPA Tablet",
    cat: "water",
    replaces: "Replaces glutaraldehyde 50%",
    hmis: "Low hazard",
 icon: "ph-pill",
 image: "img/products/dbnpa-studio.webp",
    tag: "Document-gated controlled-release program component.",
    desc: "A cooling-tower program component available only after label, SDS, registration, dose, and site-engineering review.",
    uses: [
      "Site-engineered tower treatment",
      "Documented cooling-tower programs",
      "Controlled-release dosing after technical review"
    ],
    specs: [
      ["ph-arrow-down", "Engineered dose", "Set only through approved label and site water-management records"],
      ["ph-seal-check", "Document-gated", "Registration and label files required before public claim"],
      ["ph-fire-simple", "Current SDS", "Review hazards and comparison chemistry before program approval"],
      ["ph-info", "Program note", "Review the current SDS and task controls for every program component."]
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
    tag: "For grease that laughs at light-duty cleaners: floors, forklifts, parts washers, kitchens, drains, engine bays, and warehouse equipment.",
    desc: "A low-foam alkaline degreaser for forklifts, workshops, kitchens, floors, parts, and equipment. Confirm dilution, compatibility, wastewater handling, and endpoint in a site trial.",
    uses: [
      "Warehouse and plant floors, forklifts, and engine bays",
      "Grease traps, drains, and commercial kitchen hoods",
      "Heavy oil and hydraulic-fluid degreasing",
      "Witnessed comparison against the site's current degreaser"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-gauge", "Controlled dilution", "Set from soil load, equipment, and a witnessed comparison"],
      ["ph-seal-check", "Equipment review", "Confirm OEM and substrate requirements before use"],
      ["ph-truck", "Freight review", "Confirm current transport classification before shipment"]
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
    tag: "Controlled descaling for coils, towers, pumps, and refrigeration loops.",
    desc: "A descaling option for calcium, rust, and scale in coils, cooling towers, plumbing, and fire-pump components. Application fit depends on deposit type, metallurgy, system isolation, circulation equipment, and rinse verification.",
    uses: [
      "Aluminum and copper coil descaling",
      "Cooling towers, plumbing, and ammonia coils",
      "Fire-pump and solenoid descaling",
      "Isolated cooling and heat-transfer circuits after site and OEM review"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-trend-down", "Comparison required", "Confirm corrosion and cleaning performance in a documented material test"],
      ["ph-snowflake", "Metal compatibility", "Test the exact aluminum, copper, steel, stainless, coatings, and seals"],
      ["ph-drop", "Discharge planning", "Characterize spent solution and confirm site rules"]
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
    tag: "Put the shine back without bringing hydrofluoric or hydrochloric acid into the bay.",
    desc: "A synthetic-acid aluminum brightener that restores wheels, trim, and marine aluminum without hydrofluoric or hydrochloric acid. Source docs report an Acid Brightening Index of 90.1 versus HCl at 86.3.",
    uses: [
      "Wheels, trim, and aluminum restoration",
      "Fleet, RV, and marine aluminum",
      "Detailing and dealership reconditioning",
      "Field-proven on a commercial tourist airboat"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and substrate controls before use"],
      ["ph-atom", "Synthetic acid", "SynTech brightening without the burn and fume risk"],
      ["ph-chart-line-up", "Brightening Index 90.1", "Outperformed hydrochloric acid at 86.3 in VertKleen testing"],
      ["ph-leaf", "Wastewater planning", "Confirm capture and discharge rules for the site"]
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
    tag: "Vehicle wash and wax in one process for operators who do not want three bottles for one finish.",
    desc: "A combined wash-and-finish-care candidate for vehicles, fleet, RV, and marine surfaces. Confirm finish compatibility and acceptance criteria in a witnessed trial.",
    uses: [
      "Vehicle, fleet, and RV wash and wax",
      "Marine and boat exteriors",
      "Dealership and detailing programs",
      "Yellowfin field-context photos, verification incomplete"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-sparkle", "Combined process", "Evaluate cleaning and finish care against the site's current steps"],
      ["ph-seal-check", "Finish-care support", "Product fit reviewed against finish-care requirements"],
      ["ph-leaf", "Wastewater planning", "Confirm capture and discharge rules for the site"]
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
    tag: "Spray-and-leave treatment for lichen, algae, moss, mold, and mildew stains where dwell time can do the work.",
    desc: "A neutral, spray-and-walk-away treatment that clears lichen, algae, moss, mold, and mildew from roofs, pavers, stucco, siding, and concrete without bleach; follow label directions around landscaping.",
    uses: [
      "Roofs, siding, stucco, and pavers",
      "Concrete, walkways, and exterior walls",
      "Pond and fountain algae",
      "Field-proven clearing mildew from a painted column over two weeks"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and stain-treatment controls before use"],
      ["ph-plant", "Label-directed exterior use", "Follow label directions around landscaping and animals"],
      ["ph-timer", "Spray and walk away", "Keeps working up to a month; reapply about every six months"],
      ["ph-leaf", "Controlled stain removal", "Use SDS precautions and verify substrate compatibility"]
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
    tag: "A real source-label reference for calcium, rust, and scale, routed carefully until SKU ownership is confirmed.",
    desc: "CRS is a descaler-family label for rust, calcium, scale, and water-side buildup. It's sold under the VertKleen Descaler catalog listing for now.",
    uses: [
      "Underbody and equipment rust removal",
      "HVAC coils and cooling towers",
      "Water lines, fixtures, and scale-prone plumbing",
      "Dealership and facility maintenance programs"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-drop-half", "Acid-cleaning candidate", "Compare against the current process in a controlled trial"],
      ["ph-waves", "Water-side scale", "Targets calcium, rust, and mineral buildup"],
      ["ph-leaf", "Procedure required", "Request approved concentration and rinse guidance before use"]
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
    tag: "CR HD muscle with the foam turned down for scrubbers, parts washers, and recirculating systems.",
    desc: "A low-foam heavy-duty degreaser built for automatic scrubbers, parts washers, and recirculating wash systems where foam control matters.",
    uses: [
      "Automatic floor scrubbers and machine wash",
      "Parts washers and recirculating wash systems",
      "Industrial degreasing where foam must stay low",
      "Heavy soil and grease on equipment and floors"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and equipment controls before use"],
      ["ph-drop", "Low-foam formula", "Built for machine wash and recirculating systems"],
      ["ph-atom", "Controlled degreasing", "Compare cleaning, foam, and rinse performance in the actual equipment"],
      ["ph-truck", "Freight review", "Confirm current transport classification before shipment"]
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
    tag: "Controlled alkaline cleaning for grease, organic buildup, drains, coils, and facility maintenance.",
    desc: "An alkaline cleaner for HVAC and facility work, including drains, grease, organic buildup, and controlled equipment cleaning.",
    uses: [
      "HVAC and facility drain cleaning",
      "Grease and organic-buildup removal",
      "Coils, equipment, and general maintenance"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and material compatibility before use"],
      ["ph-drop-half", "Alkaline-cleaning candidate", "Compare against the current process in a controlled trial"],
      ["ph-atom", "Controlled application", "Confirm concentration, dwell, and endpoint in a site trial"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  sar: {
    name: "VertKleen SAR",
    cat: "acid",
    replaces: "Evaluated for specialty and blended-acid programs",
    hmis: "0-0-0",
    icon: "ph-wrench",
    image: "img/products/sar-studio.webp",
    tag: "A quote-reviewed specialty chemistry candidate for targeted descaling and water-side work.",
    desc: "A specialty formulation for targeted descaling and water-side applications. Availability remains case-by-case while technical, regulatory, and application records are completed.",
    uses: [
      "Specialty descaling and acid-cleaning jobs",
      "Water-side scale and mineral removal",
      "Applications needing a tuned descaling procedure"
    ],
    specs: [
      ["ph-shield-check", "Current SDS", "Review hazard classifications and task controls before use"],
      ["ph-drop-half", "Controlled descaling", "Compare against the current process in a documented trial"],
      ["ph-waves", "Water-side scale", "Calcium, rust, and mineral buildup"]
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
    tag: "Florida-sourced inhibited propylene glycol concentrate for closed-loop heat-transfer and freeze-protection programs.",
    desc: "An inhibited propylene glycol concentrate for commercial HVAC, hydronic, and process-loop freeze protection. The Brevard Schools price list emphasizes local Florida pickup, low freight, and short lead times.",
    uses: ["Closed-loop HVAC systems", "Hydronic freeze protection", "Process heat-transfer loops"],
    specs: [
      ["ph-drop", "Propylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums quoted with freight"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  pg50: {
    name: "PG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% propylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    tag: "Premixed inhibited 50% propylene glycol for maintenance teams that do not want field mixing to become the job.",
    desc: "A ready-to-use inhibited 50% propylene glycol blend for HVAC and hydronic loop service. We confirm loop compatibility and supply before rollout.",
    uses: ["Closed-loop HVAC systems", "Hydronic loop top-offs", "Facility freeze-protection maintenance"],
    specs: [
      ["ph-drop", "PG 50 blend", "Premixed propylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums quoted with freight"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg100: {
    name: "EG inhibited 100% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    tag: "Inhibited ethylene glycol concentrate for industrial heat-transfer loops that need corrosion protection and local supply.",
    desc: "An inhibited ethylene glycol concentrate for industrial loop fill, freeze protection, and heat-transfer programs. We confirm inhibitor and loop compatibility.",
    uses: ["Industrial heat-transfer loops", "Closed-loop freeze protection", "Process-loop maintenance"],
    specs: [
      ["ph-drop", "Ethylene glycol", "Concentrated inhibited glycol"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums quoted with freight"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg50: {
    name: "EG inhibited 50% RTU",
    cat: "glycol",
    replaces: "50% ethylene glycol blend",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    tag: "Premixed inhibited 50% ethylene glycol for industrial loop top-offs and freeze-protection maintenance.",
    desc: "A ready-to-use inhibited 50% ethylene glycol blend for industrial heat-transfer and freeze-protection loops.",
    uses: ["Industrial loop top-offs", "Closed-loop freeze protection", "Heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG 50 blend", "Premixed ethylene glycol solution"],
      ["ph-thermometer-cold", "Freeze protection", "For routine loop service"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums quoted with freight"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  egu96: {
    name: "EG uninhibited 96% concentrate",
    cat: "glycol",
    replaces: "Ethylene glycol uninhibited concentrate",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    tag: "Uninhibited 96% ethylene glycol concentrate when the inhibitor strategy is handled elsewhere.",
    desc: "An uninhibited 96% ethylene glycol concentrate for industrial heat-transfer loop programs where inhibitor strategy is handled separately.",
    uses: ["Utility loop service", "Industrial freeze protection", "Process heat-transfer maintenance"],
    specs: [
      ["ph-drop", "EG uninhibited", "Concentrated glycol for utility loops"],
      ["ph-thermometer-cold", "Freeze protection", "For loop fill and maintenance programs"],
      ["ph-truck", "Bulk-ready", "Small packs priced online; drums quoted with freight"]
    ],
    docs: ["Safety Data Sheet (SDS)", "Technical Application Sheet"]
  },
  eg5050: {
    name: "EG 50/50",
    cat: "glycol",
    replaces: "50% ethylene glycol pre-mix",
    hmis: "0-0-0",
    icon: "ph-thermometer-cold",
    image: "img/products/glycols-studio.webp",
    tag: "50/50 ethylene glycol blend for quote-reviewed loop top-offs, maintenance, and supply planning.",
    desc: "A 50/50 ethylene glycol blend for closed-loop maintenance and top-off work; we confirm fluid compatibility and supply before purchase.",
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
    job: "Rust, scale, and heavy deposits",
    summary: "Use for controlled rust, mineral-scale, or passivation trials after metallurgy, concentration, rinse, and endpoint review.",
    fits: ["HVAC", "metal restoration", "concrete", "pipelines"],
    proof: "SDS, pool-filter field note, and context-only case records"
  },
  "hcr-t16": {
    job: "16+ tote descaling supply",
    summary: "For high-volume facilities and contractors standardizing on HCR tote procurement with program pricing and freight review.",
    fits: ["16+ totes", "contractors", "campuses", "industrial descaling"],
    proof: "Program pricing and Bulk HCR Program Profile"
  },
  descaler: {
    job: "Coils, towers, and heat-transfer equipment",
    summary: "A descaling candidate for aluminum fins, copper, steel, plumbing, fire pumps, and refrigeration equipment after material testing.",
    fits: ["coils", "cooling towers", "plumbing", "fire pumps"],
    proof: "SDS, label, and controlled material-test request"
  },
  crs: {
    job: "Water-side scale and rust",
    summary: "For underbody rust, fixtures, coils, and water lines where metal compatibility matters as much as cleaning power.",
    fits: ["underbodies", "fixtures", "coils", "water lines"],
    proof: "User guide and application notes"
  },
  cr: {
    job: "High-pH cleaning and water-treatment support",
    summary: "For teams evaluating an alkaline cleaning step, pH adjustment, or a controlled CR then HCR process.",
    fits: ["hoods", "floors", "CIP", "water treatment"],
    proof: "Current SDS and brewery trial records"
  },
  crhd: {
    job: "Heavy grease and industrial soil",
    summary: "A low-foam alkaline degreaser candidate for floors, forklifts, drains, engine bays, kitchen buildup, and heavy industrial soil.",
    fits: ["floors", "forklifts", "drains", "engine bays"],
    proof: "Current SDS, label, comparison file, and site-trial request"
  },
  neutral: {
    job: "Sensitive surfaces and seals",
    summary: "Choose this when grease needs to move but the surface, seal, metal, or finish needs neutral, pH-7 chemistry.",
    fits: ["equipment", "marine", "aviation", "fleet"],
    proof: "SDS and technical application sheet"
  },
  multiwash: {
    job: "Everyday facility washing",
    summary: "A cleaner candidate for concrete, drains, pressure washing, and routine facility maintenance under an approved work-area plan.",
    fits: ["campuses", "concrete", "drains", "pressure washing"],
    proof: "Current SDS and controlled site-trial request"
  },
  watersafe60: {
    job: "Scale and corrosion control",
    summary: "For site-engineered cooling-tower and closed-loop evaluation with exact composition and performance claims held behind approved records.",
    fits: ["cooling towers", "closed loops", "campuses", "hospitals"],
    proof: "Controlled documentation and program documents"
  },
  purgo: {
    job: "Document-gated water-treatment support",
    summary: "For programs evaluating odor-control or water-treatment use after label, regulatory, efficacy, and site-engineering review.",
    fits: ["towers", "WMP support", "campuses", "general use"],
    proof: "Regulatory status and safety documents"
  },
  dbnpa: {
    job: "Document-gated tower-treatment component",
    summary: "A controlled-release program component available after label, SDS, registration, dose, and site-engineering review.",
    fits: ["quarterly dosing", "cooling towers", "low-dose programs"],
    proof: "Registration, label, and SDS request"
  },
  lam3: {
    job: "Moss, algae, mold, and mildew",
    summary: "Spray and walk away on roofs, pavers, siding, stucco, concrete, ponds, and exterior walls; let the dwell time do the slow work.",
    fits: ["roofs", "pavers", "siding", "stucco"],
    proof: "Current label, SDS, and context-only field photos"
  },
  alumibrite: {
    job: "Aluminum brightening",
    summary: "Restore wheels, trim, RV, fleet, and marine aluminum without bringing HF/HCl brighteners into the bay.",
    fits: ["wheels", "trim", "RV", "marine"],
    proof: "Brightening Index 90.1 and commercial-airboat field use"
  },
  torque: {
    job: "Vehicle, fleet, RV, and marine wash",
    summary: "Clean and protect finishes in one wash-and-wax step for vehicles, fleets, RVs, and boats.",
    fits: ["vehicles", "fleets", "RVs", "boats"],
    proof: "Current label, SDS, and context-only field photos"
  },
  "cr-hd-low-foam": {
    job: "Machine wash and low-foam degreasing",
    summary: "The CR HD path for automatic scrubbers, parts washers, and recirculating systems where foam control matters.",
    fits: ["floor scrubbers", "parts washers", "recirculating wash", "heavy soil"],
    proof: "Application notes on request"
  },
  cr2: {
    job: "Concentrated alkaline cleaning",
    summary: "A higher-concentration CR-family SKU for accounts that already understand CR workflows and need confirmed small-pack or bulk pricing.",
    fits: ["alkaline cleaning", "water treatment", "high-pH", "dosing"],
    proof: "Application notes and pricing confirmed"
  },
  sar: {
    job: "Specialty descaling evaluation",
    summary: "A quote-reviewed chemistry candidate for targeted descaling and water-side work while technical and regulatory records are completed.",
    fits: ["descaling", "water-side scale", "specialty acid", "maintenance"],
    proof: "Application notes and pricing confirmed"
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

export const PRODUCT_GALLERY = {
  hcr: [
    ["img/proof/cases/ddc-rust.webp", "Rusted HVAC component cleared with VertKleen HCR", "DDC rust and scale test"],
    ["img/proof/cases/farm-rust-after.webp", "Diamond-plate steel rust removed with VertKleen HCR", "Brevard HVAC farm rust removal"],
    ["img/proof/cases/brewery.webp", "Brewery tank and heat exchanger cleaned with VertKleen CR and HCR", "Brewery CIP trial"]
  ],
  cr: [
    ["img/proof/cases/brewery.webp", "Brewery tank and heat exchanger cleaned with VertKleen CR and HCR", "Brewery CIP trial"],
    ["img/proof/cases/hood.webp", "Commercial kitchen hood and range degreased with VertKleen CR", "Commercial hood cleaning"],
    ["img/before-after/cr-after.webp", "Exterior surface after VertKleen CR cleaning", "After cleaning"]
  ],
  crhd: [
    ["img/products/crhd-studio.webp", "VertKleen CR HD heavy degreaser container", "CR HD product"],
    ["img/proof/cases/kitchen-after.webp", "Commercial kitchen deep degreased with VertKleen CR HD", "Commercial kitchen cleaning"]
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
