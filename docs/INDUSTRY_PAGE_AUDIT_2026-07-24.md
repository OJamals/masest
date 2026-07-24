# Industry Page Audit

**Date:** 2026-07-24
**Scope:** Every public industry page, its prose, rendered visuals, recommended products, and customer-facing MASEST/VertKleen PDFs.

## Executive verdict

The industry section has a strong visual system and useful buyer-oriented framing, but it is not yet a verification-grade industrial sales library.

Main problems:

1. **The new canonical industry images are not live.** Cache-busted production checks found 16/16 live `industry-sectors.json` records different from the local records and 0/16 live image byte hashes matching the local replacements. The local files and content snapshot still require publishing/deployment.
2. **The pages describe markets better than tasks.** Most pages need a tighter sequence: `asset → soil/deposit → cleaning method → operating boundary → verification → evidence`.
3. **Evidence is hidden.** None of the 32 industry pages directly links an SDS, TDS, application guide, compatibility document, certification record, or case-study PDF. Visitors must leave the page and inspect product pages.
4. **Visual proof is uneven.** Twenty-one pages have no field gallery. Several existing galleries show generic close-ups, screenshots, containers, or unrelated assets instead of the stated industrial task.
5. **Several public PDFs need immediate governance review.** One public case study is marked confidential. Another says no safety data and no written procedure were available. Several legacy documents use broad safety, certification, or performance claims without visible scope, revision date, or substantiation.
6. **The 16 supplemental pages overlap the 16 canonical sectors.** They can remain as targeted landing pages, but each needs a distinct buyer, task set, evidence pack, and canonical-link strategy. Otherwise they read as near-duplicate SEO pages.

## Verification summary

| Check | Result |
|---|---:|
| Public industry routes | 32/32 HTTP 200 |
| Local browser render | 32/32 H1 present |
| Broken rendered images | 0 |
| Horizontal overflow | 0 pages |
| Browser console errors | 0 |
| Failed browser requests | 0 |
| Canonical sectors in CMS snapshot | 16 |
| Supplemental static landing pages | 16 |
| Pages with field galleries | 11/32 |
| Pages with no field gallery | 21/32 |
| Direct PDF/document links on industry pages | 0/32 |
| Product/SDS PDFs reviewed | 43 |
| Product/SDS PDFs live | 43/43 |
| Public proof PDFs reviewed and live | 4/4 |
| Live canonical image files matching local replacements | 0/16 |

The browser-quality results establish that the page templates render cleanly. They do not establish that the prose, claims, or proof are technically adequate.

## Complete industry inventory

### Canonical CMS sectors

1. Construction — `/industries/construction.html`
2. Data Centers — `/industries/data-centers.html`
3. Distribution / Cold Storage — `/industries/distribution-cold-storage.html`
4. Education — `/industries/education.html`
5. Food & Beverage — `/industries/food-beverage.html`
6. Golf Courses — `/industries/golf-courses.html`
7. Healthcare — `/industries/healthcare.html`
8. Hotels / Property Management — `/industries/hotels-property-management.html`
9. HVAC / Water Treatment — `/industries/hvac-water.html`
10. Manufacturing — `/industries/manufacturing.html`
11. Marine — `/industries/marine.html`
12. Military / Government — `/industries/military-government.html`
13. Municipalities & Water Utilities — `/industries/municipalities-water-utilities.html`
14. Oil & Gas — `/industries/oil-gas.html`
15. Plumbing — `/industries/plumbing.html`
16. Solar / Panel Cleaning — `/industries/solar-panel-cleaning.html`

### Supplemental targeted pages

17. Aviation — FBOs, MRO, Airports — `/industries/aviation-fbos-mro-airports.html`
18. Breweries, Distilleries & Wineries — `/industries/breweries-distilleries-wineries.html`
19. Drone Cleaning Companies — `/industries/drone-cleaning-companies.html`
20. Fleet, Trucking & Car Washes — `/industries/fleet-trucking-car-washes.html`
21. Food Processing & Agriculture — `/industries/food-processing-agriculture.html`
22. Golf Courses & Sports Facilities — `/industries/golf-courses-sports-facilities.html`
23. Healthcare & Senior Living — `/industries/healthcare-senior-living.html`
24. Hotels, Resorts & Property Management — `/industries/hotels-resorts-property-management.html`
25. Marine, Marinas & Boatyards — `/industries/marine-marinas-boatyards.html`
26. Mechanical Contractors & Water Treatment — `/industries/mechanical-contractors-water-treatment.html`
27. Oil & Gas / Industrial Plants — `/industries/oil-gas-industrial-plants.html`
28. Pressure-Washing & Soft-Wash Contractors — `/industries/pressure-washing-soft-wash-contractors.html`
29. Restaurants & Commercial Kitchens — `/industries/restaurants-commercial-kitchens.html`
30. Schools & Universities — `/industries/schools-universities.html`
31. Solar Farms & Panel Cleaning — `/industries/solar-farms-panel-cleaning.html`
32. Warehousing & Distribution Centers — `/industries/warehousing-distribution-centers.html`

