# Remaining local changes release

The primary checkout's uncommitted changes were integrated onto production commit
`b49b08ff8021c379a9ecc484e8a57d06e8eaacea` in an isolated worktree. The original
checkout was preserved during integration. Public asset references use `20260929e`.

## Included scope

- Reviewed product descriptions, product-specific application guidance, comparisons,
  industry cards, and proof records, plus supporting research and tests.
- Connected CRM staff bridge and UI. Production currently has none of the five
  `MASEST_CRM_*` settings; this integration remains disabled and fails closed.
- SES `Permanent/UnsubscribedRecipient` events no longer create an all-stream
  suppression that would prevent unrelated transactional delivery.
- Local project tooling and review artifacts. Agent configuration files are
  explicitly excluded from the public static build.
- The current private-label homepage and simplified callback/email lead flow remain
  intact. Changes to the retired story engine are retained as dormant source assets.
- Quote and sample prefills keep CIP HCR and HVAC HCR distinct so the sales lead
  identifies the product requested from its product page.

## Production content and Worker

The existing content repository published only the two changed proof records,
using optimistic version checks and recording revisions:

- `lam3-concrete-cleaning`: created as version 1.
- `property-grout-moss`: corrected product attribution, version 6 to version 7.

Snapshots were refreshed from production afterward, matching the CI content source.
No product pricing, customer records, CRM credentials, or email audiences changed.

The marketing Worker deployed as version
`68538741-dd62-46b7-9fd9-4d3a7268c28e`. Its health endpoint returned success and an
unsigned SES event returned HTTP 401. No campaign or customer test email was sent.

## Validation

- Focused catalog, connected CRM, and SES reviews completed before integration.
- Initial full unit run exposed stale assertions and branding inconsistencies;
  release preparation corrects these while preserving the underlying contracts.
- Support-ticket and marketing-provider-retirement database harnesses passed.
- Site verifier passed for 131 HTML, 8 CSS, and 300 JavaScript files.
- Browser suites: 91 workspace, 36 commerce, and 87 interaction checks passed.
- Connected CRM browser fixtures: 14 checks passed against the local OpenGTM tree.
- Homepage performance: 4 checks passed; dormant story frame-budget check passed.
- Local secrets scan and static-output checks found no newly added credential
  patterns or exposed agent configuration.

Final commit, CI, and public deployment verification are recorded in the release
response and local output report after publication.
