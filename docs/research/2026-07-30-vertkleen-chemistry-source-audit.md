# VertKleen chemistry source audit

Research date: 2026-07-30

Status: **internal evidence ledger — not public copy**

## Brand boundary

Public MASEST copy must name only **VertKleen** and its product names. Supplier,
private-label, and technology-family names in this note exist only to trace evidence.
Do not publish them in HTML, metadata, structured data, PDFs, image alt text, or
download names.

Source-family evidence does not prove that a current VertKleen formulation is
identical. An exact formulation claim requires a signed crosswalk covering the
VertKleen SKU, source formulation, revision, lot, SDS/TDS, patent family, and
certifications.

## Scope and method

- Reviewed all 433 files under `~/Desktop/masest`: 162 PDF, 165 PNG, 53
  JPEG/JPG, 16 DOCX, 12 XLSX, four Markdown, four CSV, and supporting files.
- Extracted text from the controlled VertKleen SDS/TDS/label set and relevant
  Desktop brochures, product sheets, technical guides, test summaries, and the
  `MASEST_Info_Request_Checklist`.
- Compared normalized five-token sequences in local VertKleen TDS files with
  current first-party manufacturer TDS files. This is evidence of shared text
  and product-family lineage, not proof of identical formulations.
- Checked current first-party product pages/TDS files and official EPA, Health
  Canada, OECD, NIOSH, Hach, and FTC sources.

## Evidence tiers

- **High** — exact VertKleen label/SDS/TDS plus matching current official record,
  or an explicit relationship inside a VertKleen-controlled document.
- **Medium** — strong source-text identity and matching technical profile, but
  no signed private-label/formulation crosswalk.
- **Low / discovery only** — supplier marketing, distributor copy, patent
  literature, undated collateral, or tests lacking exact SKU/lot/report identity.

## Technology findings

### Low-pH VertKleen products

