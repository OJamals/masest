# Launch-Docs Review — Pricing & Ecommerce Build

**Date:** 2026-06-17
**Reviewer:** dev
**Source docs reviewed** (in `~/Desktop/masest/latest`):

1. `MASEST · VertKleen — Developer Brief (strategic direction).pdf` (5p)
2. `MASEST · VertKleen — Site Update & Ecommerce Build (phase-2 audit).pdf` (5p)
3. `VertKleen Pricing — Ecommerce Launch Spec (pricing + competitive analysis).pdf` (7p)
4. `MASEST Services — Ecommerce Launch Spec.pdf` (5p)
5. `MASEST_Services_Pricing_Workbook.xlsx` (3 sheets: Margin Spread · Competitive Analysis · Recommended Pricing)

Purpose of this review: flag missing information (esp. pricing), document conflicts between the
decks, cross-check against what is already live, and recommend an implementation path. This is a
review artifact — no catalog data should be loaded until the conflicts in §1 are resolved by the CEO.

---

## 1. Document conflicts — resolve before loading any catalog data

### C1 — The same chemical SKUs carry two different price sets

The Phase-2 Audit deck (doc 2, slide 4) and the dedicated Pricing Spec (doc 3, slide 2) both list
retail-looking prices for the same SKUs, and they disagree by ~20–25% on every shared line.

| SKU | Audit deck (doc 2) | Pricing Spec (doc 3) |
|-----|--------------------|----------------------|
| HCR 2.5 / 55 / 275 | $54.08 / $925.44 / $3,443.34 | $43.26 / $740.36 / $2,754.67 |
| CR 2.5 / 55 / 275 | $55.05 / $754.88 / $3,192.75 | $38.53 / $528.41 / $2,234.93 |
| CR HD 2.5 / 55 / 275 | $30.30 / $469.70 / $2,068.75 | $21.21 / $281.82 / $1,241.62 |
| MultiWash 2.5 / 55 / 275 | $41.96 / $635.25 / $2,940.44 | $29.37 / $381.15 / $1,764.26 |

The audit-deck table is sourced "MASEST HVAC list" / "MASEST property list" — i.e. it is most likely
a **contract/HVAC-tier** book, not retail. The dedicated Pricing Spec is the later, purpose-built
retail document and says "use as-is."

**Resolution:** Load the **Pricing Spec (doc 3) as the public retail tier.** Treat the audit-deck
numbers as a *candidate HVAC-tier price book* (see §4 tier pricing), not as retail. Get CEO
confirmation in writing before loading either.

### C2 — Pack-size count: 4 vs 5

- Developer Brief + Audit deck: online catalog = **4 sizes** (1 / 2.5 / 55 / 275); 5-gal is
  wholesale/direct only, hidden from `/shop`.
- Pricing Spec: **5 sizes** (1 / 2.5 / **5** / 55 / 275) public, and it actually provides 5-gal retail
  prices for every cleaning SKU.

**Resolution needed:** CEO decision on 4 vs 5 public pack sizes. The Pricing Spec (the later doc) is
internally consistent with 5 sizes, so the default recommendation is **5 public sizes** unless the
5-gal is deliberately wholesale-only.

### C3 — Service count is stated three ways

Services deck slide 1: headline number "**35**" cart-ready line items, subtext says "**39**
individual services," and the catalog on slide 2 lists ~**29** priced individual lines (+4 packages).
Reconcile the true count before building the services catalog.

---

## 2. Missing pricing (TBC / not present in any doc)

### Chemicals

11 of 14 chemical families are **fully priced across all 5 sizes** and ready to load:
HCR, CR, Descaler, CR HD, CR HD Low Foam, Neutral, MultiWash, Torque, AlumiBrite, Purgo, LAM3.

Outstanding:

| SKU | Missing cells | Known |
|-----|---------------|-------|
| WaterSafe60 `VK-WS60` | 1 / 2.5 / 5 gal | 55 = $619.08 · 275 = $2,774.89 |
| CR2 `VK-CR2` | 1 / 2.5 / 5 gal | 55 = $669.32 · 275 = $2,434.19 |
| SAR `VK-SAR` | 1 / 2.5 / 5 gal | 55 = $554.92 · 275 = $2,182.95 |
| Glycol — all 6 (`VK-PG100/PG50/EG100/EG50/EGU96/EG5050`) | **1 / 2.5 / 275 gal** | 5-gal & 55-gal only |
| CR HD | (ambiguity) | Two pallet rows differ ~$10; confirm correct retail line |

Glycol known cells: PG100 5=$141/55=$1,383 · PG50 5=$122/55=$1,192 · EG100 5=$126/55=$1,375 ·
EG50 5=$99/55=$995 · EGU96 5=$79/55=$865 · EG5050 5=$48/55=$445.

### Services — larger gap than the TBC cells: 5 of 8 categories are unpriced

The deck promises **8 categories** but the catalog (slide 2) only carries priced line items for:
Lab Testing (cat 06), part of Consulting/Bid (cat 02), and the WMP/ASHRAE-188 set. The following
categories have descriptions but **no priced line items at all**:

