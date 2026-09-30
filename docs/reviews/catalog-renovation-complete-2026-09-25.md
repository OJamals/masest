# Product catalog renovation complete

September 25, 2026. All **15 public products** have completed research, page renovation, and local verification. No commit, push, deployment, or remote CI run was performed in this completion pass. Existing unrelated work remains intact.

## Product coverage

| Product | Completed review |
| --- | --- |
| VertKleen CIP CR | [Review](cip-cr-renovation-2026-09-25.md) |
| VertKleen HVAC CR | [Review](hvac-cr-renovation-2026-09-25.md) |
| VertKleen CIP HCR | [Review](cip-hcr-renovation-2026-09-25.md) |
| VertKleen HVAC HCR | [Review](hvac-hcr-renovation-2026-09-25.md) |
| VertKleen Descaler | [Review](descaler-renovation-2026-09-25.md) |
| VertKleen CR HD | [Review](cr-hd-renovation-2026-09-25.md) |
| VertKleen CR HD Low Foam | [Review](cr-hd-low-foam-renovation-2026-09-25.md) |
| VertKleen Neutral | [Review](neutral-renovation-2026-09-25.md) |
| VertKleen MultiWash | [Review](multiwash-renovation-2026-09-25.md) |
| VertKleen LAM3 | [Review](lam3-renovation-2026-09-25.md) |
| Purgo | [Final consistency review](purgo-catalog-completion-2026-09-25.md), [earlier polish](purgo-final-polish-2026-09-25.md) |
| VertKleen AlumiBrite | [Review](alumibrite-renovation-2026-09-25.md) |
| VertKleen Torque | [Review](torque-renovation-2026-09-25.md) |
| VertKleen SAR | [Review](sar-renovation-2026-09-25.md) |
| WaterSafe60 | [Review](watersafe60-renovation-2026-09-25.md) |

This scope matches `CATALOG_ORDER` and the public catalog. CR60 is marked `public_visible: false`; it was not exposed or treated as a public product. Legacy internal product entries outside the public list remain unchanged.

## Final changes

Finished MultiWash and LAM3, then brought Purgo's application, technical, and inquiry sections into the same structure. Each page now has a specific job, a reason to choose the chemistry, practical application guidance, supporting records, and an appropriate purchase/sample/quote path.

MultiWash now links its EMS Fortis counterpart and separates general, gym, and marine instructions. LAM3 now shows its authentic concrete photo pair, offers both supported application methods, and links a refreshed Wet & Forget comparison. Corrected the CR grout report's product attribution. Purgo now clearly separates surface care from water-system dosing and describes manufacturer-listed application methods without borrowing Purgo N claims.

Generator-owned product pages, industry cards, comparison pages, and the proof seed were regenerated. Prices and SKU options were preserved. Conflicting Neutral, MultiWash, and LAM3 packshots use verified product-facts panels; image-review guards prevent catalog hydration from restoring withdrawn artwork.

## Verification

- **147 tests passed, zero failures** across product renovations, generated layouts, comparison guidance, catalog/industry cards, metadata, offers, document policy, and inquiry contracts.
- JavaScript check passed: **387 files**.
- Static build passed: **295 files copied; CMS media linked in 127**.
- Final browser sweep covered all 15 public product pages at **390px and 1440px**. Every page hydrated its price and six pack options. No horizontal overflow or detected broken images.
- MultiWash, LAM3, and Purgo additionally passed **320, 390, 768, 1024, and 1440px** checks. Their mobile heroes, MultiWash desktop facts panel, and LAM3 genuine result images were inspected visually.
- Case selections updated prices and savings correctly: MultiWash $83.68, LAM3 $174.58, Purgo $184.48 for two-by-2.5-gallon cases. These were read from current public catalog data through the local preview.
- Product-document inquiries populated the correct product and message. LAM3 sample inquiry selected the correct product. No forms submitted or orders created.
- **15 distinct linked local PDFs** across the catalog returned HTTP 200 with valid PDF signatures.
- `git diff --check` passed. Context graph refreshed. Incidental sitemap-only timestamp changes reverted.

The preview allowed GET/HEAD only and proxied read-only public API responses. This verifies local changes and current public catalog hydration; it does not claim production deployment.

## Asset and source follow-ups

The [image replacement queue](image-replacement-queue-2026-09-25.md) records exact assets, observed problems, actions, and replacement briefs. Synthetic-looking scenes encountered during review were flagged; many were removed from product pages. Corrected package photographs and genuine application photography remain production tasks, not completed assets.

Some supplied labels, packshots, older comparisons, and shared proof records conflict. The pages use supported product facts and exact documents where available. Remaining items include package revision/dilution reconciliation, drone facade-versus-roof proof attribution, Descaler photograph roles, and historical comparison-document updates. No certifications, patent numbers, test conditions, or ready-to-use yields were invented to fill those gaps. Original source PDFs and controlled document hashes were preserved.
