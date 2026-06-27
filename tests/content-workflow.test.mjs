import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("content schema supports review, changes, scheduled, and locks", () => {
  const sql = readFileSync(new URL("../supabase/schema-content.sql", import.meta.url), "utf8");
  assert.match(sql, /in_review/);
  assert.match(sql, /changes_requested/);
  assert.match(sql, /scheduled/);
  assert.match(sql, /scheduled_at/);
  assert.match(sql, /locked_by/);
  assert.match(sql, /locked_at/);
});

test("content API exposes workflow actions with publish and review permissions", () => {
  const source = readFileSync(new URL("../functions/api/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /action === "submit_review"/);
  assert.match(source, /action === "request_changes"/);
  assert.match(source, /action === "schedule"/);
  assert.match(source, /scheduled_at_required/);
  assert.match(source, /staffCan\(role, "content\.review"\)/);
  assert.match(source, /staffCan\(role, "content\.publish"\)/);
});

test("content editor surfaces workflow queues and actions", () => {
  const source = readFileSync(new URL("../js/admin/content.js", import.meta.url), "utf8");
  assert.match(source, /contentWorkflowQueue/);
  assert.match(source, /workflowEntries/);
  assert.match(source, /status:\s*"all"/);
  assert.match(source, /data-content-workflow/);
  assert.match(source, /Submit for review/);
  assert.match(source, /Schedule publish/);
});
