import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SRC = readFileSync(new URL("../supabase/schema-conversion.sql", import.meta.url), "utf8");

test("conversion schema adds event + utm columns to page_views (additive)", () => {
  assert.match(SRC, /alter table public\.page_views add column if not exists event\s+text default 'pageview'/i);
  assert.match(SRC, /add column if not exists utm_source/i);
  assert.match(SRC, /add column if not exists utm_medium/i);
  assert.match(SRC, /add column if not exists utm_campaign/i);
  assert.match(SRC, /page_views_event_idx/i);
});
