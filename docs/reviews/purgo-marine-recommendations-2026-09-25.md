# Purgo / Marine Antimicrobial recommendation review

Reviewed September 25, 2026. Scope: the five supplied recommendations, current live Purgo presentation, local product documents, manufacturer information, and current EPA/FDA/OSHA guidance. Review only; no storefront, packaging, catalog, or infrastructure changes.

**Verdict: proceed with a surface-led identity, clear application sections, useful dilution economics, and visible product evidence. Retain the Canadian approval announcement as a dated historical highlight. Source conflicts limit particular claims; they do not prevent improving the rest of the page.**

This consolidated review incorporates the supplied 19-file folder, EMS website and patent research, and the owner's clarification that a Canadian expert attributes non-marketing to a voluntary company decision. The [Canadian clarification](../research/purgo-canada-approval-clarification-2026-09-25.md) preserves historical disinfectant approval while distinguishing it from current authorization and hand-sanitizer approval.

| Recommendation | Decision | Required correction |
| --- | --- | --- |
| 1. Align copy and packaging | Accept | Position Purgo as an antimicrobial multi-surface cleaner with separate, documented water-system uses. Match artwork to the package sold. |
| 2. Promote four-day protection | Hold proposed claim | Existing study does not establish resistance to repeated contamination or wear for 96 hours. No demonstrated protective-barrier mechanism. |
| 3. Promote misting/fogging/electrostatic use | Revise | Manufacturer lists fogging; reviewed evidence does not establish an occupied-space ULV/electrostatic protocol or unrestricted respiratory safety. |
| 4. Show diluted cost | Accept conditionally | Arithmetic is correct for concentrate:water ratios. Resolve label/TDS conflicts before assigning ratios to applications. |
| 5. Tighten regulatory claims and promote HMIS | Accept cleanup; reject absolutes | Keep non-public-health scope. HMIS does not establish no containment, no PPE, or elimination of injury/compensation risk. |
| Canadian approval highlight | Accept with date and context | Retain the 2021 disinfectant announcement; disclose subsequent pre-market cancellation alongside the historical claim. Do not describe it as hand-sanitizer approval. |

## 1. Identity mismatch is real, but the product supports more than drains

