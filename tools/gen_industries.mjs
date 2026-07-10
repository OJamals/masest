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

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "industries");

// Industry order matches the industries.html index (deck priority). Plumbing last.
const INDUSTRIES = [
{
  slug: "oil-gas",
  name: "Oil & Gas",
  icon: "ph-gas-can",
  h1: "Clean rigs and terminals without making the chemical the main hazard.",
  sub: "Descale, derust, and degrease rigs, terminals, and pipelines without the acid fumes, solvent storage, and hazmat freight that usually come with the job.",
  intro: "Rigs, terminals, and pipelines usually get cleaned with acids and solvent degreasers that bring fumes, burns, and hazmat freight. VertKleen does the same descaling, rust removal, and degreasing at an HMIS 0-0-0 rating, so storage, handling, and shipping stay simple.",
  products: ["hcr", "descaler", "crhd", "neutral"],
  proof: { img: "ddc-rust", caption: "20-year rust scale cleared with HCR, verified by DDC Engineering." }
},
{
  slug: "marine",
  name: "Marine",
  icon: "ph-anchor",
  h1: "Marine cleaning where fumes have nowhere to go.",
  sub: "On cruise ships, commercial vessels, and docks, confined air and soft metals make the cleaning chemical a decision you can't shortcut.",
  intro: "Hull, aluminum, glass, and deck work often leans on hydrofluoric or hydrochloric acid brighteners and solvent washes — dangerous in confined shipboard air. VertKleen Torque and AlumiBrite restore those surfaces without the acids, and MultiWash handles drone pressure-washing on occupied vessels.",
  products: ["torque", "alumibrite", "multiwash", "crhd"],
  proof: { img: "marine", caption: "Yellowfin vessel trim, caulking, and glass cleared with VertKleen." }
},
{
  slug: "manufacturing",
  name: "Manufacturing",
  icon: "ph-factory",
  h1: "Get production back, not another HazCom meeting.",
  sub: "Strong cleaning for extrusion, processing, warehousing, and plant maintenance — with the documentation your technical review needs.",
  intro: "Plant maintenance runs on acid descaling, caustic CIP, and solvent degreasing, each one adding HazCom and exposure risk. VertKleen does those same jobs at an HMIS 0-0-0 rating, so there's less to handle and a cleaner package to put in front of technical review.",
  products: ["hcr", "cr", "crhd", "descaler"],
  proof: { img: "farm-rust", caption: "Heavy industrial rust scale removed with HCR, no HCl handling." }
},
{
  slug: "distribution-cold-storage",
  name: "Distribution / Cold Storage",
  icon: "ph-warehouse",
  h1: "Cold-chain cleaning cannot wait for shutdown.",
  sub: "Perishable distribution centers, refrigerated bays, ammonia systems, forklifts, kitchens, drains, and coils with proof from Walmart DSC materials.",
  intro: "Cold-storage teams juggle mildew, freezer entries, ammonia coils, condenser lines, kitchen grease, forklifts, and pilot readiness without stopping the building. VertKleen covers that whole walkdown with Descaler, CR HD, MultiWash, Purgo, and CR, and gets the proof, SDS, and trial details to you before the operations window closes.",
  products: ["descaler", "crhd", "multiwash", "purgo"],
  proof: { img: "walmart-dc-crhd", caption: "Walmart distribution-center proof covers CR HD degreasing and Descaler refrigeration work." }
},
{
  slug: "food-beverage",
  name: "Food & Beverage",
  icon: "ph-beer-bottle",
  h1: "CIP proof beats a food-safe slogan.",
  sub: "Breweries, distilleries, wineries, processing floors, hood filters, and drains cleaned around staff and active food spaces.",
  intro: "Tanks, heat exchangers, and CIP/SIP lines usually depend on caustic-acid sequences that are hard on staff and effluent. Brewlando trial notes say CR and HCR worked better than traditional caustic-soda and acid blends at the same concentration and CIP time; the Carib lab table adds effluent data buyers can review.",
  products: ["cr", "hcr", "crhd", "neutral", "multiwash"],
  proof: { img: "brewery", caption: "Brewery tanks and CIP cleaned with CR and HCR; effluent lab data on the proof page." }
},
{
  slug: "healthcare",
  name: "Healthcare",
  icon: "ph-hospital",
  h1: "Healthcare maintenance cannot become an event.",
  sub: "Clean, passivate, and maintain water systems while the building stays occupied and fume-event risk stays lower.",
  intro: "Hospitals and occupied campuses can't plan around fume events or long shutdowns. VertKleen cleans, passivates, and supports water-system programs at an HMIS 0-0-0 rating, so maintenance works around the patients, staff, and visitors still in the building.",
  products: ["watersafe60", "purgo", "hcr", "cr", "descaler"],
  proof: { img: "ac-coil", caption: "Residential facility AC coils cleaned with Descaler, aluminum-fin compatible." }
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
  slug: "golf-courses",
  name: "Golf Courses",
  icon: "ph-flag",
  h1: "Keep grounds, carts, irrigation, and clubhouse surfaces out of the harsh-chemical lane.",
  sub: "Equipment, carts, irrigation scale, exterior stains, and turf-adjacent cleaning all need chemistry grounds crews can trial safely.",
  intro: "Golf courses and sports facilities clean fleets, carts, shop floors, irrigation hardware, clubhouse exteriors, equipment, mats, and high-touch areas near turf and water. VertKleen matches those jobs with Torque, LAM3, HCR, MultiWash, and Purgo so grounds crews can trial one safer chemistry set across the property.",
  products: ["torque", "lam3", "hcr", "multiwash", "purgo"],
  primaryCta: "Request grounds-crew trial",
  primaryType: "sample",
  proof: { img: "grout-moss", caption: "Exterior concrete, grout, and biological staining cleaned with VertKleen." }
},
{
  slug: "military-government",
  name: "Military / Government",
  icon: "ph-seal-check",
  h1: "Public buyers need more than a nice label.",
  sub: "The procurement documentation federal, state, local, and public-facility buyers expect.",
  intro: "MASEST keeps SAM.gov, CAGE 0B2Q3, and NAICS 424690 paperwork ready for federal, state, local, and public-facility buyers. VertKleen replaces hazardous acids, caustics, and water-treatment chemistry across public assets, with HMIS 0-0-0 documentation, SDS, and exception notes on hand.",
  products: ["hcr", "descaler", "crhd", "alumibrite"],
  proof: { img: "ddc-rust", caption: "Rust removed from defense-contractor equipment with HCR." }
},
{
  slug: "education",
  name: "Education",
  icon: "ph-graduation-cap",
  h1: "Campus work happens while campus happens.",
  sub: "K-12 and university facilities cleaned and treated while students, faculty, and staff remain on site.",
  intro: "Schools and universities maintain water systems, kitchens, and exteriors while occupied, so how you document chemical handling matters. VertKleen cleans and treats at an HMIS 0-0-0 rating for campuses still in use. Brevard County Schools is the proof behind it.",
  products: ["cr", "hcr", "watersafe60", "lam3"],
  proof: { img: "drone-action", caption: "Occupied-campus exterior facility cleaning with VertKleen." }
},
{
  slug: "municipalities-water-utilities",
  name: "Municipalities & Water Utilities",
  icon: "ph-buildings",
  h1: "Bid-ready water and facilities chemistry with the safety file already started.",
  sub: "NSF-60 requirements, worker safety, bids, and public water review need a replacement story that survives documentation review.",
  intro: "Municipalities and water utilities need chemistry that fits bid language, worker safety expectations, and water-system documentation. CR2, WaterSafe60, and HCR give the buyer a public-sector path for NSF-60 requirements, scale and corrosion control, and acid-replacement work.",
  products: ["cr2", "watersafe60", "hcr"],
  primaryCta: "Get on our bid list",
  primaryType: "quote",
  proof: { img: "ddc-rust", caption: "DDC Engineering proof gives public buyers a documented acid-replacement result to review." }
},
{
  slug: "hvac-water",
  name: "HVAC / Water Treatment",
  icon: "ph-wind",
  h1: "The tower program, translated into cleaner chemistry.",
  sub: "Inhibitor, antimicrobial support, passivation, pH control, and ASHRAE 188 support for cooling-tower programs.",
  intro: "Cooling-tower programs combine inhibitor, antimicrobial support, descaling acid, pH control, and sometimes a non-oxidizing biocide. VertKleen covers it with WaterSafe60, Purgo, HCR, and CR, with DBNPA footnoted as a low-hazard component when the non-oxidizing biocide is specified separately.",
  products: ["watersafe60", "purgo", "hcr", "cr"],
  proof: { img: "ac-coil", caption: "HVAC coils and water systems cleaned and treated with aluminum-fin compatibility reviewed." }
},
{
  slug: "data-centers",
  name: "Data Centers",
  icon: "ph-hard-drives",
  h1: "Water-treatment chemistry for uptime teams under compliance pressure.",
  sub: "Cooling tower scale, Legionella compliance, green mandates, and uptime risk put data-center water treatment under procurement review.",
  intro: "Data centers cannot let scale, biological growth, or hazardous chemical handling become an uptime risk. WaterSafe60 covers scale and corrosion control, HCR handles acid-cleaning and passivation work, and Descaler gives facilities teams an acid-free path for coils, plumbing, and heat-transfer surfaces.",
  products: ["watersafe60", "hcr", "descaler"],
  primaryCta: "Schedule a water-treatment audit.",
  primaryType: "audit",
  proof: { img: "ac-coil", caption: "Cooling and heat-transfer surfaces cleaned with aluminum-fin compatibility reviewed." }
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
},
{
  slug: "hotels-property-management",
  name: "Hotels / Property Management",
  icon: "ph-buildings",
  h1: "One safer property-maintenance chemical set for guest-facing work.",
  sub: "Facades, pools, restrooms, HVAC, exterior stains, and odor complaints need one supplier that does not create guest-facing fume issues.",
  intro: "Hotels, resorts, and property managers juggle facades, pools, restrooms, HVAC coils, odor complaints, and exterior biological growth while guests remain on site. MultiWash, LAM3, Descaler, and Neutral create one property-maintenance lane with triple-zero handling across the core products.",
  products: ["multiwash", "lam3", "descaler", "neutral"],
  primaryCta: "Request property walkthrough",
  primaryType: "audit",
  proof: { img: "grout-moss", caption: "Exterior property surfaces cleared of biological staining with VertKleen." }
},
{
  slug: "solar-panel-cleaning",
  name: "Solar / Panel Cleaning",
  icon: "ph-sun",
  h1: "Panel cleaning at scale without making runoff the objection.",
  sub: "Soft-wash at scale without panel damage, runoff review, and drone-site logistics need chemistry that is easy to approve.",
  intro: "Solar farms and panel-cleaning teams need a soft-wash path that respects coatings, runoff, vegetation, and large site logistics. MultiWash and LAM3 support panel-adjacent exterior cleaning where bleach damage and plant kill concerns slow approval.",
  products: ["multiwash", "lam3"],
  primaryCta: "Request per-MW quote",
  primaryType: "quote",
  proof: { img: "drone-action", caption: "Drone exterior cleaning workflow supports large-site soft-wash programs." }
},
{
  slug: "schools-universities",
  name: "Schools & Universities",
  icon: "ph-graduation-cap",
  h1: "District facilities need safer chemistry that can move through approval.",
  sub: "HVAC scale, coil maintenance, and hazmat chemicals near kids create a documentation burden for K-12 and higher-ed facilities.",
  intro: "Schools and universities maintain coils, kitchens, exterior surfaces, and water-side equipment while students and staff remain on campus. Descaler, HCR, and MultiWash give facility teams a lower-hazard path for scale, rust, and everyday cleaning work.",
  products: ["descaler", "hcr", "multiwash"],
  primaryCta: "Request district pricing",
  primaryType: "quote",
  proof: { img: "drone-action", caption: "Broward County Schools proof supports occupied-campus HVAC and facilities conversations." }
},
{
  slug: "mechanical-contractors-water-treatment",
  name: "Mechanical Contractors & Water Treatment",
  icon: "ph-wind",
  h1: "Reduce callback risk with a safer descaling and water-treatment kit.",
  sub: "Callback-driven descaling and hazmat handling costs slow mechanical contractors and water-treatment teams.",
  intro: "Mechanical contractors and water-treatment providers need chemistry that works in the field and still survives owner review. HCR, Descaler, and WaterSafe60 cover scale, passivation, and cooling-water program needs without making handling the main obstacle.",
  products: ["hcr", "descaler", "watersafe60"],
  primaryCta: "Open a contractor account",
  primaryType: "quote",
  proof: { img: "ac-coil", caption: "CSS Mechanical and Skytech buy in volume for facility and water-treatment work." }
},
{
  slug: "breweries-distilleries-wineries",
  name: "Breweries, Distilleries & Wineries",
  icon: "ph-beer-bottle",
  h1: "CIP cleaning that proves itself against acid and caustic sequences.",
  sub: "CIP acid and caustic hazards, beer-line cleaning cost, and rinse acceptance all matter to beverage producers.",
  intro: "Brewery, distillery, and winery teams can use CR for the alkaline cleaning step, HCR for the acid wash, and CR HD Low Foam where low-foam degreasing matters. The food and beverage pricing table keeps this segment separate from HVAC pricing.",
  products: ["cr", "hcr", "cr-hd-low-foam"],
  primaryCta: "Book a free CIP demo",
  primaryType: "sample",
  proof: { img: "brewery", caption: "Brewlando Brewing ran the full CR and HCR CIP/SIP program and beat Micro Matic beer-line cleaner economics." }
},
{
  slug: "restaurants-commercial-kitchens",
  name: "Restaurants & Commercial Kitchens",
  icon: "ph-fork-knife",
  h1: "Grease, drains, hoods, and floors without turning the kitchen into a fume event.",
  sub: "Grease, drains, hood filters, and equipment cleaning need food-adjacent chemistry that crews can use repeatedly.",
  intro: "Restaurants and commercial kitchens need degreasing, drain, hood, and floor cleaning without solvent odor or caustic handling dominating the job. CR HD, Purgo, MultiWash, and Neutral cover the core food-service workflow.",
  products: ["crhd", "purgo", "multiwash", "neutral"],
  primaryCta: "Get a sample kit",
  primaryType: "sample",
  proof: { img: "kitchen", caption: "Restaurant and food-service work connects CR HD and Purgo to grease, drains, hoods, and odor-control support." }
},
{
  slug: "warehousing-distribution-centers",
  name: "Warehousing & Distribution Centers",
  icon: "ph-warehouse",
  h1: "Floor and fleet degreasing at warehouse scale.",
  sub: "Floor degreasing at scale and worker-safety expectations drive warehouse chemical approvals.",
  intro: "Warehouses and distribution centers need fast degreasing for floors, forklifts, parts, kitchens, and loading areas. CR HD and MultiWash give operations teams a practical path for heavy soil and recurring facility cleaning.",
  products: ["crhd", "multiwash"],
  primaryCta: "Request drum pricing",
  primaryType: "quote",
  proof: { img: "walmart-dc-crhd", caption: "Walmart distribution centers replaced Simple Green with CR HD for heavy degreasing." }
},
{
  slug: "hotels-resorts-property-management",
  name: "Hotels, Resorts & Property Management",
  icon: "ph-buildings",
  h1: "Guest-facing properties need one safer maintenance lane.",
  sub: "Facades, pools, restrooms, HVAC, exterior stains, and odor complaints need one supplier.",
  intro: "Hotels, resorts, and property managers juggle public-facing surfaces, wet areas, HVAC coils, odor complaints, and exterior biological growth. MultiWash, LAM3, Descaler, and Neutral create one property-maintenance set.",
  products: ["multiwash", "lam3", "descaler", "neutral"],
  primaryCta: "Request property walkthrough",
  primaryType: "audit",
  proof: { img: "grout-moss", caption: "Triple-zero handling supports guest-facing work with fewer fume complaints." }
},
{
  slug: "pressure-washing-soft-wash-contractors",
  name: "Pressure-Washing & Soft-Wash Contractors",
  icon: "ph-spray-bottle",
  h1: "Soft-wash work without making bleach damage the default risk.",
  sub: "Bleach damage, plant kill, and runoff liability slow pressure-washing and soft-wash approvals.",
  intro: "Pressure-washing and soft-wash contractors need exterior chemistry that can be explained to property owners, landscapers, and runoff reviewers. LAM3 and MultiWash support biological staining and general exterior wash, while CR HD and the CRS application label cover fleet grease, concrete, rust, and mineral scale.",
  products: ["lam3", "multiwash", "crhd"],
  primaryCta: "Distributor application",
  primaryType: "distributor",
  proof: { img: "grout-moss", caption: "LAM3 at $22.21/gal undercuts Wet & Forget at $34/gal and supports larger pack quoting." }
},
{
  slug: "drone-cleaning-companies",
  name: "Drone Cleaning Companies",
  icon: "ph-drone",
  h1: "Drone-rated cleaning chemistry for exterior work at height.",
  sub: "Drone cleaners need safe, drone-rated chemistry that can be explained around overspray, runoff, and vegetation.",
  intro: "Drone cleaning companies need exterior chemistry that works with flight operations and keeps plant, coating, and runoff objections under control. MultiWash, LAM3, CR HD, and the CRS application label cover exterior wash, biological staining, heavier soils, rust, and mineral scale.",
  products: ["multiwash", "lam3", "crhd"],
  primaryCta: "Book a drone-wash consult",
  primaryType: "audit",
  proof: { img: "drone-action", caption: "Inbound drone-cleaning demand is already replacing Wet & Forget and EcoAdvance conversations." }
},
{
  slug: "marine-marinas-boatyards",
  name: "Marine, Marinas & Boatyards",
  icon: "ph-anchor",
  h1: "Hull, salt, wax, and aluminum work without acid-brightener baggage.",
  sub: "Hull scale, salt, wax, and aluminum brightwork need chemistry that fits vessel and dockside constraints.",
  intro: "Marine buyers need cleaning and brightening chemistry that respects confined air, soft metals, and dockside operations. Torque, AlumiBrite, and HCR cover wash-and-wax, aluminum brightwork, and scale or rust work.",
  products: ["torque", "alumibrite", "hcr"],
  primaryCta: "Get marina bulk pricing",
  primaryType: "quote",
  proof: { img: "marine", caption: "Torque wash-and-wax work is built for vessels and marina maintenance." }
},
{
  slug: "aviation-fbos-mro-airports",
  name: "Aviation - FBOs, MRO, Airports",
  icon: "ph-airplane-tilt",
  h1: "Precision degreasing needs corrosion-aware chemistry.",
  sub: "Aviation maintenance and airport facilities need precision degreasing without corrosion concerns.",
  intro: "FBOs, MRO teams, and airport facilities need degreasing and aluminum work that can survive documentation review. CR HD and AlumiBrite support heavy soil removal and brightwork where generic solvent or caustic choices are harder to approve.",
  products: ["crhd", "alumibrite"],
  primaryCta: "Request aviation spec sheet",
  primaryType: "technical",
  proof: { img: "walmart-dc-crhd", caption: "CR HD competes with Simple Green Extreme Aircraft at lower published per-gallon economics." }
},
{
  slug: "golf-courses-sports-facilities",
  name: "Golf Courses & Sports Facilities",
  icon: "ph-flag",
  h1: "Grounds crews need chemistry that works near turf and water features.",
  sub: "Equipment, carts, irrigation scale, exterior stains, and sports-facility cleaning need safer trial chemistry.",
  intro: "Golf courses and sports facilities clean carts, mowers, irrigation hardware, shop floors, clubhouses, exterior stains, equipment, mats, and high-touch areas near turf and water. Torque, LAM3, HCR, MultiWash, and Purgo cover the grounds-crew trial set.",
  products: ["torque", "lam3", "hcr", "multiwash", "purgo"],
  primaryCta: "Request grounds-crew trial",
  primaryType: "sample",
  proof: { img: "grout-moss", caption: "The grounds-crew bundle is built around turf-adjacent and water-feature work." }
},
{
  slug: "healthcare-senior-living",
  name: "Healthcare & Senior Living",
  icon: "ph-hospital",
  h1: "Cleaning near vulnerable people needs a quieter handling story.",
  sub: "Cleaning near vulnerable people and indoor air-quality concerns make harsh chemistry harder to approve.",
  intro: "Healthcare and senior-living facilities need cleaning and scale-control products that crews can explain around patients, residents, guests, and air quality. Neutral, MultiWash, and Descaler support the core facility-maintenance set.",
  products: ["neutral", "multiwash", "descaler"],
  primaryCta: "Request facilities assessment",
  primaryType: "audit",
  proof: { img: "ac-coil", caption: "HMIS 0-0-0 handling across the core line supports occupied-facility maintenance." }
},
{
  slug: "fleet-trucking-car-washes",
  name: "Fleet, Trucking & Car Washes",
  icon: "ph-truck",
  h1: "Fleet cleaning needs wash, wax, grease, and aluminum in one lane.",
  sub: "Degreasing, wash and wax, and wheel or aluminum brightening drive fleet and truck-wash chemistry needs.",
  intro: "Fleet, trucking, and car-wash teams need recurring chemistry for exterior wash, grease, engines, wheels, and aluminum. Torque, CR HD, MultiWash, and AlumiBrite create the core fleet program.",
  products: ["torque", "crhd", "multiwash", "alumibrite"],
  primaryCta: "Fleet program pricing",
  primaryType: "quote",
  proof: { img: "marine", caption: "Torque gives wash-and-wax economics for fleet programs, with CR HD and AlumiBrite for the harder jobs." }
},
{
  slug: "oil-gas-industrial-plants",
  name: "Oil & Gas / Industrial Plants",
  icon: "ph-gas-can",
  h1: "Industrial scale, tanks, and grease without making EHSS carry the switch.",
  sub: "Tank cleaning, scale, and HAZWOPER-level safety burden make industrial chemistry a review-heavy decision.",
  intro: "Oil, gas, and industrial plants need serious scale, rust, tank, and grease cleaning while EHSS reviews the handling path. HCR, CR, and CR HD cover the main industrial replacements with a lower-hazard file.",
  products: ["hcr", "cr", "crhd"],
  primaryCta: "Talk to an EHS consultant",
  primaryType: "audit",
  proof: { img: "ddc-rust", caption: "Founder experience includes 10+ years of EHSS in oil and gas, including Halliburton and Saudi Arabia." }
},
{
  slug: "food-processing-agriculture",
  name: "Food Processing & Agriculture",
  icon: "ph-plant",
  h1: "CIP, organic residue, and wash-down chemistry for plants and farms.",
  sub: "CIP, organic residue, and wash-down compliance need chemistry that can be trialed and documented.",
  intro: "Food processing and agriculture buyers need CIP, organic-residue cleaning, wash-down support, and lower-hazard documentation before they switch from acid and caustic routines. CR, HCR, and CR HD Low Foam cover the starting set.",
  products: ["cr", "hcr", "cr-hd-low-foam"],
  primaryCta: "Request plant trial",
  primaryType: "sample",
  proof: { img: "brewery", caption: "Brewery-proven CIP chemistry carries into plant and agriculture wash-down conversations." }
},
{
  slug: "solar-farms-panel-cleaning",
  name: "Solar Farms & Panel Cleaning",
  icon: "ph-sun",
  h1: "Solar soft-wash chemistry needs a runoff and coating story.",
  sub: "Soft-wash at scale without panel damage is the approval problem for solar farms and panel cleaners.",
  intro: "Solar farms and panel-cleaning crews need chemistry that supports soft-wash workflows, drone delivery, coating review, runoff control, and vegetation concerns. MultiWash and LAM3 are the core products.",
  products: ["multiwash", "lam3"],
  primaryCta: "Request per-MW quote",
  primaryType: "quote",
  proof: { img: "drone-action", caption: "Drone-delivered soft-wash workflows are ready for large solar-site cleaning conversations." }
}
];

