import assert from "node:assert/strict";
import test from "node:test";

import {
  assertStagingHealth,
  cleanupDisposableStaff,
  isReadOnlyAdminRequest,
  isSameOriginApplicationApi,
  loadAdminStagingConfig,
  provisionDisposableStaff,
  waitForApplicationApiIdle,
} from "../tools/admin-staging-e2e.mjs";

const PRODUCTION_SUPABASE_URL = "https://production-ref.supabase.co";
const STAGING_SUPABASE_URL = "https://staging-ref.supabase.co";
const USER_ID = "11111111-1111-4111-8111-111111111111";

test("authenticated browser navigation cannot mutate application APIs", () => {
  assert.equal(isReadOnlyAdminRequest("GET"), true);
  assert.equal(isReadOnlyAdminRequest("head"), true);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isReadOnlyAdminRequest(method), false);
  }
});

test("authenticated browser token injection is limited to the staging application origin", () => {
  const baseUrl = "https://admin-preview.example.test";
  assert.equal(isSameOriginApplicationApi(baseUrl, `${baseUrl}/api/admin/stats`), true);
  assert.equal(isSameOriginApplicationApi(baseUrl, `${baseUrl}/assets/app.js`), false);
  assert.equal(isSameOriginApplicationApi(baseUrl, "https://attacker.example.test/api/admin/stats"), false);
  assert.equal(isSameOriginApplicationApi(baseUrl, "https://admin-preview.example.test.attacker.test/api/admin/stats"), false);
  assert.equal(isSameOriginApplicationApi(baseUrl, "not-a-url"), false);
});

test("panel checks wait for a sustained application API idle window", async () => {
  const pending = new Set(["request"]);
  let clock = 0;
  await waitForApplicationApiIdle(pending, {
    timeoutMs: 1_000,
    idleMs: 100,
    pollMs: 25,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      if (clock >= 50) pending.clear();
    },
  });
  assert.ok(clock >= 150, "idle window must start only after the final request finishes");

  await assert.rejects(
    () => waitForApplicationApiIdle(new Set(["stuck"]), {
      timeoutMs: 50,
      idleMs: 10,
      pollMs: 10,
      now: () => clock,
      sleep: async (milliseconds) => { clock += milliseconds; },
    }),
    (error) => error?.code === "admin_e2e_api_idle_timeout",
  );
});

function stagingEnv(overrides = {}) {
  return {
    ADMIN_E2E_ENABLE: "staging-only",
    ADMIN_E2E_BASE_URL: "https://admin-preview.example.test",
    ADMIN_E2E_SUPABASE_URL: STAGING_SUPABASE_URL,
    ADMIN_E2E_SUPABASE_ANON_KEY: "test-anon-placeholder",
    ADMIN_E2E_SUPABASE_SERVICE_ROLE_KEY: "test-service-placeholder",
    ...overrides,
  };
}

test("staging configuration refuses production and implicit execution", () => {
  assert.throws(
    () => loadAdminStagingConfig(stagingEnv({ ADMIN_E2E_ENABLE: "" }), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL }),
    (error) => error?.code === "admin_e2e_not_enabled",
  );
  assert.throws(
    () => loadAdminStagingConfig(stagingEnv({ ADMIN_E2E_BASE_URL: "https://masest.co" }), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL }),
    (error) => error?.code === "admin_e2e_production_base_forbidden",
  );
  assert.throws(
    () => loadAdminStagingConfig(stagingEnv({ ADMIN_E2E_SUPABASE_URL: PRODUCTION_SUPABASE_URL }), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL }),
    (error) => error?.code === "admin_e2e_production_database_forbidden",
  );
  assert.throws(
    () => loadAdminStagingConfig(stagingEnv({ ADMIN_E2E_SUPABASE_URL: "https://attacker.example.test" }), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL }),
    (error) => error?.code === "admin_e2e_invalid_supabase_url",
  );
});

test("staging health must report the exact configured disposable database", async () => {
  const config = loadAdminStagingConfig(stagingEnv(), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL });
  await assert.doesNotReject(() => assertStagingHealth(config, {
    fetchImpl: async () => Response.json({ ok: true, env: { supabase_url: STAGING_SUPABASE_URL } }),
  }));
  await assert.rejects(
    () => assertStagingHealth(config, {
      fetchImpl: async () => Response.json({ ok: true, env: { supabase_url: "https://wrong-ref.supabase.co" } }),
    }),
    (error) => error?.code === "admin_e2e_environment_mismatch",
  );
});

