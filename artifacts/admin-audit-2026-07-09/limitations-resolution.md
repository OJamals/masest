# Admin audit limitations: resolution map

Date: 2026-07-09  
Command: `npm run qa:admin-assurance`

The audit limitations fall into three categories: limitations that deterministic local
fixtures can remove, provider effects that require a controlled staging account, and
human-assistive-technology checks that automation can reduce but not fully replace.

## Resolution matrix

| Audit limitation | Can it be overcome? | Resolution and evidence | Remaining boundary |
|---|---|---|---|
| Sparse production rows | Yes, without adding production data | Production-shaped local fixtures now exercise a 12-item action inbox, long account labels, populated quote/company/CRM/content flows, and desktop/mobile density. `tests/admin-panel-spacing.test.mjs` and the existing admin Playwright specs are included in `qa:admin-assurance`. | A staging snapshot is still useful for unusually large real records, but no longer required for baseline layout coverage. |
| Long-content behavior | Yes | Mobile tests assert wrapping, touch height, clipping, and page-level overflow with intentionally long industrial account/action labels. | File attachments and exceptionally large rich-text bodies should still be sampled in staging. |
| Error recovery and validation | Mostly | Existing CMS, account deletion, quote, CRM, session-expiry, and API tests exercise rejected requests, validation, retry copy, and non-destructive recovery. Live-region state changes now have browser coverage. | Exhaustive combinations are not finite; new mutation paths must add their own failure contract test. |
| Destructive confirmations | Yes locally | Native dialog contracts and destructive account/CRM/order paths are exercised without touching production. All shared and custom admin dialogs now explicitly restore focus to their invoker. | Actual deletion remains a staging-only acceptance step. |
| Mutations, sends, refunds, imports, deletes, role changes | Yes at the application boundary | The assurance command submits mocked browser mutations and asserts request bodies; focused Node tests verify refund math, CSV import, authorization, audit, and role boundaries. No third-party or production side effect is created. | One controlled staging pass is required to confirm provider delivery/settlement, not application payload correctness. |
| QuickBooks sync | Yes through the application and payload boundary | QBO queue, payload, capability, retry, and sync-worker contracts are covered locally; the Integrations workspace exposes readiness and failure state separately from daily work. | A QuickBooks sandbox company is required to confirm Intuit OAuth, posting, tax mapping, and reconciliation against a real ledger. |
| Public CMS deployment | Yes through hook/export/build boundaries | Publish-hook, static-export, build, manifest, and public-site verification are covered locally. The CMS reports approved/export/deploy state honestly. | A controlled staging deployment is required to measure the final provider build, CDN propagation, and live URL confirmation. |
| Contrast ratios | Yes for rendered admin tokens | Browser-computed WCAG contrast checks now cover core helper, navigation, metadata, and eyebrow text at the rendered style boundary. | Continue adding representative selectors when new color roles are introduced. |
| Screen-reader announcements | Partly | Status regions have semantic and live-update browser tests; roles, accessible names, and state changes are asserted. | VoiceOver, NVDA, and JAWS output/order require short manual passes because browser DOM tests cannot reproduce each assistive technology. |
| Focus return after dialogs | Yes | `restoreFocusOnClose` now covers shared confirmations/details and every custom admin dialog/drawer. Browser verification confirms focus returns after cancellation. | New dialogs must use the shared helper; a regression test enforces this for current modules. |
| Zoom at 200–400% | Yes for reflow | The admin shell is tested at 320 CSS px, the WCAG reflow equivalent of 1280 px at 400% zoom, across Overview, Analytics, Finance, Integrations, and Products. | Browser-specific text-only zoom still merits a manual spot check in the supported browser matrix. |
| Full WCAG conformance | Not by automation alone | Automated coverage now handles reflow, contrast, semantics, names, live updates, keyboard tab behavior, and focus return. | Conformance still requires manual assistive-technology testing and documented results across the supported browser/AT matrix. |

## Controlled staging checklist

Use isolated provider accounts and reversible records. Do not run these against the live
customer dataset.

1. Send a newsletter test to an internal seed list and confirm receipt, suppression, bounce,
   and event reporting.
2. Create and partially refund a low-value Stripe test-mode order; confirm inventory and QBO
   credit-memo reconciliation.
3. Connect a QuickBooks sandbox company; run one invoice, payment, and refund sync; compare
   document IDs and tax treatment.
4. Import a small CRM CSV, change a staff role, and delete the imported records; confirm the
   operator-facing audit log.
5. Publish one staging-only CMS entry; confirm export diff, provider build, CDN propagation,
   deployment actor, and final preview URL.
6. Run VoiceOver/Safari and NVDA/Chrome passes for navigation, drawers, form errors, live
   regions, and rich-editor controls at 200% and 400% zoom.

## Outcome

The original audit's evidence limits are no longer blockers for local implementation QA.
External-provider effects and actual assistive-technology speech remain intentionally
staging/manual acceptance boundaries; they cannot be truthfully certified by mocked local
tests.
