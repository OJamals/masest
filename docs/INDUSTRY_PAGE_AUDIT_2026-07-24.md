# Industry Page Audit

**Date:** 2026-07-24
**Scope:** Every public industry page, its prose, rendered visuals, recommended products, and customer-facing MASEST/VertKleen PDFs.

## Executive verdict

The 27-page industry library now has task-led operating guidance, controlled document links, localized trial briefs, source-backed imagery, and permanent redirects from six retired overlaps. P0 through P3 remediation is implemented locally and covered by fail-closed tests.

Completed:

1. Removed the confidential Walmart refrigeration case study and the unsupported Trinidad tank-cleaning report from the public build. Removed their derived images and claims. Regression tests prevent either source or derivative from returning.
2. Added `asset → soil/deposit → method → concentration → process boundary → verification → documents` guidance to every industry route.
3. Added direct controlled-document links and localized trial-request briefs to every route.
4. Replaced clearly mismatched aviation, fleet, restaurant, plumbing, healthcare, distribution, and pressure/soft-wash imagery with contextual, source-backed alternatives.
5. Consolidated duplicate assets and regenerated the optimized image catalog: 223 files, about 27.05 MB, zero exact duplicate groups.
6. Added document control and an indexed public document room for all 46 public PDFs. Source-byte and review-ledger drift now fail the release gate.
7. Added two optimized, task-specific images to every route, plus a third high-value task on 11 routes with materially different cleaning work. Active chemistry scenes distinguish wet dwell, rinse/agitation, and clean endpoint.
8. Consolidated five duplicate supplemental routes into broader maintained pages and split the mixed food-processing/agriculture route into a focused Agriculture & Farm Operations page.

Residual review:

- Twenty-three documents remain marked `claim_review_required`. Distribution approval does not equal technical or legal substantiation.
- Sixteen industry routes still lack a qualifying field gallery. Generated task scenes remain separated from field proof.
- Supplemental pages remain useful only while their task, buyer, and search intent stay narrower than their canonical parent.
- P3 production deployment remains separate from this local implementation.

## Verification summary

| Check | Result |
|---|---:|
| Public industry routes | 27/27 generated |
| Local browser render | 27/27 H1 present |
| Broken rendered images | 0 |
| Horizontal overflow | 0 pages |
| Browser console errors | 0 |
| Failed browser requests | 0 |
| Canonical sectors in CMS snapshot | 16 |
| Supplemental static landing pages | 11 |
| Task images | 75/75 |
| Pages with field galleries | 11/27 |
| Pages with no field gallery | 16/27 |
| Task-led application/proof modules | 27/27 |
| Localized trial briefs | 27/27 |
| Direct controlled-document access | 27/27 |
| Public PDFs reviewed and controlled | 46/46 |
| Public product/SDS PDFs | 43 |
| Public case/lab PDFs | 3 |
| Restricted PDFs in public tree | 0 |
| Image files / total bytes | 223 / about 27.05 MB |
| Exact duplicate image groups | 0 |

Browser and release gates establish clean rendering, source integrity, and document control. They do not approve technical, regulatory, certification, or customer-performance claims.

## Complete industry inventory

### Canonical CMS sectors

1. Construction — `/industries/construction.html`
2. Data Centers — `/industries/data-centers.html`
3. Distribution / Cold Storage — `/industries/distribution-cold-storage.html`
4. Education Facilities — `/industries/education.html`
5. Food & Beverage — `/industries/food-beverage.html`
6. Golf Courses & Sports Facilities — `/industries/golf-courses.html`
7. Healthcare — `/industries/healthcare.html`
8. Hotels, Resorts & Property Management — `/industries/hotels-property-management.html`
9. HVAC / Water Treatment — `/industries/hvac-water.html`
10. Manufacturing — `/industries/manufacturing.html`
11. Marine — `/industries/marine.html`
12. Military / Government — `/industries/military-government.html`
13. Municipalities & Water Utilities — `/industries/municipalities-water-utilities.html`
14. Oil, Gas & Process Plants — `/industries/oil-gas.html`
15. Plumbing — `/industries/plumbing.html`
16. Solar Farms & Panel Cleaning — `/industries/solar-panel-cleaning.html`

