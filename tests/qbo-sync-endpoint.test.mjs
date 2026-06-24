import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../functions/api/qbo-sync.js", import.meta.url), "utf8");

test("qbo-sync endpoint is protected by QBO_SYNC_SECRET", () => {
  assert.match(SRC, /QBO_SYNC_SECRET/, "endpoint must require configured sync secret");
  assert.match(SRC, /x-qbo-sync-secret/i, "endpoint must read X-QBO-Sync-Secret header");
  assert.match(SRC, /qbo_sync_settings/, "endpoint must support Supabase-backed sync secret fallback");
  assert.match(SRC, /secret_sha256/, "fallback secret must use a hash instead of plaintext");
  assert.match(SRC, /json\(401,\s*\{\s*error:\s*'unauthorized'/,
    "bad or missing sync secret must return 401");
});

test("qbo-sync endpoint claims pending orders atomically", () => {
  assert.match(SRC, /rpc\(\s*'claim_qbo_orders'\s*,\s*\{\s*batch\s*\}/,
    "endpoint must use the claim_qbo_orders RPC");
  assert.match(SRC, /Math\.min\(25,\s*Math\.max\(1,/,
    "batch size must be bounded");
});

test("qbo-sync endpoint requeues claimed orders when token setup fails", () => {
  assert.match(SRC, /getAccessToken\(sb,\s*env\)/,
    "endpoint must verify QBO token access before processing claimed orders");
  assert.match(SRC, /nextSyncState\(order\.qbo_attempts/,
    "endpoint must compute retry state from the current attempt count");
  assert.match(SRC, /\.update\(\{\s*\.\.\.next/,
    "endpoint must persist retry state on claimed orders");
  assert.match(SRC, /qbo_error:\s*message/,
    "endpoint must record the failure reason");
});

test("qbo-sync endpoint posts claimed orders and records terminal sync state", () => {
  assert.match(SRC, /syncOrder\(/,
    "endpoint must hand claimed orders to the QBO order synchronizer");
  assert.match(SRC, /qbo_sync_status:\s*'synced'/,
    "successful QBO posts must mark orders synced");
  assert.match(SRC, /qbo_doc_id:\s*result\.docId/,
    "successful QBO posts must record the QBO document id");
  assert.match(SRC, /qbo_invoice_id(?:\s*:|\s*=)\s*result\.docId/,
    "invoice syncs must preserve the existing qbo_invoice_id column");
  assert.doesNotMatch(SRC, /qbo_document_sync_not_implemented|json\(501,/,
    "worker must not leave successfully claimed orders at the placeholder implementation boundary");
});
test("qbo-sync exposes a reusable worker for staff-triggered manual runs", () => {
  assert.match(SRC, /export async function runQboSync\(/,
    "admin-triggered sync should call the same worker used by cron");
  assert.match(SRC, /onRequestPost[\s\S]*runQboSync\(/,
    "public cron endpoint should delegate to the reusable worker after secret auth");
});
