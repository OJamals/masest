import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { deleteAccountUser } from "../functions/_lib/account-erasure.js";
import { companyAdminErasureGuard } from "../functions/api/account/delete.js";

function fakeClient({ ready = true, rpcError = null, deleteError = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name) => {
      calls.push(["rpc", name]);
      return { data: ready, error: rpcError };
    },
    auth: {
      admin: {
        deleteUser: async (userId) => {
          calls.push(["deleteUser", userId]);
          return { error: deleteError };
        },
      },
    },
  };
}

function fakeRouteClient({
  profile = { company_id: null, role: "buyer" },
  profileError = null,
  members = [],
  memberError = null,
  ready = true,
  rpcError = null,
  deleteError = null,
} = {}) {
  const sb = fakeClient({ ready, rpcError, deleteError });
  sb.from = (table) => {
    assert.equal(table, "profiles");
    sb.calls.push(["from", table]);
    const filters = [];
    const query = {
      select(columns) {
        sb.calls.push(["select", columns]);
        return query;
      },
      eq(column, value) {
        filters.push([column, value]);
        sb.calls.push(["eq", column, value]);
        return query;
      },
      async maybeSingle() {
        sb.calls.push(["maybeSingle"]);
        return { data: profile, error: profileError };
      },
      then(resolve, reject) {
        sb.calls.push(["execute"]);
        return Promise.resolve({ data: members, error: memberError }).then(
          resolve,
          reject,
        );
      },
    };
    return query;
  };
  return sb;
}

async function responseResult(response) {
  return { status: response.status, body: await response.json() };
}

test("user without a Company can erase the account", async () => {
  const sb = fakeRouteClient();

  assert.equal(await companyAdminErasureGuard(sb, "user-1"), null);
  assert.equal(sb.calls.some(([name]) => name === "rpc"), false);
  assert.equal(sb.calls.some(([name]) => name === "deleteUser"), false);
});

test("buyer-role Company member can erase the account", async () => {
  const sb = fakeRouteClient({
    profile: { company_id: "company-1", role: "buyer" },
  });

  assert.equal(await companyAdminErasureGuard(sb, "user-1"), null);
  assert.equal(sb.calls.some(([name]) => name === "execute"), false);
});

test("Company admin can erase the account when another admin remains", async () => {
  const sb = fakeRouteClient({
    profile: { company_id: "company-1", role: "admin" },
    members: [
      { id: "user-1", role: "admin" },
      { id: "user-2", role: "admin" },
    ],
  });

  assert.equal(await companyAdminErasureGuard(sb, "user-1"), null);
  assert.equal(sb.calls.some(([name]) => name === "execute"), true);
});

test("sole Company admin receives guidance before any erasure side effect", async () => {
  const sb = fakeRouteClient({
    profile: { company_id: "company-1", role: "admin" },
    members: [{ id: "user-1", role: "admin" }],
  });

  assert.deepEqual(await responseResult(
    await companyAdminErasureGuard(sb, "user-1"),
  ), {
    status: 409,
    body: {
      error: "last_company_admin",
      message: "Transfer ownership through Team settings before deleting your account.",
    },
  });
  assert.deepEqual(sb.calls, [
    ["from", "profiles"],
    ["select", "company_id,role"],
    ["eq", "id", "user-1"],
    ["maybeSingle"],
    ["from", "profiles"],
    ["select", "id,role"],
    ["eq", "company_id", "company-1"],
    ["execute"],
  ]);
});

test("profile query failure fails closed before any erasure side effect", async () => {
  const sb = fakeRouteClient({
    profileError: new Error("profile query failed"),
  });

  assert.deepEqual(await responseResult(
    await companyAdminErasureGuard(sb, "user-1"),
  ), {
    status: 500,
    body: { error: "server_error" },
  });
  assert.deepEqual(sb.calls, [
    ["from", "profiles"],
    ["select", "company_id,role"],
    ["eq", "id", "user-1"],
    ["maybeSingle"],
  ]);
});

test("member query failure fails closed before any erasure side effect", async () => {
  const sb = fakeRouteClient({
    profile: { company_id: "company-1", role: "admin" },
    memberError: new Error("member query failed"),
  });

  assert.deepEqual(await responseResult(
    await companyAdminErasureGuard(sb, "user-1"),
  ), {
    status: 500,
    body: { error: "server_error" },
  });
  assert.equal(sb.calls.some(([name]) => name === "rpc"), false);
  assert.equal(sb.calls.some(([name]) => name === "deleteUser"), false);
});

