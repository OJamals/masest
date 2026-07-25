import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptanceEnvGroups,
  buildPreflightReport,
  cloudflarePagesDeploymentFromPayload,
  cloudflarePagesEnvPresence,
  collectCloudflarePagesEnv,
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
  STRIPE_SHIPPING_RATE_IDS: "shr_live_ground",
  QBO_CLIENT_ID: "qbo_client",
  QBO_CLIENT_SECRET: "qbo_secret",
  QBO_REDIRECT_URI: "https://masest.co/api/admin/qbo/callback",
  QBO_OAUTH_STATE_SECRET: "state_secret",
  QBO_SYNC_SECRET: "sync_secret",
  QBO_INCOME_ACCOUNT_ID: "79",
  QBO_ENVIRONMENT: "production",
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
    ["supabase", "stripe", "qbo", "cms_publish"],
  );
  assert.ok(
    acceptanceEnvGroups.find((group) => group.id === "stripe").required.includes("STRIPE_SHIPPING_RATE_IDS"),
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
  assert.equal(report.checks.env_cms_publish.ok, false);
  assert.equal(JSON.stringify(report).includes("sk_live_secret"), false);
  assert.deepEqual(report.blockers.slice(0, 2), [
    "git_clean: worktree has uncommitted or untracked files",
    "env_supabase: missing one complete option: SUPABASE_DB_URL; CONTENT_DB_URL; SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY",
  ]);
});

