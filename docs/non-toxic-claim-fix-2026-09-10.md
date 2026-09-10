# "non-toxic" — 9 CMS edits, ready to paste

Drafted 2026-09-10. **Nothing here is applied.** Post bodies are CMS-authoritative
(`tools/publish-blog-ci.mjs`: *"blog posts are authored in the CMS (Supabase = source of
truth)"*), so these are edits for the admin console. A repo change would be overwritten on
the next production deploy.

## Why

All twelve VertKleen SDS classify **Acute Toxicity–Oral, Category 5**, signal word
**Warning**, hazard statement **"May be harmful if swallowed."** The word *non-toxic* is an
absolute claim that those documents contradict — and the SDS are published in the site's
own resources library, so the marketing sentence and the contradicting document sit two
clicks apart.

The other three claims are fine and stay:

| claim | SDS evidence |
|---|---|
| HMIS 0-0-0 | stated explicitly in all 12 (Health 0, Flammability 0, Physical Hazard 0) |
| noncorrosive | Skin Corrosion/Irritation is **Category 3 — irritant, not corrosive**; the word "corrosive" appears **0 times** in all 12 |
| nonflammable | HMIS flammability 0; no flammability classification anywhere |

HMIS Health 0 and GHS Acute Toxicity Category 5 are not in conflict — different systems,
different thresholds, and Category 5 is the lowest band GHS has. Only the absolute word is
the problem, so only the absolute word is removed.

## The edits

Each is a single-sentence replacement. Nothing else in the post changes.

### `blog/construction-equipment-concrete-residue-cleaning`

**Find:**

> CR HD, HCR, Descaler, and LAM3 are effective, economical VertKleen options that are non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> CR HD, HCR, Descaler, and LAM3 are effective, economical VertKleen options that are noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/data-center-cooling-maintenance-cleaning`

**Find:**

> WaterSafe60, HCR, and Descaler are HMIS 0-0-0, non-toxic, noncorrosive, and nonflammable.

**Replace with:**

> WaterSafe60, HCR, and Descaler are HMIS 0-0-0, noncorrosive, and nonflammable.

---

### `blog/golf-course-equipment-grounds-hardscape-cleaning`

**Find:**

> The VertKleen line is non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> The VertKleen line is noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/hmis-000-explained`

**Find:**

> VertKleen combines HMIS 0-0-0 with non-toxic, noncorrosive, nonflammable formulations built for demanding cleaning jobs.

**Replace with:**

> VertKleen combines HMIS 0-0-0 with noncorrosive, nonflammable formulations built for demanding cleaning jobs.

---

### `blog/hotel-property-turnover-facility-cleaning`

**Find:**

> VertKleen cleaners are effective, economical, non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> VertKleen cleaners are effective, economical, noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/military-government-maintenance-procurement`

**Find:**

> VertKleen products are effective, non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> VertKleen products are effective, noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/oil-gas-equipment-degreasing-maintenance`

**Find:**

> CR HD, HCR, Descaler, and Neutral are non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> CR HD, HCR, Descaler, and Neutral are noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/school-university-facility-cleaning-plan`

**Find:**

> VertKleen products are effective and economical while remaining non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> VertKleen products are effective and economical while remaining noncorrosive, nonflammable, and HMIS 0-0-0.

---

### `blog/solar-panel-cleaning-low-residue-maintenance`

**Find:**

> MultiWash and LAM3 are effective, economical, non-toxic, noncorrosive, nonflammable, and HMIS 0-0-0.

**Replace with:**

> MultiWash and LAM3 are effective, economical, noncorrosive, nonflammable, and HMIS 0-0-0.

---

## After publishing

`tests/health-claim-guard.test.mjs` ships with these nine allowlisted as *pending CMS
fix*. It fails on any **new** occurrence immediately, and each entry should be deleted from
the allowlist as its post is republished — when the list is empty, the debt is gone and the
guard becomes absolute.

## The document library — audited, and this part is not a copy edit

The rest of the site was scanned after the blog fix was drafted. Results:

- **Shipped HTML outside the blog: clean.** No occurrence.
- **Email templates, JS, product/industry pages: clean.**
- **PDF library: 13 files contain "non-toxic".** They are not the same claim, and lumping
  them together would be wrong:

| kind | n | assessment |
|---|---|---|
| **Test result, method cited** (OECD 202, LC50/LD50, rat oral) | 6 | Substantiated in context. A named test method reporting a band is not a bare marketing claim. Leave. |
| **Ingredient statement** ("proprietary ingredient is non-toxic") | 3 | About an ingredient, not the product. Internally consistent with the product's own Category 5. Leave. |
| **Bare product claim** | 4 | `vertkleen-cr-tds.pdf`, `vertkleen-lam3-tds.pdf`, `watersafe60-cr-nsf60-user-guide.pdf`, and **`vertkleen-multiwash-label.pdf`** — a printed label reading "Non-Corrosive, Non-Toxic, Non-Caustic, Cleaner". |

### A second claim, and it is the more serious one

**"Safe on skin and eyes" appears 8 times across 6 documents**, including
**`vertkleen-lam3-label-front.pdf`** — a printed label front reading **"SAFE ON SKIN AND
EYES"**.

Every one of the twelve SDS classifies the product **Skin Corrosion/Irritation Category 3**
and **Eye Damage/Eye Irritation Category 2B** — hazard statements *"Causes mild skin
irritation"* and *"Causes eye irritation"*.

A label telling a user a product is safe on eyes, while that product's SDS says it causes
eye irritation, is a direct contradiction on the surface a user is most likely to read and
least likely to cross-check. It could reasonably lead someone to skip eye protection.

**The blog copy contains none of these** — the contradiction lives entirely in the PDF
library.

### What is deliberately NOT done here

No replacement text is drafted for any label, TDS, or user guide. Printed labels are a
regulatory surface with print-run and sign-off implications, and that belongs with whoever
owns label approval — not with a copy edit. The finding is reported; the decision is not
mine to take.

## Guard

`tests/health-claim-guard.test.mjs` fails any shipped page carrying "non-toxic" or "safe on
skin/eyes", with the nine blog posts listed as PENDING until their CMS edit lands. It does
not scan PDFs.
