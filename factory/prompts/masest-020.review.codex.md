Review Loop Factory spec `masest-020` against current working tree.

        Native adapter: `codex`
        Spec path: `/Users/omar/Claude/Projects/MASEST/factory/specs/active/masest-020.md`

        Review stance:
        - Findings first. Focus correctness, regressions, tests, security, maintainability.
        - Compare implementation against acceptance criteria.
        - Run or inspect verification evidence:
        - `node --test tests/account-setup.test.mjs tests/staff-roles.test.mjs tests/qbo-tax-exempt.test.mjs`
- `npm run check`
- `npm run verify`
- `git diff --check`
        - If accepted, say `ACCEPTED`.
        - If not accepted, say `CHANGES_REQUESTED` and list blocking items.
        - Do not move files. Operator or CLI archive step moves accepted specs.

        Spec:
        ---
        # Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected staff-controlled tax exemption; no tax-policy expansion is authorized.
- Problem: authenticated buyers can set `companies.tax_exempt`, which checkout maps to Stripe Customer tax state.
- Out of scope: Stripe Tax configuration, nexus/calculation, automatic certificate validation, QBO behavior, and changes to the authorized staff route.
- Review failure: buyer input can still set exemption, certificate submission breaks, staff loses the audited path, provider propagation changes, or gates fail.
- Riskiest assumption: omitting `tax_exempt` reliably uses the database’s non-exempt default.
- Smallest acceptable: strip buyer authority on create/update while retaining certificate evidence and existing finance/owner mutation.

# Context

Company self-service currently accepts `tax_exempt` during create and update. Buyers may submit `resale_cert_url`, but only authorized finance/owner staff may decide stored tax-exempt state. Checkout and QBO must continue consuming the stored authoritative value.

# Acceptance Criteria

- Buyer Company creation ignores or rejects `{ tax_exempt: true }`; new Companies remain non-exempt.
- Buyer Company updates cannot mutate `tax_exempt`.
- Buyer resale-certificate upload/resubmission through `resale_cert_url` remains intact.
- Existing authorized finance/owner staff mutation remains audited and operational.
- Checkout and QBO tests prove the stored exemption still reaches providers unchanged.
- Focused malicious create/update tests and all frontmatter verification commands pass.
- Only `functions/api/account/company.js`, focused authority tests, and row-020 status receive task changes.
- Mark row 020 `DONE` only after every criterion passes.

# Constraints

- Dependency: `masest-019` must be accepted first.
- Do not change Stripe Tax enablement, origin, nexus, calculation, QBO mapping, invoices, or the authorized admin-company route.
- Do not automatically validate certificates or remove `resale_cert_url` from buyer setup.
- Do not clean or overwrite unrelated worktree changes.
- STOP if product policy requires buyer self-certification, omission does not default false, authorized staff mutation lives outside `functions/api/admin/companies.js`, or implementation needs policy/dashboard/production-data migration.

# Review Notes

- Trace both create and update assignments. Verify denied buyer values never persist.
- Confirm provider tests exercise authoritative stored state, not request-body state.