## Required site-wide changes

### P0 — before promoting industry pages

1. **Publish the local canonical image set and content snapshot.**
   - Deploy the 16 local `img/industries/samples/*.webp` replacements.
   - Publish the current `data/content/industry-sectors.json`.
   - Verify with cache-busted URLs and byte hashes, not only filenames.

2. **Remove the public Walmart refrigeration PDF pending authorization.**
   - `docs/walmart-refrigeration-case-study.pdf` is publicly reachable while marked `Confidential | May 2026`.
   - It also makes high-risk claims including “World’s #1,” “Agreed OEM Standard,” “up to 94% efficiency restored,” and “8–22% energy reduction.”
   - Republish only with written customer/OEM permission, methods, baseline, sample size, conditions, calculation method, and an approved public edition.

3. **Remove or rewrite the Trinidad tank-cleaning proof.**
   - `docs/trinidad-tank-cleaning-test.pdf` states: “Safety: No data was available” and “Test Procedure: No procedure was written.”
   - A tank-cleaning proof item cannot be public without the safety boundary, isolation, gas-freeing/confined-space controls, procedure, waste handling, and customer approval.

4. **Run technical/legal claim review over all public PDFs and labels.**
   - Fourteen of 43 product/SDS PDFs contain broad `non-toxic`, `safe`, or `zero hazard` wording detected during text review.
   - Certification logos and references include NSF, CleanGredients, USDA, NAVSEA, Pareve, EPA/FIFRA-related wording, and other marks. Confirm current status for the exact SKU, use, manufacturing location, and scope.
   - Cleaning, sanitizing, and disinfecting must remain separate claims. Link an exact EPA registration/label only where one exists.

### P1 — conversion and buyer verification

1. Add an **“Applications and proof”** module to every page:
   - task;
   - asset/substrate;
   - soil/deposit;
   - suggested product;
   - dilution/concentration range;
   - temperature, dwell, agitation, and rinse;
   - shutdown/containment boundary;
   - verification endpoint;
   - direct links to current SDS, TDS, guide, compatibility data, and relevant case study.

2. Replace generic market language with task-led copy. The first screen should answer:
   - What exactly gets cleaned?
   - What is being removed?
   - How is it applied?
   - What cannot be claimed or done?
   - What evidence can the buyer download now?

3. Localize the repeated CTA. All 32 pages currently end with “Put the current chemical on the table.” Keep the shared component, but prefill each form with the industry’s asset, soil, operating conditions, materials, wastewater route, and buying deadline.

4. Add a field-proof standard. Do not label an image “field proof” unless MASEST can identify:
   - customer/site permission;
   - date;
   - asset and substrate;
   - soil/deposit;
   - product and concentration;
   - procedure;
   - before/after endpoint;
   - result and limitations.

5. Establish canonical/supplemental relationships. Supplemental pages should target a genuinely narrower buying job and link back to the canonical sector. Merge pages that cannot sustain unique tasks, proof, and search intent.

### P2 — document governance

1. Put owner, document ID, revision, effective date, superseded status, and approval on every customer-facing PDF.
2. Replace stale internal metadata. Twenty-five of 43 reviewed PDFs have empty or misleading title metadata.
3. Repair `vertkleen-lam3-sds.pdf`; extracted text contains broken glyphs.
4. Standardize legacy TDS, label, guide, and case-study templates.
5. Add a public document index by SKU and revision. Preserve stable URLs while marking superseded documents.

## Customer-facing documentation audit

### Availability

The 13 products recommended across the industry pages resolve to 38 direct PDF references on product pages. The broader `docs/sds` library contains 43 PDFs; all 43 return HTTP 200 as `application/pdf`, and production file sizes match local files.

The availability problem is therefore not upload failure. It is **industry-page discoverability and evidence selection**.

Products with strong direct-document sets include WaterSafe 60, HCR, CR HD, Descaler, LAM3, MultiWash, Neutral, Purgo, Torque, and CR. Alumibrite, CR HD Low Foam, and CR2 currently rely substantially on request-only documents. Industry pages using those products should not imply that the verification file is immediately downloadable.

### High-risk or weak artifacts