test("account erasure fails closed before auth deletion when readiness cannot be proven", async () => {
  const sb = fakeClient({ rpcError: new Error("migration missing") });

  assert.deepEqual(await deleteAccountUser(sb, "user-1"), {
    ok: false,
    code: "account_erasure_not_ready",
  });
  assert.deepEqual(sb.calls, [["rpc", "account_erasure_ready"]]);
});

test("account erasure treats a false readiness result as unavailable", async () => {
  const sb = fakeClient({ ready: false });

  assert.deepEqual(await deleteAccountUser(sb, "user-2"), {
    ok: false,
    code: "account_erasure_not_ready",
  });
  assert.deepEqual(sb.calls, [["rpc", "account_erasure_ready"]]);
});

test("account erasure returns a stable failure without exposing auth errors", async () => {
  const rawError = "sensitive auth failure";
  const sb = fakeClient({ deleteError: new Error(rawError) });

  const result = await deleteAccountUser(sb, "user-3");

  assert.deepEqual(result, { ok: false, code: "delete_failed" });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(rawError));
  assert.deepEqual(sb.calls, [
    ["rpc", "account_erasure_ready"],
    ["deleteUser", "user-3"],
  ]);
});

test("account erasure reports success only after auth deletion succeeds", async () => {
  const sb = fakeClient();

  assert.deepEqual(await deleteAccountUser(sb, "user-4"), { ok: true });
  assert.deepEqual(sb.calls, [
    ["rpc", "account_erasure_ready"],
    ["deleteUser", "user-4"],
  ]);
});

test("account erasure migration moves pseudonymization into the auth delete transaction", () => {
  const migrationUrl = new URL("../supabase/schema-account-erasure.sql", import.meta.url);
  assert.equal(existsSync(migrationUrl), true, "account erasure migration should exist");
  const sql = readFileSync(migrationUrl, "utf8");

  assert.match(sql, /before\s+delete\s+on\s+auth\.users/i);
  assert.match(sql, /security\s+definer/i);
  assert.match(sql, /set\s+search_path\s*=\s*public\s*,\s*pg_temp/i);
  assert.match(sql, /update\s+public\.orders[\s\S]*set[\s\S]*user_id\s*=\s*null[\s\S]*customer_email\s*=\s*'anon-'\s*\|\|\s*old\.id(?:::\w+)?\s*\|\|\s*'@deleted\.invalid'[\s\S]*where\s+user_id\s*=\s*old\.id/i);
  assert.match(sql, /create\s+or\s+replace\s+function\s+public\.account_erasure_ready\s*\(/i);
  assert.match(sql, /revoke\s+[^;]+account_erasure_ready\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated/i);
  assert.match(sql, /grant\s+execute\s+on\s+function\s+public\.account_erasure_ready\s*\(\s*\)\s+to\s+service_role/i);
});

test("self-service deletion authenticates, confirms, and guards Company ownership", () => {
  const route = readFileSync(
    new URL("../functions/api/account/delete.js", import.meta.url),
    "utf8",
  );

  assert.match(route, /userFromRequest\(request,\s*env\)/);
  assert.match(route, /adminClient\(env\)/);
  assert.doesNotMatch(route, /requireCompany/);
  assert.match(route, /confirm\s*!==\s*'DELETE'/);
  assert.match(route, /await\s+companyAdminErasureGuard\(sb,\s*user\.id\)/);
  assert.match(route, /await\s+deleteAccountUser\(sb,\s*user\.id\)/);
  assert.match(route, /\.from\('profiles'\)[\s\S]*select\('company_id,role'\)/);
  assert.match(route, /isLastAdmin\(memberResult\.data,\s*userId\)/);
  assert.match(route, /last_company_admin[\s\S]*Team settings/);
  assert.ok(
    route.indexOf("await companyAdminErasureGuard(sb, user.id)")
      < route.indexOf("await deleteAccountUser(sb, user.id)"),
    "Company-admin guard must run before readiness RPC and Auth deletion",
  );
  assert.match(route, /account_erasure_not_ready[\s\S]*503/);
  assert.match(route, /json\(500[\s\S]*delete_failed/);
  assert.doesNotMatch(route, /\.from\('orders'\)|deleteUser\(|\bdetail\s*:/);
});
