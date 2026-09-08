# MASEST blog image review — 2026-09-07

Asset review and placement decisions for the blog refresh. The inventory below distinguishes selected originals from the wider gallery.

## Evidence and scope

- Starting inventory: 27 existing posts. The refreshed `data/content/blog.json` contains those 27 revisions and eight new guides. Registered dimensions and alt text: `data/content/site-images.json`.
- Owned gallery reviewed: `/Users/omar/Desktop/masest/images` — 225 image files, approximately 304.7 MB: 74 `beforeafter`, 35 `bottles`, 41 `labels`, 20 `new jugs`, 9 `field`, 16 `clientlogo`, 11 `certs`, 7 `case studies images`, 11 `logo`, and 1 root image.
- The owned gallery contains no contact-sheet or montage artifact. Recommendations below come from original-file visual inspection with `view_image`, plus registered dimensions; filenames alone were not treated as evidence.
- 39 selected owned-gallery originals were visually inspected across this audit, not all 225. The exact paths are listed below. This is a representative sample, not a claim that the full gallery was viewed.
- `/Users/omar/Desktop/masest/updates`, `/docs`, and `/updatedline` were excluded because they belong to the parallel Luna audit. No unrelated personal content was scanned.
- The industry card metadata (`image_w: 168`, `image_h: 104`) is render metadata. The underlying registered sample files are larger: `hvac-water.webp` and `food-beverage.webp` are each 840x520; `technical-resources.webp` is 1200x800.
- The three special remote heroes were visually inspected at their canonical Supabase URLs. The registry records `hmis-000-explained.webp`, `descaling-without-acid.webp`, and `vertkleen-launch.webp` as 1200x675.

## Immediate substitutions and crop guidance

| Post | Decision | Exact asset and alt |
|---|---|---|
| Cooling-tower cleaning and water management | Replace the generic industry sample hero. | `/img/industries/tasks/hvac-water-02.webp` — “Cooling-tower fill media undergoing contained cleaning during a shutdown.” Use a landscape crop that keeps the fill/media and work area; do not crop to product-only. |
| Food-plant CIP sanitation | Replace the generic industry sample hero. | `/img/industries/tasks/food-processing-agriculture-03.webp` — “Dairy milking clusters and stainless lines connected to a contained CIP wash circuit.” Keep stainless process context. Use `/img/proof/story/cip-vessel-before-aligned-202609.webp` and `/img/proof/story/cip-vessel-after-aligned-202609.webp` only as a labeled proof pair. |
| Industrial cleaning trial scope | Replace the generic registered `technical-resources.webp` scene if the parent wants a more specific trial illustration. | `/img/blog/industrial-cleaning-trial.webp` — “Representative editorial scene of a technician preparing matched stainless-steel coupons for a cleaning trial.” It shows gloved handling, coupons, beakers, wash bottle, and meter; it is an editorial scene, not provenance for a real trial. |
| HMIS 000 explained | Replace the casual remote hero with the selected crisp studio product asset. | `/Users/omar/Desktop/masest/images/bottles/product studioshots/hvac-hcr.png` — “VertKleen HVAC HCR container on a clean white studio background with its supplied product label.” Parent-selected hero: render with `object-fit: contain` on white, preserve the native label exactly, and add no chemical text. |
| VertKleen launch / line overview | Replace the casual kitchen-cup hero with the selected crisp studio product asset(s). | Primary `/Users/omar/Desktop/masest/images/bottles/product studioshots/crhd.png` — “VertKleen CR HD container on a clean white studio background with its supplied product label.” For a two-product line overview, pair it with the selected HVAC HCR studio original above using the same contain/white treatment. The field lineup is an authentic fallback, but its household background is weaker on mobile. |
| Commercial kitchen degreasing | Keep the current hero. | The worker, cookline, and grease-bearing wall are purposeful. Crop only if the grime and hand/action remain visible. `/Users/omar/Desktop/masest/images/beforeafter/kitchenbeforeafter.png` is a strong labeled body proof; `/Users/omar/Desktop/masest/images/beforeafter/grill grease CRHD before.after.png` is a compact labeled grease proof pair. |