The manufacturer describes its low-pH technology as an alternative to mineral
and buffered acids. Its technical page makes broad safety and material claims;
those are first-party marketing, not independent product substantiation
([manufacturer technology page](https://www.enviromfg.com/our-juice2)).

Patent literature proposes acid-complexing systems:

- A glycine/zwitterion–hydrochloric-acid complex with buffering and moderated
  free chloride appears in
  [US9056815B2](https://patents.google.com/patent/US9056815B2/en).
- Urea/hydrochloric-acid, inhibitor, and solvent systems appear in
  [US8580047B1](https://patents.google.com/patent/US8580047B1/en).

Patents disclose possible embodiments. They do not establish the composition,
safety, efficacy, or patent coverage of a current VertKleen lot. Public copy
should describe observable function—low-pH cleaning, descaling, mineral-deposit
removal—without claiming a molecular mechanism.

### High-pH and degreasing VertKleen products

The manufacturer describes its high-pH family as caustic/solvent replacement
technology ([manufacturer technology page](https://www.enviromfg.com/our-juice2)).
Its industrial-degreaser TDS says detergents, wetting agents, sequestrants,
penetrants, and inhibitors support removal of petroleum oils, animal/vegetable
fats, protein, and soil. It proposes hydrocarbon “encapsulation” as the
mechanism and gives 5:1, 10:1, 30:1, and 100:1 task examples
([manufacturer HD TDS](https://www.enviromfg.com/s/syncleanhdwso-tds.pdf)).

Treat “encapsulation” as supplier-proposed mechanism. Public VertKleen copy may
describe lifting/rinsing grease only where the exact VertKleen label or approved
TDS supports it.

### VertKleen Purgo

The current VertKleen label identifies:

- active ingredients: citric acid 0.60% and lemongrass oil 0.15%;
- other ingredients: water, soap bark (Quillaja saponin), and stearic acid;
- a FIFRA 25(b) minimum-risk exemption position;
- task-specific dilutions/contact times.

Source: `docs/sds/vertkleen-purgo-label.pdf`.

EPA allows citric acid and lemongrass oil as minimum-risk active ingredients,
but exemption requires all six conditions, including exact ingredient
disclosure, limited health-related claims, and no false/misleading statements
([EPA minimum-risk conditions](https://www.epa.gov/minimum-risk-pesticides/conditions-minimum-risk-pesticides),
[EPA eligible active ingredients](https://www.epa.gov/minimum-risk-pesticides/active-ingredients-allowed-minimum-risk-pesticide-products)).
EPA exemption is not EPA product registration or EPA performance approval.

The first-party Purgo TDS carries materially matching applications and dosing:
1:32 food-contact odor control, 1:64 non-food-contact odor control, 1:10
fouling/mold-stain treatment, 100 ppm cooling-tower bacteria control, and an
initial 20 ppm algae-control dose
([manufacturer Purgo TDS](https://www.enviromfg.com/s/Purgo-tds.pdf)).
These values are usable only through the current VertKleen label and its stated
surface preparation, contact time, use site, and restrictions.

The European manufacturer page says the formula uses citric acid and
`Quillaja saponaria`, and describes spray/nebulization applications
([manufacturer Purgo page](https://www.emscleaning.eu/en/purgo/)). This
corroborates ingredient/function background, but the exact VertKleen label
controls.

## Supported VertKleen routing

| VertKleen product | Internal source-family finding | Confidence | Public-copy consequence |
|---|---|---:|---|
| VertKleen HCR | Local TDS explicitly connects HCR to the low-pH source technology. | High for technology family; no exact formulation crosswalk | Say low-pH descaler for mineral scale. Keep concentration, temperature, time, and substrate attached to each result. |
| VertKleen Descaler | Local TDS explicitly names the low-pH technology. Normalized text overlap with the current manufacturer descaler TDS is 0.584. | Medium-high lineage; not exact identity | Say concentrated line cleaner/descaler for calcium, lime, scale, and rust where current VertKleen directions support it. |
| VertKleen CR HD | Local TDS repeats the manufacturer HD degreaser mechanism, use cases, and dilution examples; normalized overlap 0.485. | Medium-high lineage; not exact identity | Say high-detergency cleaner/degreaser for petroleum oils and animal/vegetable fats. Use only VertKleen-approved dilutions. |
| VertKleen Neutral | Local TDS explicitly refers to the source degreasing family, states pH 7.5, and has 0.643 normalized overlap with the manufacturer neutral TDS. | High family match; no signed crosswalk | Say neutral-pH cleaner/degreaser. Publish pH 7.5 only after exact current VertKleen TDS approval. |
| VertKleen MultiWash | Local TDS describes combined low-pH, high-pH degreasing, and odor-control components; normalized overlap with the manufacturer universal-cleaner TDS is 0.278. | Medium; formulation identity unproven | Say concentrated multi-surface cleaner, deodorizer, and degreaser. Avoid disinfectant, sanitizer, pathogen-kill, and live-microbe claims. |
| VertKleen Purgo | Same product name plus materially matching first-party use/dilution profile; local label supplies exact VertKleen composition. | High for current 25(b) label profile | Use only label-scoped odor-causing-bacteria, algae-growth, odor, and mold-stain language. Never transfer claims from other Purgo variants. |

Relevant local sources:

- `docs/sds/vertkleen-hcr-tds.pdf`
- `docs/sds/vertkleen-descaler-tds.pdf`
- `docs/sds/vertkleen-crhd-tds.pdf`
- `docs/sds/vertkleen-neutral-tds.pdf`
- `docs/sds/vertkleen-multiwash-tds.pdf`
- `docs/sds/vertkleen-purgo-label.pdf`
- `docs/sds/vertkleen-purgo-sds.pdf`

Candidate source-product names must remain internal. None of the medium-confidence
rows authorizes a public equivalence statement.

## Critical conflicts and exclusions

### VertKleen Purgo is not Purgo N

EPA’s current record for **Purgo N** identifies a different product:

- active ingredient: 1,2-hexanediol 4.25%;
- hard, nonporous, non-food-contact surfaces;
- 10-minute disinfectant contact time;
- 5-minute sanitizer contact time;
- named organism claims limited to the approved label.

Source:
[EPA-approved Purgo N label, Admin No. 82859-2](https://www3.epa.gov/pesticides/chem_search/ppls/082859-00002-20250512.pdf).

VertKleen Purgo’s current label instead describes a citric-acid/lemongrass-oil
25(b) product. Therefore:

- never call VertKleen Purgo “EPA registered”;
- never import Purgo N disinfectant/sanitizer/virus claims;
- never import Purgo N organism lists or contact times;
- never represent the two products as equivalent without a new exact-SKU
  regulatory record and formulation crosswalk.

### Health Canada claim is not current evidence

The supplier says Purgo has Health Canada disinfectant approval. The located
Health Canada record for `PURGO DISINFECTANT`, DIN 02506793, identifies 2.5%
citric acid and status **Cancelled Pre Market** effective 2022-04-01
([Health Canada product record](https://health-products.canada.ca/dpd-bdpp/info?code=99615&lang=eng)).
Do not publish a Health Canada approval claim unless MASEST obtains a current
marketed record tied to the exact VertKleen product.

### “Live microbes” evidence conflicts with the current label

`docs/sds/vertkleen-purgo-101.pdf` discusses CFU persistence, aerobic/anoxic
activity, and biological degradation. The current VertKleen Purgo label instead
lists citric acid, lemongrass oil, soap bark, stearic acid, and water; it does
not list live microorganisms.

`docs/sds/vertkleen-purgo-base-data.pdf` reports viral reductions for “Purgo raw
material Base” at ten minutes. It does not establish that the tested base is
the current 25(b) VertKleen formulation.

`docs/sds/vertkleen-purgo-bacterial-persistence-test.pdf` lacks a complete
traceable laboratory identity, exact formulation/lot crosswalk, protocol,
report identifier, and signed authorization in the public wrapper.

Quarantine all live-microbe, residual four-day kill, virucidal, disinfectant,
sanitizer, and named-pathogen claims pending exact-product reconciliation.

### Safer Choice is unsubstantiated at product level

EPA’s current Safer Choice dataset contained 4,813 rows when queried on
2026-07-30. It returned no product/company matches for VertKleen or the reviewed
source-family/product names
([EPA dataset](https://data.epa.gov/efservice/t_safer_choice_and_design_for_the_environment/JSON),
[dataset definition](https://www.epa.gov/enviro/download-additional-envirofacts-datasets)).
Historical participation in EPA’s Safer Detergents Stewardship Initiative or
use of ingredients appearing on a safer-ingredients list is not product
certification. Do not display or claim Safer Choice certification without a
current exact-product listing and mark-use permission.

### Supplier TDS method errors prevent broad safety claims

- OECD 202 is an acute Daphnia immobilization test, not a rat oral LD50 test
  ([OECD 202](https://www.oecd.org/en/publications/test-no-202-daphnia-sp-acute-immobilisation-test_9789264069947-en.html)).
- NIOSH 7903 measures inorganic acids; it does not test carbon-dioxide
  generation
  ([NIOSH method index](https://www.cdc.gov/niosh/docs/2003-154/method-8000.html)).
- Hach Method 8000 measures chemical oxygen demand; it is not a ready
  biodegradability method
  ([Hach Method 8000](https://www.hach.com/p-cod-digestion-vials-ultra-low-range-1-to-40-mgl-cod-pk25/2415825)).

Therefore supplier statements such as “non-toxic,” “100% biodegradable,”
“non-skin irritant,” “no PPE,” “safe on every surface,” and universal
non-corrosivity remain unapproved marketing assertions unless supported by
complete exact-product reports.

## VertKleen-only copy bank

Use after checking the current VertKleen label/TDS for the exact SKU:

- **VertKleen HCR:** “A low-pH descaling concentrate for calcium carbonate,
  mineral scale, and process deposits. Application concentration and contact
  time are selected for the system and deposit.”
- **VertKleen Descaler:** “A concentrated line cleaner and descaler for
  calcium, lime, scale, and rust deposits. Confirm material compatibility and
  follow the VertKleen procedure.”
- **VertKleen CR HD:** “A high-detergency cleaner and degreaser for petroleum
  oils, animal and vegetable fats, protein soils, and grime. Select dilution by
  task.”
- **VertKleen Neutral:** “A neutral-pH cleaner and degreaser for routine
  cleaning where material compatibility and frequent use matter.”
- **VertKleen MultiWash:** “A concentrated multi-surface cleaner, deodorizer,
  and degreaser for soil, grime, and oily residue.”
- **VertKleen Purgo:** “An antimicrobial multi-surface cleaner for
  label-directed control of odor-causing bacteria, odors, algae growth, and
  mold stains.”

Required qualifiers:

- “Use only as directed.”
- “Confirm material compatibility on an inconspicuous area.”
- “Results depend on deposit, concentration, temperature, contact time,
  agitation, and substrate.”
- “Request the current VertKleen label/SDS for the exact SKU.”

## Do not publish

- supplier, private-label, or source-technology names;
- “EPA registered” for VertKleen Purgo;
- disinfects, sanitizes, kills viruses, kills Legionella, or named-pathogen
  claims for VertKleen Purgo;
- Purgo N evidence as VertKleen Purgo evidence;
- live-microbe or four-day residual-kill claims;
- current Health Canada approval;
- Safer Choice certified;
- NSF/OEM/agency approval without exact current VertKleen listing;
- universally safe, non-toxic, non-corrosive, no-PPE, zero-hazard, or
  direct-discharge claims;
- patent-protected or patented-formula claims without an exact VertKleen patent
  crosswalk;
- performance superiority without a complete, auditable, exact-SKU test record.

FTC requires a reasonable basis before an objective advertising claim is
disseminated, and testing claims require the advertised level of support
([FTC Advertising Substantiation Policy](https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation)).

## Evidence still required

1. Signed VertKleen-to-source formulation crosswalk for every SKU and revision.
2. Current exact-product labels, SDSs, TDSs, and lot/formulation identifiers.
3. Regulatory certificates/listings under the VertKleen trade name or written
   private-label equivalence and mark-use authorization.
4. Complete laboratory reports with sponsor, lab, protocol, controls,
   conditions, raw/auditable results, acceptance criteria, report ID/date, and
   signature.
5. Written reconciliation of the 25(b), registered disinfectant, raw-base, and
   live-microbe Purgo materials.
