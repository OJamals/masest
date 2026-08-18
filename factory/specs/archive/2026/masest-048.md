---
id: masest-048
title: Close commerce QA and pre-existing regression failures
agent: codex
risk: high
grill: completed
verification:
  - npm run check
  - npm test
  - npm run build
  - npm run verify:site
  - npm run qa:commerce-smoke
  - npm run smoke:admin
  - npm run qa:ui-critical
  - node --test tests/spacing-regressions.test.mjs
  - npm audit --omit=dev
  - git diff --check
---

# Grill Gate

- Owner: MASEST product owner; this spec accepts only regressions proven during candidates 1–4 and the known Platform staff spacing failure.
- Problem: targeted tests can stay green while full browser/UI or pre-existing regressions remain red.
- Out of scope: unrelated redesign, copy strategy, deployment, live provider mutation, weakening assertions, deleting tests, or hiding failures through filtered output.
- Review failure: any verification command is red/flaky; spacing is fixed by suppressing the test rather than correcting layout; new failure is ignored as “pre-existing”; broad Playwright result is summarized without its actual failure set.
- Riskiest assumption: dirty UI remediation and commerce changes overlap. Preserve intent and compare exact failure sets before/after.
- Smallest acceptable: repair the known `article.product-admin-card > label ("Name")` 1280px spacing defect, fix every reproducible in-scope failure discovered during full verification, and capture clean deterministic evidence.

# Context

The initial audit reproduced `[surface-inset/bottom] gap 1px < 2px — article.product-admin-card > label ("Name") on 1280w admin#products`. Project memory warns that broad browser output can falsely appear green and fixed ports conflict when suites run concurrently.

# Acceptance Criteria

1. Reproduce and fix the known admin Products spacing failure at 1280px without weakening the minimum-gap contract or creating overflow at supported widths.
2. Run unit/API and browser suites sequentially. Capture complete failure sets and exit codes; never pipe to `tail` or report counts alone.
3. Fix every reproducible pre-existing issue encountered that is within repository scope and does not require a new product decision. Add a regression test for each semantic defect.
4. Product-decision gaps are recorded explicitly and remain active; tests are not weakened to invent behavior.
5. Run adversarial workflow QA covering Buyer checkout, Platform staff shipment/label/cancel/refund/status, Quote send/accept/decline/retry, accessibility, responsive layout, stale requests, replay, concurrent operations, and provider failures through deterministic adapters.
6. Verify no secrets/raw provider bodies/PII leaked, no live mutating provider call occurred, and migrations include rerunnable forward verification plus bounded rollback guidance.
7. Perform context-isolated code review against specs 044–048. Any failed review stays active and is remediated; only accepted review permits archive.

# Constraints

- Never run `npm test` and Playwright concurrently.
- Preserve existing assertions unless current product authority proves them stale; document any changed contract.
- No commit, push, deploy, production database write, or live money/shipping/email mutation.

# Review Notes

- Compare exact failure names, inspect responsive screenshots/DOM geometry, review migrations and rollback, then rerun all frontmatter commands from a stable tree.

# Acceptance Evidence

- `npm run verify`: 303 JavaScript files; 2,234/2,234 unit/API tests; 282-file build;
  site verification; commerce Playwright 31/31; UI-critical Playwright 46/46.
- Admin Playwright passed 25/25; spacing passed 3/3, including 1280px admin Products.
- `npm audit --omit=dev` found 0 vulnerabilities; 49 registry signatures and 12 attestations verified;
  `npm ci --dry-run --ignore-scripts` and `git diff --check` passed.
- Database schema backup captured before deployment; seven migrations applied twice; live RLS,
  privilege, trigger, constraint, index, and count verification passed.
- Context-isolated review findings were reproduced, repaired test-first, and re-reviewed clean.
