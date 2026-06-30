# MASEST Production Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a repeatable, no-secrets production acceptance gate for MASEST before any further feature expansion.

**Architecture:** Keep the acceptance process outside product runtime code: tracked docs and read-only tooling define the gate, while run-specific screenshots and provider IDs live under ignored `audits/production-acceptance-YYYY-MM-DD/`. The harness stops before live mutation and reports redacted readiness for Supabase, Stripe, QuickBooks Online, Crisp, CMS publish, Git state, and GitHub Pages deployment state.

**Tech Stack:** GitHub Issues, Markdown runbooks, Node ESM tooling, `node --test`, GitHub CLI, Cloudflare Pages, Supabase, Stripe, QuickBooks Online, Crisp, Playwright for later visual evidence, local `npm run verify`.

---

## Scope Boundary

This plan implements only the tracked preparation layer:

- One GitHub issue that anchors the production acceptance pass.
- One runbook with gate checklist, live mutation boundaries, cleanup rules, evidence rules, and controlled failure paths.
- One read-only preflight script with redacted output.
- Tests for the preflight report behavior.

This plan does not create QA customers, mutate Supabase, publish CMS entries, charge Stripe, create QBO artifacts, or send Crisp messages. Those steps require an explicit operator go/no-go after the preflight report is reviewed.

## File Structure

- Create: `docs/PRODUCTION_ACCEPTANCE.md`
  - Owner-facing runbook for the live acceptance pass.
  - Defines QA identity, evidence artifact, freeze rule, no-secrets policy, live mutation sequence, cleanup, and blocker policy.
- Create: `tools/production-acceptance-preflight.mjs`
  - Read-only Node CLI and exportable helpers.
  - Checks Git branch, clean tree, `origin/main`, latest Pages build, and required live-integration env groups.
  - Redacts every env value as `missing` or `set:<length>`.
- Create: `tests/production-acceptance-preflight.test.mjs`
  - Unit tests for redaction, gate grouping, fail-closed behavior, and passing report shape.
- Modify: `package.json`
  - Adds `npm run acceptance:preflight`.

## Task 1: Add the Read-Only Preflight Harness

**Files:**

- Create: `tests/production-acceptance-preflight.test.mjs`
- Create: `tools/production-acceptance-preflight.mjs`
- Modify: `package.json`

- [x] **Step 1: Write the failing test**

Create `tests/production-acceptance-preflight.test.mjs` with assertions that:

```js
assert.equal(redactValue("sk_live_very_secret"), "set:19");
assert.deepEqual(acceptanceEnvGroups.map((group) => group.id), [
  "supabase",
  "stripe",
  "qbo",
  "crisp",
  "cms_publish",
]);
assert.equal(report.ready, false);
assert.equal(JSON.stringify(report).includes("sk_live_secret"), false);
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/production-acceptance-preflight.test.mjs
```

Expected RED:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'tools/production-acceptance-preflight.mjs'
```

- [x] **Step 3: Implement the minimal harness**

Create `tools/production-acceptance-preflight.mjs` with:

```js
export const acceptanceEnvGroups = [
  { id: "supabase", required: ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"] },
  { id: "stripe", required: ["APP_URL", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PUBLISHABLE_KEY"] },
  { id: "qbo", required: ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_REDIRECT_URI", "QBO_OAUTH_STATE_SECRET", "QBO_SYNC_SECRET", "QBO_INCOME_ACCOUNT_ID", "QBO_ENVIRONMENT"] },
  { id: "crisp", required: ["MASEST_CRISP_ID", "CRISP_TOKEN_ID", "CRISP_TOKEN_KEY", "CRISP_IDENTITY_SECRET"], oneOf: [["CRISP_WEBHOOK_SECRET", "CRISP_WEBHOOK_KEY"]] },
  { id: "cms_publish", required: [], oneOf: [["CONTENT_PUBLISH_HOOK_URL", "CF_PAGES_DEPLOY_HOOK_URL"]] },
];
```

The CLI must support:

```bash
npm run acceptance:preflight -- --json --output audits/production-acceptance-2026-06-30/preflight.json
```

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
node --test --test-concurrency=1 --test-timeout=120000 tests/production-acceptance-preflight.test.mjs
```

Expected GREEN: four passing tests, zero failures.

## Task 2: Add the Runbook

**Files:**

- Create: `docs/PRODUCTION_ACCEPTANCE.md`

- [x] **Step 1: Define the freeze and go/no-go boundary**

The runbook must state:

```text
No live QA records, CMS publishes, Stripe charges, QBO artifacts, Crisp messages, or provider cleanup actions happen until the operator explicitly approves the go/no-go checkpoint after preflight.
```

- [x] **Step 2: Define the gate checklist**

The runbook must include checklist sections for:

```text
freeze, preflight, disposable QA identity, Supabase app mutations, buyer dashboard, business dashboard, admin CRM/CMS/orders/products/QBO, CMS publish/rollback, Stripe checkout/webhook/refund, QBO invoice/payment/refund or void, Crisp visitor/operator/webhook mirror, role checks, controlled failure paths, focused accessibility/performance, cleanup, evidence closeout
```

- [x] **Step 3: Define no-secrets evidence rules**

The runbook must require:

```text
Record timestamps, object IDs, redacted URLs, screenshots with sensitive fields masked, pass/fail notes, cleanup state, and blockers. Never record credentials, database URLs, webhook secrets, tokens, payment card details, customer PII, or raw provider payloads containing secrets.
```

## Task 3: Create the GitHub Tracking Issue

**Files:**

- Use: `docs/PRODUCTION_ACCEPTANCE.md`

- [x] **Step 1: Create the issue**

Run:

```bash
gh issue create --title "Production acceptance gate for MASEST launch readiness" --label enhancement --label admin --label money-flow --body-file docs/PRODUCTION_ACCEPTANCE.md
```

Observed: https://github.com/OJamals/masest/issues/141

Note: the remote did not have the documented `ready-for-agent` label, so existing labels were used instead: `enhancement`, `admin`, and `money-flow`.

- [x] **Step 2: Record the issue in the closeout**

Final response must include the issue URL and make clear that live mutations are still blocked until operator go/no-go.

## Task 4: Verify and Commit Only the Acceptance Scope

**Files:**

- Stage only:
  - `docs/PRODUCTION_ACCEPTANCE.md`
  - `docs/superpowers/plans/2026-06-30-production-acceptance.md`
  - `tools/production-acceptance-preflight.mjs`
  - `tests/production-acceptance-preflight.test.mjs`
  - `package.json`

- [ ] **Step 1: Run focused verification**

Run:

```bash
npm run check
node --test --test-concurrency=1 --test-timeout=120000 tests/production-acceptance-preflight.test.mjs
npm run acceptance:preflight -- --json --skip-pages --output audits/production-acceptance-2026-06-30/preflight-local.json
```

Expected:

- `npm run check` passes.
- The focused preflight tests pass.
- The live preflight command may exit nonzero when the worktree is dirty or env is incomplete; that is expected fail-closed behavior and must be reported honestly.

- [ ] **Step 2: Commit the tracked acceptance scope**

Run:

```bash
git add docs/PRODUCTION_ACCEPTANCE.md docs/superpowers/plans/2026-06-30-production-acceptance.md tools/production-acceptance-preflight.mjs tests/production-acceptance-preflight.test.mjs package.json
git commit -m "docs: add production acceptance gate"
```

Do not stage unrelated CMS/proof files.
