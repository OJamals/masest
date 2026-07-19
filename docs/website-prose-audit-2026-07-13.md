# MASEST Website Prose Audit

Date: 2026-07-13
Scope: 73 live, public URLs from `https://masest.co/sitemap.xml`; legal, account, cart, checkout, review, dashboard, and admin pages excluded.
Corpus: 25,911 rendered words after client-side content loaded.

## Executive assessment

The site already avoids most generic AI-copy habits. Its strongest voice is practical, specific, and built around jobs buyers recognize: descaling, degreasing, water treatment, site trials, documentation, and purchase approval. A broad rewrite would damage that work.

The next pass should focus on five narrower problems:

1. Tighten two broad safety claims on the homepage.
2. Replace repeated industry-page boilerplate with job-specific copy.
3. Standardize high-frequency CTA labels.
4. Reduce clipped, evenly paced sentences on core pages.
5. Make generic page titles describe buyer intent.

## Mechanical scan

| Category | Count | Assessment |
|---|---:|---|
| Negative parallelism | 0 | Clean |
| Inflated AI vocabulary | 0 | Clean |
| Hedging and throat-clearing | 0 | Clean |
| Generic low-specificity claims | 0 | Clean |
| `from X to Y` constructions | 7 | Mostly legitimate process or rating ranges; one duplicated program-tier claim should be consolidated |
| Em dashes | 272 | Above the skill guideline across the full corpus; concentrated in templated industry content and comparison formatting |
| Similar-length sentence runs | 287 | Inflated by cards and UI text, but manual review confirms clipped cadence on `/services`, `/proof`, `/contact`, `/products`, and several industry pages |

Worst examples by category:

| Category | Count | Example |
|---|---:|---|
| Repeated boilerplate | 32 pages | “Replacement options for the harsh chemistry this work usually relies on.” |
| Repeated intake copy | 32 pages | “Product, surface, soil, volume, and buying deadline…” |
| Generic CTA | 33 pages | “View details” |
| Generic CTA | 32 pages | “See the proof” |
| CTA label drift | 39 uses | “Request a quote” (25), “Request quote” (7), plus page-specific variants |
| Broad safety claim | Homepage H1 | “Industrial cleaning power. None of the hazard.” |
| Broad performance claim | Homepage lead | “VertKleen strips scale, rust, grease, and biofilm as hard as the acids and caustics…” |

## What should stay

- “The proof came off working equipment.” Concrete and credible.
- “Tell us what is on the shelf today.” Good request-form opener.
- “Shop VertKleen industrial cleaners.” Direct product-page H1.
- “Water-treatment programs, priced before the PO.” Clear buyer value.
- Product-level SDS, label, concentration, discharge, and site-rule caveats.
- Quote-first language where bulk price depends on volume, freight, or application review.
- HMIS explanations that state the scale and acknowledge manufacturer and concentration differences.

## Priority recommendations

### P0: Make safety and performance claims exact

The homepage H1 promises “None of the hazard,” while nearby copy explains that ratings vary and DBNPA is a separate low-hazard component. The broad headline creates avoidable tension with the accurate caveat.

Recommended changes:

- Replace “Industrial cleaning power. None of the hazard.” with “Industrial cleaning power. HMIS 0-0-0 formulas.”
- Replace “at an HMIS 0-0-0 safety rating” with “with typical HMIS health, flammability, and reactivity ratings of 0-0-0.”
- Tie “as hard as the acids and caustics” to named field evidence or soften it to “built for the scale, rust, grease, and biofilm jobs now handled with acids and caustics.”
- Replace “A safer chemical” on `/about` with “A lower-hazard chemical.”
- Replace “documentation your safety officer can sign” on `/blog` with “documentation your safety officer can review.”

Expected effect: stronger technical credibility, fewer compliance objections, and cleaner alignment between headlines, SDS evidence, and product caveats.

### P1: Give each industry page a reason to exist

Thirty-two industry pages repeat long blocks about harsh chemistry, HMIS 0-0-0 options, intake details, and the next step. Shared structure is useful. Shared prose at this scale makes distinct pages feel generated and weakens industry relevance.

Keep one short shared request module. Rewrite the first 120–180 words of each page around:

- equipment named by that industry;
- soil or failure mode;
- operational constraint;
- exact product or program fit;
- one relevant proof point or document;
- one next action.

Example for healthcare:

> Descale cooling loops and clean occupied facilities without adding acid fumes to patient areas. Start with the system material, deposit, water data, and shutdown window. MASEST will match the VertKleen product, dilution, and documents for facilities and infection-control review.

Example for hotels and property management:

> Remove facade stains, restroom scale, pool-deck buildup, and HVAC deposits while guest areas stay in service. Send the surface, soil, property count, and trial window for a product match and site-ready sample plan.

Expected effect: better search intent coverage, less template fatigue, and higher confidence for buyers landing deep in the site.

### P1: Normalize CTA language