test("buildPreflightReport accepts a Supabase Postgres pooler source without leaking it", () => {
  const dbUrl = "postgresql://user:very-secret-password@aws-1-us-west-2.pooler.supabase.com:5432/postgres";
  const report = buildPreflightReport({
    env: {
      ...completeEnv,
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      SUPABASE_DB_URL: dbUrl,
    },
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
  assert.equal(report.checks.env_supabase.ok, true);
  assert.match(report.checks.env_supabase.details.values.SUPABASE_DB_URL, /^set:\d+$/);
  assert.equal(JSON.stringify(report).includes(dbUrl), false);
  assert.equal(JSON.stringify(report).includes("very-secret-password"), false);
});

test("cloudflarePagesDeploymentFromPayload parses authoritative production deployment", () => {
  const head = "4978b9b289651c20acf3cc4bf1820c1b484bc461";
  const pagesBuild = cloudflarePagesDeploymentFromPayload({
    result: [{
      id: "deployment-1",
      environment: "production",
      url: "https://deployment-1.masest-commerce.pages.dev",
      created_on: "2026-06-30T09:14:53Z",
      modified_on: "2026-06-30T09:15:53Z",
      latest_stage: { name: "deploy", status: "success" },
      deployment_trigger: { metadata: { commit_hash: head } },
    }],
  });

  assert.deepEqual(pagesBuild, {
    status: "built",
    commit: head,
    source: "cloudflare_pages_api",
    deployment_id: "deployment-1",
    environment: "production",
    created_at: "2026-06-30T09:14:53Z",
    updated_at: "2026-06-30T09:15:53Z",
    url: "https://deployment-1.masest-commerce.pages.dev",
  });
});

test("cloudflarePagesDeploymentFromPayload fails closed for failed or missing deployments", () => {
  assert.equal(cloudflarePagesDeploymentFromPayload({
    result: [{ latest_stage: { status: "failure" }, deployment_trigger: { metadata: { commit_hash: "abc" } } }],
  }).status, "failure");
  assert.equal(cloudflarePagesDeploymentFromPayload({ result: [] }).status, "unavailable");
});

test("collectCloudflarePagesEnv reads config and deployment without leaking token", async () => {
  const urls = [];
  const token = "top-secret-token";
  const fetchImpl = async (url, options) => {
    urls.push(String(url));
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    if (String(url).includes("/deployments?")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [{
            id: "deployment-1",
            environment: "production",
            latest_stage: { status: "success" },
            deployment_trigger: { metadata: { commit_hash: "abc123" } },
          }],
        }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        result: { deployment_configs: { production: { env_vars: { APP_URL: { type: "secret_text" } } } } },
      }),
    };
  };
  const result = await collectCloudflarePagesEnv({
    accountId: "account",
    projectName: "masest-commerce",
    token,
    fetchImpl,
  });
  assert.equal(urls.length, 2);
  assert.equal(result.env.APP_URL, "cloudflare:secret_text");
  assert.equal(result.pagesBuild.commit, "abc123");
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("cloudflarePagesEnvPresence converts Pages env metadata into redacted presence", () => {
  const env = cloudflarePagesEnvPresence({
    deployment_configs: {
      production: {
        env_vars: {
          APP_URL: { type: "secret_text" },
          STRIPE_SECRET_KEY: { type: "secret_text" },
          STRIPE_PUBLISHABLE_KEY: { type: "plain_text", value: "pk_live_should_not_leak" },
          EMPTY_VALUE: { type: "plain_text", value: "" },
        },
      },
    },
  });

  assert.deepEqual(env, {
    APP_URL: "cloudflare:secret_text",
    STRIPE_SECRET_KEY: "cloudflare:secret_text",
    STRIPE_PUBLISHABLE_KEY: "cloudflare:plain_text",
  });
  assert.equal(JSON.stringify(env).includes("pk_live_should_not_leak"), false);
});

test("buildPreflightReport can use Cloudflare Pages env presence for production blockers", () => {
  const env = cloudflarePagesEnvPresence({
    deployment_configs: {
      production: {
        env_vars: Object.fromEntries([
          "APP_URL",
          "SUPABASE_URL",
          "SUPABASE_ANON_KEY",
          "SUPABASE_SERVICE_ROLE_KEY",
          "STRIPE_SECRET_KEY",
          "STRIPE_WEBHOOK_SECRET",
          "STRIPE_SHIPPING_RATE_IDS",
          "CONTENT_PUBLISH_HOOK_URL",
        ].map((key) => [key, { type: "secret_text" }])),
      },
    },
  });
  const report = buildPreflightReport({
    env,
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
    envSource: {
      type: "cloudflare_pages",
      project: "masest-commerce",
      environment: "production",
    },
    now: "2026-06-30T00:00:00.000Z",
  });

  assert.equal(report.ready, false);
  assert.equal(report.env_source.type, "cloudflare_pages");
  assert.equal(report.checks.env_supabase.ok, true);
  assert.equal(report.checks.env_cms_publish.ok, true);
  assert.equal(report.checks.env_stripe.ok, true);
  assert.equal(report.checks.env_qbo.ok, false);
  assert.deepEqual(report.checks.env_stripe.details.missing, []);
  assert.equal(JSON.stringify(report).includes("cloudflare:secret_text"), false);
});

test("buildPreflightReport accepts a Cloudflare QBO connect key bundle", () => {
  const env = cloudflarePagesEnvPresence({
    deployment_configs: {
      production: {
        env_vars: {
          APP_URL: { type: "secret_text" },
          SUPABASE_URL: { type: "secret_text" },
          SUPABASE_ANON_KEY: { type: "secret_text" },
          SUPABASE_SERVICE_ROLE_KEY: { type: "secret_text" },
          STRIPE_SECRET_KEY: { type: "secret_text" },
          STRIPE_WEBHOOK_SECRET: { type: "secret_text" },
          STRIPE_SHIPPING_RATE_IDS: { type: "secret_text" },
          CONTENT_PUBLISH_HOOK_URL: { type: "secret_text" },
          QBO_CONNECT_KEY: { type: "secret_text" },
        },
      },
    },
  });
  const report = buildPreflightReport({
    env,
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

  assert.equal(report.checks.env_qbo.ok, true);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("env_qbo:")), false);
});

test("buildPreflightReport accepts individual QBO vars without an income account id", () => {
  const { QBO_INCOME_ACCOUNT_ID: _incomeAccountId, QBO_CONNECT_KEY: _connectKey, ...env } = completeEnv;
  const report = buildPreflightReport({
    env,
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

  assert.equal(report.checks.env_qbo.ok, true);
  assert.equal(report.checks.env_qbo.details.values.QBO_INCOME_ACCOUNT_ID, undefined);
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("env_qbo:")), false);
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
});