### Supplemental targeted pages

17. Aviation — FBOs, MRO, Airports — `/industries/aviation-fbos-mro-airports.html`
18. Breweries, Distilleries & Wineries — `/industries/breweries-distilleries-wineries.html`
19. Drone Cleaning Companies — `/industries/drone-cleaning-companies.html`
20. Fleet, Trucking & Car Washes — `/industries/fleet-trucking-car-washes.html`
21. Agriculture & Farm Operations — `/industries/agriculture.html`
22. Healthcare & Senior Living — `/industries/healthcare-senior-living.html`
23. Marine, Marinas & Boatyards — `/industries/marine-marinas-boatyards.html`
24. Mechanical Contractors & Water Treatment — `/industries/mechanical-contractors-water-treatment.html`
25. Pressure-Washing & Soft-Wash Contractors — `/industries/pressure-washing-soft-wash-contractors.html`
26. Restaurants & Commercial Kitchens — `/industries/restaurants-commercial-kitchens.html`
27. Warehousing & Distribution Centers — `/industries/warehousing-distribution-centers.html`

## Cleaning-task research inventory

1. **Construction:** reusable steel formwork and concrete-pump cleanup; cured and uncured concrete residue; form-release oil; tools and equipment; masonry efflorescence; post-construction hardscape.
2. **Data Centers:** isolated plate heat exchangers; chilled-water loops; CDUs, strainers, pumps, condensers, cooling towers, and mechanical-room assets; mineral scale and utility-side deposits.
3. **Distribution / Cold Storage:** freezer and warehouse floors; tire marks, pallet grime, and light oil; docks; evaporator coils; condensate areas; material-handling equipment.
4. **Education:** campus walkways and stairs; hydronic exchangers; locker rooms; gym floors; cafeterias; restrooms; air-handler coils and condensate pans.
5. **Food & Beverage:** tank and line CIP; fermenters and kettles; krausen and organic film; beer/wine stone; plate and shell-and-tube exchangers; pre-sanitation cleaning.
6. **Golf Courses:** reel mowers, carts, and turf equipment; maintenance pads; irrigation valves and sprinkler components; clubhouse hardscape.
7. **Healthcare:** isolated water-side exchangers and HVAC assets; occupied-campus exterior glass and canopies; ordinary soil removal before the approved disinfection step.
8. **Hotels / Property Management:** pool waterline scale; facade and glass staining; guest-area hardscape; kitchens; laundry; back-of-house floors.
9. **HVAC / Water Treatment:** fin-safe coil cleaning; cooling-tower fill; boilers; exchangers; condensate pans; isolated closed-loop descaling and flushing.
10. **Manufacturing:** presses and machine tools; cutting-fluid and grease residue; aqueous parts washing; filters; utility floors.
11. **Marine:** hull and waterline film; bilges; oily service residue; contained boatyard washing.
12. **Military / Government:** fleet undercarriages; pumps and utility equipment; maintenance-bay grease; controlled wash-water recovery.
13. **Municipalities & Water Utilities:** pumps, impellers, volutes, valves, and pipe flanges; lift-station equipment; mineral scale and rust deposits.
14. **Oil & Gas:** de-inventoried valve manifolds; isolated hydrocarbon and grease soil; heat-exchanger plates; contained maintenance cleaning.
15. **Plumbing:** tankless heaters; boilers and circulation loops; removed flanges and valves; mineral scale and rust.
16. **Solar / Panel Cleaning:** dust, bird residue, and hard-water spotting; utility-scale module rows; connected soft-brush and robotic cleaning.
17. **Aviation — FBOs, MRO, Airports:** ground-support equipment; hydraulic-fluid and grease soil; hangar wash bays; wheel/brake tooling; engine stands; approved aircraft-adjacent components.
18. **Breweries, Distilleries & Wineries:** fermenter and process-tank CIP; krausen; beer/wine stone; mash and utility equipment; tube-sheet descaling; floors and drains.
19. **Drone Cleaning Companies:** inaccessible high-rise glass and facades; steep residential roofs; other hard-to-reach exterior surfaces; tether, overspray, finish, and runoff control.
20. **Fleet, Trucking & Car Washes:** tractor and trailer road film; bugs; grease; wheels; cab/trailer interiors; wash bays; shop floors; aqueous parts cleaning.
21. **Food Processing & Agriculture:** empty stainless conveyors, hoppers, and augers; fat, protein, carbohydrate, and plant residue; farm and milking equipment; pre-sanitation and biosecurity cleaning boundaries.
22. **Golf Courses & Sports Facilities:** locker rooms and showers; stadium walkways and bleachers; athletic hardscape; grounds equipment; irrigation assets.
23. **Healthcare & Senior Living:** commercial laundry service areas; accessible showers and restroom mineral film; HVAC and plumbing assets; cleaning before infection-prevention chemistry.
24. **Hotels, Resorts & Property Management:** commercial washer drums; hood filters; resort hardscape; facade/glass; kitchens; pool areas; back-of-house soil.
25. **Marine, Marinas & Boatyards:** aluminum workboat oxidation; waterline film; outboard and pump components; engine-service parts; bilges; contained service pads.
26. **Mechanical Contractors & Water Treatment:** shell-and-tube tube sheets; boiler heat-exchanger cores; coils; loops; pumps; isolated recirculation and flush-cart work.
27. **Oil & Gas / Industrial Plants:** isolated pump skids; hydrocarbon soil; fin-fan cooler coils; utility exchangers; shutdown cleaning with containment and permits.
28. **Pressure-Washing & Soft-Wash Contractors:** roof algae; siding and facades; storefront concrete; atmospheric soil; traffic film; substrate-matched pressure and runoff recovery.
29. **Restaurants & Commercial Kitchens:** hood baffles and filters; flat tops, grills, fryers, and cooklines; carbonized/polymerized grease; floors before rinse and sanitation.
30. **Schools & Universities:** gym floors; locker rooms; cafeteria assets; air-handler coils; plumbing/HVAC utility assets; campus exteriors.
31. **Solar Farms & Panel Cleaning:** utility-scale rows; dust, bird residue, and water spots; tracker-safe rail-guided brushes; low-water robotic cleaning.
32. **Warehousing & Distribution Centers:** loading docks and dock plates; forklift tire marks; pallet grime; light oil; material-handling and forklift maintenance bays.