| Artifact | Finding | Recommendation |
|---|---|---|
| `walmart-refrigeration-case-study.pdf` | Public but marked confidential; major OEM/performance claims | Remove immediately; obtain permission and substantiation |
| `trinidad-tank-cleaning-test.pdf` | No safety data; no written procedure | Remove or rebuild as a controlled retrospective |
| `walmart-dc-brochure.pdf` | “Approved by Crown Forklift and Plug Power” plus broad performance/certification framing | Require written authorization, dated scope, methods, and approved public wording |
| `brewery-cip-trial-brewlando.pdf` | Useful four-page trial, but missing visible revision/metadata and a complete validation boundary | Add procedure, concentration/temperature/time/flow, rinse endpoint, sanitation boundary, and customer signoff |
| `vertkleen-cooling-tower-brochure.pdf` | “Zero hazards” and broad acid-fume/hazmat framing | Technical/legal review; replace absolutes with measured, scoped statements |
| `vertkleen-cr-tds.pdf` | “Non-Toxic” and “Zero Corrosion Rate” | Cite test method, materials, conditions, detection limit, and limitations |
| `vertkleen-crhd-tds.pdf` | “Non-Toxic” plus certification/logo implications | Scope claims to exact SKU and current listing |
| `vertkleen-neutral-tds.pdf` | “Non-Toxic” | Replace with hazard-classification and use-condition language |
| `vertkleen-multiwash-tds.pdf` | Food-contact/EPA/FIFRA-related wording; public hazard presentation may conflict across artifacts | Reconcile TDS, label, SDS, and allowed-use wording |
| `watersafe60-tds.pdf` | Safety, sanitizing, and NSF-related claims | Separate cleaning from sanitizing; link exact current listing and use |
| Purgo label/SDS set | Food-contact and minimum-risk pesticide framing | Ensure the label governs every claim; verify federal exemption and state registration requirements |

Examples of stale metadata include:

- `vertkleen-cr-label.pdf` titled “SapH HCR”
- `vertkleen-cr-tds.pdf` titled “Data Barracuda.pub”
- `vertkleen-descaler-tds.pdf` titled “Blow Out Sales.pub”
- `vertkleen-hcr-tds.pdf` titled “EnviroSyn HCR Lit”
- `vertkleen-multiwash-tds.pdf` titled “MSDS Fortis.pub”
- `watersafe60-titration-test.pdf` titled “syntech water test CONF DNSO.xls - Compatibility Mode”

Only two of 43 reviewed PDFs exposed a detectable revision/effective date in extracted text. That is insufficient for procurement, EHS, QA, healthcare, food, utility, military, or engineering review.

## Page-by-page audit

### 1. Construction

**Verdict:** Refine prose; replace gallery.

- **Current focus:** Active-job chemistry; Descaler, HCR, CR HD, LAM3.
- **Prose:** Good buyer framing, but “construction” remains too broad. Lead with concrete-pump/forms/tool cleanup before residue cures, form-release and hydraulic oil removal, masonry efflorescence, and coating-preparation cleaning. Separate uncured concrete residue from cured mineral deposits.
- **Visuals:** New local lead is contextual. Existing gallery is mostly generic surface/grime close-ups and does not prove a construction task.
- **Materials:** Add concrete/masonry/metal/coating compatibility, runoff pH, collection/neutralization SOP, and task-specific demos. Include silica-aware process language; cleaner does not eliminate silica controls.

### 2. Data Centers

**Verdict:** Strong foundation; make operating boundaries explicit.

- **Current focus:** Uptime/compliance; WaterSafe 60, HCR, Descaler.
- **Prose:** Keep the uptime angle. Name isolated plate heat exchangers, cooling towers, condensers, water-side economizers, CDUs, strainers, and generator/mechanical areas. Never imply wet cleaning on energized IT equipment.
- **Visuals:** New local lead is relevant. No field gallery exists.
- **Materials:** Add a data-center method of procedure covering redundancy state, isolation, leak containment, protected sensors, flush endpoint, waste route, recommissioning, rollback, and zero-impact evidence.

### 3. Distribution / Cold Storage

**Verdict:** Refine prose; replace two gallery cards.

- **Current focus:** Cold-chain uptime; Descaler, CR HD, MultiWash, Purgo.
- **Prose:** Target low-temperature floor soil, forklift grease/tire marks, dock plates, door curtains, evaporator housings, guards, pans, and accessible coils. Add freezer shutdown/defrost and slip-reopening criteria.
- **Visuals:** Forklift image is useful. Dashboard and brochure/table screenshots are unreadable as gallery cards and should become linked evidence, not “field” images.
- **Materials:** Add low-temperature efficacy, freeze point, galvanized/aluminum/copper compatibility, food-area rinse/use statement, wastewater route, and floor drying/reopening data.

### 4. Education

**Verdict:** Rework task hierarchy and gallery.

- **Current focus:** Campus continuity; CR, HCR, WaterSafe 60, LAM3.
- **Prose:** Split custodial work from plant/facilities work: cafeterias, restrooms, locker rooms, athletic areas, exterior masonry, HVAC coils/condensate, fleet, and workshops. Explain why CIP-positioned CR/HCR products belong on a school page or replace them with task-matched recommendations.
- **Visuals:** Existing stained-wall, product-jug, and close-up images feel generic and low-evidence. Show a closed wash area, campus masonry test patch, mechanical-room coil task, or fleet wash pad.
- **Materials:** Link VOC/fragrance/residue data, dilution control, locked storage, occupied-space restrictions, floor-finish/slip compatibility, and a district pilot with reopening criteria. Do not imply disinfectant performance.

