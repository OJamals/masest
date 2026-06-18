import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../supabase/schema-email.sql", import.meta.url), "utf8");

test("schema-email defines email_events and email_suppressions", () => {
  assert.match(SRC, /create table if not exists public\.email_events/i);
  assert.match(SRC, /create table if not exists public\.email_suppressions/i);
  assert.match(SRC, /resend_id\s+text/i);
  assert.match(SRC, /status\s+text[^;]*default\s+'sent'/i);
  assert.match(SRC, /email\s+text\s+primary key/i);
});

test("schema-email grants both tables to service_role (else 42501 on insert)", () => {
  assert.match(SRC, /grant all privileges on public\.email_events,\s*public\.email_suppressions to service_role/i);
  assert.match(SRC, /grant usage, select on all sequences in schema public to service_role/i);
});