### Desktop source-corpus follow-up

- Fresh review covered 433 files under `/Users/omar/Desktop/masest`, including 216 raster images, 13 preferential `NEW` before/after images, and 26 preferential `NEW` PDFs.
- Source photos documented valid tasks—brewery CIP, heat-exchanger descaling, hood-filter cleaning, hardscape/algae removal, shop-floor degreasing, filter cleaning, marine washing, fleet cleaning, and exterior drone work—but most unused files were low-resolution snapshots, text collages, screenshots, duplicates, or poorly oriented.
- Existing high-value healthcare and marine field photos were already integrated in corrected, cropped form. Remaining source scenes were represented with higher-quality generated task imagery rather than publishing weak derivatives as evidence.
- No additional PDF was auto-published. New gym, home/property, transportation, and Yellowfin marketing pieces contain broad safety, regulatory, certification, antimicrobial, customer, or performance claims requiring owner/legal scope review. New Purgo technical documents are already represented in the controlled public set.
- Data-center prospecting notes and lead-research documents are not product substantiation or customer-facing verification and remain unpublished.

## Cleaning-task visual coverage map

`Direct` means the task appears on its own industry page. `Shared` means a technically equivalent setup is represented on a closely related page without duplicating the same scene. `Residual direct gap` identifies page-specific variants that remain text-only; shared scenes may cover the method without depicting the exact asset.