### 5. Food & Beverage

**Verdict:** Best task framing; strengthen validation and replace weak proof imagery.

- **Current focus:** CIP proof; CR, HCR, CR HD, Neutral, MultiWash.
- **Prose:** Keep “CIP proof beats a food-safe slogan.” Add the full CIP variables: soil, metallurgy/elastomer, concentration, temperature, time, turbulent flow/velocity, foam profile, rinse endpoint, and verification. Separate CIP, COP, exterior washdown, cleaning, and sanitation.
- **Visuals:** New local CIP lead is strong. Stainless process vessels are useful. Chemical-pouring imagery has poor handling optics, and one equipment caption appears more specific than the visible asset supports.
- **Materials:** Make the Brewlando trial downloadable here after revision. Add concentration/conductivity correlation, soil-loading capacity, rinse requirements, exact food-area listing, compatibility, and customer-selected ATP/micro/allergen verification.

### 6. Golf Courses

**Verdict:** Refine; add field proof.

- **Current focus:** Grounds, carts, irrigation, clubhouse; Torque, LAM3, HCR, MultiWash, Purgo.
- **Prose:** Prioritize mower decks/reels, utility vehicles/carts, wash pads, shop floors, fueling areas, isolated irrigation strainers/pumps, and hardscapes. Avoid generic “safe near turf/water” language without exposure limits.
- **Visuals:** New lead and supplemental wash-pad lead are relevant. Canonical page has no gallery.
- **Materials:** Add turf/plant contact limits, runoff controls, metal/paint/rubber compatibility, separator compatibility, and a mower/fleet case study measuring cleaning time, water, finish condition, and washwater handling.

### 7. Healthcare

**Verdict:** Rework the visual proof and claim boundary.

- **Current focus:** Maintenance continuity; WaterSafe 60, Purgo, HCR, CR, Descaler.
- **Prose:** Decide whether the page sells environmental-services cleaning, facilities/water-side maintenance, or both. If both, make them separate tracks. Cleaning must be described as the step before facility-approved disinfection; do not imply pathogen kill without an exact registered label.
- **Visuals:** New local lead is contextual. Current gallery shows dirty coil/ledge/threshold close-ups rather than a hospital water-side or controlled EVS task.
- **Materials:** Add residue/odor/VOC data, surface compatibility, healthcare application SOP, EPA-label links only for registered uses, and water-management-plan boundaries for towers/heat exchangers.

### 8. Hotels / Property Management

**Verdict:** Refine; add evidence.

- **Current focus:** Guest-facing maintenance; MultiWash, LAM3, Descaler, Neutral.
- **Prose:** Replace “one safer chemical set” with task-specific lanes: pool tile/deck/grout during closure, kitchens, laundry/service areas, façades/walks, and water-side mechanical equipment. “Safer” requires a named comparison and conditions.
- **Visuals:** New local lead and supplemental pool-deck lead are relevant. No gallery exists.
- **Materials:** Add a surface matrix for stone, grout, pool finishes, stainless, glass, sealants, fabric, and slip-resistant floors; closure/reopening SOP; odor/residue data; and a hotel case study with guest-area downtime.

### 9. HVAC / Water Treatment

**Verdict:** Strong market fit; tighten chemistry and performance proof.

- **Current focus:** Cooling-tower program; WaterSafe 60, Purgo, HCR, CR.
- **Prose:** Name scale, corrosion products, silt, and organic fouling across towers, basins, plate/shell heat exchangers, condensers, boilers, loops, coils, pans, and strainers. Avoid Legionella-control implications unless supported by an exact registered biocide label.
- **Visuals:** New lead is strong. Existing coil before/after images are useful but underrepresent the page’s tower, loop, and exchanger focus.
- **Materials:** Add deposit analysis, capacity, corrosion-coupon data, metallurgy/elastomer matrix, sizing calculator, neutralization/disposal, return-to-service SOP, and pressure-drop/approach-temperature results.

### 10. Manufacturing

**Verdict:** Rework examples and gallery.

- **Current focus:** Production uptime; HCR, CR, CR HD, Descaler.
- **Prose:** Replace broad “production” copy with presses, conveyors, machine bases, guards, tooling, parts, cutting/hydraulic oil, coolant film, floors, traffic lanes, outage cleaning, and pre-coating preparation.
- **Visuals:** Current engine/filter imagery reads as automotive aftermarket, not a manufacturing line or maintenance cell.
- **Materials:** Add OEM/paint/elastomer compatibility, residue/noninterference testing, LOTO-aware SOP, soil-specific test methods, and a case study reporting labor, line downtime, wastewater, and post-clean acceptance.

### 11. Marine

**Verdict:** Refine; diversify gallery.