Live browser inspection confirmed $42.99 for 1 GAL, drain/water-system hero copy, a Marine Antimicrobial badge, and the gym-oriented Purgo jug. The hydrated image is explicitly described as a gym-label jug. Its label names equipment, mats, and hands; its general-surface instruction uses 1:32. The current marine name is **Marine Antimicrobial**, not Marine Antiseptic. [Live page](https://masest.co/products/purgo), [live artwork](https://media.masest.co/site/img/products/purgo-studio.webp).

The catalog associates Purgo with water treatment, while the marine mapping uses canonical product `purgo` / `VK-PRG`. The variant records distinguish industrial `PRG-1G` from marine `MAM-1G`; therefore a shared base product does not mean every sellable package has the same SKU or label. See [catalog](../../data/catalog.seed.json) and [marine mapping](../../data/industry-applications.json).

Manufacturer literature supports surface cleaning and non-public-health odor/fouling applications, including cooling towers. The existing [exact-chemical authority review](../PURGO_AFFILIATE_PRODUCT_AUTHORITY_REVIEW_2026-08-22.md) records owner-confirmed private-label equivalence. Preserve that authority while reconciling document revisions and directions. [EMS Purgo TDS](https://www.enviromfg.com/s/Purgo-tds.pdf).

Recommended page structure: a surface-cleaning lead, followed by two clearly labeled application sections: **Facility surfaces** and **Drains & water systems**. Tabs are optional; visible sections make directions easier to compare. Give each application its own surfaces, dilution, contact time, method, rinse requirement, and limitations. Marine presentation should use the matching marine package and supported head/galley/bilge uses. Do not invent industrial dosing merely to fit existing copy.

Prefer visible sections for the initial revision. The product can serve more than one application without forcing buyers to choose between contradictory product identities. If tabs are later used, keep the underlying directions accessible and linkable. Use “Facility surfaces” initially: the more specific “High-Touch Facility Surfaces” needs matching surface compatibility and directions, particularly for porous mats and upholstery. Keep “Marine Antimicrobial” with its marine presentation; it should not be the primary identity above a facility-use jug.

Candidate lead, pending final label reconciliation:

> Concentrated antimicrobial cleaning for facility surfaces and odor-control programs. Purgo controls odor-causing bacteria and other non-public-health microorganisms when used as directed.

## 2. Four-day persistence: the supplied interpretation exceeds the study

The [Bacterial Persistence Test](../sds/vertkleen-purgo-bacterial-persistence-test.pdf) contains a marketing summary followed by four scanned laboratory pages. All four were visually inspected. The laboratory report is Milouda report **20055117**, dated **June 28, 2020**, for ECOTIV CLEAN; it identifies a PURGO disinfection-suspension sample. The 2026 date on the MASEST cover is a distribution date, not a new experiment.

The method describes 4 × 4 cm stainless-steel surfaces, four surfaces per microorganism, inoculation before treatment, drying for 30 minutes, spraying, then holding in a biohazard hood for four days. The procedure describes two baseline and two treated surfaces per microorganism. It does not document repeated inoculation after treatment, abrasion, routine cleaning, or field use on mats and equipment. A negative uninoculated control is described; a matched untreated four-day survival control is not clearly documented.

Further defects require laboratory clarification:

- The method states four days, while the results-column heading states 30 seconds.
- The conclusion claims a two-log reduction for *E. faecalis* and *E. aerogenes*, but their displayed counts do not support that magnitude. For example, the first *E. faecalis* pair is 13,200 before and 8,600 after, approximately 35% reduction, not 99%.
- The reviewed report does not specify a transferable 1:16 or 1:32 test dilution or establish equivalence to the current finished-product revision.

**Do not turn this into “prevents recolonization for 96 hours,” “continuous four-day protection,” or reduced cleaning frequency.** It reports outcomes after a four-day hold; that is a narrower finding. EPA's residual-efficacy guidance illustrates why durability and re-inoculation matter, although that registration guidance is not itself a Purgo 25(b) approval standard. [EPA residual-efficacy guidance](https://www.epa.gov/pesticide-registration/guidance-products-adding-residual-efficacy-claims).

The proposed non-volatile, bio-based protective-barrier explanation is also unsubstantiated in the reviewed documents. [Purgo Technology 101](../sds/vertkleen-purgo-101.pdf) instead describes stabilized live vegetative microbes and even refers to “Xtreme,” creating another document-identity issue. Do not combine these narratives into a new mechanism. Zero VOCs alone would not prove a durable antimicrobial film.

Do not publish the assertion that almost all conventional products stop working when dry: the reviewed EPA guidance itself covers products with residual activity. If presenting the study now, use a neutral “Laboratory report available” link with test conditions and limitations; avoid a four-day protection graphic until the inconsistencies and intended claim are resolved.

## 3. Fogging has a manufacturer basis; the proposed safety extension does not

[EMS's current Purgo listing](https://www.enviromfg.com/products1) explicitly lists spray-and-wipe, spray-and-leave, and fogging. This supports investigating a fogging application section. It does not specify ULV droplet size, electrostatic compatibility, application rate, ventilation, occupancy, re-entry, or respiratory protection. The TDS reports no VOCs; it does not establish every proposed claim about fumes, residues, or breathing aerosol.

Separate the methods:

- **Surface spraying / mist-and-wipe:** include the exact current package directions after reconciling dilution and contact time.
- **Fogging:** obtain the manufacturer protocol for the exact formula and intended environment before publishing operational instructions.
- **Electrostatic spraying / automated misting:** obtain specific method compatibility and exposure instructions; do not infer them from ordinary spraying or fogging.

Do not equate an occupied-campus water-treatment program with aerosol application around occupants. Do not extend general-surface no-rinse wording to every use, especially food-contact surfaces. EPA warns that disinfectant safety and efficacy are method-dependent; that guidance is relevant caution, not proof that Purgo is a registered disinfectant. Workplace respiratory decisions require exposure assessment. [EPA application-method guidance](https://www.epa.gov/coronavirus-and-disinfectants/can-i-use-fogging-fumigation-or-electrostatic-spraying-or-drones-help), [OSHA respirator selection](https://www.osha.gov/etools/respiratory-protection/respirator-selection).

## 4. Dilution economics are strong, but directions conflict

At the observed $42.99 per US gallon, if `1:N` means **one part concentrate plus N parts water**:

| Dilution | Finished solution from 1 gal concentrate | Chemical cost per finished gal |
| --- | --- | --- |
| 1:32 | 33 gal | $1.30 |
| 1:16 | 17 gal | $2.53 |
| 1:64 | 65 gal | $0.66 |
| 1:10 | 11 gal | $3.91 |

Calculations: `42.99 / 33 = 1.3027…`; `42.99 / 17 = 2.5288…`. Excludes tax, freight, water, labor, equipment, and wastage. This demonstrates low chemical cost per diluted gallon, not reseller margin or total cleaning cost. Compare competing products only at equivalent use conditions.

Current artwork states 1:16 for high-touch odor, 1:32 for general surfaces, and 1:5 for heavy fouling. It also states one gallon makes up to five gallons, internally inconsistent with those ratios under the concentrate:water convention. The EMS TDS instead assigns 1:32 to food-contact odor control, 1:64 to non-food-contact odor control, and 1:10 to spoilage/fouling. The [archived local label](../sds/vertkleen-purgo-label.pdf) also differs from the gym rendering.

Therefore, retain the calculator concept but obtain one authoritative, revision-controlled application table first. Say “1 part concentrate + 32 parts water,” not just “1:32.” Drive price from the selected current variant, distinguish unit versus case pricing, and do not calculate tower dosing from surface dilution. Different ratio conventions would change both yield and cost.

The preferred worked example, once that convention and application are confirmed, is: **“Makes 33 gallons of solution at 1 part concentrate + 32 parts water — approximately $1.30 per diluted gallon.”** Place it near the selected one-gallon price with the named application. The 1:16 calculation remains arithmetic only; omit it from published application choices until supported. The label-supported 1:64 and 1:10 options can populate the calculator after reconciliation. Avoid an unexplained “from $0.66” teaser, which could imply that every application permits the weakest dilution.

## 5. Regulatory cleanup: necessary, with corrections to the proposed fix

FIFRA 25(b) is a conditional exemption from federal pesticide registration, not EPA approval or certification. Non-public-health odor/fouling claims can qualify; public-health disinfection and sanitization claims cannot. Hard non-porous surfaces alone do not determine the regulatory scope. Check formulation, labeling, and applicable state requirements together. [EPA minimum-risk conditions](https://www.epa.gov/minimum-risk-pesticides/conditions-minimum-risk-pesticides).

“Marine Antiseptic” and “for hands” can imply topical antimicrobial use; FDA regulates consumer antiseptic rubs as OTC drugs. Skin compatibility is different from permission to market a hand antiseptic. For the surface-product page, avoid implying hand sanitization without the corresponding product-specific basis. [FDA consumer antiseptic guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/consumer-antiseptic-rub-final-rule-questions-and-answers-guidance-industry).

“FDA-GRAS” is not blanket FDA approval of a finished cleaner, inhalation exposure, skin antisepsis, or no-rinse food-contact use. GRAS concerns a substance under its intended food-use conditions. Food-contact pesticide applications separately require appropriate ingredient tolerances or exemptions and supported directions. [FDA GRAS framework](https://www.fda.gov/food/food-ingredients-packaging/generally-recognized-safe-gras), [EPA food-use tolerances](https://www.epa.gov/minimum-risk-pesticides/need-tolerances-and-tolerance-exemptions-minimum-risk-pesticides).

Keep HMIS 0-0-0 as a specifically sourced rating once current SDS identity is resolved. Do not derive these claims from it:

- No secondary containment: site, quantity, storage, and environmental requirements remain separate.
- No DOT hazmat surcharge: manufacturer transport classification can support narrower shipping language, but carrier charges and package/mode conditions are separate.
- Eliminates workers' compensation risks: unsupported absolute; neither an HMIS rating nor a safer chemical can eliminate workplace injury or claims.

The live phrase “Antimicrobial certification” needs a named certificate and scope or replacement with “Product documentation and laboratory reports.” Keep Purgo distinct from **Purgo N**, which EMS separately identifies as its EPA-registered disinfectant/sanitizer. Foreign product approvals do not automatically authorize US claims. [EMS product distinctions](https://www.enviromfg.com/products1).

The supplied eight-page historical EMS-attributed SDS now gives a Purgo-specific basis for discussing HMIS 0-0-0 and non-dangerous-goods transport classification. This improves the evidence position. A proposed trust tile is **“HMIS 0–0–0”** with Health / Flammability / Physical Hazard labels and a link to the applicable SDS. Until current formula/revision applicability is confirmed, describe the source as the January 2020 EMS Purgo SDS rather than presenting a newly certified rating. Transport copy can follow the applicable SDS classification; do not promise carrier pricing or waive package/mode conditions. [Supplied SDS review](../research/purgo-supplied-folder-review-2026-09-25.md).

## 6. Canadian approval can remain visible as a historical highlight

Accept the owner's preference to retain and, where useful, highlight the Canadian announcement. The [January 12, 2021 EMS release](https://www.enviromfg.com/s/EMS-Purgo-Health-Canada-Press-Release.pdf) remains evidence of a historical disinfectant registration. Pre-market cancellation does not undo that history and does not establish a safety or efficacy failure. The owner's expert explanation of voluntary non-marketing is consistent with the official status; the public record does not independently disclose the company's motive.

Use a dated evidence card, visible in the product-documentation section:

> **Canadian disinfectant registration announced in 2021**
>
> EMS announced Health Canada registration of Purgo as a disinfectant on January 12, 2021. The identified Canadian registrations were subsequently cancelled before marketing.
>
> Read the original EMS announcement · View Canadian product records

Link the record context beside the announcement, not behind an unrelated disclaimer. If the commercial reason is included, attribute it: “According to the owner's Canadian expert, the company voluntarily chose not to market the products in Canada.” The reason can remain in an expanded evidence note if it adds little for shoppers. The dated headline and subsequent status should remain together.

This can appear as a useful proof point without implying present Canadian market authorization. Avoid a standalone current-tense “Health Canada approved” badge, “approved hand sanitizer,” or a graphic resembling a regulator endorsement. The release mentions future hand-sanitizer offerings separately; it does not establish their approval. These findings are specific to the identified Canadian products, not all EMS private labels. [Canadian clarification and official sources](../research/purgo-canada-approval-clarification-2026-09-25.md).

## Concrete page direction

The proposed page should answer what the product is, where it fits, how much usable solution it makes, and which evidence supports it:

1. **Hero and purchase area:** “Purgo — Concentrated surface cleaning & odor control.” Supporting draft: “For facility surfaces and documented water-system applications. Choose the application and follow its dilution and contact-time directions.” Use verified package photography matched to the selected SKU; keep price, pack size, availability, and purchase action together.
2. **Applications:** visible Facility surfaces and Drains & water systems sections. Each links to the relevant directions. Keep marine uses and imagery attached to the actual marine package. Omit unverified dosing cells rather than filling them with extrapolations.
3. **Diluted cost:** show the named, verified application and ratio beside its yield and current selected-variant chemical cost. Explain ratio units directly.
4. **Methods:** list manufacturer-documented spray-and-wipe, spray-and-leave, and fogging as supported methods, with use-specific directions. Describe fogging at a high level until its operating protocol is available. Add electrostatic/ULV/automated misting only after method-specific support.
5. **Evidence:** current applicable label, SDS and TDS first; dated Canadian announcement next; laboratory report with test conditions and limitations. Keep document issue dates distinct from MASEST upload or cover dates. Do not label the collection “certification.”
6. **Practical FAQs:** clarify application selection, concentrate-versus-finished volume, contact time, rinse requirements, and hand-use limits. Each answer should refer to the applicable directions rather than borrowing claims from Purgo AF or Purgo N.

The hero text is a concrete review draft. Final package selection, operational directions, and document publication remain subject to the identified source reconciliation; no storefront implementation is included in this review.

## Source corrections and recommended order

The August authority review identified the local Purgo SDS as CR-derived. Current extraction re-confirmed matching high-pH spill wording, specific gravity `1.24 ± 0.02`, boiling point `≥ 234 F`, and the same defective freezing-point conversion in [Purgo SDS](../sds/vertkleen-purgo-sds.pdf) and [CR SDS](../sds/vertkleen-cr-sds.pdf). Consequently, the local Purgo SDS cannot serve as independently verified support for new PPE, transport, or safety claims. Its general statement that respiratory protection is not required must not be promoted into occupied-space fogging instructions.

The subsequently supplied January 2020 EMS-attributed SDS has specific gravity `1.00 ± 0.02`, boiling point `≥211°F`, freezing point `≤32°F`, and oral rat LD50 `3,120 mg/kg`. These values strengthen the mismatch finding and supply a historical comparison source. The remaining task is matching an authenticated master SDS to the sold formula/revision, not finding any Purgo SDS at all. Do not silently convert the historical reproduction into a new MASEST-issued document. [Full comparison](../research/purgo-supplied-folder-review-2026-09-25.md).

Recommended order:

1. Reconcile the exact current formula/revision, manufacturer SDS/TDS, delivered package artwork, and application directions. Preserve owner-confirmed chemical equivalence; verify revision-specific document applicability.
2. Resolve gym-label yield/dilution conflicts and marine-label direction gaps. Review archived document statuses: the local Purgo label is marked restricted, the SDS reference-only, and marine artwork internal-source-only in the current ledgers. Distribution permission is distinct from technical substantiation.
3. Correct page identity, matching imagery, document links, and diluted-cost presentation using that source set.
4. Obtain laboratory clarification and a suitable residual-performance protocol before expanding the four-day claim. Obtain method-specific instructions before adding ULV, electrostatic, or occupancy claims.

Work that can proceed without new efficacy testing: surface-led copy, application organization, SKU/image reconciliation, clearer document names and dates, the dated Canadian evidence card, removal of unsupported safety absolutes, and the calculator design. Actual dilution choices, replacement SDS publication, and expanded residual/application claims each depend on their own evidence gap. They should not hold all other improvements together.

Verification performed: live page/artwork/price, local catalog and document ledgers, PDF text extraction, visual inspection of all four original persistence-study pages and all eight supplied SDS images, review of all 19 supplied-folder files and the separately supplied Canadian announcement, targeted SDS comparison, cost calculations, patent/product separation, and primary-source EPA/FDA/OSHA/Health Canada/manufacturer review. New product testing, current state brand registration, and a current authenticated replacement manufacturer SDS were not independently established. No storefront, packaging, original source document, commit, or deployment changed.