| Industry | Direct task coverage | Shared coverage | Residual direct gap |
|---|---|---|---|
| Construction | Formwork, tools, concrete-pump hopper and line cleanout | Hardscape via contractor page | Release oil; masonry efflorescence |
| Data Centers | Plate exchanger, chilled-water pump, strainer, closed-loop flush | Coils, condensers, towers, and utility exchangers via HVAC/mechanical pages | CDU-specific view |
| Distribution / Cold Storage | Freezer floor, tire/oil soil, evaporator coil | Dock, forklift, and handling equipment via warehousing page | Condensate-area detail |
| Education Facilities | Campus steps/walkway, hydronic exchanger, gym floor, and AHU coil | Cafeteria floor via restaurant page | Restroom-specific view |
| Food & Beverage | Tank CIP, plate exchanger, and food conveyor | Fermenter, mash tun, tube sheet, floor, and drain contexts via brewery/restaurant pages | — |
| Golf Courses & Sports Facilities | Reel mower, irrigation parts, protected golf-cart wash, locker-room shower, and stadium walkway | Exterior hardscape via contractor page | Bleacher-specific view |
| Healthcare | Water-side exchanger and entrance canopy | Laundry, accessible shower, HVAC, and plumbing via senior-living/mechanical pages | Restroom-specific view |
| Hotels, Resorts & Property Management | Pool waterline, facade, commercial washer, and hood filter | Hardscape and back-of-house floor via contractor/restaurant pages | — |
| HVAC / Water Treatment | Coil, cooling-tower fill, condensate pan | Boiler, exchanger, loop, and pump work via mechanical/plumbing pages | — |
| Manufacturing | Press bed, aqueous parts wash, approved reusable filter | Utility-floor recovery via warehouse/aviation pages | — |
| Marine | Hull, waterline, and bilge | Aluminum workboat, outboard, and service parts via marina page | — |
| Military / Government | Fleet undercarriage and pump parts | Utility equipment and maintenance-floor recovery via municipal/aviation pages | Maintenance-bay-specific view |
| Municipalities & Water Utilities | Impeller, valve, above-ground lift-station pump and float equipment | Pipe flanges via plumbing page | — |
| Oil, Gas & Process Plants | Gas-free manifold, exchanger plates, pump skid, and fin-fan cooler | — | — |
| Plumbing | Tankless closed-loop flush and removed flanges | Boiler, circulation loop, valve, and pump work via mechanical/municipal pages | — |
| Solar Farms & Panel Cleaning | Connected soft brush, autonomous robot, utility rows, and rail-guided brush | — | — |
| Aviation — FBOs, MRO, Airports | Ground-support equipment, parts washer, hangar floor recovery | Undercarriage and shop-floor contexts via fleet/military pages | Engine-stand-specific view |
| Breweries, Distilleries & Wineries | Fermenter CIP, exchanger tube sheet, mash-tun CIP | Tank, plate exchanger, floor, and drain contexts via food/restaurant pages | — |
| Drone Cleaning Companies | Inaccessible facade and steep residential roof | Ground-access siding and hardscape via contractor page | — |
| Fleet, Trucking & Car Washes | Tractor wash, parts washer, refrigerated trailer interior | Undercarriage and shop-floor recovery via military/aviation pages | Cab-interior-specific view |
| Agriculture & Farm Operations | Hopper/auger wash and milking-equipment CIP | Food-process conveyor, tank, and exchanger CIP via food-and-beverage page | Packing-line exterior |
| Healthcare & Senior Living | Laundry floor and accessible shower | HVAC, plumbing, and canopy contexts via healthcare/mechanical pages | — |
| Marine, Marinas & Boatyards | Aluminum workboat and outboard parts | Hull, waterline, and bilge via marine page | — |
| Mechanical Contractors & Water Treatment | Tube sheet and boiler exchanger core | Coils, loops, pumps, and valves via HVAC/plumbing pages | — |
| Pressure-Washing & Soft-Wash Contractors | Steep roof, storefront concrete, siding | High facade and glass via drone/hotel pages | — |
| Restaurants & Commercial Kitchens | Hood filters, cookline, floor degreasing | Process CIP via food-and-beverage page | — |
| Warehousing & Distribution Centers | Loading dock and forklift wash bay | Aisle-floor recovery, tire marks, and light oil via cold-storage page | — |

### High-value gap additions

Eleven new scenes were selected because they add a materially different asset, soil, or method—not another angle of an existing task:

1. Concrete-pump hopper and delivery-line cleanout over a lined washout.
2. Brewery mash/lauter-tun CIP.
3. Protected low-pressure golf-cart exterior cleaning.
4. HVAC condensate-pan cleaning and recovery.
5. Manufacturer-approved reusable industrial filter soak, rinse, and air-dry sequence.
6. Above-ground lift-station pump, guide, and float cleaning.
7. Aircraft-hangar floor degreasing with auto-scrub recovery.
8. Empty refrigerated-trailer interior washout.
9. Dairy milking-equipment CIP before sanitation.
10. Low-pressure siding wash with surface and landscape protection.
11. Commercial-kitchen floor degreasing before sanitation.

Every added active-cleaning scene shows wet dwell or wet soil, a physically connected cleaning method, and a clean/recovered endpoint. No image implies instantaneous dry-soil removal, unsupported sanitizing, inaccessible-surface access, uncontrolled wash water, or mandatory hazmat controls.

### Research basis for scene design

These sources informed equipment geometry and process boundaries. They do not substantiate VertKleen performance:

- [US EPA concrete washout guidance](https://www.epa.gov/sites/default/files/2015-11/documents/concretewashout_0.pdf) — pump hoppers and chutes require controlled washout and containment.
- [Spraying Systems brewery and winery tank cleaning](https://www.spray.com/campaigns/tank-cleaning/tank-cleaning-for-breweries-and-wineries) — fixed rotary CIP hardware is used across brew kettles, tanks, and sanitary applications.
- [Club Car vehicle cleaning and maintenance guidance](https://www.clubcar.com/en/resources/vehicle-cleaning-disinfecting-and-maintenance-guidelines) — cart cleaning must respect vehicle materials and electrical systems.
- [Carrier condensate-drain maintenance guidance](https://www.carrier.com/us/en/residential/hvac-resources/air-conditioners/how-to-clean-ac-drain-line/) — moisture and debris form sludge around condensate collection and drainage.
- [K&N reusable industrial filter cleaning guidance](https://www.knglobalfiltration.com/how-to-clean-your-industrial-air-filter-2/) — only approved washable filters should be soaked, gently agitated, rinsed, and fully air-dried; pressure washing is excluded.
- [Xylem lift-station application guidance](https://www.xylem.com/en-us/applications/lift-stations/) — pump selection and maintenance are core lift-station concerns; the scene keeps service above ground and contained.
- [Tennant aviation and transportation floor-cleaning guidance](https://www.tennantco.com/en_us/resources/industries/aviation-transportation.html) — scrub-and-recovery equipment addresses oil, grease, dust, and debris on hard floors.
- [FDA sanitary transportation guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-sanitary-transportation-food) — food-transport vehicles require sanitary operating controls; the image shows cleaning only, not compliance certification.
- [Tetra Pak dairy-equipment cleaning handbook](https://dairyprocessinghandbook.tetrapak.com/chapter/cleaning-dairy-equipment) — dairy CIP uses a repeatable recovery, pre-rinse, cleaning, rinse, and separate disinfection sequence.
- [Polymeric Exterior Products Association siding maintenance guidance](https://polymericexteriors.org/polymeric-exterior-products/siding/cleaning-and-maintenance/) — siding cleaning uses gentle tools and thorough rinse rather than a cutting pressure jet.
- [Ecolab commercial floor and drain cleaning overview](https://www.ecolab.com/solutions/inst/commercial-floor-and-drain-cleaning-products) — kitchen-floor work targets grease buildup and controlled drain/floor cleaning.

## Remediation status

### P0 — complete

- Removed both restricted proof PDFs and all public references, derived imagery, and performance claims.
- Added fail-closed tests against source names, public paths, claims, and derived image paths.
- Rebuilt canonical sector imagery and CMS snapshots.
- Reviewed all current public PDFs; 23 are unflagged by automated triage and 23 require claim substantiation.

### P1 — complete

- Every industry route now has a task-led “Applications and proof” module.
- Every module names asset, soil, chemistry, concentration, process controls, shutdown/containment, verification endpoint, material boundary, and wastewater route.
- Every route exposes controlled product documents and a localized six-input trial brief.
- Representative scenes are separated from field proof. Every page states the minimum evidence required before a field result is presented as proof.
- Canonical and supplemental relationships are encoded in the industry registry.

### P2 — complete

- All 46 public PDFs have owner, document ID, revision, effective date, approval, and approval-scope records.
- Public document room indexes every current PDF by ID and revision.
- Release checks verify PDF bytes against the review ledger and source corpus under `/Users/omar/Desktop/masest`.
- Changed or unreviewed PDF bytes fail closed.
- Restricted customer records stay in the source corpus only; they are excluded from the Pages build.

### P3 — complete locally

- Consolidated Golf/Sports, Hotels/Resorts, Oil/Gas/Process Plants, Education/Schools, and Solar/Farms into five maintained routes.
- Split the mixed Food Processing & Agriculture route: food-processing tasks moved to Food & Beverage; Agriculture & Farm Operations now has its own task, controls, documents, CTA, and gallery.
- Added permanent 301 redirects for all six retired URLs and removed those routes from source pages and sitemap.
- Preserved all 75 accepted task images. Every image still renders exactly once on a maintained page whose scope includes the depicted task.
- Reduced the public industry library from 32 routes to 27 without dropping a distinct regulated use, buyer workflow, or accepted visual.

### Remaining governance work

- Technical/legal owners must substantiate or narrow every `claim_review_required` statement.
- Customer/OEM names, certification marks, efficacy claims, and regulatory wording need written scope approval.
- Legacy visual templates and embedded PDF metadata should be modernized during each source-owner-approved reissue, without changing controlled bytes ad hoc.

## Customer-facing documentation audit

### Availability

The 13 products recommended across the industry pages resolve to controlled documents from each page. The public library contains 43 product/SDS PDFs and three approved case/lab PDFs.

The release gate verifies all 46 files against the review ledger, embeds visible document control, indexes them in the public document room, and confirms source bytes under `/Users/omar/Desktop/masest`.

Products with strong direct-document sets include WaterSafe 60, HCR, CR HD, Descaler, LAM3, MultiWash, Neutral, Purgo, Torque, and CR. Alumibrite, CR HD Low Foam, and CR2 currently rely substantially on request-only documents. Industry pages using those products should not imply that the verification file is immediately downloadable.

### High-risk or weak artifacts

| Artifact | Finding | Recommendation |
|---|---|---|
| Walmart refrigeration case study | Removed from public build; confidential source retained on Desktop | Republish only after written customer/OEM authorization and methods review |
| Trinidad tank-cleaning test | Removed from public build; source lacked safety data and written procedure | Rebuild only as a controlled retrospective with procedure, safety boundary, waste route, and customer approval |
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

The public wrapper now supplies document ID, revision, effective date, owner, and approval scope. Source-owner-approved reissues should also repair stale embedded metadata and replace broad claims with scoped evidence.

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

**Verdict:** Visual remediation complete; retain technical follow-up.

- **Current focus:** Cold-chain uptime; Descaler, CR HD, MultiWash, Purgo.
- **Prose:** Target low-temperature floor soil, forklift grease/tire marks, dock plates, door curtains, evaporator housings, guards, pans, and accessible coils. Add freezer shutdown/defrost and slip-reopening criteria.
- **Visuals:** Contextual cold-storage lead retained. Duplicate and confidential cards were removed; gallery now shows one source-backed on-site assessment.
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

**Verdict:** Visual remediation complete; claim boundary still needs owner review.

- **Current focus:** Maintenance continuity; WaterSafe 60, Purgo, HCR, CR, Descaler.
- **Prose:** Decide whether the page sells environmental-services cleaning, facilities/water-side maintenance, or both. If both, make them separate tracks. Cleaning must be described as the step before facility-approved disinfection; do not imply pathogen kill without an exact registered label.
- **Visuals:** Contextual mechanical-room lead retained. Gallery now combines coil work with source-backed UF Shands exterior-cleaning field images.
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
- **Materials:** Trinidad proof is retired. Add flash point/VOC, steel/coating/gasket/seal compatibility, LOTO boundary, wash recovery, rinse endpoint, waste characterization, and a safer pump/skid or exchanger case study.

### 15. Plumbing

**Verdict:** Visual remediation complete; strengthen method evidence.

- **Current focus:** Indoor scale removal; Descaler, HCR, Neutral.
- **Prose:** Target closed-loop tankless-water-heater and isolated exchanger descaling, fixtures/valves/aerators, serviceable drain components, and complete flush/return-to-service. Avoid broad “muriatic acid replacement” claims without task-specific performance and material comparison.
- **Visuals:** Contextual descaling lead retained. Gallery now shows a source-backed pipe-flange before/after pair plus a cleared floor drain.
- **Materials:** Add OEM acceptance, metal/elastomer matrix, concentration/time/temperature limits, neutralization, flush volume, pH/conductivity endpoint, potable-water boundary, and a named heater/exchanger case study.

### 16. Solar / Panel Cleaning

**Verdict:** Refine; add warranty and performance proof.

- **Current focus:** Scale cleaning/runoff; MultiWash, LAM3.
- **Prose:** Name dust, pollen, bird residue, soot, and hard-water spotting. Put module-manufacturer instructions, water quality, glass/coating compatibility, connector protection, temperature/irradiance limits, and qualified-person boundaries before chemistry.
- **Visuals:** New lead and supplemental robot-cleaning lead are relevant. Canonical page has no gallery.
- **Materials:** Add manufacturer/warranty position, abrasion/residue/reflectance test, brush/pad specification, electrical/fall/runoff SOP, and a normalized output case study rather than an unqualified energy-gain claim.

### 17. Aviation — FBOs, MRO, Airports

**Verdict:** Safer visual boundary implemented; aviation-specific approval remains required.

- **Current focus:** Corrosion-aware degreasing; CR HD, Alumibrite.
- **Prose:** Define the safe sales boundary. Prefer ground-support equipment, hangar floors, non-flight-critical maintenance parts, and approved corrosion-control workflows. “Aviation” must not imply airframe, avionics, engine, acrylic, coating, sealant, or OEM approval.
- **Visuals:** Unrelated forklift image removed. Lead now uses source-backed commercial-airboat aluminum restoration and explicitly states that aviation use requires written material and maintenance approval.
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

**Verdict:** Lead visual corrected; retain finish/wastewater follow-up.

- **Current focus:** Wash/wax/grease/aluminum; Torque, CR HD, MultiWash, Alumibrite.
- **Prose:** Separate exterior fleet wash, chassis/engine-area degreasing, aluminum brightening, cab/interior hard surfaces, wash-bay floors, and automatic-system compatibility. Avoid implying one chemistry safely covers every finish.
- **Visuals:** Marine image removed. Lead now shows a source-backed vehicle-wash result from the Desktop corpus.
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
- **Materials:** Add the same confined-space, isolation, recovery, materials, and waste requirements as the canonical Oil & Gas page. Trinidad proof is retired and blocked from page generation.

### 28. Pressure-Washing & Soft-Wash Contractors

**Verdict:** Lead visual corrected; chemistry and wastewater guidance still need owner review.

- **Current focus:** Reduced bleach-damage risk; LAM3, MultiWash, CR HD.
- **Prose:** Separate organic staining, grease, mineral deposits, roofs, siding, masonry, concrete, and fleet/equipment. Do not imply that all soft-wash work can avoid bleach or that a product is surface-safe without substrate, concentration, dwell, and rinse limits.
- **Visuals:** Concrete-pump image removed. Lead now shows a source-backed exterior-cleaning crew staging chemistry and tools beside a landscaped facade.
- **Materials:** Add substrate matrix, plant/landscape protection, overspray, dwell/rinse, pressure/nozzle limits, collection/diversion, sanitary-discharge approval, and spot-test procedure.

### 29. Restaurants & Commercial Kitchens

**Verdict:** Lead image corrected; retain food-service evidence follow-up.

- **Current focus:** Grease, drains, hoods, floors; CR HD, Purgo, MultiWash, Neutral.
- **Prose:** Separate hood/exhaust surfaces, fry-line grease, floors, drains, walls, nonfood-contact equipment exteriors, and food-contact surfaces. Define pre-clean, rinse, sanitize/disinfect, and reopening steps. Do not imply the cleaner replaces hood-system service or a registered sanitizer.
- **Visuals:** CIP-skid image removed. Lead now shows source-backed commercial-kitchen grease-removal work and keeps sanitation as a separate controlled step.
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
- **Materials:** Add concrete/coating/tire/floor-scrubber compatibility, dilution/dwell, slip and dry-time verification, wastewater route, and a warehouse case study. Use Walmart customer/OEM claims only after written approval and substantiation.

## Implemented information architecture

The 16 canonical CMS sectors remain the primary collection. Eleven supplemental pages remain because they cover a distinct regulated use or buyer workflow:

1. **Distinct regulated use:** Aviation, Drone Cleaning, Restaurants, Senior Living.
2. **Distinct buyer/workflow:** Agriculture, Breweries, Fleet, Marine/Marinas, Mechanical Contractors, Pressure/Soft Wash, Warehousing.

The five duplicate supplemental pages were merged into broader canonical routes. Food processing moved under Food & Beverage; Agriculture became a focused farm-operations page. Marine/Marinas remains separate around boatyard washwater and haul-out operations.

## Remaining delivery order

1. Deploy current source and verify production with cache-busted browser checks.
2. Obtain technical/legal substantiation for the 23 `claim_review_required` documents.
3. Add qualifying field galleries only where site permission and complete method records exist.
4. Reissue legacy PDFs with corrected embedded metadata and approved claim scope.

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

## Task imagery implementation

OpenAI image generation produced 75 final 1200 × 750 WebP task scenes. After P3 consolidation, every accepted file renders exactly once across 27 maintained industry galleries. Images from retired overlap pages moved only to broader pages whose scope includes the depicted task; source-backed field proof remains separate.

Prompt baseline: photorealistic industrial documentary scene; landscape 8:5; upright, mechanically plausible equipment; crop-safe margins; visible soil plus cleaning in progress or a clean result; no brands, text, product bottles, exaggerated foam, unsafe runoff, or detached tools. People were avoided unless needed to make tool handling and application credible. Workers use ordinary task-appropriate controls without chemical suits or respirators; required isolation, electrical, pressure, confined-space, cooling-tower, and wastewater controls remain visible or stated.

- **Construction:** formwork residue removal in progress; stained reusable forms staged for cleaning.
- **Data Centers:** opened fouled plate exchanger; contained chilled-water loop flush.
- **Distribution / Cold Storage:** low-foam floor auto-scrub and recovery; evaporator-coil cleaning.
- **Education Facilities:** campus stair/walkway dry-down; hydronic exchanger recirculation clean; gym floor and AHU coil.
- **Food & Beverage:** process-tank CIP spray-ball coverage; fouled-to-clean exchanger plates; food conveyor.
- **Agriculture & Farm Operations:** hopper/auger wash; milking-equipment CIP.
- **Golf Courses & Sports Facilities:** reel-mower wash pad; irrigation components; cart, locker-room, and stadium tasks.
- **Healthcare:** isolated water-side exchanger clean; ground-level water-fed canopy cleaning.
- **Hotels, Resorts & Property Management:** pool-waterline scale brushing; low-pressure facade wash; washer and hood-filter cleaning.
- **HVAC & Water Treatment:** fin-safe condenser-coil cleaning; cooling-tower fill cleaning during shutdown.
- **Manufacturing:** isolated stamping-press degreasing; aqueous parts-wash result.
- **Marine:** contained hull/waterline wash; bilge degreasing with absorbent recovery.
- **Military & Government:** fleet undercarriage wash with recovery; rust-affected pump parts staged for treatment.
- **Municipalities & Water Utilities:** pump-impeller descaling; gate-valve scale removal.
- **Oil, Gas & Process Plants:** gas-free valve-manifold degreasing; exchanger plates; pump skid and fin-fan cooler.
- **Plumbing:** tankless-heater closed-loop flush; flange scale removal with clean comparison.
- **Solar Farms & Panel Cleaning:** connected water-fed soft brush; autonomous robot; rail-guided utility-row cleaning.

## Decision

**Ship the remediated library after release gates and production browser QA pass.** Treat document-control status as distribution control only; claim approval remains a separate owner responsibility.