const NAV = [
  ["", "MASEST"], ["products", "Products"], ["services", "Services"], [null, "Use Cases"],
  ["industries", "Industries"], ["proof", "Proof"],
  ["resources", "Resources"]
];

// Per-industry field gallery. Images live at img/industries/<slug>/g{1,2,3}.webp
// (generated by tools/gen_galleries.py from the case-study photo library).
// [alt, caption] per image — alt carries the full description, caption is the on-card line.
const GALLERY = {
  "oil-gas": [
    ["VertKleen HCR dissolving two decades of rust in a jar test", "Rust dissolved in an HCR jar test"],
    ["Measured HCR dose for a controlled descaling test", "Measured dose, controlled descale"],
    ["Rusted steel beside a cleaned test patch", "Cleaned patch vs. muriatic acid"]
  ],
  "marine": [
    ["Yellowfin helm and console cleaned with VertKleen Torque", "Helm and console cleaned"],
    ["Hull and topsides washed dockside without acid brighteners", "Topsides washed dockside"],
    ["43-foot Yellowfin finished bow to transom", "Finished bow to transom"]
  ],
  "manufacturing": [
    ["Greasy intake assembly before VertKleen CR HD degreasing", "Greasy intake, pre-degrease"],
    ["Filter media cleared of grease with fibers intact", "Media cleared, fibers intact"],
    ["Degreased filter restored to clean media", "Restored to clean media"]
  ],
  "distribution-cold-storage": [
    ["Walmart distribution center CR HD degreasing proof", "CR HD degreasing proof"],
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
    ["Non-corrosive coil descaler dosed at a condenser during in-place service", "Descaler dosed at the condenser"],
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
  "drone-action": [520, 650],
  brewery: [1200, 900],
  "ddc-rust": [1200, 579],
  "farm-rust": [740, 967],
  "grout-moss": [919, 690],
  marine: [1175, 1125],
  "walmart-dc-crhd": [708, 513],
};

const enc = (s) => encodeURIComponent(s).replace(/'/g, "%27");
const htmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const SEGMENT_PRICING = JSON.parse(
  readFileSync(resolve(HERE, "..", "data", "segment-pricing.json"), "utf8"),
);
const PRICE_SEGMENTS = new Map(
  SEGMENT_PRICING.segments.map((segment) => [segment.slug, segment]),
);

const LABEL_VARIANTS = {
  "fb-cip-cr": {
    market: "FB label",
    name: "VertKleen CIP CR",
    subtitle: "50% caustic soda replacement · brewery CIP",
    image: "cip-cr-studio.webp",
    productHref: "cr",
    priceProductSlug: "cr",
    priceSegmentSlug: "cip-food-beverage",
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
    priceProductSlug: "hcr",
    priceSegmentSlug: "cip-food-beverage",
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
    priceProductSlug: "cr-hd",
    priceSegmentSlug: "cip-food-beverage",
    directions: [
      ["Kitchen line — light grease", "Spray at 1:16, dwell 3–5 min, then wipe or rinse"],
      ["Bar mats, fryers & hoods", "Apply at 1:8, agitate, then rinse"],
      ["Stubborn / baked-on buildup", "Apply neat, dwell, then rinse"],
    ],
  },
  "fb-multiwash": {
    market: "FB label",
    name: "VertKleen MultiWash",
    subtitle: "Multi-surface cleaner · deodorizer · antimicrobial",
    image: "multiwash-food-beverage-studio.webp",
    productHref: "multiwash",
    priceProductSlug: "multiwash",
    priceSegmentSlug: "cip-food-beverage",
    directions: [
      ["Bar tops, glass & tables", "Fill a 32 oz spray bottle at 1:16; mist and wipe"],
      ["Floors", "Dilute 1:32 in a mop bucket or auto-scrubber"],
      ["Restrooms & fixtures", "Spray at 1:16, let stand, then wipe"],
      ["Upholstery & booths", "Spray at 1:16, blot and air-dry"],
    ],
    coverage: "1 gal cleans 1,000–1,500 sq ft; 1 gal makes up to 5 gal.",
  },
  "pw-crhd": {
    market: "PW label",
    name: "VertKleen CR HD",
    subtitle: "Heavy-duty degreaser · fleet & concrete",
    image: "crhd-pressure-wash-studio.webp",
    productHref: "crhd",
    priceProductSlug: "cr-hd",
    priceSegmentSlug: "hvac-facilities",
    directions: [
      ["Fleet & equipment", "Apply at 1:20 via downstream injector or foam cannon; dwell, then rinse"],
      ["Concrete oil & grease", "Apply at 1:8, agitate and rinse"],
      ["Heavy / baked-on buildup", "Apply neat, dwell, then rinse"],
    ],
  },
  "pw-crs": {
    market: "PW label",
    name: "VertKleen CRS",
    subtitle: "Calcium, rust & scale · non-corrosive",
    image: "crs-pressure-wash-studio.webp",
    productHref: "descaler",
    priceProductSlug: "descaler",
    priceSegmentSlug: "hvac-facilities",
    directions: [
      ["Rust & fertilizer stains", "Apply at 1:4, dwell 3–5 min, agitate, then rinse"],
      ["Battery / deep stains", "Apply at 1:2, dwell, then rinse"],
      ["Heavy scale & calcium", "Apply neat, dwell, then rinse"],
    ],
    catalogNote: "CRS currently routes through the published Descaler catalog listing.",
  },
  "pw-multiwash": {
    market: "PW label",
    name: "VertKleen MultiWash",
    subtitle: "Bleach / sodium hypochlorite replacement",
    image: "multiwash-pressure-wash-studio.webp",
    productHref: "multiwash",
    priceProductSlug: "multiwash",
    priceSegmentSlug: "hvac-facilities",
    directions: [
      ["House wash / soft wash", "Apply through a downstream injector at 1:16; dwell, then low-pressure rinse"],
      ["Concrete & flatwork", "Apply at 1:8, agitate and rinse"],
      ["General surfaces", "Dilute 1:32, apply and rinse"],
    ],
    coverage: "1 gal cleans 1,000–1,500 sq ft; 1 gal makes up to 5 gal.",
  },
  "gym-multiwash": {
    market: "Gym label",
    name: "VertKleen MultiWash",
    subtitle: "Gym · fitness · studio & clinic cleaner",
    image: "multiwash-gym-studio.webp",
    productHref: "multiwash",
    priceProductSlug: "multiwash",
    priceSegmentSlug: "hvac-facilities",
    directions: [
      ["Equipment, machines & mats", "Dilute 1:32; mist onto a cloth or surface and wipe. Do not soak electronics"],
      ["Floors & tile", "Dilute 5:1 in a mop bucket or auto-scrubber"],
      ["Glass & mirrors", "Dilute 4:1 and wipe streak-free"],
      ["Heavy soil & grout", "Dilute 2:1; apply, let stand, agitate and rinse"],
    ],
    coverage: "1 gal cleans 1,000–1,500 sq ft; 1 gal makes up to 5 gal.",
  },
  "gym-purgo": {
    market: "Gym label",
    name: "VertKleen Pūrgo",
    subtitle: "Antimicrobial · high-touch · deodorizer",
    image: "purgo-gym-studio.webp",
    productHref: "purgo",
    priceProductSlug: "purgo",
    priceSegmentSlug: "hvac-facilities",
    directions: [
      ["High-touch odor", "Dilute 1:16; spray onto equipment, benches and rails; let stand, then wipe"],
      ["General surfaces", "Dilute 1:32; mist and wipe down — no rinse required"],
      ["Heavy fouling", "Dilute 1:5; apply, allow full contact time, then wipe"],
    ],
    coverage: "1 gal cleans 1,000–1,500 sq ft; 1 gal makes up to 5 gal.",
  },
};

const INDUSTRY_LABEL_VARIANTS = {
  "food-beverage": ["fb-cip-cr", "fb-cip-hcr", "fb-crhd", "fb-multiwash"],
  "breweries-distilleries-wineries": ["fb-cip-cr", "fb-cip-hcr"],
  "restaurants-commercial-kitchens": ["fb-crhd", "fb-multiwash"],
  "food-processing-agriculture": ["fb-cip-cr", "fb-cip-hcr"],
  "pressure-washing-soft-wash-contractors": ["pw-crhd", "pw-crs", "pw-multiwash"],
  "drone-cleaning-companies": ["pw-crhd", "pw-crs", "pw-multiwash"],
  "fleet-trucking-car-washes": ["pw-crhd", "pw-multiwash"],
  "golf-courses": ["gym-multiwash", "gym-purgo"],
  "golf-courses-sports-facilities": ["gym-multiwash", "gym-purgo"],
};

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
}).format(Number(value));

