import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceEnvGroups,
  buildPreflightReport,
  redactValue,
} from "../tools/production-acceptance-preflight.mjs";

const completeEnv = {
  APP_URL: "https://masest.co",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon_secret_value",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_secret_value",
  STRIPE_SECRET_KEY: "sk_live_secret",
  STRIPE_WEBHOOK_SECRET: "whsec_secret",
  STRIPE_PUBLISHABLE_KEY: "pk_live_public",
  QBO_CLIENT_ID: "qbo_client",
  QBO_CLIENT_SECRET: "qbo_secret",
  QBO_REDIRECT_URI: "https://masest.co/api/admin/qbo/callback",
  QBO_OAUTH_STATE_SECRET: "state_secret",
  QBO_SYNC_SECRET: "sync_secret",
  QBO_INCOME_ACCOUNT_ID: "79",
  QBO_ENVIRONMENT: "production",
  MASEST_CRISP_ID: "crisp-site-id",
  CRISP_TOKEN_ID: "token-id",
  CRISP_TOKEN_KEY: "token-key",
  CRISP_WEBHOOK_KEY: "website-hook-key",
  CRISP_IDENTITY_SECRET: "identity-secret",
  CONTENT_PUBLISH_HOOK_URL: "https://deploy-hook.example",
};

test("redactValue reports presence without leaking secret values", () => {
  assert.equal(redactValue(""), "missing");
  assert.equal(redactValue(null), "missing");
  assert.equal(redactValue("abcdef"), "set:6");
  assert.equal(redactValue("sk_live_very_secret"), "set:19");
});

test("acceptanceEnvGroups names the live integration gates", () => {
  assert.deepEqual(
    acceptanceEnvGroups.map((group) => group.id),
    ["supabase", "stripe", "qbo", "crisp", "cms_publish"],
  );
});

test("buildPreflightReport fails closed and redacts missing env checks", () => {
  const report = buildPreflightReport({
    env: {
      APP_URL: "https://masest.co",
      SUPABASE_URL: "https://example.supabase.co",
      STRIPE_SECRET_KEY: "sk_live_secret",
    },
    git: {
      head: "abc123",
      branch: "main",
      originHead: "abc123",
      dirtyFiles: ["proof.html", ".tmp-proof.json"],
    },
    pagesBuild: { status: "built", commit: "abc123" },
    now: "2026-06-30T00:00:00.000Z",
  });

  assert.equal(report.ready, false);
  assert.equal(report.checks.git_clean.ok, false);
  assert.equal(report.checks.env_supabase.ok, false);
  assert.equal(report.checks.env_stripe.ok, false);
  assert.equal(report.checks.env_qbo.ok, false);
  assert.equal(report.checks.env_crisp.ok, false);
  assert.equal(report.checks.env_cms_publish.ok, false);
  assert.equal(JSON.stringify(report).includes("sk_live_secret"), false);
  assert.deepEqual(report.blockers.slice(0, 2), [
    "git_clean: worktree has uncommitted or untracked files",
    "env_supabase: missing SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
  ]);
});

test("buildPreflightReport passes local gates when commit, env, and Pages build match", () => {
  const report = buildPreflightReport({
    env: completeEnv,
    git: {
      head: "af514838dd5f10aa65a5eb83d6b2dec2a86684f4",
      branch: "main",
      originHead: "af514838dd5f10aa65a5eb83d6b2dec2a86684f4",
      dirtyFiles: [],
    },
    pagesBuild: {
      status: "built",
      commit: "af514838dd5f10aa65a5eb83d6b2dec2a86684f4",
    },
    now: "2026-06-30T00:00:00.000Z",
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.checks.git_branch.ok, true);
  assert.equal(report.checks.pages_commit.ok, true);
  assert.equal(report.checks.env_crisp.details.values.CRISP_TOKEN_KEY, "set:9");
  assert.equal(JSON.stringify(report).includes("token-key"), false);
});
