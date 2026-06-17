# Go-Live Confirm Checklist — Sales/CEO sign-off sheet

**Date opened:** 2026-06-17
**Purpose:** single sheet to collect every value/decision still blocking the `/shop` launch.
Fill the blanks, initial each section, return to dev. Nothing loads to the public catalog until the
three DECISIONS below are signed off. See `LAUNCH_REVIEW_2026-06-17.md` for full context.

---

## A. Decisions (must sign off first — block everything)

- [ ] **D1 — Canonical chemical price set.** Two decks give different retail prices for the same SKUs.
      Confirm the **Pricing Spec** numbers are the public retail tier (recommended), and the
      higher Phase-2-Audit numbers are the HVAC contract tier (not retail).
      Decision: ____________________   Initials: ______
- [ ] **D2 — Public pack-size count.** 4 sizes (1 / 2.5 / 55 / 275, 5-gal wholesale-only) **or**
      5 sizes (1 / 2.5 / 5 / 55 / 275). Recommended: 5.
      Decision: ____________________   Initials: ______
- [ ] **D3 — Service count.** Decks say 35 / 39 / ~29. State the real count of cart-ready services.
      Count: ______ individual + ______ packages   Initials: ______

---

## B. Chemical pricing — fill the TBC cells (USD, ex-plant Melbourne FL)

### B1 — WaterSafe60 / CR2 / SAR small packs

| SKU | 1 gal | 2.5 gal | 5 gal | (55 gal) | (275 gal) |
|-----|-------|---------|-------|----------|-----------|
| `VK-WS60` | ______ | ______ | ______ | $619.08 | $2,774.89 |
| `VK-CR2`  | ______ | ______ | ______ | $669.32 | $2,434.19 |
| `VK-SAR`  | ______ | ______ | ______ | $554.92 | $2,182.95 |

### B2 — Glycol: 1 / 2.5 / 275 gal (5-gal + 55-gal already known)

| SKU | 1 gal | 2.5 gal | (5 gal) | (55 gal) | 275 gal |
|-----|-------|---------|---------|----------|---------|
| `VK-PG100`  | ______ | ______ | $141 | $1,383 | ______ |
| `VK-PG50`   | ______ | ______ | $122 | $1,192 | ______ |
| `VK-EG100`  | ______ | ______ | $126 | $1,375 | ______ |
| `VK-EG50`   | ______ | ______ | $99  | $995   | ______ |
| `VK-EGU96`  | ______ | ______ | $79  | $865   | ______ |
| `VK-EG5050` | ______ | ______ | $48  | $445   | ______ |

### B3 — CR HD ambiguity

- [ ] Master sheet has two CR HD pallet rows differing ~$10. Confirm correct retail line.
      Correct 55-gal CR HD retail = $________   (spec assumed $281.82)   Initials: ______

---

## C. Service catalog — author the missing lines

Priced today (load-ready): Lab Testing (water/biological/materials), part of Consulting/Bid, WMP set,
4 bundled packages. **Author line items + 30%-margin prices (or mark quote-only) for:**

- [ ] 01 Risk Mgmt & EHSS — services + prices: ________________________________
- [ ] 03 Industrial Cleaning & PM — services + prices: ________________________________
- [ ] 04 Engineering Consulting (DDC) — confirm pure quote-only (no fixed price)?  Y / N
- [ ] 05 Water Treatment & Controls — non-WMP services + prices: ____________________
- [ ] 07 Fire & Mold Assessments — services + prices: ________________________________
- [ ] 08 Air Quality Testing — services + prices: ________________________________
- [ ] **Service SKU stems** — provide the full `MS-{CATEGORY}-{SLUG}` list for every service
      (only `MS-LAB-BIO-LEGIONELLAPCR` exists today).

---

## D. Freight data (blocks the freight engine)

- [ ] Per-variant **shipping weight (`weight_lb`)** for every pack size of every SKU.
- [ ] **Flat-rate ground $** for 1-gal and 2.5-gal from Melbourne FL (or confirm live-rate API).
- [ ] 5-gal: single-unit ground vs multi-pail LTL threshold (cart weight cutover).

---

## E. Tier price books (login-gated; can follow launch)

- [ ] **HVAC contract tier** — confirm whether the Phase-2-Audit numbers ARE this book, or provide.
- [ ] **Property maintenance tier** — provide price book or % discount off retail.
- [ ] **Distributor tier** — provide price book or % discount off retail.
- [ ] Confirm Hyper Kit SKUs stay distributor-login-only (off public `/shop`).

---

## F. Tax / compliance

- [ ] Glycol "tax exempt with certificate" — confirm exemption applies only to approved accounts with
      a resale cert on file (matches the resale-cert + Stripe Tax flow being built).

---

**Return to dev when A is signed off + as many of B–F as available.** Partial returns are fine: any
SKU with a confirmed full row can be loaded; unconfirmed cells render as "Contact for quote."
