import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

async function packageJson() {
  return JSON.parse(await readFile(new URL("package.json", root), "utf8"));
}

const read = (path) => readFile(new URL(path, root), "utf8");

test("the default verification gate includes dedicated admin assurance", async () => {
  const pkg = await packageJson();
  const verifyCore = String(pkg.scripts?.["verify:core"] || "");
  const matches = verifyCore.match(/npm run qa:admin-assurance/g) || [];

  assert.equal(matches.length, 1, "verify:core must run qa:admin-assurance exactly once");
  assert.ok(
    verifyCore.indexOf("npm run qa:admin-assurance") < verifyCore.indexOf("npm run qa:commerce-smoke"),
    "admin assurance should fail before unrelated commerce/browser gates",
  );
});

test("default verification covers every admin browser spec", async () => {
  const pkg = await packageJson();
  const defaultAdminCoverage = [
    pkg.scripts?.["qa:workspace-regressions"],
    pkg.scripts?.["qa:admin-assurance"],
  ].join(" ");
  const adminSpecs = (await readdir(new URL("tools/", root)))
    .filter((name) => /^admin.*\.spec\.mjs$/.test(name))
    .sort();

  assert.ok(adminSpecs.length > 0, "admin browser spec inventory must not be empty");
  for (const spec of adminSpecs) {
    assert.match(defaultAdminCoverage, new RegExp(`(?:^|\\s)tools/${spec.replaceAll(".", "\\.")}(?:\\s|$)`));
  }
});

test("authenticated admin E2E is staging-only and manually dispatched", async () => {
  const pkg = await packageJson();
  assert.equal(pkg.scripts?.["qa:admin-staging-e2e"], "node tools/admin-staging-e2e.mjs");

  const workflow = await read(".github/workflows/admin-staging-e2e.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /environment: admin-staging-e2e/);
  assert.match(workflow, /ADMIN_E2E_ENABLE: staging-only/);
  for (const secret of [
    "ADMIN_E2E_BASE_URL",
    "ADMIN_E2E_SUPABASE_URL",
    "ADMIN_E2E_SUPABASE_ANON_KEY",
    "ADMIN_E2E_SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    assert.match(workflow, new RegExp(`\\$\\{\\{ secrets\\.${secret} \\}\\}`));
  }
  assert.match(workflow, /npm run qa:admin-staging-e2e/);
});

test("production deployment runs an anonymous read-only admin smoke", async () => {
  const pkg = await packageJson();
  assert.equal(pkg.scripts?.["qa:admin-production-smoke"], "node tools/admin-production-smoke.mjs");

  const workflow = await read(".github/workflows/verify.yml");
  const deployIndex = workflow.indexOf("- name: Deploy production to Cloudflare Pages");
  const smokeIndex = workflow.indexOf("- name: Verify production admin gate");
  assert.ok(deployIndex >= 0, "production deploy step must exist");
  assert.ok(smokeIndex > deployIndex, "production admin smoke must run after deployment");

  const nextStepIndex = workflow.indexOf("\n      - name:", smokeIndex + 1);
  const smokeStep = workflow.slice(smokeIndex, nextStepIndex === -1 ? undefined : nextStepIndex);
  assert.match(smokeStep, /ADMIN_PRODUCTION_BASE_URL: https:\/\/masest\.co/);
  assert.match(smokeStep, /run: npm run qa:admin-production-smoke/);
  assert.doesNotMatch(smokeStep, /\$\{\{ secrets\.|Authorization|Bearer|\bPOST\b/);
});