- **Current focus:** Enclosed-space handling; Torque, Alumibrite, MultiWash, CR HD.
- **Prose:** Name salt, oxidation, waterline film, biological residue, bilge/engine-room grease, and the exact substrates: aluminum, gelcoat, painted steel, stainless, nonskid, sealants, and glazing. State washwater-capture requirements; “biodegradable” is not discharge permission.
- **Visuals:** New lead is strong. Two gallery images are near-duplicate outboard/boat views, and the third is an ambiguous wet surface.
- **Materials:** Add coating/substrate compatibility, aquatic-toxicity/phosphorus data, capture/disposal guidance, and a boatyard/fleet case study with finish retention and corrosion observation.

### 12. Military / Government

**Verdict:** Good procurement premise; replace generic proof.

- **Current focus:** Public-buyer documentation; HCR, Descaler, CR HD, Alumibrite.
- **Prose:** Target fleet/depot/ground-support equipment, maintenance-bay floors, tools, parts, spill-containment surfaces, public works, transit assets, and coating preparation. Avoid implying military qualification from generic customer history.
- **Visuals:** Rust close-up, container/jar, and diamond-plate images do not show a government asset or controlled depot task.
- **Materials:** Add country of origin, lot traceability, shelf life, lead time, insurance, exact current certifications, substitution/equivalency matrix, coating/connector/seal compatibility, and an approved pilot protocol.

### 13. Municipalities & Water Utilities

**Verdict:** Refine; add utility-grade evidence.

- **Current focus:** Bid-ready water/facilities chemistry; CR2, WaterSafe 60, HCR.
- **Prose:** Name isolated pumps, valves, screens, grit equipment, clarifiers, maintenance shops, scale removal, potable storage, and wastewater equipment. Separate cleaner instructions from utility-owned disinfection, sampling, and return-to-service.
- **Visuals:** New local lead is relevant. No gallery exists.
- **Materials:** CR2 lacks a direct public verification set. Add exact intended-contact surfaces, applicable NSF listing, compatibility, pH/COD/metals data where relevant, confined-space/LOTO boundary, neutralization, waste route, flush/sampling endpoint, and a utility case study.

### 14. Oil & Gas

**Verdict:** Rework proof and safety language.

- **Current focus:** Rigs/terminals and chemical hazard; HCR, Descaler, CR HD, Neutral.
- **Prose:** Lead with isolated valve manifolds, pumps, skids, exchangers, tools, tank exteriors, loading areas, containment, and pre-inspection cleaning. Tank-outage work must be one controlled step inside isolation, gas-freeing, confined-space, and waste-recovery plans.
- **Visuals:** New lead is relevant. Existing cone/beaker/rust close-ups do not demonstrate a facility task.
- **Materials:** Do not use the current Trinidad document as public proof. Add flash point/VOC, steel/coating/gasket/seal compatibility, LOTO boundary, wash recovery, rinse endpoint, waste characterization, and a safer pump/skid or exchanger case study.

### 15. Plumbing

**Verdict:** Good lead message; replace gallery.

- **Current focus:** Indoor scale removal; Descaler, HCR, Neutral.
- **Prose:** Target closed-loop tankless-water-heater and isolated exchanger descaling, fixtures/valves/aerators, serviceable drain components, and complete flush/return-to-service. Avoid broad “muriatic acid replacement” claims without task-specific performance and material comparison.
- **Visuals:** New local lead is relevant. Existing sill/edge close-ups do not show plumbing equipment.
- **Materials:** Add OEM acceptance, metal/elastomer matrix, concentration/time/temperature limits, neutralization, flush volume, pH/conductivity endpoint, potable-water boundary, and a named heater/exchanger case study.

### 16. Solar / Panel Cleaning

**Verdict:** Refine; add warranty and performance proof.

- **Current focus:** Scale cleaning/runoff; MultiWash, LAM3.
- **Prose:** Name dust, pollen, bird residue, soot, and hard-water spotting. Put module-manufacturer instructions, water quality, glass/coating compatibility, connector protection, temperature/irradiance limits, and qualified-person boundaries before chemistry.
- **Visuals:** New lead and supplemental robot-cleaning lead are relevant. Canonical page has no gallery.
- **Materials:** Add manufacturer/warranty position, abrasion/residue/reflectance test, brush/pad specification, electrical/fall/runoff SOP, and a normalized output case study rather than an unqualified energy-gain claim.

### 17. Aviation — FBOs, MRO, Airports

**Verdict:** Rework urgently.

- **Current focus:** Corrosion-aware degreasing; CR HD, Alumibrite.
- **Prose:** Define the safe sales boundary. Prefer ground-support equipment, hangar floors, non-flight-critical maintenance parts, and approved corrosion-control workflows. “Aviation” must not imply airframe, avionics, engine, acrylic, coating, sealant, or OEM approval.
- **Visuals:** Lead image is a Walmart forklift proof image and is unrelated to aviation.
- **Materials:** Add exact materials/testing, residue, rinse, corrosion, and OEM/operator approval. FAA corrosion guidance emphasizes aircraft-specific compounds, restrictions, rinsing, and OEM procedures. Replace the page or narrow it until MASEST has aviation-specific compatibility evidence.