function variantPriceRows(variant) {
  const segment = PRICE_SEGMENTS.get(variant.priceSegmentSlug);
  if (!segment) throw new Error(`Missing pricing segment: ${variant.priceSegmentSlug}`);
  const rows = segment.rows.filter((row) => row.product_slug === variant.priceProductSlug);
  if (!rows.length) {
    throw new Error(`Missing ${variant.priceProductSlug} prices in ${variant.priceSegmentSlug}`);
  }
  return { segment, rows };
}

function labelVariantCard(key) {
  const variant = LABEL_VARIANTS[key];
  if (!variant) throw new Error(`Missing label variant: ${key}`);
  const { segment, rows } = variantPriceRows(variant);
  const prices = rows.map((row) =>
    `<li>${htmlText(row.pack)} — ${money(row.price_per_unit)}${row.quote_only ? " · quote" : ""}</li>`,
  ).join("");
  const directions = variant.directions.map(([use, dilution]) =>
    `<li><strong>${htmlText(use)}:</strong>&nbsp; ${htmlText(dilution)}</li>`,
  ).join("");
  const note = variant.catalogNote
    ? `        <p>${htmlText(variant.catalogNote)}</p>\n`
    : "";
  const coverage = variant.coverage
    ? `        <p class="product-proof-line">${htmlText(variant.coverage)}</p>\n`
    : "";

  return `<article class="prod-card" data-label-variant="${key}">
        <img class="product-shot" src="../img/products/${variant.image}" alt="${htmlText(variant.name)} ${variant.market} jug" loading="lazy">
        <span class="catalog-type">${variant.market} · ${htmlText(segment.title)} pricing</span>
        <h3>${htmlText(variant.name)}</h3>
        <div class="replaces">${htmlText(variant.subtitle)}</div>
        <h4>Label dilution / concentration</h4>
        <ul class="product-fit-list" aria-label="${htmlText(variant.name)} label directions">${directions}</ul>
${coverage}        <h4>Published pack prices</h4>
        <ul class="product-fit-list" aria-label="${htmlText(variant.name)} ${htmlText(segment.title)} prices">${prices}</ul>
${note}        <div class="prod-actions">
          <a class="btn btn-secondary" href="../products/${variant.productHref}">View base product</a>
          <a class="btn btn-primary" href="../contact?type=quote&amp;product=${enc(variant.name)}&amp;label=${enc(variant.market)}">Request this label</a>
        </div>
      </article>`;
}