## Gallery findings and guardrails

- Strongest new proof candidate: `/Users/omar/Desktop/masest/images/beforeafter/kitchenbeforeafter.png` (1599x792). The same cookline edge is visibly shown with heavy brown grease on the left and a substantially cleaner stainless surface on the right. Use as a captioned before/after, not as an unlabeled hero.
- Strongest new CIP result detail: `/Users/omar/Desktop/masest/images/beforeafter/NEW CR CIP after.jpg` (4000x3000) and `/Users/omar/Desktop/masest/images/beforeafter/NEW CR CIP after 2.jpg` (4000x3000). Both show a bright stainless vessel interior and agitator after cleaning. They are after-only until a verified matching before is attached; do not imply a before/after result from these alone.
- Useful trial/process illustration: the existing local `/Users/omar/Claude/Projects/MASEST/img/blog/industrial-cleaning-trial.webp` is the best topic-specific editorial scene in the current library. It is representative artwork/illustration; no real-trial provenance should be inferred. `/Users/omar/Desktop/masest/images/beforeafter/NEW CR.JPEG` is a supplied field photo of a CR jug on a wet industrial floor beneath process equipment, but its portrait framing and partly soft label make it an in-body process image, not the hero.
- Useful HVAC-water detail: `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_5040.JPG` and `IMG_5041.JPG` visibly show mineral spotting on a condenser/cooler cover; use as a paired “observed scale” detail in HVAC/cooling-tower content. Their small landscape dimensions make them unsuitable for a full-width hero.
- Useful HVAC diagnostic detail: `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_3093(1).JPEG` visibly shows a heavily loaded fibrous coil/filter surface. Use only as a labeled maintenance “before” detail; there is no matching after in this review.
- `/Users/omar/Desktop/masest/images/field/8:14:26 mcp_photo-21112_singular_display_fullPicture.JPEG` is authentic HVAC HCR shipment context with multiple jugs on a truck tailgate, but the residential background and lack of action make it a case-study/sidebar image rather than a hero.
- Product studio files are the strongest crisp candidates for the HMIS and line-overview replacements. The visually inspected set is `/Users/omar/Desktop/masest/images/bottles/product studioshots/crhd.png`, `multiwash.png`, `torque.png`, `hvac-cr.png`, `hvac-hcr.png`, `lam3.png`, and `watersafe60.png`; they are clean, centered, readable product references on white. Use the exact native files in product callouts, comparison cards, or SDS/HMIS sections; do not redraw or restate their labels.
- `/Users/omar/Desktop/masest/images/beforeafter/heatexchanger hcr before:after.png` and `/Users/omar/Desktop/masest/images/beforeafter/NEW hcr before:after.JPEG` are comparative HCR-versus-acid plates, not chronological before/after proof. Caption them as comparison evidence only if the article has the supporting provenance.
- `/Users/omar/Desktop/masest/images/beforeafter/vertdrone before.JPG` and `vertdrone after.jpeg` are photographs of controller screens, not usable exterior-cleaning proof. Do not promote them to hero or generic proof.
- The `concrete1.JPEG`, `concrete2.JPEG`, and `concrete3.JPEG` files show real dirty concrete and a cleaning pass, but not a matched completed result. They can support construction workflow context; do not label them before/after.
- The `lam3 before.JPEG` and `lam3 after.JPEG` pair shows a visibly cleaner surface, but framing and surface context differ enough that it should remain a labeled case detail, not a hero or unqualified proof claim.
- Reject the blurry pipe close-ups, competitor Pan-Treat bottle, and cluttered workshop image as blog hero candidates. The field product lineup is authentic but cluttered; retain only for an editorial product-lineup context if needed.

### Exact owned-gallery files visually inspected

