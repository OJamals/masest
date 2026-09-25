# EMS Purgo: official registry verification

Checked 2026-09-25. Scope: public EPA, California DPR, Health Canada and U.S. drug-label records. Read-only research; no website changes or external submissions.

## Principal finding

The name Purgo spans materially different products. The current EPA-registered **Purgo N** is a ready-to-use 1,2-hexanediol surface disinfectant. The Canadian Purgo records found are cancelled citric-acid products. The historical **Purgo AF** drug label contains benzalkonium chloride. These records cannot support interchangeable claims for MASEST's original Purgo concentrate.

## United States: Purgo N, EPA 82859-2

The [live EPA PPLS API](https://ordspub.epa.gov/ords/pesticides/cswu/ppls/82859-2) returned:

- Product status **Active**, cancellation flag **No**. Registration and status dates: **June 19, 2019**. This is the database's historical status date, not a 2026 renewal date.
- Registrant: Environmental Manufacturing Solutions, LLC.
- Transfer from **91176-2**, The Gilla Company, LLC d/b/a Protein Express Laboratories: **June 17, 2024**.
- Formulation: **Ready-to-Use Solution**; active ingredient **1,2-Hexanediol 4.25%**, CAS 6920-22-5.
- Active alternative brand: **PURGO PRO-V**. Inactive brand names: PELS 422 and GILLA.
- Five label files returned. Newest accepted date: **May 12, 2025**. Earlier files: November 10, 2022; February 22, 2021; April 17, 2020; June 19, 2019, under the predecessor registration.

The [newest EPA label PDF](https://www3.epa.gov/pesticides/chem_search/ppls/082859-00002-20250512.pdf) includes a **May 12, 2025 notification** changing the primary brand from PELS 422 to Purgo N; EPA received the submission July 31, 2024. Its directions restrict use to hard, nonporous, **non-food-contact** surfaces. Spray from 6–8 inches; maintain wetness for the required contact time. Listed disinfection targets require **10 minutes**; listed sanitization targets require **5 minutes**. Athletic facilities, locker rooms, boats and ships are among use sites. The reviewed label contains no 1:32/1:16 dilution, 96-hour residual, electrostatic, ULV or occupied-space fogging directions. It names patents **10,194,657** and **10,813,353**; this establishes their label association, not their present legal status or equivalence to original Purgo. [EPA label, PDF pp. 1, 3–6](https://www3.epa.gov/pesticides/chem_search/ppls/082859-00002-20250512.pdf).

[California DPR's current results](https://apps.cdpr.ca.gov/cgi-bin/label/labq.pl?p_epas=828) separately show **PURGO N, 82859-2-AA, ACTIVE, 02/25/26**. That column is labelled Active / Inactive Date. It is a California record, not a new federal label date.

## Canada: current records contradict an unqualified current approval claim

EMS's [January 12, 2021 press release](https://static1.squarespace.com/static/5dee8a7c57e1833f5c2ae5d3/t/5ffdfa1d554fff4f89c3095f/1610480157183/EMS%2BPurgo%2BHealth%2BCanada%2BPress%2BRelease.pdf) announced Health Canada registration of Purgo All Purpose Antimicrobial Cleaner and named Alera Skin Products as a Canadian partner. This is historical manufacturer information.

The [live Health Canada brand-name API](https://health-products.canada.ca/api/drug/drugproduct/?brandname=purgo&type=json&lang=en) returned exactly two products, both held by **ALERA SKIN CARE PRODUCTS INC.**:

| Product | DIN | Current status | Status date | Database product update |
| --- | --- | --- | --- | --- |
| PURGO DISINFECTANT | 02506793 | Cancelled Pre Market | 2022-04-01 | 2025-03-22 |
| PURGO ALL NATURAL DISINFECTING WIPES | 02513625 | Cancelled Pre Market | 2022-04-01 | 2025-03-22 |

Status verified directly using the [99615 status API](https://health-products.canada.ca/api/drug/status/?id=99615&type=json&lang=en) and [100281 status API](https://health-products.canada.ca/api/drug/status/?id=100281&type=json&lang=en). Both return a null original-market date. Health Canada's [status definitions](https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-product-database/terminology.html) define Cancelled Pre Market as cancellation before the product was ever marketed in Canada; this is distinct from cancellation for a safety issue.

Both [disinfectant ingredients](https://health-products.canada.ca/api/drug/activeingredient/?id=99615&type=json&lang=en) and [wipe ingredients](https://health-products.canada.ca/api/drug/activeingredient/?id=100281&type=json&lang=en) identify **citric acid 2.5% w/w**. No current approved Purgo DIN appeared in this brand-name query. This is not an exhaustive search of all possible white-label names. The EMS–Alera relationship is documented, but formula equivalence to MASEST's SKU remains unverified. Electronic product monographs were unavailable in the DPD product records.

## United States: Purgo AF / AF Gel drug label

The [NLM DailyMed label PDF](https://dailymed.nlm.nih.gov/dailymed/downloadpdffile.cfm?setId=a2dffcf7-a16c-bf6d-e053-2995a90a0309), revised **January 2023**, identifies EMS as labeler and describes topical hand sanitizers with **benzalkonium chloride 0.13% v/v**. Structured ingredient tables report **0.1274 g/100 g**. Those units should not be silently substituted.

The product-level marketing tables report:

| Product NDC | Name | Marketing start | Marketing end |
| --- | --- | --- | --- |
| 74869-420 | Purgo AF liquid | 2020-04-09 | 2023-12-01 |
| 74869-424 | Purgo AF liquid | 2020-06-15 | 2023-01-19 |
| 74869-524 | Purgo AF Gel | 2020-10-09 | 2024-01-27 |

The document uses the historical category OTC monograph not final, part333E, and expressly says FDA has not evaluated the product's compliance. Exact-product searches of openFDA's current NDC endpoint returned no matches. These observations support a historical listing with recorded marketing end dates; they do not establish current active marketing, current manufacturer compliance or FDA approval. [FDA explicitly distinguishes NDC listing from approval](https://www.fda.gov/drugs/development-approval-process-drugs/national-drug-code-database-background-information).

Purgo AF's skin-use instructions and ingredient evidence belong to those named drug products. They do not justify adding hand-use claims to original Purgo or Purgo N.

## Retrieval provenance

Direct HTTPS retrieval succeeded using macOS `/usr/bin/curl`; the alternate curl/Python CA configuration initially failed certificate-chain validation for Health Canada. No TLS verification bypass was used. SHA-256 hashes describe retrieved bytes, not authorship or document revision dates:

| Source | SHA-256 |
| --- | --- |
| EPA live PPLS JSON, 82859-2 | `d02723ae5e43dd40dc30435c68123eef3a6e70865faa3a84c1f86cae2203420c` |
| EPA 2025-05-12 label PDF | `81a5ae84bd719da9c9ab20d3e653320e96b70b760fbccb5ee9c594869ae6f280` |
| Health Canada Purgo brand-name JSON | `9bdaaae58bde59c38793a4a1dffe081fec96480a15b9987543be67317367cfc6` |
| Health Canada 99615 status JSON | `96b922539a9c04c5dc20dc676aea76947fc9b17dae1e4d372e344c3911b59774` |
| Health Canada 100281 status JSON | `99eef89dda517d1621133e91acd185e09e53e153d83e71c3d68fffbe9e3c158e` |
| DailyMed Purgo AF/AF Gel PDF | `ba02d990c68f9e68c98395c79a3dada82010269a2859503b831ff7dcc8b2e6aa` |

Next evidence needed for MASEST copy: manufacturer mapping of the sold SKU to its formula, current label and regulatory identifier; current SDS; application-specific directions; and any residual-efficacy study supporting a defined duration under defined conditions. No cross-product transfer of claims is supported by these records.
