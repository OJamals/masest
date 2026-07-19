---
id: masest-023
title: Prevent erasure of the sole Company admin
agent: codex
risk: medium
grill: completed
verification:
  - node --test tests/account-erasure.test.mjs tests/account-scope.test.mjs
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected denial rather than automatic ownership transfer.
- Problem: self-service erasure bypasses the last-Company-admin invariant and can orphan buyer members.
- Out of scope: SQL trigger/helper changes, production migration, Company deletion, member detachment, transfer automation, platform-staff deletion, and UI redesign.
- Review failure: sole-admin deletion reaches any side effect, valid deletion cases break, existing account-erasure transaction changes, or gates fail.
- Riskiest assumption: Company membership and admin role still live on `profiles.company_id` and the current role value.
- Smallest acceptable: fail closed with 409 before readiness/deletion whenever the requester is the sole Company admin.

# Context

Team demotion/removal already protects the last Company admin. Account erasure must apply the same invariant before invoking readiness RPC or Auth deletion.

# Acceptance Criteria

- User without a Company can erase the account unchanged.
- Buyer-role Company member can erase the account unchanged.
- Company admin with another Company admin can erase the account.
- Sole Company admin receives 409 `last_company_admin` with guidance to transfer ownership through Team settings.
- Sole-admin denial performs no readiness RPC and no Auth deletion.
- Profile/member query failure fails closed with a generic server error and no deletion.
- Existing migration-not-ready, Auth-failure, and successful-erasure tests remain green.
- `deleteAccountUser` and the account-erasure SQL/transaction boundary remain unchanged.
- All frontmatter verification commands pass; mark row 023 `DONE` afterward.

# Constraints

- Dependencies: `masest-019` accepted; preserve completed account-erasure failure-safety/transaction work.
- Completed prerequisite: advisor plan 012’s account-erasure code and transaction boundary remain intact.
- Scope changes to `functions/api/account/delete.js`, `tests/account-erasure.test.mjs`, and row-023 status only.
- Do not implement automatic transfer or alter Company/platform-staff deletion semantics.
- STOP if live role/membership storage differs, owner requests undefined automatic transfer, or guard needs SQL/transaction-boundary changes.

# Review Notes

- Verify side-effect ordering explicitly.
- Review failure-path tests for fail-closed behavior, not only happy-path role counts.
