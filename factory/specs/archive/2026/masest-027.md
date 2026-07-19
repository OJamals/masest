---
id: masest-027
title: Add a deterministic critical-UI verification gate
agent: codex
risk: medium
grill: completed
verification:
  - npm run qa:ui-critical
  - npm run qa:ui-critical && npm run qa:ui-critical
  - npm run check
  - npm run verify
---

# Grill Gate

- Owner: maintainer.
- Decision source: maintainer selected an explicit local critical-UI suite and truthful reduced-motion behavior; hosted CI changes are not authorized.
- Problem: full verification omits buyer-critical accessibility/geometry/story checks, and reduced-motion CSS leaves meaningful transitions/transforms active.
- Out of scope: full remediation suite, screenshot baselines, UI redesign, retries, and hosted CI.
- Review failure: suite uses a wildcard, omits a named contract, flakes, hides failures with retries, reduced motion remains active, or full verify omits the gate.
- Riskiest assumption: selected browser specs can be deterministic within the accepted local runtime budget.
- Smallest acceptable: explicit `qa:ui-critical`, package-script contract coverage, reduced-motion fixes, and two consecutive clean runs.

# Context

Critical buyer contracts include focus visibility, service-tab keyboard semantics, chat/lead-bar mobile geometry, story visibility, and reduced motion. These need one explicit stable suite included after built-site verification.

# Acceptance Criteria

- `package.json` defines `qa:ui-critical` with an explicit spec list; it never uses `tools/*.spec`.
- Suite covers visible focus, service-tab arrow/tab semantics, 390px chat/lead-bar non-overlap, desktop/mobile story visibility, and reduced motion.
- `npm run verify` runs `qa:ui-critical` after built-site validation.
- Reduced-motion mode has no meaningful animation, transition, or transform in the affected global/blog styles.
- Package-script contract tests prevent silent removal of the gate.
- Port readiness, teardown, and data are deterministic; no retries are added.
- `npm run qa:ui-critical && npm run qa:ui-critical` passes.
- All frontmatter verification commands pass; mark row 027 `DONE` afterward.

# Constraints

- Dependencies: `masest-019`, `masest-024`, and `masest-026` must be accepted first.
- Scope changes to `package.json`, `css/style.css`, `css/blog.css`, selected critical specs only for deterministic stabilization, script-contract tests, and row-027 status.
- Do not promote all remediation specs, add screenshots/retries, redesign covered UI, or configure hosted CI.
- STOP if secrets/mutable production data are required, deterministic lifecycle repair cannot remove flakes, visibility requires completing animation, or measured full-gate time exceeds the accepted budget; report timings and a split proposal.

# Review Notes

- Review exact package-script ordering and explicit spec names.
- Run twice from clean process state; inspect server lifecycle and reduced-motion computed styles.
