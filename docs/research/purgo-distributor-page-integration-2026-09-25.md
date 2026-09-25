# Purgo distributor research and page integration

Reviewed September 25, 2026. The strongest shared selling points are practical: odor control, recognizable surface-cleaning jobs, fleet interiors, concentrate value, and straightforward ordering. These ideas are now reflected in the local Purgo page and catalog copy. No deployment performed.

## What other distributors do well

| Distributor | Useful approach | MASEST integration |
| --- | --- | --- |
| [EMS Cleaning, Spain](https://www.emscleaning.eu/en/purgo/) | Leads with multi-surface cleaning, odor control, a non-staining formula, and familiar commercial settings. Identifies EMS as manufacturer and Kefi Bosque Group as importer. | Surface-led hero; gym, locker-room, restroom, and fleet applications; colorless/non-staining benefit. |
| [Overgreen, Peru](https://www.overgreenperu.com/purgo/) | Makes the concentrate visible in several package sizes; places benefits, use settings, technical data, and SDS together. | Keep the concentrate prominent; retain the existing small-pack/bulk buying path; add package comparisons to the design brief. |
| [EMS Slovenia / VOK1](https://www.ems-slo.si/purgo-dezinfekcijsko-sredstvo-in-cistilo) | Names actual surfaces, separates everyday cleaning from specialized maintenance, and makes product advice and quotes accessible. | Replace vague “wet areas” with recognizable surfaces and jobs; strengthen the cleaning-program CTA. |
| [ZEL Distribution, Canada](https://zeldistro.com/transit) | Gives Purgo a clear fleet-interior role beside other EMS products, emphasizes dilution, and offers sample/TDS access. | Add fleet interiors and a task-focused sample CTA; retain dilution economics in the next design step. |
| [Cleanse It All](https://cleanseitall.com/purgo/) | Lists specific rooms and surfaces and presents packaging from small bottles to bulk supply. | Concrete facility uses and a clear replenishment path. |
| [EMS Russia](https://ems-rus.com/projects/purgo/) | Organizes room care, odor control, specialized applications, package selection, and advice. | Keep surface applications prominent while preserving drains and water systems as a distinct use group. |
| [Avto-Sintez, Ukraine](https://avto-sintez.com.ua/pdf/002_purgo-product-description-en.pdf) | Hosts EMS literature with a broad surface-care story and separate technical material. | Reinforces a benefit-led page with accessible application documents. The brochure is historical, copyright 2019. |

These are first-party descriptions of each distributor's offering, not independent efficacy tests. Proposed copy is original; no distributor prose, customer logos, testimonials, or photographs were copied. The [additional-source appendix](purgo-distributor-additional-insights-2026-09-25.md) records the supporting research and the unresolved EcoTivClean website lead.

## The points that made it onto our page

**Lead:** Surface cleaning and odor control.

**Hero:**

> Clean hard surfaces and control odor-causing bacteria with a versatile professional concentrate. Put Purgo to work in gyms, locker rooms, restrooms, and fleet interiors, with dedicated uses for drains and water systems.

**Product benefit:**

> Purgo targets odor-causing bacteria with a colorless, non-staining formula for everyday surface care.

**Value:**

> Mix for the job, choose the application method, and make every gallon work across your cleaning routine.

**Actions:** Plan my Purgo cleaning program · Try Purgo on your toughest odor problem.

The application list now names floors, counters, sinks, waste containers, fitness/facility spaces, fleet interiors, and dedicated water-system maintenance. The proof description now directs buyers to product documentation, laboratory reports, and application guidance.

The specific cleaning, odor-bacteria, non-staining, and surface-use points also appear in the [manufacturer's Purgo TDS](https://www.enviromfg.com/s/Purgo-tds.pdf). [EMS's antimicrobial page](https://www.enviromfg.com/sanitizers) separately supports spray-and-wipe, spray-and-leave, and fogging; these remain in the broader marketing brief. Distributor repetition was not used as a substitute for that manufacturer basis.

## Ideas carried into the next page-design step

- **Application navigation:** Facility surfaces, Fleet interiors, and Drains & water systems. Give each its own practical directions.
- **Mixing economics:** show finished-solution yield and cost beside the chosen application and live price. Keep 1:32 and 1:64 tied to their respective label uses and confirm the ratio convention.
- **Packaging comparison:** show MASEST's actual purchasable sizes, then offer a bulk quote. Distributor inventories do not establish MASEST stock.
- **Proof close to purchase:** make applicable product documents and the dated Canadian registration announcement easy to reach.
- **Application help:** give fogging customers a direct route to equipment and use guidance.

Keep the Canadian highlight in the concise form already chosen: “Health Canada disinfectant registration — 2021,” linked to the original announcement. No cancellation or non-launch narrative was added to marketing copy.

## Internal source decisions

The research exposed differences worth keeping out of copywriting decisions: EMS Cleaning calls its presentation ready-to-use; Cleanse It All starts with a 50% dilution; other distributors describe concentrates. Some repeat the older SynTech/live-microbe narrative. Those details were not imported into MASEST's formulation or directions.

Regional pathogen claims, broad environmental/safety promises, four-day protection, customer logos, and adjacent products' OEM approvals were not transferred. The current work adds stronger supported benefits without changing formula, dosing, packaging, registration, or safety documents.

## Local implementation

- [Catalog copy](../../js/main/catalog-data.js): Purgo positioning, benefits, use list, and CTAs.
- [Catalog seed](../../data/catalog.seed.json): matching product description.
- [Generated Purgo page](../../products/purgo.html): rebuilt through `npm run seo-inject`; updated visible copy, metadata, and structured-data description.
- [Marketing direction](../reviews/purgo-marketing-direction-2026-09-25.md): expanded application and buying guidance.

Existing pricing, product identity, marine alias, artwork, and technical documents remain in place. Broader image/direction reconciliation from the earlier review remains separate work. Unrelated working-tree edits were preserved; no commit, push, or deployment performed.

Validation: 61 existing tests passed across catalog, product layout, search, escaping, marine mapping, and SEO metadata. Updated two copy-specific expectations to match the new Purgo language. Browser checks at 390px and 1440px confirmed the new benefit text and quote/sample actions with no horizontal overflow. `git diff --check` passed. The generator's unrelated sitemap date churn was discarded.