function industryLabelVariantsBlock(ind) {
  const keys = INDUSTRY_LABEL_VARIANTS[ind.slug];
  if (!keys?.length) return "";
  const cards = keys.map(labelVariantCard).join("\n      ");
  const tiers = [...new Set(keys.map((key) => PRICE_SEGMENTS.get(LABEL_VARIANTS[key].priceSegmentSlug).title))];

  return `\n<section class="section section-slim" data-industry-label-variants="${ind.slug}">
    <div class="wrap">
      <div class="section-head">
        <span class="eyebrow">Industry label variants</span>
        <h2 class="headline">Use the label built for this work.</h2>
        <p class="subhead">Directions and concentration come from the pictured application label. Pack prices come from the ${htmlText(tiers.join(" and "))} workbook tier; freight is excluded and quote-marked bulk packs remain quote-routed.</p>
      </div>
      <div class="prod-grid prod-grid-rec">
      ${cards}
      </div>
    </div>
  </section>`;
}

const INDUSTRY_DETAILS = {
  "oil-gas": ["Chemicals replaced", "Hydrochloric acid (muriatic acid), solvent degreasers, and aggressive rust removers used on rigs, terminals, pipeline parts, and tank-farm equipment.", "Bundle: HCR for rust and passivation, Descaler for mineral scale, CR HD for oily soils, Neutral for sensitive surfaces."],
  marine: ["Buyer objection", "Confined air, aluminum brightwork, glass, and dockside access make acid brighteners and solvent washes hard to manage.", "Bundle: Torque for wash-and-wax, AlumiBrite for aluminum, MultiWash for exterior cleaning, CR HD for machinery spaces."],
  manufacturing: ["Common replacements", "Acid descalers, caustic CIP cleaners, and solvent degreasers used across lines, floors, parts, and maintenance bays.", "Bundle: HCR for scale and rust, CR for alkaline cleaning, CR HD for heavy grease, Descaler for mineral deposits."],
  "distribution-cold-storage": ["Walkdown sequence", "Walmart perishable DSC materials check banana-room mildew, refrigerated hard-to-reach areas, ammonia coil scale, condenser and drain-line buildup, kitchen grease, and pilot readiness.", "Bundle: Descaler for ammonia coils and heat-transfer circuits, CR HD for fryer, hood, floor, forklift, and parts degreasing, MultiWash and Purgo for spot mildew and odor-control support."],
  "food-beverage": ["Sector proof", "Brewery and distillery work centers on CR and HCR sequences for tanks, heat exchangers, protein soil, beer stone, and hood or drain cleaning.", "Bundle: CR for alkaline wash, HCR for acid wash, CR HD for grease, Neutral where sensitive surfaces or seals matter."],
  healthcare: ["Buyer objection", "Occupied facilities can't trade maintenance for fume events, shutdowns, or uncontrolled chemical exposure.", "Bundle: WaterSafe60 and Purgo for water-program support, HCR for passivation, CR for pH and alkaline cleaning."],
  construction: ["Common replacements", "Hydrochloric acid (muriatic acid), bleach, and caustic degreasers used for concrete cleanup, equipment, pavers, and exterior biological growth.", "Bundle: Descaler for concrete and calcium, HCR for rust, CR HD for equipment grease, LAM3 for exterior growth."],
  "golf-courses": ["Trial focus", "Grounds teams need course equipment, carts, irrigation hardware, wet areas, and exterior stains cleaned without chemistry that threatens turf, water features, or member-facing spaces.", "Bundle: Torque for carts and fleet wash, LAM3 for biological staining, HCR for irrigation scale and rust, MultiWash for clubhouse and exterior cleaning."],
  "military-government": ["Procurement signal", "Public buyers need CAGE, NAICS, SDS, and controlled documents before they'll switch a chemistry standard.", "Bundle: HCR, Descaler, CR HD, and AlumiBrite cover rust, scale, grease, and aluminum restoration, all with documentation on file."],
  education: ["Sector proof", "Campus buyers need cleaning and water-treatment options that work while students, faculty, and staff remain on site.", "Bundle: CR and HCR for facility cleaning, WaterSafe60 for water systems, LAM3 for exterior biological growth."],
  "municipalities-water-utilities": ["Bid signal", "Public water and municipal facilities need worker-safety improvements that still respect NSF-60, bid language, and documentation review.", "Bundle: CR2 for NSF-60 caustic replacement conversations, WaterSafe60 for scale and corrosion control, HCR for acid-cleaning and passivation work."],
  "hvac-water": ["Program coverage", "Cooling tower programs cover inhibitor, oxidizing antimicrobial support, non-oxidizing biocide, acid cleaning, pH adjustment, and degreasing.", "Bundle: WaterSafe60, Purgo, HCR, CR, and Neutral, with DBNPA footnoted separately when the non-oxidizing rotation is specified."],
  "data-centers": ["Program coverage", "Cooling tower scale, Legionella compliance, and green mandates all sit inside the same uptime conversation for data-center facilities teams.", "Bundle: WaterSafe60 for scale and corrosion control, HCR for passivation and heavy scale, Descaler for acid-free heat-transfer cleaning."],
  plumbing: ["Buyer objection", "Water lines, fixtures, heaters, and drains need scale removal without hydrochloric acid handling inside occupied buildings.", "Bundle: Descaler for calcium and scale, HCR for heavier rust and passivation, Neutral for sensitive equipment cleaning."],
  "hotels-property-management": ["Property walkthrough", "Guest-facing properties need facades, pools, restrooms, HVAC, odor, and exterior-stain work handled without fume complaints or a pile of separate suppliers.", "Bundle: MultiWash for daily property cleaning, LAM3 for biological staining, Descaler for pools, restrooms, and HVAC scale, Neutral for sensitive surfaces."],
  "solar-panel-cleaning": ["Site review", "Solar and panel-cleaning crews need soft-wash chemistry that can be explained around coatings, vegetation, runoff, drones, and large-site access.", "Bundle: MultiWash for panel-adjacent exterior cleaning and LAM3 for moss, algae, mold, and mildew staining."],
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
    <div class="wrap">
      <div class="section-head center">
        <span class="eyebrow">Next move</span>
          <h2 class="headline">Put the current chemical on the table.</h2>
          <p class="subhead">Send the current product, surface, soil, volume, and buying deadline. We'll come back with the replacement, the proof, a sample, or a distributor — whatever you need next.</p>
      </div>
      <div class="cta-grid">
        <a class="cta-tile" href="${q("quote")}"><i class="ph ph-tag" aria-hidden="true"></i><span class="cta-tile-t">Price the replacement</span><span class="cta-tile-s">Product, volume, freight</span></a>
        <a class="cta-tile" href="${q("audit")}"><i class="ph ph-clipboard-text" aria-hidden="true"></i><span class="cta-tile-t">Match the current drum</span><span class="cta-tile-s">Current chemical to VertKleen fit</span></a>
        <a class="cta-tile" href="${q("sample")}"><i class="ph ph-package" aria-hidden="true"></i><span class="cta-tile-t">Run a site trial</span><span class="cta-tile-s">Trial 3 to 5 products on site</span></a>
        <a class="cta-tile" href="${q("distributor")}"><i class="ph ph-handshake" aria-hidden="true"></i><span class="cta-tile-t">Set up supply</span><span class="cta-tile-s">BSC, distributor, white-label</span></a>
      </div>
    </div>
  </section>`;
}

const GALLERY_IMAGE_DIMS = {
  "distribution-cold-storage": [[708, 513], [1600, 1200], [1600, 1200]],
};

function galleryBlock(ind) {
  const shots = GALLERY[ind.slug];
  if (!shots) return "";
  const figs = shots.map(([alt, cap], i) => {
    const [w, h] = (GALLERY_IMAGE_DIMS[ind.slug] || [])[i] || [900, 675];
    return `
        <figure class="ind-shot">
          <img src="../img/industries/${ind.slug}/g${i + 1}.webp" alt="${alt.replace(/"/g, "&quot;")}" loading="lazy" width="${w}" height="${h}">
          <figcaption>${cap}</figcaption>
        </figure>`;
  }).join("");
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
<link rel="stylesheet" href="../css/style.css?v=20260706c">
<link rel="stylesheet" href="../css/navigation.css?v=20260706a">
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
    <div class="wrap ind-intro">
      <div class="ind-intro-copy">
        <span class="ind-icon"><i class="ph ${ind.icon}" aria-hidden="true"></i></span>
        <h2 class="headline">Why VertKleen fits ${ind.name}.</h2>
        <p>${ind.intro}</p>
        <a class="btn btn-ink" href="../proof">See the proof</a>
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
        <p class="subhead">Replacement options for the harsh chemistry this work usually relies on first.</p>
      </div>
      <div class="prod-grid prod-grid-rec" data-ind-products="${ind.products.join(" ")}"></div>
    </div>
  </section>${industryLabelVariantsBlock(ind)}
${galleryBlock(ind)}
<div class="cms-page-sections" data-cms-content="page_sections" data-cms-page="industries/${ind.slug}" data-cms-region="body"></div>
${ctaBlock(ind)}
</main>

<script type="module" src="../js/main.js?v=20260710d"></script>
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
