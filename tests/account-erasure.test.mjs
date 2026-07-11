import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { deleteAccountUser } from "../functions/_lib/account-erasure.js";

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

test("self-service deletion is authenticated but not company-gated and fails closed", () => {
  const route = readFileSync(
    new URL("../functions/api/account/delete.js", import.meta.url),
    "utf8",
  );

  assert.match(route, /userFromRequest\(request,\s*env\)/);
  assert.match(route, /adminClient\(env\)/);
  assert.doesNotMatch(route, /requireCompany/);
  assert.match(route, /confirm\s*!==\s*'DELETE'/);
  assert.match(route, /await\s+deleteAccountUser\(sb,\s*user\.id\)/);
  assert.match(route, /account_erasure_not_ready[\s\S]*503/);
  assert.match(route, /json\(500[\s\S]*delete_failed/);
  assert.doesNotMatch(route, /\.from\('orders'\)|deleteUser\(|\bdetail\s*:/);
});
