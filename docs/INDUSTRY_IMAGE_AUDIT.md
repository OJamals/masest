# Industry Image Audit and Replacement Set

Date: 2026-07-23

## Outcome

The 16 images managed by `data/content/industry-sectors.json` were replaced with
distinct, contextual industrial-cleaning scenes. The same file paths are retained,
so CMS-rendered cards, the static `industries.html` fallback, and 29 industry detail
or alias pages all receive the replacements without a URL migration.

The original files contained no exact binary duplicates, but most were functionally
repetitive: generic facility, machinery, or exterior photographs that did not show
the cleaning application described by the industry copy. Several alt descriptions
also described the old generic scene rather than an industrial-cleaning action.

## Audit and prompt set

All replacements were generated with the built-in `imagegen` workflow as
photorealistic, natural-light, documentary industrial photography. Shared prompt
constraints: landscape card-safe composition, credible PPE and equipment, restrained
water or foam, no unsafe chemical handling, no logos, no text, and no watermarks.

| Industry | Previous issue | Replacement scenario |
| --- | --- | --- |
| Oil & Gas | Generic tanks and valves; no cleaning action | Worker cleaning an isolated valve manifold and heat exchanger outside a tank farm |
| Marine | Generic boatyard hull | Boatyard worker removing salt and oxidation from a yacht hull in a lift |
| Manufacturing | Generic machinery | Worker degreasing heavy production machinery |
| Distribution / Cold Storage | Forklift-only warehouse scene | Worker cleaning a refrigerated warehouse floor near a forklift and evaporator |
| Food & Beverage | Static stainless tanks | Technician operating a clean-in-place skid connected to sanitary tanks and piping |
| Healthcare | Generic mechanical room | Facilities technician descaling a plate heat exchanger in a hospital mechanical room |
| Construction | Broad pressure-washing scene | Crew cleaning concrete-pump equipment and an active job-site slab |
| Military / Government | Generic fleet bay | Public-sector fleet worker washing an unmarked utility truck |
| Education | Generic campus exterior | Campus facilities worker cleaning stained exterior steps and walkway |
| HVAC / Water Treatment | Static cooling equipment | Technician servicing cooling-tower and heat-exchanger water equipment |
| Plumbing | Generic heater and piping | Plumber circulating descaling solution through tankless water heaters |
| Data Centers | Server aisle without maintenance context | Technician cleaning water-side cooling equipment beside an isolated server aisle |
| Golf Courses | Parked carts and equipment | Grounds worker cleaning mowers and carts on a wash pad |
| Solar / Panel Cleaning | Generic array/equipment view | Unbranded robotic soft-brush cleaner removing soil from a utility-scale array |
| Municipalities & Water Utilities | Generic treatment plant | Utility workers cleaning a removed pump impeller and valve |
| Hotels / Property Management | Generic resort walkway | Facilities worker cleaning a closed, guest-free poolside courtyard |

## Technical delivery

- Output directory: `img/industries/samples/`
- Format and dimensions: 16 WebP files at 840 by 520 pixels
- Total transferred size: 1,597,262 bytes
- Uniqueness: 16 unique paths and SHA-256 hashes
- Closest 16-by-16 average-hash distance: 54 of 256 bits
- CMS alt metadata and all public HTML fallbacks were updated to describe the new scenes
- `data/content/manifest.json` was updated to match the revised industry snapshot
- `data/content/site-images.json` was regenerated so the CMS image library indexes the replacements

## Scenario research

- Food and beverage CIP: [FDA Food Code 2022](https://www.fda.gov/media/184685/download?attachment=)
- Healthcare water-system maintenance: [CDC Environmental Infection Control — Water](https://www.cdc.gov/infection-control/hcp/environmental-control/water.html)
- Data-center cooling-water equipment: [U.S. Department of Energy — Cooling Water Efficiency Opportunities for Federal Data Centers](https://www.energy.gov/cmei/femp/cooling-water-efficiency-opportunities-federal-data-centers)
- Cooling-tower scale, corrosion, and biological-growth maintenance: [U.S. Department of Energy — Best Management Practice 10](https://www.energy.gov/cmei/femp/best-management-practice-10-cooling-tower-management)
- Solar preventive maintenance and cleaning: [NREL Best Practices for Operation and Maintenance of Photovoltaic and Energy Storage Systems](https://docs.nrel.gov/docs/fy24osti/89249.pdf)
- Oil and gas tank-area safety context: [OSHA Storage Tanks — Hazard Recognition and Solutions](https://www.osha.gov/storage-tanks/hazard-solutions)

## Verification

- CMS hydration: 16 industry rows rendered and replaced the static fallback
- Browser image audit: 16 of 16 loaded, 16 distinct `currentSrc` values, intrinsic width 840, no empty alt text
- Responsive audit: desktop and 390-pixel mobile layouts reviewed; mobile horizontal overflow was zero
- `npm run verify`: passed
  - 1,605 unit tests
  - 17 commerce browser tests
  - 41 critical UI browser tests
  - static build and site verification

Visual review artifacts:

- `/Users/omar/.codex/visualizations/2026/07/23/019f90f6-19e0-7721-9ce9-56c9b6f472db/industries-final-webp-contact-sheet.jpg`
- `/Users/omar/.codex/visualizations/2026/07/23/019f90f6-19e0-7721-9ce9-56c9b6f472db/industries-browser-desktop.png`
- `/Users/omar/.codex/visualizations/2026/07/23/019f90f6-19e0-7721-9ce9-56c9b6f472db/industries-browser-mobile.png`