Current high-frequency labels:

- “View details”: 33 pages
- “See the proof”: 32 pages
- “Request a quote”: 25 pages
- “View products”: 21 pages
- “All products”: 17 pages
- “Request free sample”: 15 pages
- “Request quote”: 7 pages
- “Browse products”: 8 pages

Use a small action vocabulary:

| Intent | Canonical label |
|---|---|
| Product detail | View product |
| Product catalog | Browse products |
| Evidence | See field proof |
| Commercial request | Request a quote |
| Trial | Request a sample |
| Technical document | Request document |
| Service scope | Request service scope |

On industry cards, replace “View details” with a descriptive label such as “View healthcare applications”; when a matching case exists, name it instead of using a generic proof label. Keep labels short. Add specific accessible names where card context is unavailable to assistive technology.

Expected effect: clearer action hierarchy, stronger anchor text, and less hesitation between similar buttons.

### P1: Put evidence closer to the claim

The site often states a lower-hazard or performance claim, then points to a general proof library. Link the claim to the closest matching evidence:

- Put a named case, substrate, concentration, or before/after result beside performance claims.
- Put the relevant SDS or label beside HMIS and handling claims.
- Replace generic “See the proof” links with the case name when the match is known.
- Mark lab, field, manufacturer, and customer evidence distinctly.

Expected effect: less buyer effort between claim and verification.

### P2: Loosen the clipped cadence

Core pages rely heavily on short declarative lines such as “Name the work,” “Price the job,” and “Move the PO.” The rhythm works in isolated headlines. Repetition across headings, cards, and body copy makes the site sound scripted.

Revision rule:

- Keep short lines for primary claims.
- Let supporting paragraphs carry conditions, mechanisms, and evidence in one complete sentence.
- Remove adjacent headings that restate the same procurement idea.
- Avoid stacking three imperative fragments in one viewport.

Example:

Current `/services` sequence:

> Technical services that make the chemical switch easier to approve.
> Name the work, and the quote moves faster.
> The public price is for budgeting.

Recommended:

> Water analysis, management plans, bid support, and field service with public budget pricing. Send the site, system, and deliverable; MASEST will return the scope needed for approval.

### P2: Strengthen generic page titles

All 73 pages have meta descriptions, and no descriptions are duplicated. That foundation is good. Opportunities remain:

- 23 titles are under 35 characters.
- 2 titles exceed 65 characters.
- 10 descriptions are under 100 characters.
- 5 title strings are duplicated.

Length alone is not a defect. Fix titles that omit the product, task, or audience:

| Current | Recommended direction |
|---|---|
| `About | MASEST Consulting` | `About MASEST | VertKleen Chemistry & Field Support` |
| `Request | MASEST VertKleen` | `Request a VertKleen Quote, Sample, or Chemical Audit` |
| `Industries | MASEST VertKleen` | `VertKleen Industrial Cleaning Applications by Industry` |
| `Marine | MASEST VertKleen` | `Marine Descaling & Degreasing | VertKleen` |
| `Oil & Gas | MASEST VertKleen` | `Oil & Gas Descaling & Degreasing | VertKleen` |

Expand short descriptions only when a useful mechanism, application, or buyer qualifier is missing. Do not pad them to hit a character target.

## Suggested core-page headline revisions

| Page | Current | Recommendation |
|---|---|---|
| `/` | Industrial cleaning power. None of the hazard. | Industrial cleaning power. HMIS 0-0-0 formulas. |
| `/services` | Technical services that make the chemical switch easier to approve. | Water analysis, WMPs, bid support, and field service with public scope pricing. |
| `/industries` | One replacement story, tuned by industry. | Find VertKleen products for your equipment, soil, and site requirements. |
| `/about` | Chemistry, testing, and field support from one supplier. | VertKleen chemistry, field testing, and procurement support from Florida’s Space Coast. |
| `/resources` | Specs, dilutions, and documents in one place. | Keep. |
| `/proof` | The proof came off working equipment. | Keep. |
| `/contact` | Tell us what is on the shelf today. | Keep. |

## Implementation sequence

1. Correct homepage and blog claim language.
2. Normalize shared CTA labels and accessible names.
3. Rewrite the industry-page template once, then supply unique leads and proof modules by industry.
4. Consolidate repetitive procurement headings on `/services`, `/about`, and `/industries`.
5. Update generic title tags and short descriptions.
6. Re-run the mechanical scan and a rendered crawl.
7. Compare quote starts, sample requests, proof-link clicks, and contact-form completion by landing page.

## Verification record

- Mechanical scan pass 1: 0 negative-parallelism hits, 0 inflated-vocabulary hits, 0 hedge hits, 0 generic low-specificity hits.
- Structural review: repetition, CTA drift, cadence, em-dash density, safety-claim precision, and metadata checked.
- Recommendation copy scan: 0 banned negative-parallelism frames; no invented performance numbers or certifications.
- Verify passes: 2.
