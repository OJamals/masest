import assert from "node:assert/strict";
import test from "node:test";
import { getAccessToken, qboBaseUrl } from "../functions/_lib/qbo.js";

function fakeQboTokenStore(row) {
  const calls = { updated: null };
  const sb = {
    from(table) {
      assert.equal(table, "qbo_tokens");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: row, error: null }; },
        update(payload) {
          calls.updated = payload;
          return {
            eq() {
              return { async maybeSingle() { return { data: { ...row, ...payload }, error: null }; } };
            },
          };
        },
      };
    },
  };
  return { sb, calls };
}

test("qboBaseUrl selects sandbox unless production is explicit", () => {
  assert.equal(qboBaseUrl({ QBO_ENVIRONMENT: "sandbox" }), "https://sandbox-quickbooks.api.intuit.com");
  assert.equal(qboBaseUrl({ QBO_ENVIRONMENT: "production" }), "https://quickbooks.api.intuit.com");
  assert.equal(qboBaseUrl({}), "https://sandbox-quickbooks.api.intuit.com");
});

test("getAccessToken reuses an unexpired stored access token", async () => {
  const { sb, calls } = fakeQboTokenStore({
    realm_id: "realm_123",
    access_token: "access_live",
    refresh_token: "refresh_live",
    access_expires_at: "2026-06-18T13:00:00.000Z",
  });

  const token = await getAccessToken(sb, {}, {
    now: new Date("2026-06-18T12:00:00.000Z"),
    fetchImpl: async () => { throw new Error("fetch should not run"); },
  });

  assert.deepEqual(token, { accessToken: "access_live", realmId: "realm_123" });
  assert.equal(calls.updated, null);
});

test("getAccessToken refreshes an expired stored access token and persists rotation", async () => {
  const { sb, calls } = fakeQboTokenStore({
    realm_id: "realm_123",
    access_token: "access_old",
    refresh_token: "refresh_old",
    access_expires_at: "2026-06-18T11:00:00.000Z",
  });

  let request;
  const token = await getAccessToken(sb, {
    QBO_CLIENT_ID: "client_id",
    QBO_CLIENT_SECRET: "client_secret",
  }, {
    now: new Date("2026-06-18T12:00:00.000Z"),
    fetchImpl: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        async json() {
          return { access_token: "access_new", refresh_token: "refresh_new", expires_in: 3600 };
        },
      };
    },
  });

  assert.equal(request.url, "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer");
  assert.match(request.init.headers.authorization, /^Basic /);
  assert.match(String(request.init.body), /grant_type=refresh_token/);
  assert.match(String(request.init.body), /refresh_token=refresh_old/);
  assert.deepEqual(token, { accessToken: "access_new", realmId: "realm_123" });
  assert.equal(calls.updated.access_token, "access_new");
  assert.equal(calls.updated.refresh_token, "refresh_new");
  assert.equal(calls.updated.realm_id, "realm_123");
});