### 18. Breweries, Distilleries & Wineries

**Verdict:** Refine; strongest supplemental page.

- **Current focus:** CIP versus acid/caustic sequences; CR, HCR, CR HD Low Foam.
- **Prose:** Differentiate fermenters, bright tanks, transfer lines, fillers, pasteurizers, stills, and winery tartrate/mineral/organic soils. State which chemistry handles which soil and where an acid, alkaline, or staged cycle remains necessary.
- **Visuals:** CIP lead is relevant. No field gallery exists.
- **Materials:** Add low-foam circulation data, concentration/temperature/time/flow, metallurgy/elastomer compatibility, rinse endpoint, sanitation boundary, and the revised Brewlando trial. CR HD Low Foam needs direct downloadable documents.

### 19. Drone Cleaning Companies

**Verdict:** Rework positioning and compliance boundary.

- **Current focus:** Drone-delivered exterior cleaning; MultiWash, LAM3, CR HD.
- **Prose:** “Drone-rated” is an unsupported approval-style phrase unless the chemistry has payload, pump, seal, hose, nozzle, atomization, overspray, and target-surface compatibility evidence. Clarify that this page serves drone cleaning operators, not drone maintenance.
- **Visuals:** Lead drone image is relevant. No field gallery exists.
- **Materials:** Add UAS platform compatibility, payload SDS/hazard classification, droplet/overspray controls, runoff, target-substrate matrix, jobsite exclusion zone, and operator compliance checklist. FAA rules apply to commercial UAS operations; carrying hazardous materials under Part 107 is prohibited.

### 20. Fleet, Trucking & Car Washes

**Verdict:** Rework lead visual; sharpen lane-based tasks.

- **Current focus:** Wash/wax/grease/aluminum; Torque, CR HD, MultiWash, Alumibrite.
- **Prose:** Separate exterior fleet wash, chassis/engine-area degreasing, aluminum brightening, cab/interior hard surfaces, wash-bay floors, and automatic-system compatibility. Avoid implying one chemistry safely covers every finish.
- **Visuals:** Current lead is a marine outboard/boat image and is wrong for this page.
- **Materials:** Add paint, aluminum, glass, rubber, plastics, decals, polished metal, wax/sealant, reclaim-system, separator, and wastewater compatibility. EPA guidance identifies oil, grease, metals, salts, detergents, and cleaners in vehicle washwater; add capture/discharge instructions.

### 21. Food Processing & Agriculture

**Verdict:** Split or substantially re-scope.

- **Current focus:** Plant/farm CIP and washdown; CR, HCR, CR HD Low Foam.
- **Prose:** Food processing and agriculture are not one task set. Processing needs sanitary equipment/CIP/COP and food-area controls. Farms need harvest/packing equipment, produce-contact surfaces, animal-area boundaries, soil/organic load, runoff, and crop/livestock exposure limits.
- **Visuals:** CIP lead supports processing but not agriculture.
- **Materials:** Either create separate pages or add clearly separated modules. For covered produce operations, FDA rules require adequate cleaning and, where necessary, sanitizing of food-contact equipment/tools. Add exact intended use, rinse, crop/animal exposure, equipment compatibility, and runoff controls.

### 22. Golf Courses & Sports Facilities

**Verdict:** Differentiate from canonical golf page or merge.

- **Current focus:** Grounds work near turf/water; Torque, LAM3, HCR, MultiWash, Purgo.
- **Prose:** Keep this page only if “sports facilities” gains unique tasks: bleachers, synthetic turf perimeter, locker/service areas, stadium hardscape, fleet, and pressure-wash runoff. Otherwise canonicalize to Golf Courses.
- **Visuals:** Wash-pad lead is relevant. No gallery exists.
- **Materials:** Add turf and synthetic-surface compatibility, runoff containment, slip/reopening criteria, finish testing, and sports-facility proof.

### 23. Healthcare & Senior Living

**Verdict:** Rework; do not sell only a “quieter handling story.”

- **Current focus:** Cleaning near vulnerable people; Neutral, MultiWash, Descaler.
- **Prose:** Separate resident-care environmental surfaces, kitchens/laundry/service areas, and plant-room work. State occupancy restrictions, cleaning frequency, residue, fragrance, ventilation, and the handoff to an EPA-registered disinfectant where required.
- **Visuals:** Hospital mechanical-room lead supports facilities maintenance but not resident-area cleaning or senior living.
- **Materials:** Add facility-approved SOP, noncritical-surface compatibility, low-residue/odor evidence, staff training, storage, audit checklist, and exact registered-label links only for disinfectants. CDC guidance stresses setting-specific protocols, material compatibility, cleaning schedules, and EPA-registered disinfectants.

