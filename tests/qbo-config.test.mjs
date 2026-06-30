import assert from "node:assert/strict";
import test from "node:test";

import {
  QBO_REQUIRED_KEYS,
  qboConfigEnv,
  qboConfigStatus,
} from "../functions/_lib/qbo-config.js";

const connectKeyPayload = {
  client_id: "qbo-client-id",
  client_secret: "qbo-client-secret",
  redirect_uri: "https://masest.co/api/admin/qbo/callback",
  oauth_state_secret: "oauth-state-secret",
  sync_secret: "sync-secret",
  income_account_id: "79",
  environment: "production",
  realm_id: "realm-123",
};

test("QBO_CONNECT_KEY imports every required QuickBooks runtime value", () => {
  const env = qboConfigEnv({ QBO_CONNECT_KEY: JSON.stringify(connectKeyPayload) });

  assert.equal(env.QBO_CLIENT_ID, "qbo-client-id");
  assert.equal(env.QBO_CLIENT_SECRET, "qbo-client-secret");
  assert.equal(env.QBO_REDIRECT_URI, "https://masest.co/api/admin/qbo/callback");
  assert.equal(env.QBO_OAUTH_STATE_SECRET, "oauth-state-secret");
  assert.equal(env.QBO_SYNC_SECRET, "sync-secret");
  assert.equal(env.QBO_INCOME_ACCOUNT_ID, "79");
  assert.equal(env.QBO_ENVIRONMENT, "production");
  assert.equal(env.QBO_REALM_ID, "realm-123");
  assert.deepEqual(qboConfigStatus(env).missing, []);
});

test("QBO_CONNECT_KEY accepts base64 JSON bundles and explicit env overrides", () => {
  const encoded = Buffer.from(JSON.stringify(connectKeyPayload), "utf8").toString("base64");
  const env = qboConfigEnv({
    QBO_CONNECT_KEY: encoded,
    QBO_ENVIRONMENT: "sandbox",
  });

  assert.equal(env.QBO_CLIENT_ID, "qbo-client-id");
  assert.equal(env.QBO_ENVIRONMENT, "sandbox");
  assert.deepEqual(qboConfigStatus(env).missing, []);
});

test("qboConfigStatus reports missing keys without leaking imported secrets", () => {
  const status = qboConfigStatus({
    QBO_CONNECT_KEY: JSON.stringify({ client_id: "qbo-client-id" }),
  });

  assert.equal(status.source, "QBO_CONNECT_KEY");
  assert.deepEqual(
    status.missing,
    QBO_REQUIRED_KEYS.filter((key) => key !== "QBO_CLIENT_ID"),
  );
  assert.equal(JSON.stringify(status).includes("qbo-client-id"), false);
});
