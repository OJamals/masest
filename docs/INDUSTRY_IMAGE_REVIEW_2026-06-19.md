# Industry Image Review - 2026-06-19

Scope: `industries.html`, generated `industries/*.html`, and `img/industries/*/*.webp`.

Method: parsed every industry page image, checked exact file hashes, ran a simple perceptual-hash duplicate scan, and reviewed a labeled contact sheet of all per-industry gallery images.

## Summary

No byte-identical duplicates were found inside `img/industries/*`.

Several pages reuse the same proof image across different industries. That is not technically broken, but it weakens buyer trust when a visitor clicks through multiple industry pages and sees the same proof asset reframed for different sectors.

Most gallery images are usable. The main update need is replacing a few product-only, bathroom/fixture, or lab-test images where the page promises a sector-specific field environment.

## High-Priority Updates

| Page | Image | Flag | Update action |
| --- | --- | --- | --- |
| `industries/plumbing.html` | `../img/proof/cases/ac-coil.webp` | Nonrelevant proof image. Plumbing page talks lines, fixtures, heaters, drains; the proof image is an AC coil and is also reused by healthcare and HVAC/water. | Replace the proof image with a plumbing-specific drain, fixture, water-heater, or scaled line image. If no sourced proof exists yet, use `img/industries/plumbing/g1.webp` or `g2.webp` as a temporary page image and mark it as field-gallery proof, not case proof. |
| `industries/healthcare.html` | `../img/proof/cases/ac-coil.webp` | Weak/duplicate proof image. It can support facility HVAC, but it is reused on HVAC/water and plumbing, so healthcare does not feel distinct. | Replace with occupied healthcare/campus facility proof: mechanical room, wet-area maintenance, coil service in a medical facility, or water-treatment evidence. |
| `industries/healthcare.html` | `../img/industries/healthcare/g2.webp`, `g3.webp` | Near-duplicate same fixture/sill scene; also reads more like plumbing/bathroom maintenance than healthcare operations. | Keep at most one. Replace the other with healthcare-specific field context. |
| `industries/hvac-water.html` | `../img/industries/hvac-water/g1.webp` | Caption says condenser unit cleaned in service, but the image is mostly a product jug over coil media. | Replace with an actual condenser/coil service shot or recaption as product-in-use reference. Prefer replacement. |
| `industries/education.html` | `../img/industries/education/g2.webp` | Product pail/phone shot does not visually say campus or education facility. | Replace with campus mechanical room, walkway, kitchen, restroom/wet-area, or exterior facility cleaning image. |

## Medium-Priority Updates

| Page | Image | Flag | Update action |
| --- | --- | --- | --- |
| `industries/education.html` | `../img/proof/cases/grout-moss.webp` | Duplicates construction proof image. It fits campus exteriors but is not education-specific. | Replace when a campus proof image is available; acceptable as temporary. |
| `industries/manufacturing.html` | `../img/industries/manufacturing/g1.webp`, `g2.webp`, `g3.webp` | Images read as automotive intake/filter media more than manufacturing plant maintenance. | If manufacturing is meant to signal extrusion, processing, warehousing, or plant maintenance, replace with machinery, line, floor, tank, or industrial filter evidence. |
| `industries/military-government.html` | `../img/industries/military-government/g2.webp` | Product/jar close-up is less persuasive than the DDC rust proof used elsewhere on the page. | Replace with documented equipment/component proof or procurement/documentation context. |
| `industries/oil-gas.html` | `../img/proof/cases/ddc-rust.webp`, `g1.webp`, `g2.webp`, `g3.webp` | Visually coherent around rust/descale, but mostly lab/test imagery rather than rig, terminal, pipeline, or tank-farm work. | Accept as temporary technical proof; replace with oil/gas asset field images when sourced. |
| `industries/marine.html` | `../img/industries/marine/g3.webp` | Close-up glossy surface lacks context; weaker than `g1` and `g2`. | Replace with wider hull/deck/brightwork context if available. |

## Duplicate Proof Reuse To Reduce

| Proof image | Current uses | Recommendation |
| --- | --- | --- |
| `../img/proof/cases/ac-coil.webp` | `healthcare.html`, `hvac-water.html`, `plumbing.html` | Keep for HVAC/water. Replace healthcare and plumbing with sector-specific images. |
| `../img/proof/cases/grout-moss.webp` | `construction.html`, `education.html` | Keep for construction. Replace education when campus-specific image is available. |
| `../img/proof/cases/ddc-rust.webp` | `military-government.html`, `oil-gas.html` | Keep for military/government or oil/gas, but not both long-term. Prefer DDC for military/government, and source rig/tank/pipeline rust proof for oil/gas. |

## Per-Industry Gallery Duplicate Notes

| Pair | Result |
| --- | --- |
| `img/industries/plumbing/g1.webp` + `g2.webp` | Same fixture-track scene, likely before/after. Good as a pair, but repetitive if shown as independent gallery cards. Consider replacing one with pipe, heater, or drain context. |
| `img/industries/healthcare/g2.webp` + `g3.webp` | Same sill/fixture scene. Replace one. |
| `img/industries/construction/g1.webp` + `img/industries/marine/g3.webp` | Perceptual-hash false positive. Not duplicate; both are mostly flat surfaces. No action required. |

## Pages That Look Strong Enough

| Page | Notes |
| --- | --- |
| `industries/food-beverage.html` | Brewery/tank/heat-exchanger images match the page promise. |
| `industries/marine.html` | `g1` and `g2` are relevant; only `g3` is weak context. |
| `industries/construction.html` | Gallery is relevant to exterior/concrete/site cleaning. |
| `industries/hvac-water.html` | `g2` and `g3` are relevant coil images; replace `g1`. |

## Suggested Update Order

1. Replace plumbing proof image.
2. Replace healthcare duplicate/weak images.
3. Replace education product pail shot.
4. Replace HVAC/water product-jug gallery shot.
5. Reduce reused proof images across education, oil/gas, and military/government.
