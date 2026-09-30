# AlumiBrite review and renovation

## Buyer outcome

A fleet or boat operator with dull aluminum can identify the right use, understand why this cleaner is different, see both comparative data and a real restoration, and request a sample or select a purchase size without leaving the product page.

AlumiBrite follows Purgo in `CATALOG_ORDER`. Scope: its product page, shared catalog copy, generated industry cards, and focused verification. Existing directory, story, email, and configuration work is preserved.

## Review judgment

The original page had the right broad use but repeated HF/HCl avoidance, buried the evidence behind a link, and used a generic application caption. Its strongest selling story is aluminum restoration: SynTech cleaning releases oxidation and embedded grime to reveal natural brightness, without etching to produce the finish or adding a separate neutralizing step.

The current manufacturer-linked [EMS technical sheet](https://www.enviromfg.com/s/alumibritewso-tds.pdf), also supplied locally in `Desktop/masest/alumibrite`, supports this positioning. [Synpro](https://synproproducts.com/wp-content/uploads/2017/03/Alumibrite.pdf) and [RussTech](https://www.russtech.com/surface-products/synthetic-acids) reinforce fleet use, preservation of natural brightness, and fewer cleaning steps. Copy is newly written for MASEST.

## Changes

- Lead with the restored finish and concrete applications: truck tanks, trailers, wheels, RVs, and marine aluminum.
- Identify the SynTech technology and remove repetitive replacement copy from the hero.
- Add a readable score comparison: Alumi-Brite 90.1, HF 92.5, HCl 86.3. Keep manufacturer attribution, test conditions, and the distinction between scores and percentages visible.
- Add a four-step workflow: check the finish, apply at label dilution, rinse and inspect, maintain the result.
- Display existing matched before/after close-ups of the same vessel panel on the product page, with AlumiBrite and Torque both credited. The hero proof link jumps directly to this result.
- Add specific image captions, search metadata, a sample CTA, and an application/SDS inquiry path.
- Keep existing purchasing and bulk-quote controls.

## Source and packaging decisions

- Current EMS technical data is copyright 2022 and remains linked from its website as of this review. It says to follow the product label for dilution. An older distributor sheet lists different ratios and shelf life; these were not copied into the page.
- The supplied newer general label calls the product a synthetic-acid cleaner and excludes HF/HCl. Its header says triple-zero, but the diamond shows 1-1-0. Older marine artwork says acid-free. The existing HMIS 0-0-0 page badge agrees with EMS technical data and its published SDS. Packaging artwork still needs one consistent master; no artwork was changed in this renovation.
- The 3-minute, 5%-active benchmark is a comparison protocol, not consumer mixing or dwell-time instructions. No dilution economics calculator was added from conflicting label versions.
- No new acid-free, universal finish compatibility, certification, numbered-patent, skin-safety, PPE-exemption, or environmental-discharge claims were introduced.
- The airboat PDF names AlumiBrite, Torque, and N; the website's previously approved result credits AlumiBrite and Torque. The paired result is presented as a combined restoration, not an isolated AlumiBrite trial.
- The owner confirmed on 2026-09-25 that EMS material may be used freely on MASEST as a direct reseller of the same chemical. This supersedes the earlier distribution assumption for this EMS material. The page links directly to the current EMS technical PDF, including its comparison, studies, and transport classifications. It adds attributed HMIS, DOT, VOC/phosphate, dermal-testing, and paint/glass compatibility details. Product applicability and current certification status still determine which individual claims or badges fit this page.
- The owner also reaffirmed the product's environmental and safety benefits. Biodegradability is included from EMS's current technical sheet. Unrestricted dumping is not stated: the available EMS Alumi-Brite SDS explicitly excludes storm-drain discharge. This is an actual document conflict, not a hypothetical disclaimer.

External research: [source dossier](../research/alumibrite-external-research-2026-09-25.md).

## Finish checks

- [x] Generated page and three industry references refreshed: aviation, fleet/car washes, and military/government.
- [x] Focused regression tests pass: 69 checks across product layout, AlumiBrite evidence, industry cards, metadata, commerce schema, and document review.
- [x] Read and operate the revised production build at 320, 390, 768, 1024, and 1440 pixels.
- [x] Verify pricing controls, bulk quote, keyboard-activated sample prefill, images, direct EMS PDF, and no horizontal overflow or JavaScript page errors.
- [x] Final scope and source review complete. JavaScript check passed across 383 files; static build and whitespace checks passed.

## QA evidence and limits

Browser QA used the local production build with read-only production commerce APIs and real published media. Observed prices: 1 gal $16.49; 2.5 gal $38.49; 4 x 1 gal case $59.36; 2 x 2.5 gal case $69.28. Drum/tote choices remain quote-only. The 55-gallon quote preserves the requested size, and the sample CTA opens the form with VertKleen AlumiBrite preselected. No form was submitted and no order was placed.

An isolated snapshot at commit `6896ede5`, with only the AlumiBrite changes and the authorized EMS attribution policy adjustment, passed all 85 checks across seven focused test files. This confirms the earlier catalog-directory failure came from separate active renovation. The main checkout already contains a shared update to `tests/public-document-review.test.mjs` permitting EMS attribution while preserving VertKleen product identity; that policy update is a dependency of this page. The isolated verification applies the equivalent policy without taking unrelated directory changes. This is scoped local verification, not a claim that the entire shared working tree passes CI.

Visual QA refined the comparison into a compact two-column table on mobile and used matched panel photos rather than the older, differently framed vessel shots. Lazy images were awaited before decoding in the QA harness; the actual production media returned HTTP 200.

QA script: [alumibrite-page-qa.mjs](/tmp/alumibrite-page-qa.mjs). Captures: [mobile comparison](/tmp/alumibrite-comparison-390.png), [desktop result](/tmp/alumibrite-result-1440.png), [mobile hero](/tmp/alumibrite-hero-320.png), [desktop hero](/tmp/alumibrite-hero-1440.png).

Status: renovated and locally verified; not committed, pushed, or deployed in this task. Existing unrelated work remains intact. Packaging-artwork reconciliation remains a separate content item.