test("provisioning creates one confirmed owner and returns only ephemeral runtime state", async () => {
  const config = loadAdminStagingConfig(stagingEnv(), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/auth/v1/admin/users")) {
      return Response.json({ id: USER_ID });
    }
    if (String(url).includes("/rest/v1/profiles?on_conflict=id")) {
      return Response.json([{ id: USER_ID, is_staff: true, staff_role: "owner" }], { status: 201 });
    }
    if (String(url).includes("/auth/v1/token?grant_type=password")) {
      return Response.json({ access_token: "ephemeral-access-token", user: { id: USER_ID } });
    }
    throw new Error(`unexpected request ${url}`);
  };

  const provisioned = await provisionDisposableStaff(config, {
    fetchImpl,
    randomUUID: () => USER_ID,
    randomPassword: () => "test-only-password",
  });

  assert.equal(provisioned.userId, USER_ID);
  assert.equal(provisioned.accessToken, "ephemeral-access-token");
  assert.equal(provisioned.email, undefined, "test identity must not escape provisioning");
  assert.equal(provisioned.password, undefined, "test password must not escape provisioning");
  assert.deepEqual(calls.map((call) => new URL(call.url).pathname), [
    "/auth/v1/admin/users",
    "/rest/v1/profiles",
    "/auth/v1/token",
  ]);
  assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
  const profile = JSON.parse(calls[1].options.body);
  assert.deepEqual(profile, {
    id: USER_ID,
    role: "buyer",
    is_staff: true,
    staff_role: "owner",
    full_name: "MASEST Admin E2E",
  });
});

test("cleanup removes and verifies both disposable profile and auth user", async () => {
  const config = loadAdminStagingConfig(stagingEnv(), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET", signal: options.signal });
    const pathname = new URL(url).pathname;
    if (pathname === "/rest/v1/profiles" && options.method === "DELETE") return new Response(null, { status: 204 });
    if (pathname === `/auth/v1/admin/users/${USER_ID}` && options.method === "DELETE") return Response.json({});
    if (pathname === "/rest/v1/profiles") return Response.json([]);
    if (pathname === `/auth/v1/admin/users/${USER_ID}`) return Response.json({ message: "not found" }, { status: 404 });
    throw new Error(`unexpected request ${url}`);
  };

  await cleanupDisposableStaff(config, USER_ID, { fetchImpl });

  assert.deepEqual(calls.map(({ method }) => method), ["DELETE", "DELETE", "GET", "GET"]);
  assert.ok(calls.every((call) => call.signal instanceof AbortSignal));
});

test("provisioning rolls back the auth user when profile creation fails", async () => {
  const config = loadAdminStagingConfig(stagingEnv(), { productionSupabaseUrl: PRODUCTION_SUPABASE_URL });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    calls.push({ pathname, method: options.method || "GET" });
    if (pathname === "/auth/v1/admin/users" && options.method === "POST") return Response.json({ id: USER_ID });
    if (pathname === "/rest/v1/profiles" && options.method === "POST") return Response.json({ message: "schema mismatch" }, { status: 500 });
    if (pathname === "/rest/v1/profiles" && options.method === "DELETE") return new Response(null, { status: 204 });
    if (pathname === `/auth/v1/admin/users/${USER_ID}` && options.method === "DELETE") return Response.json({});
    if (pathname === "/rest/v1/profiles") return Response.json([]);
    if (pathname === `/auth/v1/admin/users/${USER_ID}`) return Response.json({ message: "not found" }, { status: 404 });
    throw new Error(`unexpected request ${url}`);
  };

  await assert.rejects(
    () => provisionDisposableStaff(config, {
      fetchImpl,
      randomUUID: () => USER_ID,
      randomPassword: () => "test-only-password",
    }),
    (error) => error?.code === "admin_e2e_profile_create_failed",
  );
  assert.ok(calls.some((call) => call.pathname === `/auth/v1/admin/users/${USER_ID}` && call.method === "DELETE"));
});
