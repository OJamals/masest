import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../supabase/schema-email.sql", import.meta.url), "utf8");

test("schema-email defines provider-neutral lifecycle events and suppressions", () => {
  assert.match(SRC, /create table if not exists public\.email_events/i);
  assert.match(SRC, /create table if not exists public\.email_suppressions/i);
  assert.match(SRC, /provider_message_id\s+text/i);
  assert.match(SRC, /create table if not exists public\.email_delivery_events/i);
  assert.match(SRC, /create or replace function public\.apply_email_delivery_event/i);
  assert.match(SRC, /status\s+text[^;]*default\s+'sent'/i);
  assert.match(SRC, /primary key \(email, stream\)/i);
});

test("schema-email grants all email tables and lifecycle RPC to service_role", () => {
  assert.match(SRC, /grant all privileges on public\.email_events,\s*public\.email_suppressions,\s*public\.email_delivery_events to service_role/i);
  assert.match(SRC, /grant execute on function public\.apply_email_delivery_event/i);
  assert.match(SRC, /grant usage, select on all sequences in schema public to service_role/i);
});