### 24. Hotels, Resorts & Property Management

**Verdict:** Differentiate or merge with canonical page.

- **Current focus:** Guest-facing maintenance; MultiWash, LAM3, Descaler, Neutral.
- **Prose:** Give resorts a unique job set—pools/spas, stone and tile, outdoor food-service areas, marina/golf interfaces, laundry, and high-occupancy turnaround—or canonicalize to Hotels / Property Management.
- **Visuals:** Pool-deck lead is relevant. No gallery exists.
- **Materials:** Add stone/pool-finish compatibility, venue closure, runoff exclusion, rinse, slip testing, water rebalancing, and reopening signoff.

### 25. Marine, Marinas & Boatyards

**Verdict:** Useful narrower page; add yard/runoff proof.

- **Current focus:** Hull, salt, wax, aluminum; Torque, Alumibrite, HCR.
- **Prose:** Differentiate from Marine by focusing on boatyard wash pads, haul-out hull cleaning, dock/deck hard surfaces, parts shops, and fleet service. Remove any “acid-brightener baggage” comparison not supported by task-specific data.
- **Visuals:** Hull-cleaning lead is relevant. No field gallery exists.
- **Materials:** Add designated wash-area capture, coating/gelcoat/aluminum compatibility, antifouling boundary, aquatic data, and a yard case study. EPA shipyard guidance recommends designated pressure-wash areas with washwater containment.

### 26. Mechanical Contractors & Water Treatment

**Verdict:** Refine around contractor workflow.

- **Current focus:** Callback-risk reduction; HCR, Descaler, WaterSafe 60.
- **Prose:** Make this the installer/service-company page: system survey, deposit sample, isolation, temporary circulation, concentration/endpoint monitoring, neutralization, flush, recommissioning, and service report.
- **Visuals:** Cooling-tower/exchanger lead is relevant. No gallery exists.
- **Materials:** Add a contractor-ready MOP, system-sizing worksheet, metallurgy/seal matrix, titration/endpoint guide, waste route, and a customer signoff template.

### 27. Oil & Gas / Industrial Plants

**Verdict:** Split the buyer or canonicalize.

- **Current focus:** Scale, tanks, grease, EHS; HCR, CR, CR HD.
- **Prose:** “Industrial plants” is too broad beside Oil & Gas and Manufacturing. Narrow to refineries/terminals/process plants with isolated skids, exchangers, containment, and outage cleaning, or redirect the manufacturing portion.
- **Visuals:** Oil/gas equipment-cleaning lead is relevant. No gallery exists.
- **Materials:** Add the same confined-space, isolation, recovery, materials, and waste requirements as the canonical Oil & Gas page. Do not link the current Trinidad proof.

### 28. Pressure-Washing & Soft-Wash Contractors

**Verdict:** Rework visual, chemistry claims, and wastewater guidance.

- **Current focus:** Reduced bleach-damage risk; LAM3, MultiWash, CR HD.
- **Prose:** Separate organic staining, grease, mineral deposits, roofs, siding, masonry, concrete, and fleet/equipment. Do not imply that all soft-wash work can avoid bleach or that a product is surface-safe without substrate, concentration, dwell, and rinse limits.
- **Visuals:** Current construction concrete-pump image is not a pressure/soft-wash contractor scenario.
- **Materials:** Add substrate matrix, plant/landscape protection, overspray, dwell/rinse, pressure/nozzle limits, collection/diversion, sanitary-discharge approval, and spot-test procedure.

### 29. Restaurants & Commercial Kitchens

**Verdict:** Rework lead image and food-service evidence.

- **Current focus:** Grease, drains, hoods, floors; CR HD, Purgo, MultiWash, Neutral.
- **Prose:** Separate hood/exhaust surfaces, fry-line grease, floors, drains, walls, nonfood-contact equipment exteriors, and food-contact surfaces. Define pre-clean, rinse, sanitize/disinfect, and reopening steps. Do not imply the cleaner replaces hood-system service or a registered sanitizer.
- **Visuals:** Current CIP-skid lead is a food-processing scenario, not a commercial kitchen.
- **Materials:** Add FDA Food Code-aligned food-contact instructions, exact rinse requirements, floor-slip/reopening criteria, hood/metal compatibility, drain-use boundaries, and current label/SDS links.

### 30. Schools & Universities

**Verdict:** Differentiate procurement page from canonical Education.

- **Current focus:** District approval; Descaler, HCR, MultiWash.
- **Prose:** Keep this page if it becomes the procurement/implementation path: district pilot, chemical review, custodial training, dilution control, locked storage, occupied-space scheduling, campus rollout, and audit. Otherwise merge with Education.
- **Visuals:** Campus exterior-cleaning lead is relevant. No gallery exists.
- **Materials:** Add bid/submittal pack, pilot protocol, floor/surface compatibility, VOC/fragrance/residue data, reopening criteria, and district-approved case study.

