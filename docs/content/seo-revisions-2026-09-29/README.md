# Priority SEO article revisions — September 29, 2026

These revisions improve three existing articles for readers choosing products and planning maintenance. Existing URLs, publication dates, author attribution, hero images, categories, and tags remain intact. The article headings and search descriptions become more specific; the existing concise HTML search titles remain in use.

| Article | Main change |
| --- | --- |
| [Heat exchanger descaling](how-to-descale-heat-exchanger.md) | Deposit and material selection, HCR/CR/CR HD distinctions, equipment-specific process limits, and accurate scope for the Brevard rust-removal example |
| [Commercial kitchen degreasing](commercial-kitchen-degreasing-guide.md) | Surface-based product selection, a closing-shift sequence, and separate food-contact sanitation requirements |
| [Commercial gym cleaning](commercial-gym-cleaning-checklist.md) | Daily and weekly checklists, MultiWash cleaning guidance, and Purgo odor treatment after required pre-cleaning |

Each body contains one application-specific contact link. The existing contact form opens with a callback option and allows written details. The articles serve maintenance readers directly; private-label positioning is not forced into these searches.

## Evidence review

The supplier-evidence review found no blocking unsupported product claims or material omissions in these copies. The revisions remove blanket assurances about PPE and ventilation, universal chemical sequences, unsupported numerical recipes, and case-study extrapolation.

CR HD remains identified as a high-foam product. HCR and CR aluminum use requires application guidance because the available documents do not establish one consistent operating envelope. Purgo is not presented as the sole soil-removal step or as an approved disinfectant. No shelf-life change is needed in these articles because they make no shelf-life claim.

Public source references appear where readers need them:

- [MASEST product documents](https://masest.co/resources)
- [Alfa Laval plate heat exchanger troubleshooting](https://www.alfalaval.com/service-and-support/product-services/plate-heat-exchanger-services/troubleshooting-for-plate-heat-exchangers/)
- [FDA Food Code](https://www.fda.gov/food/fda-food-code/food-code-2022)
- [CDC facility cleaning and disinfection](https://www.cdc.gov/hygiene/about/when-and-how-to-clean-and-disinfect-a-facility.html)

## Canonical publication

[revisions.json](revisions.json) records the proposed field changes and the observed CMS versions before publication. The Markdown files provide article bodies; they are not alternate build inputs.

The canonical CMS repository validates the content, checks the current version and any active editor lock, updates the published entry, and writes a revision record. Publication preserves the existing entry identity. Generated blog snapshots and pages come from those canonical entries.

Saving a published CMS entry as a draft would remove it from the next public snapshot. These revisions therefore use the published-entry path. The website-only release omits the optional newsletter dispatch; no marketing campaign is part of this work.

## Verification

- All three revised bodies passed supplier-evidence review.
- Thirteen distinct internal links returned HTTP 200 before release.
- Existing diagrams and kitchen field photos remain in the articles, with captions that preserve the application and evidence limits. Their production media URLs returned HTTP 200.
- Canonical validation preserved the intended body and all unrelated article metadata.
- Existing entries stayed published and received matching revision records for the text revision and the restored supporting visuals.
- Only the three intended articles changed in the canonical blog export. Generated index, feed, and related-reading labels update with their headings and descriptions.

Deployment verification is recorded in the corresponding release review.
