import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const expectedColumns = /grant\s+select\s*\(\s*type\s*,\s*slug\s*,\s*title\s*,\s*status\s*,\s*locale\s*,\s*payload\s*,\s*seo\s*\)\s+on\s+(?:table\s+)?public\.content_entries\s+to\s+anon\s*;/i;
const publishedOnlyPolicy = /create\s+policy\s+content_entries_published_snapshot_read[\s\S]+?for\s+select[\s\S]+?to\s+anon[\s\S]+?using\s*\(\s*status\s*=\s*'published'(?:::public\.content_status)?\s*\)/i;

test("content schema grants anon only the published snapshot fields", () => {
  const schema = read("supabase/schema-content.sql");

  assert.match(schema, /alter\s+table\s+public\.content_entries\s+enable\s+row\s+level\s+security\s*;/i);
  assert.match(schema, /revoke\s+all\s+privileges\s+on\s+(?:table\s+)?public\.content_entries\s+from\s+anon\s*;/i);
  assert.match(schema, expectedColumns);
  assert.match(schema, publishedOnlyPolicy);
  assert.doesNotMatch(schema, /grant\s+(?:insert|update|delete|all)[^;]*content_entries[^;]*to\s+anon/i);
});

test("production migration applies the same least-privilege snapshot contract", () => {
  const migration = read("supabase/migrate-content-snapshot-read-2026-09-02.sql");

  assert.match(migration, /alter\s+table\s+public\.content_entries\s+enable\s+row\s+level\s+security\s*;/i);
  assert.match(migration, /revoke\s+all\s+privileges\s+on\s+(?:table\s+)?public\.content_entries\s+from\s+anon\s*;/i);
  assert.match(migration, expectedColumns);
  assert.match(migration, publishedOnlyPolicy);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all)[^;]*content_entries[^;]*to\s+anon/i);
});