### 31. Solar Farms & Panel Cleaning

**Verdict:** Differentiate utility-scale operations from canonical solar.

- **Current focus:** Runoff/coating concern; MultiWash, LAM3.
- **Prose:** Make this page utility-scale: robotic/vehicle access, row scheduling, water logistics, weather/irradiance windows, energized-system boundaries, vegetation/runoff, and performance normalization.
- **Visuals:** Robotic panel-cleaning lead is relevant. No gallery exists.
- **Materials:** Add module-manufacturer approval, robotic brush/pad compatibility, water quality, residue/reflectance, connector protection, work-zone/fall/electrical SOP, and normalized output evidence.

### 32. Warehousing & Distribution Centers

**Verdict:** Refine; distinguish ambient warehouses from cold storage.

- **Current focus:** Floor/fleet degreasing; CR HD, MultiWash.
- **Prose:** Target tire marks, hydraulic/forklift grease, loading docks, rack bases, battery/charging-area boundaries, floor scrubbers, pedestrian reopening, and food/nonfood storage differences.
- **Visuals:** Cold-storage floor-cleaning lead is relevant but makes the page look freezer-specific.
- **Materials:** Add concrete/coating/tire/floor-scrubber compatibility, dilution/dwell, slip and dry-time verification, wastewater route, and a warehouse case study. Use the Walmart DC document only after approval claims are substantiated.

## Recommended information architecture

Keep 16 canonical pages as the primary CMS collection. Treat supplemental pages as one of three types:

1. **Distinct regulated use:** Aviation, Drone Cleaning, Restaurants, Senior Living.
2. **Distinct buyer/workflow:** Breweries, Fleet, Mechanical Contractors, Pressure/Soft Wash, Warehousing.
3. **Likely merge/canonicalize unless unique proof is added:** Golf & Sports, Hotels/Resorts, Oil & Gas/Industrial Plants, Schools/Universities, Solar Farms.

Food Processing & Agriculture should be split. Marine/Marinas can remain distinct only if the supplemental page focuses on boatyard washwater and haul-out operations.

## Recommended delivery order

1. Remove/restrict the two P0 proof PDFs.
2. Publish and byte-verify the 16 new canonical images.
3. Add direct evidence modules to Food & Beverage, HVAC/Water, Oil & Gas, Data Centers, Healthcare, and Municipalities first.
4. Replace the clearly wrong supplemental leads: Aviation, Fleet, Pressure/Soft Wash, Restaurants.
5. Replace weak canonical galleries: Construction, Distribution, Education, Food & Beverage, Healthcare, Manufacturing, Marine, Military/Government, Oil & Gas, Plumbing.
6. Rewrite the supplemental pages around unique workflows; merge those without unique proof.
7. Reissue public PDFs under document control and complete claim/certification review.
8. Run final local and production browser QA, PDF-link checks, cache-busted image hash checks, and structured-data validation.

## Research basis

Detailed primary-source task and evidence notes for the 16 canonical sectors are in [`INDUSTRY_CLEANING_SOURCE_NOTES.md`](./INDUSTRY_CLEANING_SOURCE_NOTES.md).

Supplemental-page recommendations also rely on:

- [FAA AC 43-4B: Corrosion Control for Aircraft](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_43-4B.pdf)
- [FAA Part 107 overview](https://www.faa.gov/newsroom/small-unmanned-aircraft-systems-uas-regulations-part-107)
- [FAA hazardous-material transport by UAS guidance](https://www.faa.gov/hazmat/air_carriers/operations/drones/transporting-hazmat-by-uas-guidance.pdf)
- [EPA vehicle-wash source-water guidance](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1009V6A.TXT)
- [EPA ship and boat-building stormwater guidance](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P1007BVQ.TXT)
- [FDA 2022 Food Code](https://www.fda.gov/food/fda-food-code/food-code-2022)
- [FDA FSMA FAQ and Produce Safety Rule references](https://www.fda.gov/food/food-safety-modernization-act-fsma/frequently-asked-questions-fsma)
- [CDC healthcare environmental-cleaning procedures](https://www.cdc.gov/healthcare-associated-infections/hcp/cleaning-global/procedures.html)
- [CDC healthcare surface-risk guidance](https://www.cdc.gov/healthcare-associated-infections/hcp/infection-control/index.html)
- [CDC long-term-care enhanced-barrier FAQ](https://www.cdc.gov/long-term-care-facilities/hcp/prevent-mdro/faqs.html)

## Decision

**Do not treat the industry library as finished after image deployment.** The correct next milestone is a six-page evidence-first pilot—Food & Beverage, HVAC/Water, Oil & Gas, Data Centers, Healthcare, and Municipalities—followed by the remaining canonical pages and then differentiated supplemental pages.