The following 39 files were opened with `view_image`; other gallery files were inventory-only:

- `/Users/omar/Desktop/masest/images/beforeafter/NEW CR.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/NEW CR before 4.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/NEW cr after.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/NEW hcr before:after.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/NEW CR CIP after.jpg`
- `/Users/omar/Desktop/masest/images/beforeafter/NEW CR CIP after 2.jpg`
- `/Users/omar/Desktop/masest/images/beforeafter/kitchenbeforeafter.png`
- `/Users/omar/Desktop/masest/images/beforeafter/grill grease CRHD before.after.png`
- `/Users/omar/Desktop/masest/images/beforeafter/concrete1.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/concrete2.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/concrete3.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/lam3 before.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/lam3 after.JPEG`
- `/Users/omar/Desktop/masest/images/beforeafter/vertdrone before.JPG`
- `/Users/omar/Desktop/masest/images/beforeafter/vertdrone after.jpeg`
- `/Users/omar/Desktop/masest/images/beforeafter/heatexchanger hcr before:after.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/crhd.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/hvac-hcr.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/lam3.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/watersafe60.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/hvac-cr.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/multiwash.png`
- `/Users/omar/Desktop/masest/images/bottles/product studioshots/torque.png`
- `/Users/omar/Desktop/masest/images/new jugs/crhd.png`
- `/Users/omar/Desktop/masest/images/new jugs/cip cr.png`
- `/Users/omar/Desktop/masest/images/new jugs/cip hcr.png`
- `/Users/omar/Desktop/masest/images/new jugs/hvac hcr.png`
- `/Users/omar/Desktop/masest/images/new jugs/hvac descaler.png`
- `/Users/omar/Desktop/masest/images/certs/HMIS.png`
- `/Users/omar/Desktop/masest/images/case studies images/S031_U0698_Dealership_area_product_dilution_table.png`
- `/Users/omar/Desktop/masest/images/field/8:14:26 205a01fb-17d3-42f3-9c1a-6178b36a15f8.jpg`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_3085(2).JPEG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_3086(3).JPEG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_3089(1).JPEG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_3093(1).JPEG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_5040.JPG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 IMG_5041.JPG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 mcp_photo-21112_singular_display_fullPicture.JPEG`
- `/Users/omar/Desktop/masest/images/field/8:14:26 photo-20661_singular_display_fullPicture.JPEG`

## All 27 current hero decisions

| Post | Current registered hero | Size | Decision |
|---|---|---:|---|
| Beer-line cleaner cost comparison | `/img/blog/comparisons/beer-line-cleaner-cost-comparison-split.webp` | 1448x1086 | Keep as a comparison card/hero; preserve the 4:3 split and both containers. |
| Car-dealership cleaning checklist | `/img/blog/car-dealership-cleaning-hero.webp` | 1440x811 | Keep; clear scrubber-in-service-bay action. |
| Commercial drain odor-control guide | `/img/blog/commercial-drain-odor-control-hero.webp` | 1440x811 | Keep; measured drain treatment is on-topic and legible. |
| Commercial gym cleaning checklist | `/img/blog/commercial-gym-cleaning-hero.webp` | 1440x811 | Keep; staff and cardio-equipment context are clear. |
| Commercial kitchen degreasing guide | `/img/blog/commercial-kitchen-degreasing-hero.webp` | 1440x811 | Keep; preserve worker, cookline, and grime-bearing wall. |
| Cooling-tower cleaning and water-management plan | `/img/industries/samples/hvac-water.webp` | 840x520 | Replace with `/img/industries/tasks/hvac-water-02.webp`; the sample is valid size but generic. |
| CR HD vs Simple Green | `/img/blog/comparisons/cr-hd-vs-simple-green-split.webp` | 1448x1086 | Keep; product comparison is clear; preserve 4:3 framing. |
| CR HD Walmart distribution-center case study | `/img/blog/warehouse-degreasing-trial-hero.webp` | 1440x810 | Keep for the case study; current scrubber scene is stronger than a generic warehouse sample. |
| Descaler fire-pump Walmart case study | `/img/blog/descaler-fire-pump-case-hero.webp` | 1440x811 | Keep; opened fire-pump component gives credible technical context. |
| Descaling without acid | `/storage/v1/object/public/content-assets/site/img/blog/descaling-without-acid.webp` | 1200x675 | Keep provisionally; tight coil detail is relevant but has no visible scale contrast or action. Replace only when a verified, better coil/descaling action image is imported. |
| Drone building-cleaning guide | `/img/industries/tasks/drone-cleaning-companies-01.webp` | 1200x750 | Keep; tethered drone and façade are directly relevant. |
| Food-plant CIP sanitation release | `/img/industries/samples/food-beverage.webp` | 840x520 | Replace with `/img/industries/tasks/food-processing-agriculture-03.webp`; use aligned CIP pair in body only. |
| HCR Brevard HVAC rust case study | `/img/blog/cases/hcr-brevard-after.webp` | 1417x714 | Keep as the after hero; keep before/after stacked with captions rather than fabricating a split. |
| HCR vs RYDLYME | `/img/blog/comparisons/hcr-vs-rydlyme-split.webp` | 1448x1086 | Keep as a comparison; preserve both containers and 4:3 ratio. |
| HMIS 000 explained | `/storage/v1/object/public/content-assets/site/img/blog/hmis-000-explained.webp` | 1200x675 | Replace. The current mobile view is a casual close crop with incomplete jug labels and a handwritten mason jar. Use the parent-selected `/Users/omar/Desktop/masest/images/bottles/product studioshots/hvac-hcr.png`; render contain on white and preserve the supplied label exactly. |
| How to clean an oxidized aluminum boat | `/img/blog/aluminum-boat-cleaning-hero.webp` | 1440x811 | Keep; unmistakable marine context, appropriate only to this topic. |
| How to descale a heat exchanger | `/img/blog/heat-exchanger-descaling-hero.webp` | 1440x811 | Keep; closed-loop hoses, pump, and exchanger show process. |
| How to remove moss and algae without pressure washing | `/img/blog/lam3-moss-algae-cleaning-hero.webp` | 1440x811 | Keep; active low-pressure treatment is clear. Use the gallery pair only as labeled supporting detail. |
| HVAC condensate drain-line cleaning guide | `/img/blog/hvac-drain-line-cleaning-hero.webp` | 1440x811 | Keep; air-handler pan and drain-line service are clear. |
| Industrial cleaning trial scope, isolate, contain, release | `/img/site/scenes/technical-resources.webp` | 1200x800 | Replace with `/img/blog/industrial-cleaning-trial.webp` if a topic-specific visual is preferred; this is a representative editorial scene, not authentic trial evidence. |
| LAM3 vs Wet & Forget | `/img/blog/comparisons/lam3-vs-wet-forget-split.webp` | 1448x1086 | Keep as a comparison; preserve 4:3 split. |
| Low-foam degreaser for parts washers and floor scrubbers | `/img/blog/low-foam-parts-washer-hero.webp` | 1440x811 | Keep; parts washer and technician provide direct equipment context. |
| Neutral-pH industrial degreaser guide | `/img/blog/neutral-ph-industrial-degreaser-hero.webp` | 1440x811 | Keep; hand sprayer, finished equipment, and oily-residue task are legible. |
| VertKleen HCR vs CLR | `/img/blog/comparisons/vertkleen-hcr-vs-clr-split.webp` | 1448x1086 | Keep as a comparison; preserve both containers and 4:3 ratio. |
| VertKleen launch | `/storage/v1/object/public/content-assets/site/img/blog/vertkleen-launch.webp` | 1200x675 | Replace. The current kitchen cup is too casual for a line overview. Use the parent-selected `/Users/omar/Desktop/masest/images/bottles/product studioshots/crhd.png`; render contain on white. Pair with the HVAC HCR studio original when a two-product line overview is desired. |
| Warehouse-floor degreasing guide | `/img/blog/warehouse-floor-degreasing-hero.webp` | 1440x811 | Keep; ride-on scrubber, lane, tire marks, and tracked grime are clear. |
| WaterSafe60 water-treatment guide | `/img/blog/watersafe60-water-treatment-hero.webp` | 1440x811 | Keep; technician sampling at a pump-station manifold is on-topic. |

## Eight new guide selections

These are already registered and served canonical R2 industry-task assets, each 1200x750. No desktop-gallery import is required; use the exact canonical paths below.

| Guide | Hero | Alt | Secondary / proof direction |
|---|---|---|---|
| Construction cleaning | `/img/industries/tasks/construction-03.webp` | Concrete-pump hopper moving from wet cement residue through rinse to clean metal over a lined washout | `/img/industries/tasks/construction-01.webp`; use concrete gallery files only as labeled workflow details. |
| Data-center cleaning | `/img/industries/tasks/data-centers-01.webp` | Fouled plate heat exchanger opened beside a closed recirculating cleaning skid in a data-center mechanical room | `data-centers-02.webp` for isolated pump/strainer context. |
| Education facilities | `/img/industries/tasks/education-02.webp` | School hydronic heat exchanger connected to a contained recirculation cleaning cart | `education-01.webp` for controlled campus exterior dry-down. |
| Hotels and property management | `/img/industries/tasks/hotels-property-management-01.webp` | Property-maintenance technician brushing mineral scale from resort pool waterline tile | `hotels-property-management-02.webp` for controlled low-pressure façade wash. |
| Golf courses | `/img/industries/tasks/golf-courses-01.webp` | Commercial reel-mower components being washed on a contained golf maintenance pad | `golf-courses-02.webp` for scaled irrigation valves beside cleaned components. |
| Solar-panel cleaning | `/img/industries/tasks/solar-panel-cleaning-02.webp` | Autonomous soft-brush robot leaving a clean pass across dusty photovoltaic panels | `solar-panel-cleaning-01.webp` for technician and water-fed soft-brush context. |
| Oil and gas | `/img/industries/tasks/oil-gas-01.webp` | Technician degreasing a de-inventoried and gas-free oilfield valve manifold over containment | `oil-gas-02.webp` for isolated heat-exchanger plate context. |
| Military and government facilities | `/img/industries/tasks/military-government-01.webp` | Public works fleet undercarriage undergoing a controlled wash with drain recovery | `military-government-02.webp` for rust-affected public-works pump parts on a contained tray. |

## Final comparison layout

All five product-comparison images fill the card and article header edge to edge. Media regions use the images' native 4:3 ratio, `object-fit: cover`, and zero padding. This removes the embedded-rectangle appearance while preserving both complete containers and their labels. Single-product studio headers retain their separate white-background treatment.

## Selected replacements

Apply these first: (1) HMIS → parent-selected studio `/Users/omar/Desktop/masest/images/bottles/product studioshots/hvac-hcr.png`; (2) launch/line overview → parent-selected studio `/Users/omar/Desktop/masest/images/bottles/product studioshots/crhd.png`, optionally paired with HVAC HCR; (3) render both with `contain` on white and register the originals through the CDN; (4) cooling tower → already-served `/img/industries/tasks/hvac-water-02.webp`; (5) food plant → already-served `/img/industries/tasks/food-processing-agriculture-03.webp`; (6) trial → representative editorial `/img/blog/industrial-cleaning-trial.webp`; (7) kitchen body proof → use a registered public equivalent where available, with `/Users/omar/Desktop/masest/images/beforeafter/kitchenbeforeafter.png` as the gallery source reference. Do not use the HCR-versus-acid plates, controller-screen drone pair, or unpaired after-only CIP images as generic before/after proof.