- 01 Risk Mgmt & EHSS (OSHA audits, PSM/PHA, incident response, program dev)
- 03 Industrial Cleaning & PM (VertKleen-applied programs)
- 04 Engineering Consulting (DDC — explicitly "quoted per scope," no fixed price)
- 05 Water Treatment & Controls (only the WMP slice is priced; injection systems/programs are not)
- 07 Fire & Mold Assessments
- 08 Air Quality Testing

These need their line items + prices authored, or to be marked quote-only.

### Service SKU stems are referenced but not provided

The services spec says SKUs are "pulled from workbook Sheet 3," but Sheet 3 contains only the
recommended-price column — there is no SKU-stem column. Only one example SKU exists in the docs
(`MS-LAB-BIO-LEGIONELLAPCR`). The full `MS-{CATEGORY}-{SLUG}` list must be authored.

---

## 3. Missing non-pricing data

- **Freight:** the rules are defined (flat ground for 1+2.5 gal; ground-or-LTL for 5 gal; quote
  post-order for 55+275 gal) but there are **no per-variant `weight_lb` values and no flat-rate
  ground dollar amounts.** The variant schema calls for `weight_lb` and `ships_freight`; both are
  empty. This blocks the freight engine.
- **Tier price books (HVAC / Property / Distributor):** values not provided ("sales-assigned at
  login"). By design, but the tier mechanism is unbuilt and no seed numbers exist. The C1 audit-deck
  numbers are the likely source for the HVAC tier.
- **Glycol tax handling:** docs state glycol is "tax exempt with certificate." This depends on the
  resale-certificate + Stripe Tax exemption flow (already designed this session — see the Stripe Tax
  spec). Glycol buyers need the exempt path live.
- **Hyper Kit SKUs** (CR HD Hyper Kit $8,731.80, MultiWash Hyper Kit $13,788.60, HCR tote/tanker
  $4,775.93) are correctly flagged distributor-only — keep off public `/shop`. (Noted, not a gap.)

---

## 4. Cross-check vs the live build (the decks assume greenfield — it is not)

The decks recommend "Stripe **or Shopify** … Astro/Next + Sanity/Decap CMS + HubSpot." The live site
already runs **Cloudflare Pages + CF Functions + Supabase + Stripe**, hand-coded. Mapping:

- **Already built:** the variant model (`product_variants`: vsku / price / stripe_price_id / active,
  plus `products.mode` = buy|quote and `products.taxable`), guest cart + transfer, Stripe Checkout,
  the webhook (order + stock + notification + subscription), orders with a `tax` column, accounts,
  and quote intake. The Phase-1 MVP-store infrastructure substantially exists.
- **The decks overstate `/shop` as new work** — do not rebuild on Shopify. Load the catalog data
  into the existing CF/Supabase stack.
- **Genuinely not built (the real remaining work):**
  - Load the 20-product × pack-size SKU matrix.
  - 6 glycol product detail pages.
  - Services as `mode='quote'` products **with deferred capture** (current quote-mode takes no
    payment; the spec wants charge-after-schedule-confirmed → Stripe `capture_method: manual`).
  - **Tier pricing** (per-company negotiated price book — roadmap item 2B, unbuilt).
  - **Freight engine.**
  - **SDS/TDS direct downloads** (still request-gated today).
  - **schema.org** Product/Offer/Organization markup.

---

## 5. Implementation recommendations (ordered)

1. **Get CEO sign-off on C1 / C2 / C3 first.** Pricing source, pack-size count, and service count
   gate everything downstream. Do not load catalog data until resolved.
2. **Collect the TBC matrix in one request to sales** (see `GO_LIVE_CONFIRM_CHECKLIST.md`):
   WS60/CR2/SAR small packs, all glycol 1/2.5/275, the correct CR HD row, and per-variant weights.
   Render unconfirmed cells as "Contact for quote" until filled (the spec already prescribes this for
   WS60/CR2/SAR).
3. **Load chemicals into the existing Supabase variant model** — no new commerce platform.
   `VK-{PRODUCT}-{SIZE}` → `product_variants`; retail price = public tier.
4. **Build tier pricing** as per-company price-list overrides (roadmap 2B). Login swaps retail → tier.
   Seed the HVAC tier from the C1 audit numbers if confirmed.
5. **Services** = `mode='quote'` products + **deferred Stripe capture** for the schedule-then-charge
   flow. Engineering/DDC stays pure-quote (no price).
6. **Freight** once weights arrive. **SDS downloads** = flip the request-gate to direct PDF (ties to
   the CMS/media-library roadmap item). **schema.org** markup alongside the PDP work.
7. **Glycol exempt buyers** → finish the resale-cert + Stripe-Tax exemption path already designed.

### Bottom line

Pricing for **11 of 14 chemical families is complete** (retail, all 5 sizes) and loadable now. The
real blockers to a clean go-live are: (a) reconcile the two conflicting chemical price sets, (b) ~15
TBC chemical cells, (c) **5 of 8 service categories have no priced line items**, (d) no freight
weights, (e) no tier books. Items (a) and (c) are the largest — they are not "fill a cell," they are
"decide the canonical source" and "author a missing catalog."
