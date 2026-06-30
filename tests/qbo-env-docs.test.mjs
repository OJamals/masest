import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test(".env.example documents all QBO runtime variables", () => {
  const env = read(".env.example");
  for (const key of [
    "QBO_CONNECT_KEY",
    "QBO_CLIENT_ID",
    "QBO_CLIENT_SECRET",
    "QBO_REDIRECT_URI",
    "QBO_OAUTH_STATE_SECRET",
    "QBO_SYNC_SECRET",
    "QBO_INCOME_ACCOUNT_ID",
    "QBO_ENVIRONMENT",
  ]) {
    assert.match(env, new RegExp(`^${key}=`, "m"), `${key} missing`);
  }
  assert.doesNotMatch(env, /QuickBooks Online \/ Intuit \(Phase 3 — placeholders\)/);
});

test("QBO cron template schedules the protected sync endpoint", () => {
  const sql = read("supabase/qbo-cron.example.sql");
  assert.match(sql, /create extension if not exists pg_cron/);
  assert.match(sql, /create extension if not exists pg_net/);
  assert.match(sql, /create extension if not exists pgcrypto/);
  assert.match(sql, /qbo_sync_settings/);
  assert.match(sql, /secret_sha256/);
  assert.match(sql, /cron\.schedule\(\s*'qbo-sync'/);
  assert.match(sql, /net\.http_post/);
  assert.match(sql, /https:\/\/masest\.co\/api\/qbo-sync/);
  assert.match(sql, /x-qbo-sync-secret/i);
});

test("Cloudflare owner docs point to schema, cron, and QBO connect steps", () => {
  const docs = read("CLOUDFLARE_PAGES.md");
  assert.match(docs, /supabase\/schema-qbo\.sql/);
  assert.match(docs, /supabase\/qbo-cron\.example\.sql/);
  assert.match(docs, /pg_cron/);
  assert.match(docs, /pg_net/);
  assert.match(docs, /pgcrypto/);
  assert.match(docs, /SHA-256 hash/);
  assert.match(docs, /QBO_CONNECT_KEY/);
  assert.match(docs, /Connect QuickBooks/);
});
